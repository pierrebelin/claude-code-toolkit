#!/usr/bin/env bash
set -uo pipefail
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

# Pre-audit gate — the mechanical half of /verify-ddd-tdd: red means no audit fork.
# Frozen literals are read in English and in the French of older sheets and labels.
#
# Usage:
#   cctoolkit pre-audit <batch> <sheet.md>
#
# Exit 0 = GREEN, the audit may be forked. Exit 1 = RED, fix and re-run.

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <batch> <sheet.md>" >&2
    exit 2
fi

BATCH="$1"
SHEET="$2"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIT_PY="$HERE/lib/kit_config.py"
SCRIPTS="$HERE/scripts"
ROOT="$(python3 "$KIT_PY" root)" || exit 2
cd "$ROOT" || exit 1

if [[ ! -f "$SHEET" ]]; then
    echo "sheet not found: $SHEET" >&2
    exit 2
fi

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
# One grep pass restricted to the source extensions: never one per method over the build output.
missing_methods() {
    local wanted found
    wanted="$(grep -v '^$' | sort -u)"
    [[ -z "$wanted" ]] && return 0
    # shellcheck disable=SC2086 # test roots are segment globs, expanded here
    found="$(grep -rhowF "${SOURCE_INCLUDES[@]}" -f <(printf '%s\n' "$wanted") -- $KIT_TEST_DIRS 2>/dev/null | sort -u)"
    comm -23 <(printf '%s\n' "$wanted") <(printf '%s\n' "$found") | grep -v '^$'
}

# Untracked files appended as /dev/null patches: `git diff` alone ignores them.
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
# Added lines starting with `layout.sources.comment`; listed with `·`: only `✗` lines fail.
COMMENTS="$(python3 "$KIT_PY" diff-comments "$ROOT" <"$DIFF_FILE")"
if [[ -z "$COMMENTS" ]]; then
    ok "production comments: none added"
else
    printf '  · %s\n' "production comments added — each must say what the code cannot (constraint, decision, workaround); the audit judges them"
    while IFS= read -r l; do note "$l"; done <<<"$COMMENTS"
fi

# ── 3. Every modified file belongs to the batch ──────────────────────────────
# Outside the code roots, .claude/, todo/ and the plan folder: a deviation unless the sheet names it.
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
# Only classes, tags and handler folders the diff touches are judged: the rest is debt.
TOUCHED_CLASSES="$(python3 "$KIT_PY" diff-test-classes "$ROOT" <"$DIFF_FILE")"
TOUCHED_TRAITS="$(python3 "$KIT_PY" diff-tags "$ROOT" <"$DIFF_FILE")"
UNTESTED="$(python3 "$SCRIPTS"/rules-coverage.py --untested 2>&1)"
STALE=""
OLD_UNBOUND=""
while IFS= read -r l; do
    case "$l" in
        *"DEAD REFERENCE"*|*"RÉFÉRENCE MORTE"*) needles="$TOUCHED_TRAITS" ;;
        *"UNBOUND TEST"*|*"TEST NON RATTACHÉ"*)
            # A method the diff does not add predates the batch: its class gained a traited test, not it.
            m="${l##*.}"; m="${m%% *}"
            for n in $TOUCHED_CLASSES; do
                [[ "$l" == *"$n"* ]] || continue
                if [[ -n "$m" ]] && grep -qE "^\+.*\b${m}\b" "$DIFF_FILE"; then STALE+="$l"$'\n'; else OLD_UNBOUND+="$l"$'\n'; fi
                break
            done
            continue ;;
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
if [[ -n "$OLD_UNBOUND" ]]; then
    printf '  · %s\n' "unbound tests older than the batch, in classes it touches — reported, never failed"
    while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$OLD_UNBOUND"
fi
# Rule sheets the repo keeps out of Git exist in no fresh checkout: the gate cannot judge them.
if git check-ignore -q -- "${SOURCE_DIRS[0]:-src}/.kit-probe/$KIT_RULE_SHEET" 2>/dev/null; then
    if [[ -n "$STALE" ]]; then
        printf '  · %s\n' "RM traits against the handler tables: $KIT_RULE_SHEET is git-ignored in this repo — reported, never failed; never recreate a rule sheet to turn this gate green"
        while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$STALE"
    else
        ok "RM traits: no dead reference, no unbound test, no rule touched without a test"
    fi
elif [[ -z "$STALE" ]]; then
    ok "RM traits: no dead reference, no unbound test, no rule touched without a test"
else
    ko "RM traits inconsistent with the handler rules tables (\`kit:rules\`) — update the handler CLAUDE.md or write the rule's test before the audit"
    while IFS= read -r l; do note "$l"; done <<<"$STALE"
    # Draft table rows for each dead reference: the fix is the table, not the trait.
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
# A `## Cycles` sheet: the `cycle` lines of the run work file, and every method it names on disk.
# An older sheet: its `TDD:` ticks.
STATE_DIR="$(dirname "$SHEET")/run/.work.jsonl"
python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --index >/dev/null 2>&1
HAS_BLOCK=$([[ $? -eq 2 ]] && echo 0 || echo 1)
if [[ $HAS_BLOCK -eq 1 ]]; then
    OPEN_CYCLES="$(python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --done "$STATE_DIR" --batch "$BATCH" 2>&1)"
    if [[ $? -eq 0 ]]; then
        ok "cycles: every cycle of \`## Cycles\` has its final state in $STATE_DIR"
    else
        ko "cycles without a final state (RED or GREEN not observed) in $STATE_DIR"
        while IFS= read -r l; do [[ -n "$l" ]] && note "$l"; done <<<"$OPEN_CYCLES"
    fi
    MISSING="$(python3 "$SCRIPTS"/sheet-cycles.py "$SHEET" --methods "$STATE_DIR" --batch "$BATCH" 2>/dev/null | missing_methods)"
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
# The first `Should…` of the Test cell of each TDD sequence row.
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
# Spy names: identifiers holding Received/CallCount/Called that the sources do not already use.
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
# Opt-in: `layout.sources.languageGuard` {"file": "<guard test>", "skip": [globs]}. A literal
# added under the source roots with two French function words is listed; files the guard
# quotes and `skip` globs are left alone. No guard or no file: the gate does not run.
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
# Opt-in: `layout.integrationGuard` {"sources": [globs], "tests": [globs]}. A change under
# `sources` passes with a change under `tests` or a waiver line in the sheet
# (`Integration test waiver: <reason>` / `Dérogation TI : <raison>`). No guard: not run.
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
