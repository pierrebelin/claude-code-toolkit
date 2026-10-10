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
# one of them before the audit is forked — except comments, listed for the
# audit to judge since 2026-10-09.
#
# What stays with the audit: correctness, reuse, placement, cost, a stale plan.
# None of that is decidable by a grep.
#
# Usage:
#   cctoolkit pre-audit <batch> <sheet.md>
#
# Exit 0 = GREEN, the audit may be forked. Exit 1 = RED, fix and re-run.
# ══════════════════════════════════════════════════════════════════════════════

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <batch> <sheet.md>" >&2
    exit 2
fi

BATCH="$1"
SHEET="$2"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# kit_config.py beside scripts/ (plugin, toolkit); under .claude/lib/ in a copy
# predating the plugin, where scripts/ sat at the repo root.
KIT_PY="$HERE/lib/kit_config.py"
[[ -f "$KIT_PY" ]] || KIT_PY="$HERE/.claude/lib/kit_config.py"
SCRIPTS="$HERE/scripts"
ROOT="$(python3 "$KIT_PY" root)" || exit 2
cd "$ROOT" || exit 1

if [[ ! -f "$SHEET" ]]; then
    echo "sheet not found: $SHEET" >&2
    exit 2
fi

# Paths, comment prefix and tag carrier come from .claude/kit.config.json, resolved
# by kit_config.py.
if ! KIT_VARS="$(python3 "$KIT_PY" shell "$ROOT")"; then
    echo "kit.config.json unreadable — cctoolkit doctor" >&2
    exit 2
fi
eval "$KIT_VARS"
read -ra CODE_DIRS <<<"$KIT_SOURCE_DIRS $KIT_TEST_DIRS"
read -ra SOURCE_DIRS <<<"$KIT_SOURCE_DIRS"
read -ra SOURCE_INCLUDES <<<"$KIT_SOURCE_INCLUDES"

RED=0
ok()   { printf '  ✓ %s\n' "$1"; }
ko()   { printf '  ✗ %s\n' "$1"; RED=1; }
note() { printf '      %s\n' "$1"; }

# `git diff` ignores untracked files, and a batch's new handler and new tests
# are exactly that: each one is appended as a /dev/null → file patch.
batch_diff() {
    git diff 2>/dev/null
    git ls-files --others --exclude-standard -- "${CODE_DIRS[@]}" 2>/dev/null | while IFS= read -r f; do
        git diff --no-index -- /dev/null "$f" 2>/dev/null
    done
}

DIFF_FILE="$(mktemp)"
batch_diff >"$DIFF_FILE"

printf 'PRE-AUDIT — batch %s — sheet %s\n' "$BATCH" "$SHEET"

# ── 1. Every DDD/APP/PERF id classified by the sheet ─────────────────────────
IDS="$(python3 "$SCRIPTS"/rules-coverage.py --ids "$SHEET" 2>&1)"
if grep -q 'not cited : (none)' <<<"$IDS" && grep -q 'unknown references : (none)' <<<"$IDS"; then
    ok "DDD/APP/PERF ids: all classified"
else
    ko "DDD/APP/PERF ids unclassified or unknown — every id is applied on a sheet's \`kit:applied-rules\` row or listed \`N/A — reason\` on the global plan's \`kit:na-rules\` line"
    while IFS= read -r l; do note "$l"; done <<<"$IDS"
fi

# ── 2. Comments added to production code — listed, never failed ──────────────
# Added lines that *start* with the source comment prefix (`layout.sources.comment`,
# `//` for C#): a URL inside a string does not match, a rewritten XML doc block does.
# Whether a comment says what the code cannot is a judgment: the audit's `Comments`
# axis makes it. Listed with `·`, not `✗`: only `✗` lines are failures.
COMMENTS="$(python3 "$KIT_PY" diff-comments "$ROOT" <"$DIFF_FILE")"
if [[ -z "$COMMENTS" ]]; then
    ok "production comments: none added"
else
    printf '  · %s\n' "production comments added — each must say what the code cannot (constraint, decision, workaround); the audit judges them"
    while IFS= read -r l; do note "$l"; done <<<"$COMMENTS"
fi

# ── 3. Every modified file belongs to the batch ──────────────────────────────
# The source and test roots, the sheet and its plan folder are the batch. Anything
# else (.claude/, scripts/, packages, csproj outside src/tests) is a Scope
# deviation unless the sheet names it — then the audit reads it as declared.
PLAN_DIR="$(dirname "$SHEET")"
OUTSIDE=""
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ "$f" =~ ^$KIT_CODE_RE ]] && continue
    case "$f" in
        "$PLAN_DIR"/*|*/__pycache__/*) continue ;;
    esac
    if grep -qF -- "$(basename "$f")" "$SHEET"; then
        continue
    fi
    OUTSIDE+="$f"$'\n'
done < <(git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)
if [[ -z "$OUTSIDE" ]]; then
    ok "scope: every modified file is under $KIT_SCOPE_LABEL or $PLAN_DIR/"
else
    ko "files modified outside the batch and absent from the sheet — declare them under \`## Decisions\` (to isolate at commit) or restore them"
    while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$OUTSIDE"
fi

# ── 4. Trait ↔ handler table consistency, on the batch's test classes only ───
# Pre-existing unbound tests elsewhere are debt, not this batch's deviation:
# only a class the diff touches is judged here.
TOUCHED_CLASSES="$(python3 "$KIT_PY" diff-test-classes "$ROOT" <"$DIFF_FILE")"
TOUCHED_TRAITS="$(python3 "$KIT_PY" diff-tags "$ROOT" <"$DIFF_FILE")"
UNTESTED="$(python3 "$SCRIPTS"/rules-coverage.py --untested 2>&1)"
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
    ko "RM traits inconsistent with the handler rules tables (\`kit:rules\`) — update the handler CLAUDE.md before the audit"
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
ADDED_TESTS="$(python3 "$KIT_PY" diff-interaction "$ROOT" <"$DIFF_FILE")"
DOMAIN_WORDS="$(grep -rhoE "${SOURCE_INCLUDES[@]}" '\b[A-Za-z]*(Received|CallCount|Called)[A-Za-z]*\b' "${SOURCE_DIRS[@]}" 2>/dev/null | sort -u)"
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
