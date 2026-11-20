#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): the reminder of a use-case folder without its rule sheet.
# A source file edited under a use-case root, in a folder the layout marks as a use case
# (`layout.useCase.marker`) holding no rule sheet (`layout.ruleSheet`): one line of
# additionalContext asking for the sheet. The rules <-> tests report runs at the end of a
# batch instead (`cctoolkit traceability`, called by `cctoolkit pre-audit`).
# Missing python3, lib or broken config: silent, exit 0. Plain stdout on PostToolUse never
# reaches the model: the reminder goes through additionalContext.

case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
INPUT=$(cat)

# Cheap bail-out before lib/platform.sh and any python.
case "$INPUT" in *'"file_path"'*) ;; *) exit 0 ;; esac
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

# Per the scope cache, no Python: a file outside every use-case root, or one whose folder
# already holds its rule sheet (the sheet itself included), leaves nothing to remind.
. "${BASH_SOURCE[0]%/*}/../lib/scope-cache.sh" 2>/dev/null || { scope_file_of() { return 1; }; scope_outside() { return 1; }; }
if scope_file_of "$INPUT"; then
  scope_outside "$SCOPE_FILE" uc && exit 0
  [ -n "${SCOPE_SHEET:-}" ] && [ -f "${SCOPE_FILE%/*}/$SCOPE_SHEET" ] && exit 0
fi

KIT_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" 2>/dev/null && pwd)"
[ -n "$KIT_LIB" ] || exit 0

HOOK_INPUT="$INPUT" KIT_LIB="$KIT_LIB" python3 <<'PYEOF' 2>/dev/null
import json, os, sys

try:
    _d = json.loads(os.environ.get("HOOK_INPUT") or "{}")
    raw = (_d.get("tool_input") or _d).get("file_path", "") or ""
except Exception:
    sys.exit(0)
if not raw:
    sys.exit(0)

sys.path.insert(0, os.environ["KIT_LIB"])
try:
    import kit_config
    from rule_sheet import SHAPE
    # A file of a linked worktree (a batch run beside another) is judged against that worktree.
    wt = kit_config.worktree_of(raw)
    C = kit_config.load(wt or kit_config.project_root())
except Exception:
    sys.exit(0)
if not wt:
    try:
        kit_config.write_scope_cache(C)
    except Exception:
        pass

raw = kit_config._native(raw)
target = os.path.normpath(raw if os.path.isabs(raw) else os.path.join(C.root, raw))
if C.under(target, C.use_case_roots) is None or not C.is_source(target):
    sys.exit(0)
if os.path.basename(target) == C.rule_sheet:
    sys.exit(0)
if C.under(target, C.test_roots) is not None:
    try:
        import kit_testtag
        if kit_testtag.adapter(C).is_test_file(target):
            sys.exit(0)
    except Exception:
        sys.exit(0)
d = os.path.dirname(target)
if os.path.isfile(os.path.join(d, C.rule_sheet)) or not C.is_use_case_dir(d):
    sys.exit(0)
rel = os.path.relpath(d, C.root_of(d, C.use_case_roots)).replace(os.sep, "/")
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse",
                  "additionalContext": f"Reminder: no {C.rule_sheet} in {rel} — create one ({SHAPE})."}},
                 ensure_ascii=False))
PYEOF

exit 0
