#!/usr/bin/env bash
set -uo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# Pre-audit gate — the mechanical half of /verify-ddd-tdd, in five seconds
# ══════════════════════════════════════════════════════════════════════════════
# Measured on 30 verdicts (2026-09-09 to 09-11): 27 ECARTS, and the recurring
# causes were all deterministic — "N identifiants jamais classés" (8 times,
# Bloquant), `///` rewritten in production code (5), `.claude/` hunks outside
# the batch (4), a trait citing a rule absent from the handler tables, a sheet
# left unclosed. Each one cost a five-minute Opus audit
# plus a correction round plus a `reprise` audit. This script fails on every
# one of them before the audit is forked.
#
# What stays with the audit: correctness, reuse, placement, cost, "Plan périmé".
# None of that is decidable by a grep.
#
# Usage:
#   bash scripts/pre-audit.sh <lot> <fiche.md>
#
# Exit 0 = VERT, the audit may be forked. Exit 1 = ROUGE, fix and re-run.
# ══════════════════════════════════════════════════════════════════════════════

if [[ $# -ne 2 ]]; then
    echo "usage : $0 <lot> <fiche.md>" >&2
    exit 2
fi

LOT="$1"
FICHE="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

if [[ ! -f "$FICHE" ]]; then
    echo "fiche introuvable : $FICHE" >&2
    exit 2
fi

RED=0
ok()   { printf '  ✓ %s\n' "$1"; }
ko()   { printf '  ✗ %s\n' "$1"; RED=1; }
note() { printf '      %s\n' "$1"; }

DIFF_FILE="$(mktemp)"
git diff >"$DIFF_FILE" 2>/dev/null

printf 'PRE-AUDIT — lot %s — fiche %s\n' "$LOT" "$FICHE"

# ── 1. Every DDD/APP/PERF id classified by the sheet ─────────────────────────
IDS="$(python3 scripts/rules-coverage.py --ids "$FICHE" 2>&1)"
if grep -q 'non cités : (aucun)' <<<"$IDS" && grep -q 'références inconnues : (aucune)' <<<"$IDS"; then
    ok "identifiants DDD/APP/PERF : tous classés"
else
    ko "identifiants DDD/APP/PERF non classés ou inconnus — chaque id doit être \`applique\` ou \`N/A — raison\` dans la fiche"
    while IFS= read -r l; do note "$l"; done <<<"$IDS"
fi

# ── 2. No comment added to production code ───────────────────────────────────
# Added lines that *start* with `//` or `///`: a URL inside a string does not
# match, a rewritten XML doc block does.
COMMENTS="$(awk '
    /^\+\+\+ b\// { file = substr($0, 7); insrc = (file ~ /^src\//) }
    /^@@/ { match($0, /\+[0-9]+/); line = substr($0, RSTART + 1, RLENGTH - 1) - 1; next }
    insrc && /^\+/ && !/^\+\+\+/ { line++; if ($0 ~ /^\+[[:space:]]*\/\//) print file ":" line ": " substr($0, 2); next }
    insrc && /^-/ && !/^---/ { next }
    insrc && /^ / { line++ }
' "$DIFF_FILE")"
if [[ -z "$COMMENTS" ]]; then
    ok "commentaires en production : aucun ajouté"
else
    ko "commentaires ajoutés en production (\`//\` ou \`///\`) — supprimer, l'intention passe par le nommage"
    while IFS= read -r l; do note "$l"; done <<<"$COMMENTS"
fi

# ── 3. Every modified file belongs to the batch ──────────────────────────────
# src/, tests/, the sheet and its plan folder are the batch. Anything else
# (.claude/, scripts/, packages, csproj outside src/tests) is a Périmètre
# deviation unless the sheet names it — then the audit reads it as declared.
PLAN_DIR="$(dirname "$FICHE")"
OUTSIDE=""
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in
        src/*|tests/*|"$PLAN_DIR"/*|*/__pycache__/*) continue ;;
    esac
    if grep -qF -- "$(basename "$f")" "$FICHE"; then
        continue
    fi
    OUTSIDE+="$f"$'\n'
done < <(git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)
if [[ -z "$OUTSIDE" ]]; then
    ok "périmètre : tous les fichiers modifiés sont dans src/, tests/ ou $PLAN_DIR/"
else
    ko "fichiers modifiés hors lot, absents de la fiche — les déclarer sous \`## Decisions\` (à isoler au commit) ou les restaurer"
    while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$OUTSIDE"
fi

# ── 4. Trait ↔ handler table consistency, on the batch's test classes only ───
# Pre-existing unbound tests elsewhere are debt, not this batch's deviation:
# only a class the diff touches is judged here.
TOUCHED_CLASSES="$(grep -oE '^\+\+\+ b/tests/.*/[A-Za-z0-9_]+\.cs$' "$DIFF_FILE" | sed -E 's#.*/([A-Za-z0-9_]+)\.cs$#\1#' | sort -u)"
TOUCHED_TRAITS="$(grep -oE '^\+.*Trait\("RM", *"[^"]+"' "$DIFF_FILE" | sed -E 's#.*"RM", *"([^"]+)"#\1#' | sort -u)"
UNTESTED="$(python3 scripts/rules-coverage.py --untested 2>&1)"
STALE=""
while IFS= read -r l; do
    case "$l" in
        *"RÉFÉRENCE MORTE"*) needles="$TOUCHED_TRAITS" ;;
        *"TEST NON RATTACHÉ"*) needles="$TOUCHED_CLASSES" ;;
        *) continue ;;
    esac
    for n in $needles; do
        if [[ "$l" == *"$n"* ]]; then STALE+="$l"$'\n'; break; fi
    done
done <<<"$UNTESTED"
if [[ -z "$STALE" ]]; then
    ok "traits RM : aucune référence morte, aucun test non rattaché"
else
    ko "traits RM incohérents avec les tableaux \`## Règles métier\` — mettre à jour le CLAUDE.md du handler avant l'audit"
    while IFS= read -r l; do note "$l"; done <<<"$STALE"
fi

# ── 5. Sheet closed: every behaviour carries its three ticks ─────────────────
if grep -q 'RED ✅ · GREEN ✅ · COUT ✅' "$FICHE" && ! grep -qE '(RED|GREEN|COUT) ⬜' "$FICHE"; then
    ok "fiche : chaque comportement porte \`TDD : RED ✅ · GREEN ✅ · COUT ✅\`"
else
    ko "fiche non clôturée — chaque comportement livré porte \`TDD : RED ✅ · GREEN ✅ · COUT ✅\`, aucune coche ⬜ ne reste"
fi

# ── 6. Whitespace ────────────────────────────────────────────────────────────
if git diff --check >/dev/null 2>&1; then
    ok "git diff --check : propre"
else
    ko "git diff --check signale des espaces en fin de ligne ou des conflits"
fi

rm -f "$DIFF_FILE"

if [[ $RED -eq 0 ]]; then
    printf 'PRE-AUDIT — lot %s : VERT — l'\''audit peut être délégué\n' "$LOT"
    exit 0
fi
printf 'PRE-AUDIT — lot %s : ROUGE — corriger puis relancer, pas d'\''audit avant\n' "$LOT"
exit 1
