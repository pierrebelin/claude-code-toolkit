#!/usr/bin/env bash
set -uo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# Audit capture — deterministic material for /verify-ddd-tdd
# ══════════════════════════════════════════════════════════════════════════════
# The auditor used to spend ~30 turns collecting what it needs before judging
# anything, one tool call per turn. A turn resends the whole accumulated
# context: those turns were the bulk of the audit's bill. This script gathers
# the same material in a single call, into one file the auditor opens once.
#
# What it does NOT do: choose the targeted test filters. `/verify-ddd-tdd` §3
# holds that the volume of tests executed is an audit decision, not a reflex.
# Only the deterministic floor lives here — build, and ArchitectureTests when
# the diff makes it mandatory.
#
# Usage:
#   cctoolkit audit-capture <batch> <sheet.md> <output> [--base <work>]
#
# --base: the run work file holding the `batch-baseline snapshot` of the batch. The diff
# is then the batch's own, files the user had modified before the batch left out: a diff
# three batches wide once reached the auditor at 6802 lines, truncated to 1200.
#
# Example:
#   cctoolkit audit-capture F1 todo/<feature>/PLAN-F1.md \
#        "$SCRATCHPAD/audit-F1.txt"
# ══════════════════════════════════════════════════════════════════════════════

if [[ $# -ne 3 && ! ( $# -eq 5 && "$4" == "--base" ) ]]; then
    echo "Usage: cctoolkit audit-capture <batch> <sheet.md> <output> [--base <work>]" >&2
    exit 2
fi

BATCH="$1"
SHEET="$2"
OUT="$3"
BASE="${5:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# kit_config.py beside scripts/ (plugin, toolkit); under .claude/lib/ in a copy
# predating the plugin, where scripts/ sat at the repo root.
KIT_PY="$HERE/lib/kit_config.py"
[[ -f "$KIT_PY" ]] || KIT_PY="$HERE/.claude/lib/kit_config.py"
SCRIPTS="$HERE/scripts"
ROOT="$(python3 "$KIT_PY" root)" || exit 2
cd "$ROOT" || exit 1

if [[ ! -f "$SHEET" ]]; then
    echo "Sheet not found: $SHEET" >&2
    exit 2
fi

# Paths and commands come from .claude/kit.config.json, resolved by kit_config.py.
if ! KIT_VARS="$(python3 "$KIT_PY" shell "$ROOT")"; then
    echo "kit.config.json unreadable — cctoolkit doctor" >&2
    exit 2
fi
eval "$KIT_VARS"
read -ra CODE_DIRS <<<"$KIT_SOURCE_DIRS $KIT_TEST_DIRS"

mkdir -p "$(dirname "$OUT")"
: > "$OUT"

# Bounded on purpose: this file is read by a model that pays for every line of
# it on every later turn. A raw log has no place here.
DIFF_MAX=1200
LOG_MAX=6

section() { printf '\n=== %s ===\n' "$1" >>"$OUT"; }

# Runs a command line (a `commands.*` string of kit.config.json), records its exit
# code, and keeps at most LOG_MAX useful lines when it fails — nothing at all when
# it passes.
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

printf '# Audit capture — batch %s\nsheet: %s\ngenerated: %s\n' \
    "$BATCH" "$SHEET" "$(date '+%F %H:%M')" >>"$OUT"

section "git status"
git status --short >>"$OUT" 2>&1

section "git diff --check"
git diff --check >>"$OUT" 2>&1 || true

# The diff drives everything below: the auditor walks it hunk by hunk, and the
# mandatory suites are read off the paths it touches.
# `git diff` alone ignores untracked files, and a batch's new handler and new tests
# are exactly that: each one is appended as a /dev/null → file patch.
# Code only. Measured runs captured 65-110 kB, most of it outside the batch's
# code: tooling work left in the tree, the sheet and plan, handler CLAUDE.md
# tables (pre-audit already gates them), Verify snapshots. Each capture was read
# 5-7 times in slices, every slice carried to the end of the audit. Those paths
# stay named under "changed files", never inlined.
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

# Never truncated: a cut diff was audited on a sample. Past DIFF_MAX the diff stays
# in its own file and the capture carries an index, one line per file with its line
# range, so the auditor reads every file by range.
section "batch diff ($DIFF_LINES lines)"
if [[ "$DIFF_LINES" -gt "$DIFF_MAX" ]]; then
    printf 'full diff: %s — read it file by file, ranges below (Read offset/limit), no file skipped\n\n' "$DIFF_FILE" >>"$OUT"
    awk '/^\+\+\+ /{ if (f) printf "%s: lines %d-%d\n", f, s, NR-2; f=$2; s=NR-1 } END { if (f) printf "%s: lines %d-%d\n", f, s, NR }' "$DIFF_FILE" >>"$OUT"
else
    cat "$DIFF_FILE" >>"$OUT"
fi

# TDD evidence of a sheet with a `## Cycles` block: one line per cycle, read off the
# `cycle` lines the RED and GREEN agents appended to the run work file. Such a sheet carries no ticks; the
# `Plan` axis judges RED observed before GREEN from this section.
STATE_DIR="$(dirname "$SHEET")/run/.work.jsonl"
python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --index >/dev/null 2>&1
if [[ $? -ne 2 ]]; then
    section "TDD cycles (scripts/sheet-cycles.py --summary)"
    python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --summary "$STATE_DIR" --batch "$BATCH" >>"$OUT" 2>&1
fi

section "RM/CU coverage — rules with no test"
python3 "$SCRIPTS"/rules-coverage.py --untested >>"$OUT" 2>&1

section "DDD/APP/PERF id coverage of the sheet"
python3 "$SCRIPTS"/rules-coverage.py --ids "$SHEET" >>"$OUT" 2>&1

# Awaited Infrastructure calls per modified file, read off the syntax tree;
# loop, lambda and in-memory filter flagged, added lines told from pre-existing
# ones. The `Cost` axis judges this section instead of re-opening the handlers.
if [[ -n "$BASE" ]]; then
    section "access cost (scripts/access-cost.py --base)"
    python3 "$SCRIPTS"/access-cost.py --base "$BASE" "$BATCH" >>"$OUT" 2>&1 || true
else
    section "access cost (scripts/access-cost.py --diff)"
    python3 "$SCRIPTS"/access-cost.py --diff >>"$OUT" 2>&1 || true
fi

# `commands.build` covers the whole solution; a red build makes every verdict
# below it meaningless, so it runs first and unconditionally when code moved.
if [[ -z "$KIT_BUILD" ]]; then
    section "build"
    printf 'not run — no commands.build in kit.config.json\n' >>"$OUT"
elif grep -qE "^\+\+\+ b/$KIT_CODE_RE" "$DIFF_FILE"; then
    run_check "build" "$KIT_BUILD"
else
    section "build"
    printf 'not run — the diff touches neither %s\n' "$KIT_NEITHER_LABEL" >>"$OUT"
fi

# ArchitectureTests whole, exactly under the condition of
# `implement-tdd/references/test-scope.md` §2: a handler, an endpoint, a
# repository, a layer boundary or a DI registration changed
# (`commands.architectureTest.when`, a regex on the changed paths). Deterministic
# on the diff's paths, so it does not need the model's judgement.
if [[ -z "$KIT_ARCH_RUN" || -z "$KIT_ARCH_WHEN" ]]; then
    section "ArchitectureTests"
    printf 'not run — no commands.architectureTest in kit.config.json\n' >>"$OUT"
elif sed -n 's#^+++ b/##p' "$DIFF_FILE" | grep -qE "$KIT_ARCH_WHEN"; then
    run_check "ArchitectureTests (whole suite)" "$KIT_ARCH_RUN"
else
    section "ArchitectureTests"
    printf 'not run — no handler, endpoint, repository, boundary or DI in the diff\n' >>"$OUT"
fi

section "left to the audit"
cat >>"$OUT" <<'EOF'
The targeted suites (UnitTests, ContractTests, filtered IntegrationTests) are not
run here: their scope is an audit decision. Build the filter from the production
folders touched, see implement-tdd/references/test-scope.md §2.
EOF

[[ "$DIFF_LINES" -gt "$DIFF_MAX" ]] || rm -f "$DIFF_FILE"
printf '\nCapture written: %s (%s bytes)\n' "$OUT" "$(wc -c <"$OUT" | tr -d ' ')"
