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
#   bash scripts/audit-capture.sh <batch> <sheet.md> <output>
#
# Example:
#   bash scripts/audit-capture.sh F1 todo/<feature>/PLAN-F1.md \
#        "$SCRATCHPAD/audit-F1.txt"
# ══════════════════════════════════════════════════════════════════════════════

if [[ $# -ne 3 ]]; then
    echo "Usage: bash scripts/audit-capture.sh <batch> <sheet.md> <output>" >&2
    exit 2
fi

BATCH="$1"
SHEET="$2"
OUT="$3"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

if [[ ! -f "$SHEET" ]]; then
    echo "Sheet not found: $SHEET" >&2
    exit 2
fi

mkdir -p "$(dirname "$OUT")"
: > "$OUT"

# Bounded on purpose: this file is read by a model that pays for every line of
# it on every later turn. A raw log has no place here.
DIFF_MAX=1200
LOG_MAX=6

section() { printf '\n=== %s ===\n' "$1" >>"$OUT"; }

# Runs a command, records its exit code, and keeps at most LOG_MAX useful lines
# when it fails — nothing at all when it passes.
run_check() {
    local label="$1"; shift
    local log rc
    log="$(mktemp)"
    "$@" >"$log" 2>&1
    rc=$?
    section "$label"
    printf 'command: %s\nexit: %s\n' "$*" "$rc" >>"$OUT"
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
DIFF_FILE="$(mktemp)"
git diff >"$DIFF_FILE" 2>/dev/null
DIFF_LINES=$(wc -l <"$DIFF_FILE" | tr -d ' ')

section "changed files"
git diff --name-only >>"$OUT" 2>&1

section "batch diff ($DIFF_LINES lines)"
if [[ "$DIFF_LINES" -gt "$DIFF_MAX" ]]; then
    head -"$DIFF_MAX" "$DIFF_FILE" >>"$OUT"
    printf '\n[diff truncated at %s lines out of %s — read the rest targeted and bounded]\n' \
        "$DIFF_MAX" "$DIFF_LINES" >>"$OUT"
else
    cat "$DIFF_FILE" >>"$OUT"
fi

section "RM/CU coverage — rules with no test"
python3 scripts/rules-coverage.py --untested >>"$OUT" 2>&1

section "DDD/APP/PERF id coverage of the sheet"
python3 scripts/rules-coverage.py --ids "$SHEET" >>"$OUT" 2>&1

# `rtk dotnet build` covers the whole solution; a red build makes every verdict
# below it meaningless, so it runs first and unconditionally when code moved.
if grep -qE '^\+\+\+ b/(src|tests)/' "$DIFF_FILE"; then
    run_check "build" rtk dotnet build {{PRODUCT}}.sln --no-restore
else
    section "build"
    printf 'not run — the diff touches neither src/ nor tests/\n' >>"$OUT"
fi

# ArchitectureTests whole, exactly under the condition of
# `implement-tdd/references/test-scope.md` §2: a handler, an endpoint, a
# repository, a layer boundary or a DI registration changed. Deterministic on
# the diff's paths, so it does not need the model's judgement.
if grep -qE '^\+\+\+ b/src/.*(Handler|Endpoints/|Repositories/|Extensions/|DbContext)' "$DIFF_FILE"; then
    run_check "ArchitectureTests (whole suite)" \
        rtk dotnet test --project tests/{{PRODUCT}}.ArchitectureTests/{{PRODUCT}}.ArchitectureTests.csproj \
        --no-build --no-restore
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

rm -f "$DIFF_FILE"
printf '\nCapture written: %s (%s bytes)\n' "$OUT" "$(wc -c <"$OUT" | tr -d ' ')"
