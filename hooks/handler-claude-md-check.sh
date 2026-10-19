#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): checks the business-rule <-> test traceability.
# Rules table (`kit:rules`) of each rule sheet vs the `<SheetFolder>/<RM|RL-xx>` tags the
# tests carry (`testTag` adapter): reports untested rules and orphan tests. A tag counts
# in every suite; only `layout.tests.bound` suites must tag every test.
# Missing python3, lib or broken config: silent, exit 0. Warning only, through
# additionalContext: plain stdout on PostToolUse never reaches the model.

case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
INPUT=$(cat)

# Cheap bail-out before any python.
case "$INPUT" in *'"file_path"'*) ;; *) exit 0 ;; esac

KIT_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" 2>/dev/null && pwd)"
[ -n "$KIT_LIB" ] || exit 0

# One python for parse + check.
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
    import kit_config, kit_testtag
    from rule_sheet import SHAPE, rule_rows, shape_issues
    C = kit_config.load()
    AD = kit_testtag.adapter(C)
except Exception:
    sys.exit(0)

ROOT = C.root
SHEET = C.rule_sheet

target = raw if os.path.isabs(raw) else os.path.join(ROOT, raw)
target = os.path.normpath(target)

in_app = C.under(target, C.use_case_roots) is not None
in_tests = C.under(target, C.test_roots) is not None
if not (in_app or in_tests):
    sys.exit(0)
is_sheet = os.path.basename(target) == SHEET
is_test = in_tests and AD.is_test_file(target)
if not (is_sheet or is_test or (in_app and C.is_source(target))):
    sys.exit(0)


def read(path):
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read()


is_handler_dir = C.is_use_case_dir


# --- Index 1: rules declared in the rule sheets -------------------------------
# rules[sheet] = [(rule_id, label), ...]  ;  prefix_of[sheet] = folder name
rules, prefix_of = {}, {}
all_md = set()
for base, files in C.walk(C.use_case_roots):
    if SHEET not in files:
        continue
    md = os.path.join(base, SHEET)
    rows, empty_ok = rule_rows(read(md))
    if rows or empty_ok:
        rules[md] = rows
        prefix_of[md] = os.path.basename(base)
    # A feature or root CLAUDE.md is an index: no fixed structure to check.
    # Keep a handler folder, plus any shared folder declaring rules.
    if md in rules or is_handler_dir(base):
        all_md.add(md)
        prefix_of.setdefault(md, os.path.basename(base))

declared = {f"{prefix_of[md]}/{rid}" for md, rows in rules.items() for rid, _ in rows}

# --- Index 2: tags placed on the tests --------------------------------------
# methods[Class.Method] = (path, class, [values], binding required)
# traits[value] = [Class.Method, ...]
methods, traits = {}, {}
for t, bound in kit_testtag.scan_tree(C, AD):
    methods[t.key] = (t.path, t.cls, t.tags, bound)
    for v in t.tags:
        traits.setdefault(v, []).append(t.key)

# Windows: payload and walked paths may differ by case; compare the walked spelling.
if os.name == "nt":
    walked = {os.path.normcase(p): p for p in all_md} | {os.path.normcase(p): p for p, _, _, _ in methods.values()}
    target = walked.get(os.path.normcase(target), target)

def tell(text):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": text}},
                     ensure_ascii=False))


# --- Report scope ------------------------------------------------------------
focus = set()
if is_sheet:
    if target in all_md:
        focus.add(target)
elif not is_test:
    d = os.path.dirname(target)
    md = os.path.join(d, SHEET)
    if md in all_md:
        focus.add(md)
    elif is_handler_dir(d):
        rel = os.path.relpath(d, C.root_of(d, C.use_case_roots))
        tell(f"Reminder: no {SHEET} in {rel} — create one ({SHAPE}).")
        sys.exit(0)
    else:
        sys.exit(0)
else:
    # test file: walk up to the CLAUDE.md files whose prefix a trait of this file carries
    prefixes = {v.split("/")[0] for k, (p, _, carried, _) in methods.items() if p == target for v in carried}
    for md in rules:
        if prefix_of[md] in prefixes:
            focus.add(md)
    if not focus:
        untagged = sorted(k for k, (p, _, carried, bound) in methods.items()
                          if p == target and bound and not carried)
        if untagged:
            tell("Tests with no `RM` trait: " + ", ".join(untagged[:5]))
        sys.exit(0)

if not focus:
    sys.exit(0)

# --- Report ------------------------------------------------------------------
out = []
for md in sorted(focus):
    rel_md = os.path.relpath(md, ROOT)
    if md not in rules:
        issues = shape_issues(read(md))
        detail = (" — " + " ; ".join(issues)) if issues else ""
        out.append(f"{rel_md}: no rules table — fixed shape: title + description, {SHAPE}{detail}.")
        continue

    prefix = prefix_of[md]
    untested = [rid for rid, _ in rules[md] if f"{prefix}/{rid}" not in traits]
    stale = sorted(v for v in traits if v.split("/")[0] == prefix and v not in declared)

    shared = sorted(f"{k} ({', '.join(carried)})" for k, (_, _, carried, _) in methods.items()
                    if len([v for v in carried if v.split("/")[0] == prefix]) > 1)

    # A test bound to another handler is not an orphan here.
    md_classes = {methods[k][1] for v in traits if v.split("/")[0] == prefix for k in traits[v]}
    orphans = sorted(k for k, (_, cls, carried, bound) in methods.items()
                     if bound and cls in md_classes and not carried)

    # The fixed shape only applies to a handler folder, not a shared one.
    lines = shape_issues(read(md)) if is_handler_dir(os.path.dirname(md)) else []
    lines = [f"  {i}" for i in lines]
    if untested:
        lines.append(f"  rules with no test: {', '.join(untested)}")
    if stale:
        lines.append(f"  traits citing a rule absent from the table: {', '.join(stale[:5])}")
    if orphans:
        lines.append(f"  tests with no `RM` trait: {', '.join(orphans[:5])}" + (f" (+{len(orphans)-5})" if len(orphans) > 5 else ""))
    if shared:
        lines.append(f"  test shared by several rules: {'; '.join(shared[:3])}")
    if lines:
        out.append(f"{rel_md}\n" + "\n".join(lines))
    elif not is_sheet:
        out.append(f"{rel_md}: rules/tests traceability up to date.")

if out:
    msg = ["Rules ↔ tests traceability", "\n".join(out)]
    total_untested = sum(1 for md, rows in rules.items() for rid, _ in rows
                         if f"{prefix_of[md]}/{rid}" not in traits)
    if total_untested:
        msg.append(f"({total_untested} rules with no test across {C.use_case_label})")
    tell("\n".join(msg))
PYEOF

exit 0
