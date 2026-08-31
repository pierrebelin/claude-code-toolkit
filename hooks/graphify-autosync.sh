#!/bin/bash
# Auto-sync du graphe graphify en fin de session.
#
# Declenchement : empreinte du working tree (voir graphify-freshness.sh), pas un
# flag pose par les hooks Edit/Write. Capte donc aussi les editions IDE, merges,
# pulls et changements de branche.
#
# Verification : mtime de graph.json avant/apres. graphify update sort en code 0
# sans rien ecrire dans plusieurs cas (garde-fou anti-regression de noeuds,
# "Nothing to update"), donc ni le code retour ni stdout ne prouvent l'ecriture.
#
# Le garde-fou refuse d'ecrire quand le nouveau graphe a moins de noeuds que
# l'ancien, protection contre les chunks manquants d'une session partielle. Une
# baisse est pourtant normale apres un refactor supprimant du code : on rejoue
# avec --force si l'extraction est complete et la baisse sous le seuil, sinon on
# alerte sans ecraser.

# Repo derive de l'emplacement du script (.claude/hooks/ -> racine). Sans cela, un
# defaut en dur ferait mettre a jour le graphe d'un AUTRE repo depuis ce hook.
REPO="${GRAPHIFY_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GRAPHIFY="$HOME/.local/bin/graphify"
GRAPH="$REPO/graphify-out/graph.json"
FRESHNESS="$REPO/.claude/hooks/graphify-freshness.sh"
export GRAPHIFY_REPO="$REPO"   # freshness doit viser le meme repo
LOG=/tmp/graphify-hook.log
LOCK=/tmp/graphify-autosync.lock
MAX_SHRINK_PCT=2

SID=$(cat 2>/dev/null | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1 (session=$SID)" >> "$LOG"; }
mtime() { stat -f %m "$GRAPH" 2>/dev/null || echo 0; }

[ -x "$GRAPHIFY" ] || { say "graphify introuvable, skip"; exit 0; }

# Verrou atomique : deux sessions qui s'arretent ensemble lanceraient deux
# rebuilds concurrents de ~64s sur le meme graph.json.
if ! mkdir "$LOCK" 2>/dev/null; then
  say "skip, un autre autosync tient le verrou"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

STALE=$("$FRESHNESS" --refresh)
if [ "$STALE" = "0" ]; then
  say "skip, graphe a jour"
  exit 0
fi
if [ "$STALE" = "-1" ]; then
  say "ALERTE graph.json absent, lancer un build initial"
  exit 0
fi

BEFORE=$(mtime)
OUT=$("$GRAPHIFY" update "$REPO" 2>&1)

if [ "$(mtime)" != "$BEFORE" ]; then
  say "update OK, $STALE fichiers rattrapes"
  "$FRESHNESS" --refresh >/dev/null
  exit 0
fi

# Rien d'ecrit. Seul le refus pour regression de noeuds est rattrapable.
if ! grep -qF 'Refusing to overwrite' <<<"$OUT"; then
  say "ALERTE update n'a rien ecrit et n'a pas invoque le garde-fou. Derniere ligne: $(tail -1 <<<"$OUT")"
  exit 0
fi

NEW=$(sed -n 's/.*new graph has \([0-9]*\) nodes.*/\1/p' <<<"$OUT" | head -1)
OLD=$(sed -n 's/.*existing graph.json has \([0-9]*\).*/\1/p' <<<"$OUT" | head -1)
# Recherche litterale : grep peut etre ugrep, qui rejette les retro-references BRE.
COMPLETE=$(grep -cF '(100%)' <<<"$OUT")

if [ -z "$NEW" ] || [ -z "$OLD" ] || [ "$OLD" -le 0 ]; then
  say "ALERTE update refuse, comptage de noeuds illisible, graphe inchange"
  exit 0
fi

SHRINK=$(( (OLD - NEW) * 100 / OLD ))
if [ "$COMPLETE" -eq 0 ] || [ "$SHRINK" -gt "$MAX_SHRINK_PCT" ]; then
  say "ALERTE update refuse, $OLD->$NEW noeuds (-${SHRINK}%), extraction complete=$COMPLETE. Graphe inchange, verifier a la main"
  exit 0
fi

FOUT=$("$GRAPHIFY" update "$REPO" --force 2>&1)
if [ "$(mtime)" != "$BEFORE" ]; then
  say "update --force OK, $OLD->$NEW noeuds (-${SHRINK}%, code supprime), $STALE fichiers rattrapes"
  "$FRESHNESS" --refresh >/dev/null
else
  say "ALERTE update --force n'a rien ecrit. Derniere ligne: $(tail -1 <<<"$FOUT")"
fi
