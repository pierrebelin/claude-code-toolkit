#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): checks the business-rule <-> test traceability.
#
# Every use-case folder (kit.config.json `layout.useCase`; clean-architecture: a handler
# folder under src/<Product>.Application/) carries a rule sheet (`layout.ruleSheet`,
# CLAUDE.md) with a three-column rules table under the heading anchored
# `<!-- kit:rules -->`. Sections are found by their anchor, never by their title: the
# title is prose in the language of kit.config.json `language.docs`. The rule -> test
# link lives on the test, as a tag whose value is `<SheetFolder>/<RM|RL-xx>` and whose
# carrier is the `testTag` adapter (xUnit: `[Trait("RM", "…")]`). The hook builds two
# global indexes (rules declared / tags placed under the test roots) and reports the
# gaps. Every suite counts: a response-shape rule is only provable by a contract
# snapshot, a persistence rule only by an integration test.
#
# Paths, markers and the tag carrier come from lib/kit_config.py and lib/kit_testtag.py.
# A missing python3, lib module, preset or a broken kit.config.json: silent, exit 0
# (tools/doctor names the cause).
#
# Warning only: exit 0 in every case, never blocking. Output goes through
# hookSpecificOutput.additionalContext: on PostToolUse, plain stdout at exit 0 lands in the
# transcript only and never reaches the model (231 emissions, 0 read, probe of 2026-09-13).

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',d).get('file_path',''))" 2>/dev/null || true)
[ -z "$FILE_PATH" ] && exit 0

KIT_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" 2>/dev/null && pwd)"
[ -n "$KIT_LIB" ] || exit 0

FILE_PATH="$FILE_PATH" KIT_LIB="$KIT_LIB" python3 <<'PYEOF' 2>/dev/null
import json, os, re, sys

sys.path.insert(0, os.environ["KIT_LIB"])
try:
    import kit_config, kit_testtag
    C = kit_config.load()
    AD = kit_testtag.adapter(C)
except Exception:
    sys.exit(0)

ROOT = C.root
SHEET = C.rule_sheet

raw = os.environ["FILE_PATH"]
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


# --- Index 1: rules declared in the handler CLAUDE.md files -------------------
# rules[claude_md] = [(rule_id, label), ...]  ;  prefix_of[claude_md] = folder name
# `## <any title> <!-- kit:rules -->`; the table under it is read by position, or by
# the schema anchor `<!-- kit:cols id,rule,outcome -->` when one precedes it.
ANCHOR = re.compile(r"<!--\s*kit:([a-z][a-z0-9-]*)")
COLS = re.compile(r"<!--\s*kit:cols\s+([\w,-]+)\s*-->")
RULE_ID = re.compile(r"R[ML]-\d+")


def anchor_of(line):
    m = ANCHOR.search(line)
    return m.group(1) if m else None


def rule_rows(text):
    """(rows, explicitly empty) of the section anchored kit:rules."""
    rows, in_section, empty_ok, cols = [], False, False, ["id", "rule"]
    for line in text.splitlines():
        if line.startswith("## "):
            in_section = anchor_of(line) == "rules"
            continue
        if not in_section:
            continue
        # An explicitly empty section carries `<!-- kit:none -->` ("None (pure query)").
        if anchor_of(line) == "none":
            empty_ok = True
        c = COLS.search(line)
        if c:
            cols = c.group(1).split(",")
            continue
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [x.strip() for x in s.strip("|").split("|")]
        i = cols.index("id") if "id" in cols else 0
        j = cols.index("rule") if "rule" in cols else 1
        if i < len(cells) and RULE_ID.fullmatch(cells[i]):
            rows.append((cells[i], cells[j] if j < len(cells) else ""))
    return rows, empty_ok


SHAPE = "sections anchored <!-- kit:rules -->, <!-- kit:flow -->, <!-- kit:events -->, in that order"


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
    # Keep the folder carrying a handler, plus any file declaring rules
    # (Core/GroupAccess documents its own without being a handler).
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
        print(f"Reminder: no {SHEET} in {rel} — create one ({SHAPE}).")
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
            print("Tests with no `RM` trait: " + ", ".join(untagged[:5]))
        sys.exit(0)

if not focus:
    sys.exit(0)

# --- Fixed shape -------------------------------------------------------------
ALLOWED = ["rules", "flow", "events"]


def shape_issues(md):
    heads = [l for l in read(md).splitlines() if l.startswith("## ")]
    issues = []
    extra = [l[3:].split("<!--")[0].strip() for l in heads if anchor_of(l) not in ALLOWED]
    if extra:
        issues.append("forbidden sections: " + ", ".join(f"'{s}'" for s in extra))
    kept = [anchor_of(l) for l in heads if anchor_of(l) in ALLOWED]
    missing = [f"kit:{a}" for a in ALLOWED if a not in kept]
    if missing:
        issues.append("missing sections: " + ", ".join(missing))
    if kept != [a for a in ALLOWED if a in kept]:
        issues.append("expected order: kit:rules, kit:flow, kit:events")
    if heads and not kept:
        issues.append("no kit anchor — sheet written before the anchors: cctoolkit migrate-anchors --apply")
    return issues


# --- Report ------------------------------------------------------------------
out = []
for md in sorted(focus):
    rel_md = os.path.relpath(md, ROOT)
    if md not in rules:
        issues = shape_issues(md)
        detail = (" — " + " ; ".join(issues)) if issues else ""
        out.append(f"{rel_md}: no rules table — fixed shape: title + description, {SHAPE}{detail}.")
        continue

    prefix = prefix_of[md]
    untested = [rid for rid, _ in rules[md] if f"{prefix}/{rid}" not in traits]
    stale = sorted(v for v in traits if v.split("/")[0] == prefix and v not in declared)

    shared = sorted(f"{k} ({', '.join(carried)})" for k, (_, _, carried, _) in methods.items()
                    if len([v for v in carried if v.split("/")[0] == prefix]) > 1)

    # A cross-cutting class spreads its tests over several handlers: a test bound to
    # another handler is not an orphan here.
    md_classes = {methods[k][1] for v in traits if v.split("/")[0] == prefix for k in traits[v]}
    orphans = sorted(k for k, (_, cls, carried, bound) in methods.items()
                     if bound and cls in md_classes and not carried)

    # The fixed shape only applies to a handler folder. Core/GroupAccess declares shared
    # rules without being one: keep its traceability, not its shape.
    lines = shape_issues(md) if is_handler_dir(os.path.dirname(md)) else []
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
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                             "additionalContext": "\n".join(msg)}},
                     ensure_ascii=False))
PYEOF

exit 0
