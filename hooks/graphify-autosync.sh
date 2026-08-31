#!/bin/bash
# Auto-sync of the graphify graph at the end of a session.
#
# Trigger: working tree fingerprint (see graphify-freshness.sh), not a flag
# dropped by the Edit/Write hooks. So it also catches IDE edits, merges, pulls
# and branch switches.
#
# Verification: mtime of graph.json before/after. graphify update exits 0 without
# writing anything in several cases (node-shrink guard, "Nothing to update"), so
# neither the exit code nor stdout proves a write happened.
#
# The guard refuses to write when the new graph has fewer nodes than the old one,
# protecting against the missing chunks of a partial session. A drop is however
# normal after a refactor that deletes code: replay with --force if the extraction
# is complete and the drop is under the threshold, otherwise warn without
# overwriting.

# Repo derived from the script location (.claude/hooks/ -> root). Without that, a
# hardcoded default would update the graph of ANOTHER repo from this hook.
REPO="${GRAPHIFY_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GRAPHIFY="$HOME/.local/bin/graphify"
GRAPH="$REPO/graphify-out/graph.json"
FRESHNESS="$REPO/.claude/hooks/graphify-freshness.sh"
export GRAPHIFY_REPO="$REPO"   # freshness must target the same repo
LOG=/tmp/graphify-hook.log
LOCK=/tmp/graphify-autosync.lock
MAX_SHRINK_PCT=2

SID=$(cat 2>/dev/null | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1 (session=$SID)" >> "$LOG"; }
mtime() { stat -f %m "$GRAPH" 2>/dev/null || echo 0; }

[ -x "$GRAPHIFY" ] || { say "graphify not found, skip"; exit 0; }

# Atomic lock: two sessions stopping together would launch two concurrent
# ~64s rebuilds on the same graph.json.
if ! mkdir "$LOCK" 2>/dev/null; then
  say "skip, another autosync holds the lock"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

STALE=$("$FRESHNESS" --refresh)
if [ "$STALE" = "0" ]; then
  say "skip, graph up to date"
  exit 0
fi
if [ "$STALE" = "-1" ]; then
  say "ALERT graph.json missing, run an initial build"
  exit 0
fi

BEFORE=$(mtime)
OUT=$("$GRAPHIFY" update "$REPO" 2>&1)

if [ "$(mtime)" != "$BEFORE" ]; then
  say "update OK, $STALE files caught up"
  "$FRESHNESS" --refresh >/dev/null
  exit 0
fi

# Nothing written. Only the node-shrink refusal is recoverable.
if ! grep -qF 'Refusing to overwrite' <<<"$OUT"; then
  say "ALERT update wrote nothing and did not invoke the guard. Last line: $(tail -1 <<<"$OUT")"
  exit 0
fi

NEW=$(sed -n 's/.*new graph has \([0-9]*\) nodes.*/\1/p' <<<"$OUT" | head -1)
OLD=$(sed -n 's/.*existing graph.json has \([0-9]*\).*/\1/p' <<<"$OUT" | head -1)
# Literal search: grep may be ugrep, which rejects BRE back-references.
COMPLETE=$(grep -cF '(100%)' <<<"$OUT")

if [ -z "$NEW" ] || [ -z "$OLD" ] || [ "$OLD" -le 0 ]; then
  say "ALERT update refused, node count unreadable, graph unchanged"
  exit 0
fi

SHRINK=$(( (OLD - NEW) * 100 / OLD ))
if [ "$COMPLETE" -eq 0 ] || [ "$SHRINK" -gt "$MAX_SHRINK_PCT" ]; then
  say "ALERT update refused, $OLD->$NEW nodes (-${SHRINK}%), complete extraction=$COMPLETE. Graph unchanged, check by hand"
  exit 0
fi

FOUT=$("$GRAPHIFY" update "$REPO" --force 2>&1)
if [ "$(mtime)" != "$BEFORE" ]; then
  say "update --force OK, $OLD->$NEW nodes (-${SHRINK}%, code deleted), $STALE files caught up"
  "$FRESHNESS" --refresh >/dev/null
else
  say "ALERT update --force wrote nothing. Last line: $(tail -1 <<<"$FOUT")"
fi
