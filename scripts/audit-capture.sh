#!/usr/bin/env bash
set -uo pipefail
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

# Audit capture — the deterministic material for /verify-ddd-tdd, in one file.
# Usage:
#   cctoolkit audit-capture <batch> <sheet.md> <output> [--base <work>] [--suites-green <S1,S2>]
# --base: run work file with the batch's `batch-baseline snapshot`: the diff is the batch's own.
# --suites-green: writes `suites-green` beside the output, read by lib/guard-auditor.sh.
# Targeted test filters are left to the audit: only build and ArchitectureTests run here.
# The `## Mechanical audit — F<n>` section (table Axis | Check | Result | Evidence) states
# what the capture itself established: ok / gap / not checked. Read by ddd-tdd-auditor.

usage() {
    echo "Usage: cctoolkit audit-capture <batch> <sheet.md> <output> [--base <work>] [--suites-green <S1,S2>]" >&2
    exit 2
}
[[ $# -ge 3 ]] || usage
BATCH="$1"
SHEET="$2"
OUT="$3"
shift 3
BASE=""
GREEN=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --base) [[ $# -ge 2 ]] || usage; BASE="$2"; shift 2 ;;
        --suites-green) [[ $# -ge 2 ]] || usage; GREEN="$2"; shift 2 ;;
        *) usage ;;
    esac
done
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIT_PY="$HERE/lib/kit_config.py"
SCRIPTS="$HERE/scripts"
ROOT="$(python3 "$KIT_PY" root)" || exit 2
cd "$ROOT" || exit 1

if [[ ! -f "$SHEET" ]]; then
    echo "Sheet not found: $SHEET" >&2
    exit 2
fi

if ! KIT_VARS="$(python3 "$KIT_PY" shell "$ROOT")"; then
    echo "kit.config.json unreadable — cctoolkit doctor" >&2
    exit 2
fi
eval "$KIT_VARS"
read -ra CODE_DIRS <<<"$KIT_SOURCE_DIRS $KIT_TEST_DIRS"
read -ra SOURCE_INCLUDES <<<"$KIT_SOURCE_INCLUDES"

mkdir -p "$(dirname "$OUT")"
: > "$OUT"

MARKER="$(dirname "$OUT")/suites-green"
rm -f "$MARKER"
if [[ -n "$GREEN" ]]; then
    VERB="$(python3 "$KIT_PY" command test X 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) { if ($i == "rtk") continue; if ($i ~ /^-|\//) break; v = v (v ? " " : "") $i } print v }')"
    {
        printf 'verb: %s\nroots: %s\n' "$VERB" "$KIT_SOURCE_DIRS $KIT_TEST_DIRS"
        tr ',' '\n' <<<"$GREEN" | sed -n 's/^ *\([^ ]\{1,\}\) *$/suite: \1/p'
    } >"$MARKER"
fi

# Bounded: the auditor pays for every line of this file on every later turn.
DIFF_MAX=1200
LOG_MAX=6

section() { printf '\n=== %s ===\n' "$1" >>"$OUT"; }

# Runs a `commands.*` string, records its exit code, keeps at most LOG_MAX lines on failure.
run_check() {
    local label="$1" cmd="$2"
    local log rc
    log="$(mktemp)"
    eval "$cmd" >"$log" 2>&1
    rc=$?
    section "$label"
    printf 'command: %s\nexit: %s\n' "$cmd" "$rc" >>"$OUT"
    if [[ $rc -ne 0 ]]; then
        grep -E "error|Error|failed|Failed|FAIL" "$log" | head -"$LOG_MAX" >>"$OUT" \
            || tail -"$LOG_MAX" "$log" >>"$OUT"
    fi
    rm -f "$log"
    return $rc
}

# Mechanical audit rows: `mrow <axis> <check> <ok|gap|not checked> <evidence>`, one line, no pipe.
ROWS=""
mrow() {
    local ev="${4//$'\n'/ ; }"
    ROWS+="| $1 | $2 | $3 | ${ev//|/¦} |"$'\n'
}
# Reads test method names on stdin, prints those absent from the test roots (as pre-audit.sh).
missing_methods() {
    local wanted found
    wanted="$(grep -v '^$' | sort -u)"
    [[ -z "$wanted" ]] && return 0
    # shellcheck disable=SC2086 # test roots are segment globs, expanded here
    found="$(grep -rhowF "${SOURCE_INCLUDES[@]}" -f <(printf '%s\n' "$wanted") -- $KIT_TEST_DIRS 2>/dev/null | sort -u)"
    comm -23 <(printf '%s\n' "$wanted") <(printf '%s\n' "$found") | grep -v '^$'
}

printf '# Audit capture — batch %s\nsheet: %s\ngenerated: %s\n' \
    "$BATCH" "$SHEET" "$(date '+%F %H:%M')" >>"$OUT"

section "git status"
git status --short >>"$OUT" 2>&1

section "git diff --check"
CHECK_OUT="$(git diff --check 2>&1)"
CHECK_RC=$?
[[ -n "$CHECK_OUT" ]] && printf '%s\n' "$CHECK_OUT" >>"$OUT"

# Code only (.md and *.verified.* named under "changed files", never inlined);
# untracked files appended as /dev/null patches, `git diff` alone ignores them.
DIFF_SCOPE=(-- "${CODE_DIRS[@]}" ':(exclude)*.md' ':(exclude)*.verified.*')
batch_diff() {
    git diff "${DIFF_SCOPE[@]}" 2>/dev/null
    git ls-files --others --exclude-standard "${DIFF_SCOPE[@]}" 2>/dev/null | while IFS= read -r f; do
        git diff --no-index -- /dev/null "$f" 2>/dev/null
    done
}
DIFF_FILE="${OUT%.txt}.diff"
if [[ -n "$BASE" ]]; then
    python3 "$SCRIPTS"/batch-baseline.py diff "$BASE" "$BATCH" --code >"$DIFF_FILE" 2>/dev/null
else
    batch_diff >"$DIFF_FILE"
fi
DIFF_LINES=$(wc -l <"$DIFF_FILE" | tr -d ' ')

section "changed files"
if [[ -n "$BASE" ]]; then
    python3 "$SCRIPTS"/batch-baseline.py diff "$BASE" "$BATCH" --name-only >>"$OUT" 2>&1
else
    { git diff --name-only; git ls-files --others --exclude-standard -- "${CODE_DIRS[@]}"; } >>"$OUT" 2>&1
fi
printf '\n[diff below: code of the source and test folders only; .md, *.verified.* and anything outside them are listed here, read them targeted when an axis needs it]\n' >>"$OUT"

# Never truncated: past DIFF_MAX the capture carries an index of line ranges into the diff file.
section "batch diff ($DIFF_LINES lines)"
if [[ "$DIFF_LINES" -gt "$DIFF_MAX" ]]; then
    printf 'full diff: %s — read it file by file, ranges below (Read offset/limit), no file skipped\n\n' "$DIFF_FILE" >>"$OUT"
    awk '/^\+\+\+ /{ if (f) printf "%s: lines %d-%d\n", f, s, NR-2; f=$2; s=NR-1 } END { if (f) printf "%s: lines %d-%d\n", f, s, NR }' "$DIFF_FILE" >>"$OUT"
else
    cat "$DIFF_FILE" >>"$OUT"
fi

# TDD evidence of a sheet with a `## Cycles` block: one line per cycle.
STATE_DIR="$(dirname "$SHEET")/run/.work.jsonl"
python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --index >/dev/null 2>&1
if [[ $? -ne 2 ]]; then
    section "TDD cycles (scripts/sheet-cycles.py --summary)"
    python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --summary "$STATE_DIR" --batch "$BATCH" >>"$OUT" 2>&1
fi

# Stubs carrying logic recorded by lib/tdd_scope.py since the batch started; no record, no section.
SINCE="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import work_file; r = work_file.of(work_file.read(sys.argv[2]), "preexisting", sys.argv[3]); print(r[0].get("at", 0) if r else 0)' "$SCRIPTS/../lib" "$STATE_DIR" "$BATCH" 2>/dev/null || echo 0)"
STUBS="$(python3 "$SCRIPTS"/tdd-scope.py evidence --since "${SINCE:-0}" 2>/dev/null)"
if [[ -n "$STUBS" ]]; then
    section "stubs with logic (lib/tdd_scope.py, RED check)"
    printf '%s\n' "$STUBS" >>"$OUT"
fi

section "RM/CU coverage — rules with no test"
python3 "$SCRIPTS"/rules-coverage.py --untested >>"$OUT" 2>&1

section "DDD/APP/PERF id coverage of the sheet"
IDS="$(python3 "$SCRIPTS"/rules-coverage.py --ids "$SHEET" 2>&1)"
printf '%s\n' "$IDS" >>"$OUT"

if [[ -n "$BASE" ]]; then
    section "access cost (scripts/access-cost.py --base)"
    COST_OUT="$(python3 "$SCRIPTS"/access-cost.py --base "$BASE" "$BATCH" 2>&1)"; COST_RC=$?
    printf '%s\n' "$COST_OUT" >>"$OUT"
else
    section "access cost (scripts/access-cost.py --diff)"
    COST_OUT="$(python3 "$SCRIPTS"/access-cost.py --diff 2>&1)"; COST_RC=$?
    printf '%s\n' "$COST_OUT" >>"$OUT"
fi

# Build runs first: a red build makes every verdict below it meaningless.
BUILD_ROW=("not checked" "no commands.build in kit.config.json")
if [[ -z "$KIT_BUILD" ]]; then
    section "build"
    printf 'not run — no commands.build in kit.config.json\n' >>"$OUT"
elif grep -qE "^\+\+\+ b/$KIT_CODE_RE" "$DIFF_FILE"; then
    run_check "build" "$KIT_BUILD"; rc=$?
    if [[ $rc -eq 0 ]]; then BUILD_ROW=(ok "\`$KIT_BUILD\` exit 0"); else BUILD_ROW=(gap "\`$KIT_BUILD\` exit $rc"); fi
else
    section "build"
    printf 'not run — the diff touches neither %s\n' "$KIT_NEITHER_LABEL" >>"$OUT"
    BUILD_ROW=("not checked" "the diff touches neither $KIT_NEITHER_LABEL")
fi

# ArchitectureTests whole when a changed path matches `commands.architectureTest.when`.
ARCH_ROW=("not checked" "no commands.architectureTest in kit.config.json")
if [[ -z "$KIT_ARCH_RUN" || -z "$KIT_ARCH_WHEN" ]]; then
    section "ArchitectureTests"
    printf 'not run — no commands.architectureTest in kit.config.json\n' >>"$OUT"
elif sed -n 's#^+++ b/##p' "$DIFF_FILE" | grep -qE "$KIT_ARCH_WHEN"; then
    run_check "ArchitectureTests (whole suite)" "$KIT_ARCH_RUN"; rc=$?
    if [[ $rc -eq 0 ]]; then ARCH_ROW=(ok "\`$KIT_ARCH_RUN\` exit 0"); else ARCH_ROW=(gap "\`$KIT_ARCH_RUN\` exit $rc"); fi
else
    section "ArchitectureTests"
    printf 'not run — no handler, endpoint, repository, boundary or DI in the diff\n' >>"$OUT"
    ARCH_ROW=("not checked" "no handler, endpoint, repository, boundary or DI in the diff")
fi

# Mechanical audit: the rows this capture established itself, nothing it did not run.
section "Mechanical audit — $BATCH"
if [[ -n "$BASE" ]]; then
    BATCH_FILES="$(python3 "$SCRIPTS"/batch-baseline.py diff "$BASE" "$BATCH" --name-only 2>/dev/null)"
else
    BATCH_FILES="$(git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)"
fi
PLAN_DIR="$(dirname "$SHEET")"
OUTSIDE=""
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ "$f" =~ ^$KIT_CODE_RE ]] && continue
    case "$f" in
        .claude/*|todo/*|"$PLAN_DIR"/*|*/__pycache__/*) continue ;;
    esac
    grep -qF -- "$(basename "$f")" "$SHEET" && continue
    OUTSIDE+="$f "
done <<<"$BATCH_FILES"

if [[ $CHECK_RC -eq 0 ]]; then mrow Scope '`git diff --check`' ok 'clean'
else mrow Scope '`git diff --check`' gap "$(head -1 <<<"$CHECK_OUT")"; fi

SCOPE_CHECK='every modified file under the code roots, .claude/, todo/, the plan folder or named by the sheet'
if [[ -z "$OUTSIDE" ]]; then mrow Scope "$SCOPE_CHECK" ok 'none outside'
else mrow Scope "$SCOPE_CHECK" gap "outside and absent from the sheet: ${OUTSIDE% }"; fi

IDS_CHECK='DDD/APP/PERF ids all classified by the sheet'
if grep -qE '(not cited|non cités) : \((none|aucun)\)' <<<"$IDS" && grep -qE '(unknown references|références inconnues) : \((none|aucune)\)' <<<"$IDS"; then
    mrow Plan "$IDS_CHECK" ok '`not cited`: (none), `unknown references`: (none)'
else
    mrow Plan "$IDS_CHECK" gap "$(grep -E '(not cited|non cités|unknown references|références inconnues) :' <<<"$IDS" | tr '\n' ' ')"
fi

python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --index >/dev/null 2>&1
if [[ $? -eq 2 ]]; then
    mrow TDD 'every cycle has its final state (RED then GREEN observed)' 'not checked' 'sheet without `## Cycles`: the `TDD:` ticks are the auditor'"'"'s'
    mrow TDD 'methods of the sheet exist under the test roots' 'not checked' 'sheet without `## Cycles`'
else
    OPEN_CYCLES="$(python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --done "$STATE_DIR" --batch "$BATCH" 2>&1)"
    if [[ $? -eq 0 ]]; then mrow TDD 'every cycle has its final state (RED then GREEN observed)' ok 'work file'
    else mrow TDD 'every cycle has its final state (RED then GREEN observed)' gap "without final state: $OPEN_CYCLES"; fi
    MISSING="$(python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --methods "$STATE_DIR" --batch "$BATCH" 2>/dev/null | missing_methods)"
    if [[ -z "$MISSING" ]]; then mrow TDD 'methods of `## Cycles` exist under the test roots' ok 'all found'
    else mrow TDD 'methods of `## Cycles` exist under the test roots' gap "absent: $(tr '\n' ' ' <<<"$MISSING")"; fi
fi

COST_CHECK='no Infrastructure call in a loop or lambda, no in-memory filter'
case "${COST_RC:-}" in
    0) mrow Cost "$COST_CHECK" ok "$(tail -1 <<<"$COST_OUT")" ;;
    2) mrow Cost "$COST_CHECK" gap "$(tail -1 <<<"$COST_OUT")" ;;
    *) mrow Cost "$COST_CHECK" 'not checked' "$(tail -1 <<<"$COST_OUT")" ;;
esac
mrow Validations 'build' "${BUILD_ROW[@]}"
mrow Validations 'ArchitectureTests' "${ARCH_ROW[@]}"
if [[ -n "$GREEN" ]]; then mrow Validations 'suites green after the last production change' ok "global green: $GREEN"
else mrow Validations 'suites green after the last production change' 'not checked' 'no `--suites-green`'; fi
mrow 'Layer rules' 'Correctness, Reuse, Simplification, Placement, Comments, Test policy' 'not checked' 'judged pass: the auditor'"'"'s'

printf '| Axis | Check | Result | Evidence |\n|------|-------|--------|----------|\n%s' "$ROWS" >>"$OUT"

section "left to the audit"
cat >>"$OUT" <<'EOF'
The targeted suites (UnitTests, ContractTests, filtered IntegrationTests) are not
run here: their scope is an audit decision. Build the filter from the production
folders touched, see implement-tdd/references/test-scope.md §2.
EOF

[[ "$DIFF_LINES" -gt "$DIFF_MAX" ]] || rm -f "$DIFF_FILE"
printf '\nCapture written: %s (%s bytes)\n' "$OUT" "$(wc -c <"$OUT" | tr -d ' ')"
