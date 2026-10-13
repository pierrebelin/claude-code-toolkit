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
# audit to judge since 2026-10-09, and `.claude/` / `todo/` hunks, never counted
# as outside the batch since 1.3.1: they were the user's own harness edits.
#
# What stays with the audit: correctness, reuse, placement, cost, a stale plan.
# None of that is decidable by a grep.
#
# Frozen literals are read in both vocabularies — the English of the kit and the
# French of sheets, plans and report labels written before the switch (`RÉFÉRENCE
# MORTE`, `TEST NON RATTACHÉ`, `non cités : `, `TDD :` ticks with `COUT`).
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

# Reads test method names on stdin, prints those absent from the test roots.
# One pass restricted to the source extensions: a grep per method over the whole
# roots walked the build output (1 GB) at 16 s each — 8 min for 31 methods on a
# 2026-10-13 run, paid again on every re-run after a fix.
missing_methods() {
    local wanted found
    wanted="$(grep -v '^$' | sort -u)"
    [[ -z "$wanted" ]] && return 0
    # shellcheck disable=SC2086 # test roots are segment globs, expanded here
    found="$(grep -rhowF "${SOURCE_INCLUDES[@]}" -f <(printf '%s\n' "$wanted") -- $KIT_TEST_DIRS 2>/dev/null | sort -u)"
    comm -23 <(printf '%s\n' "$wanted") <(printf '%s\n' "$found") | grep -v '^$'
}

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
CHANGED="$(git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)"

printf 'PRE-AUDIT — batch %s — sheet %s\n' "$BATCH" "$SHEET"

# ── 1. Every DDD/APP/PERF id classified by the sheet ─────────────────────────
IDS="$(python3 "$SCRIPTS"/rules-coverage.py --ids "$SHEET" 2>&1)"
if grep -qE '(not cited|non cités) : \((none|aucun)\)' <<<"$IDS" && grep -qE '(unknown references|références inconnues) : \((none|aucune)\)' <<<"$IDS"; then
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
# else (scripts/, packages, csproj outside src/tests) is a Scope deviation unless
# the sheet names it — then the audit reads it as declared. .claude/ and todo/
# are skipped since 1.3.1: on a real plan, the 3 run-plan stops they caused were
# the user's own harness edits, never a batch agent's.
PLAN_DIR="$(dirname "$SHEET")"
OUTSIDE=""
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ "$f" =~ ^$KIT_CODE_RE ]] && continue
    case "$f" in
        .claude/*|todo/*|"$PLAN_DIR"/*|*/__pycache__/*) continue ;;
    esac
    if grep -qF -- "$(basename "$f")" "$SHEET"; then
        continue
    fi
    OUTSIDE+="$f"$'\n'
done < <(git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)
if [[ -z "$OUTSIDE" ]]; then
    ok "scope: every modified file is under $KIT_SCOPE_LABEL, .claude/, todo/ or $PLAN_DIR/"
else
    ko "files modified outside the batch and absent from the sheet — declare them under \`## Decisions\` (to isolate at commit) or restore them"
    while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$OUTSIDE"
fi

# ── 4. Trait ↔ handler table consistency, on the batch's test classes only ───
# Pre-existing unbound tests elsewhere are debt, not this batch's deviation:
# only a class the diff touches is judged here. Same for a rule left without
# test: judged only when its handler folder is in the diff (rule rewritten in
# the batch, its tests deleted).
TOUCHED_CLASSES="$(python3 "$KIT_PY" diff-test-classes "$ROOT" <"$DIFF_FILE")"
TOUCHED_TRAITS="$(python3 "$KIT_PY" diff-tags "$ROOT" <"$DIFF_FILE")"
UNTESTED="$(python3 "$SCRIPTS"/rules-coverage.py --untested 2>&1)"
STALE=""
while IFS= read -r l; do
    case "$l" in
        *"DEAD REFERENCE"*|*"RÉFÉRENCE MORTE"*) needles="$TOUCHED_TRAITS" ;;
        *"UNBOUND TEST"*|*"TEST NON RATTACHÉ"*) needles="$TOUCHED_CLASSES" ;;
        *" with no test — "*|*" sans test — "*)
            h="${l%%:*}"; h="${h##*/}"
            grep -qF -- "/$h/" <<<"$CHANGED" && STALE+="$l"$'\n'
            continue ;;
        *) continue ;;
    esac
    for n in $needles; do
        if [[ "$l" == *"$n"* ]]; then STALE+="$l"$'\n'; break; fi
    done
done <<<"$UNTESTED"
if [[ -z "$STALE" ]]; then
    ok "RM traits: no dead reference, no unbound test, no rule touched without a test"
else
    ko "RM traits inconsistent with the handler rules tables (\`kit:rules\`) — update the handler CLAUDE.md or write the rule's test before the audit"
    while IFS= read -r l; do note "$l"; done <<<"$STALE"
    # A dead reference is a rule the tests wrote and the table never received. On a
    # 2026-10-13 run the fixing agent retargeted 12 traits to existing rules and
    # deleted 4: green, and traceability lost. The draft rows point the other way.
    DEAD_IDS="$(sed -nE 's/.*(DEAD REFERENCE|RÉFÉRENCE MORTE): ([^ ]+).*/\2/p' <<<"$STALE" | sort -u)"
    if [[ -n "$DEAD_IDS" ]]; then
        note "draft rows for the handler tables — reword the rule, keep the trait as it is:"
        while IFS= read -r id; do
            # shellcheck disable=SC2086 # test roots are segment globs, expanded here
            grep -rnwF "${SOURCE_INCLUDES[@]}" -- "$id" $KIT_TEST_DIRS 2>/dev/null | while IFS=: read -r f n _; do
                awk -v from="$n" -v id="${id##*/}" -v loc="$f:$n" '
                    NR <= from { next }
                    NR > from + 40 { exit }
                    !t && match($0, /(Should|should_|test_|Test)[A-Za-z0-9_]*/) { t = substr($0, RSTART, RLENGTH); next }
                    t && match($0, /(Should|should_|test_|Test)[A-Za-z0-9_]*/) { exit }
                    t && !e && match($0, /[A-Z][A-Za-z0-9]*(Exception|Error)/) { e = substr($0, RSTART, RLENGTH) }
                    END { printf "| %s | <rule — %s> | `%s` |   (%s)\n", id, t, (e ? e : "<result>"), loc }
                ' "$f"
            done
        done <<<"$DEAD_IDS" | while IFS= read -r l; do note "  $l"; done
    fi
fi

# ── 5. Every cycle reached its final state ───────────────────────────────────
# Sheets with a `## Cycles` block (run-lot since 1.7.4) carry no ticks: the cycle
# state files the RED and GREEN agents write are the evidence, and every method
# the block names must exist under the test roots (a method a RED reported
# unreachable or already covered excepted). Older sheets keep their `TDD:` ticks and
# the tests named by their TDD sequence.
# Cycle states sit under run/.work/; a run started before that layout keeps them under
# run/.travail/ or run/<batch>/.
RUN_DIR="$(dirname "$SHEET")/run"
STATE_DIR="$RUN_DIR/.work/$BATCH/cycles"
for d in "$RUN_DIR/.work/$BATCH/cycles" "$RUN_DIR/.travail/$BATCH/cycles" "$RUN_DIR/$BATCH/cycles"; do
    if [[ -d "$d" ]]; then STATE_DIR="$d"; break; fi
done
python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --index >/dev/null 2>&1
HAS_BLOCK=$([[ $? -eq 2 ]] && echo 0 || echo 1)
if [[ $HAS_BLOCK -eq 1 ]]; then
    OPEN_CYCLES="$(python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --done "$STATE_DIR" 2>&1)"
    if [[ $? -eq 0 ]]; then
        ok "cycles: every cycle of \`## Cycles\` has its final state in $STATE_DIR"
    else
        ko "cycles without a final state (RED or GREEN not observed) in $STATE_DIR"
        while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$OPEN_CYCLES"
    fi
    MISSING="$(python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --methods "$STATE_DIR" 2>/dev/null | missing_methods)"
    if [[ -z "$MISSING" ]]; then
        ok "tests of \`## Cycles\`: all present under ${KIT_TEST_DIRS}"
    else
        ko "methods named by \`## Cycles\` absent under ${KIT_TEST_DIRS} — written under another name, or the block is stale"
        while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$MISSING"
    fi
elif grep -qE 'RED ✅ · GREEN ✅ · (COST|COUT) ✅|TDD ?: GUARD ✅' "$SHEET" && ! grep -qE '(RED|GREEN|COST|COUT|GUARD) ⬜' "$SHEET"; then
    ok "sheet: every behaviour carries \`TDD: RED ✅ · GREEN ✅ · COST ✅\` (guard: \`TDD: GUARD ✅\`)"
else
    ko "sheet not closed — every delivered behaviour carries \`TDD: RED ✅ · GREEN ✅ · COST ✅\` (guard: \`TDD: GUARD ✅\`), no ⬜ tick left"
fi

# ── 5b. Every test named by a sheet without a `## Cycles` block exists ────────
# Sheets kept citing tests a correction removed or never wrote, steps ticked RED ✅
# over them. The first `Should…` of the Test cell of each row of the TDD sequence.
if [[ $HAS_BLOCK -eq 0 ]]; then
    MISSING="$(awk '
        /^## / { in_tdd = ($0 ~ /kit:tdd-sequence/ || $0 ~ /^## (TDD sequence|Deroulement TDD|Déroulement TDD)/) }
        in_tdd && /^\| *[0-9]+ *\|/ {
            split($0, c, "|")
            if (match(c[3], /`Should[A-Za-z0-9_]+(\(\))?`/)) {
                t = substr(c[3], RSTART + 1, RLENGTH - 2); sub(/\(\)$/, "", t); print t
            }
        }' "$SHEET" | missing_methods)"
    if [[ -z "$MISSING" ]]; then
        ok "tests of the sheet: all present under ${KIT_TEST_DIRS}"
    else
        ko "tests named by the sheet absent under ${KIT_TEST_DIRS} — write the test, or remove it from the sheet with the reason"
        while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$MISSING"
    fi
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
# recorder read back, `Assert.Single(_fixture.Repository.Products)`.
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

# ── 8. Production messages stay in English ──────────────────────────────────
# Opt-in. `layout.sources.languageGuard` in kit.config.json names the architecture
# test that already fails an accented literal in production code:
#   {"file": "tests/<Suite>/<GuardTests>.cs", "skip": ["src/*.Migrations/*"]}
# French written without its accents slips past such a guard (7 literals in 4 files,
# a Blocking and an audit round). A literal added under the source roots holding two
# French function words is listed; the production files the guard quotes (its own
# exclusions) and the `skip` globs are left alone. No `languageGuard`, or its file
# absent: the gate does not run.
FRENCH="$(python3 - "$DIFF_FILE" "$ROOT" "$(dirname "$KIT_PY")" <<'PY'
import fnmatch, os, re, sys
diff_path, root, lib = sys.argv[1:4]
sys.path.insert(0, lib)
try:
    import kit_config
    cfg = kit_config.load(root)
except Exception:
    sys.exit(3)
guard = cfg.layout["sources"].get("languageGuard")
guard_file = os.path.join(root, guard.get("file", "")) if isinstance(guard, dict) else ""
if not guard_file or not os.path.isfile(guard_file):
    sys.exit(3)
skip = [str(g) for g in guard.get("skip", [])]
with open(guard_file, encoding="utf-8", errors="ignore") as fh:
    quoted = re.findall(r'"([^"\s]+)"', fh.read())
excluded = {q for q in quoted if cfg.under(q, cfg.source_roots) and cfg.is_source(q)}
with open(diff_path, encoding="utf-8", errors="ignore") as fh:
    diff = fh.read()
markers = re.compile(r"(?<![\w'])(?:(le|la|les|des|du|une|est|sont|pas|pour|dans|avec|aucun|aucune|cette|aux|ne)(?![\w'-])|([ndlq]u?)'(?=\w))", re.I)
path, line, keep = None, 0, False
for raw in diff.splitlines():
    if raw.startswith("+++ b/"):
        path = raw[6:]
        keep = bool(cfg.under(path, cfg.source_roots)) and cfg.is_source(path) and path not in excluded \
            and not any(fnmatch.fnmatch(path, g) for g in skip)
        continue
    if raw.startswith("@@"):
        line = int(re.search(r"\+(\d+)", raw).group(1)) - 1
        continue
    if path is None or raw.startswith("---"):
        continue
    if raw.startswith("+"):
        line += 1
        if keep:
            for lit in re.findall(r'"((?:[^"\\]|\\.)*)"', raw[1:]):
                if len({(m.group(1) or m.group(2) + "'").lower() for m in markers.finditer(lit)}) >= 2:
                    print(f"{path}:{line}: \"{lit}\"")
    elif not raw.startswith("-"):
        line += 1
PY
)"
FRENCH_RC=$?
if [[ $FRENCH_RC -eq 0 ]]; then
    if [[ -z "$FRENCH" ]]; then
        ok "production literals: no French sentence added under ${SOURCE_DIRS[*]}"
    else
        ko "French literal added under ${SOURCE_DIRS[*]} — production messages are written in English (the language guard only sees accents)"
        while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$FRENCH"
    fi
fi

# ── 9. Persistence touched → integration test or written waiver ─────────────
# Opt-in. `layout.integrationGuard` in kit.config.json names the persistence code
# and the integration suite, segment globs as everywhere else:
#   {"sources": ["src/{product}.Infrastructure"], "tests": ["tests/{product}.IntegrationTests"]}
# Audit found persistence hunks with no integration test and no waiver in 4 batches
# of one repo (2026-09-08 to 09-23). A file changed under `sources` passes when a
# file under `tests` changed too, or when the sheet carries a waiver line —
# `Integration test waiver: <reason>`, or its French form `Dérogation TI : <raison>`.
# No `integrationGuard`: the gate does not run.
INFRA="$(CHANGED_FILES="$CHANGED" python3 - "$ROOT" "$(dirname "$KIT_PY")" "$SHEET" <<'PY'
import os, re, sys
root, lib, sheet = sys.argv[1:4]
sys.path.insert(0, lib)
try:
    import kit_config
    cfg = kit_config.load(root)
except Exception:
    sys.exit(3)
guard = cfg.layout.get("integrationGuard")
if not isinstance(guard, dict):
    sys.exit(3)
sources, tests = cfg._list(guard.get("sources", [])), cfg._list(guard.get("tests", []))
if not sources or not tests:
    sys.exit(3)
changed = [l.strip() for l in os.environ.get("CHANGED_FILES", "").splitlines() if l.strip()]
touched = [p for p in changed if cfg.under(p, sources)]
if not touched:
    sys.exit(0)
if any(cfg.under(p, tests) for p in changed):
    print("TESTED")
    sys.exit(0)
with open(sheet, encoding="utf-8", errors="ignore") as fh:
    if re.search(r"Integration test waiver:|Dérogation TI :", fh.read()):
        print("WAIVED")
        sys.exit(0)
print("\n".join(touched))
PY
)"
INFRA_RC=$?
if [[ $INFRA_RC -eq 0 ]]; then
    case "$INFRA" in
        "") ok "persistence: untouched" ;;
        TESTED) ok "persistence touched: integration test modified" ;;
        WAIVED) ok "persistence touched: waiver written in the sheet" ;;
        *)
            ko "persistence touched with no integration test and no \`Integration test waiver: <reason>\` line in the sheet (\`Dérogation TI : <raison>\` in a French sheet)"
            while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$INFRA" ;;
    esac
fi

rm -f "$DIFF_FILE"

if [[ $RED -eq 0 ]]; then
    printf 'PRE-AUDIT — batch %s: GREEN — the audit may be delegated\n' "$BATCH"
    exit 0
fi
printf 'PRE-AUDIT — batch %s: RED — fix and re-run, no audit before\n' "$BATCH"
exit 1
