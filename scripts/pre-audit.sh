#!/usr/bin/env bash
set -uo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# Pre-audit gate — the mechanical half of /verify-ddd-tdd, in five seconds
# ══════════════════════════════════════════════════════════════════════════════
# Measured on 30 verdicts (2026-09-09 to 09-11): 27 GAPS, and the recurring
# causes were all deterministic — N ids never classified (8 times,
# Blocking), `///` rewritten in production code (5), `.claude/` hunks outside
# the batch (4), a trait citing a rule absent from the handler tables, a sheet
# left unclosed. Each one cost a five-minute Opus audit
# plus a correction round plus a `resume` audit. This script fails on every
# one of them before the audit is forked.
#
# What stays with the audit: correctness, reuse, placement, cost, a stale plan.
# None of that is decidable by a grep.
#
# Usage:
#   bash scripts/pre-audit.sh <batch> <sheet.md>
#
# Exit 0 = GREEN, the audit may be forked. Exit 1 = RED, fix and re-run.
# ══════════════════════════════════════════════════════════════════════════════

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <batch> <sheet.md>" >&2
    exit 2
fi

BATCH="$1"
SHEET="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

if [[ ! -f "$SHEET" ]]; then
    echo "sheet not found: $SHEET" >&2
    exit 2
fi

RED=0
ok()   { printf '  ✓ %s\n' "$1"; }
ko()   { printf '  ✗ %s\n' "$1"; RED=1; }
note() { printf '      %s\n' "$1"; }

# `git diff` ignores untracked files, and a batch's new handler and new tests
# are exactly that: each one is appended as a /dev/null → file patch.
batch_diff() {
    git diff 2>/dev/null
    git ls-files --others --exclude-standard -- src tests 2>/dev/null | while IFS= read -r f; do
        git diff --no-index -- /dev/null "$f" 2>/dev/null
    done
}

DIFF_FILE="$(mktemp)"
batch_diff >"$DIFF_FILE"

printf 'PRE-AUDIT — batch %s — sheet %s\n' "$BATCH" "$SHEET"

# ── 1. Every DDD/APP/PERF id classified by the sheet ─────────────────────────
IDS="$(python3 scripts/rules-coverage.py --ids "$SHEET" 2>&1)"
if grep -q 'not cited : (none)' <<<"$IDS" && grep -q 'unknown references : (none)' <<<"$IDS"; then
    ok "DDD/APP/PERF ids: all classified"
else
    ko "DDD/APP/PERF ids unclassified or unknown — every id is applied on a sheet's \`Applied rules\` row or listed \`N/A — reason\` on the global plan's \`Non-applicable rules\` line"
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
    ok "production comments: none added"
else
    ko "comments added to production code (\`//\` or \`///\`) — remove them, naming carries intent"
    while IFS= read -r l; do note "$l"; done <<<"$COMMENTS"
fi

# ── 3. Every modified file belongs to the batch ──────────────────────────────
# src/, tests/, the sheet and its plan folder are the batch. Anything else
# (.claude/, scripts/, packages, csproj outside src/tests) is a Scope
# deviation unless the sheet names it — then the audit reads it as declared.
PLAN_DIR="$(dirname "$SHEET")"
OUTSIDE=""
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in
        src/*|tests/*|"$PLAN_DIR"/*|*/__pycache__/*) continue ;;
    esac
    if grep -qF -- "$(basename "$f")" "$SHEET"; then
        continue
    fi
    OUTSIDE+="$f"$'\n'
done < <(git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)
if [[ -z "$OUTSIDE" ]]; then
    ok "scope: every modified file is under src/, tests/ or $PLAN_DIR/"
else
    ko "files modified outside the batch and absent from the sheet — declare them under \`## Decisions\` (to isolate at commit) or restore them"
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
        *"DEAD REFERENCE"*) needles="$TOUCHED_TRAITS" ;;
        *"UNBOUND TEST"*) needles="$TOUCHED_CLASSES" ;;
        *) continue ;;
    esac
    for n in $needles; do
        if [[ "$l" == *"$n"* ]]; then STALE+="$l"$'\n'; break; fi
    done
done <<<"$UNTESTED"
if [[ -z "$STALE" ]]; then
    ok "RM traits: no dead reference, no unbound test"
else
    ko "RM traits inconsistent with the \`## Règles métier\` tables — update the handler CLAUDE.md before the audit"
    while IFS= read -r l; do note "$l"; done <<<"$STALE"
fi

# ── 5. Sheet closed: every behaviour carries its three ticks ─────────────────
if grep -q 'RED ✅ · GREEN ✅ · COST ✅' "$SHEET" && ! grep -qE '(RED|GREEN|COST) ⬜' "$SHEET"; then
    ok "sheet: every behaviour carries \`TDD: RED ✅ · GREEN ✅ · COST ✅\`"
else
    ko "sheet not closed — every delivered behaviour carries \`TDD: RED ✅ · GREEN ✅ · COST ✅\`, no ⬜ tick left"
fi

# ── 6. Whitespace ────────────────────────────────────────────────────────────
if git diff --check >/dev/null 2>&1; then
    ok "git diff --check: clean"
else
    ko "git diff --check reports trailing whitespace or conflict markers"
fi

# ── 7. Handler tests observe results and SavedEvents, never the double ──────
# test-scope.md §5 was there, the audit still found a spy or a double's state
# asserted in 7 batches (2026-09-09 to 10-01): `…Received` captures, a call
# recorder read back, `Assert.Single(_fixture.Repository.EncodingProfiles)`.
# Spy names are identifiers holding Received/CallCount/Called that src/ does
# not already use (`ReceivedFrom` is domain vocabulary, not a spy).
ADDED_TESTS="$(awk '
    /^\+\+\+ b\// { file = substr($0, 7); intests = (file ~ /^tests\/[^\/]*\.(UnitTests|CoreTests)\//) }
    /^@@/ { match($0, /\+[0-9]+/); line = substr($0, RSTART + 1, RLENGTH - 1) - 1; next }
    intests && /^\+/ && !/^\+\+\+/ { line++; print file ":" line ": " substr($0, 2); next }
    intests && /^-/ && !/^---/ { next }
    intests && /^ / { line++ }
' "$DIFF_FILE")"
DOMAIN_WORDS="$(grep -rhoE --include='*.cs' '\b[A-Za-z]*(Received|CallCount|Called)[A-Za-z]*\b' src 2>/dev/null | sort -u)"
INTERACTIONS=""
while IFS= read -r l; do
    [[ -z "$l" ]] && continue
    code="${l#*: }"
    spy=""
    while IFS= read -r w; do
        [[ -n "$w" ]] && ! grep -qxF -- "$w" <<<"$DOMAIN_WORDS" && spy="$w"
    done < <(grep -oE '\b[A-Za-z]*(Received|CallCount|Called)[A-Za-z]*\b' <<<"$code")
    state="$(grep -oE 'Assert\.[A-Za-z]+\(_fixture\.[A-Za-z]*(Repository|Service|Client|Gateway)\.[A-Za-z]+' <<<"$code" | grep -vE '\.(Saved[A-Za-z]*)?Events$')"
    [[ -n "$spy" || -n "$state" ]] && INTERACTIONS+="$l"$'\n'
done <<<"$ADDED_TESTS"
if [[ -z "$INTERACTIONS" ]]; then
    ok "handler tests: no interaction or double-state assertion"
else
    ko "interaction or double-state assertion — test-scope.md §5: returned result (query), type and content of \`SavedEvents\` (command)"
    while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$INTERACTIONS"
fi

rm -f "$DIFF_FILE"

if [[ $RED -eq 0 ]]; then
    printf 'PRE-AUDIT — batch %s: GREEN — the audit may be delegated\n' "$BATCH"
    exit 0
fi
printf 'PRE-AUDIT — batch %s: RED — fix and re-run, no audit before\n' "$BATCH"
exit 1
