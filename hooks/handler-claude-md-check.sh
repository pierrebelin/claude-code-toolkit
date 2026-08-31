#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): checks business-rule <-> unit-test traceability.
#
# Every handler CLAUDE.md (src/{{PRODUCT}}.Application/**/<Handler>/CLAUDE.md)
# carries a "## Business rules" table whose Tests column cites `TestClass.Method`.
# The hook builds two global indexes (cited references / tests actually present in
# tests/{{PRODUCT}}.UnitTests and tests/{{PRODUCT}}.ContractTests) and reports the
# gaps. ContractTests count: a response-shape rule (payload, HTTP status) can only
# be checked through a contract snapshot.
#
# Warning only: exit 0 in every case, never blocking.

INPUT=$(cat)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FILE_PATH=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',d).get('file_path',''))" 2>/dev/null || true)
[ -z "$FILE_PATH" ] && exit 0

REPO_ROOT="$REPO_ROOT" FILE_PATH="$FILE_PATH" python3 <<'PYEOF'
import os, re, sys, unicodedata

ROOT = os.environ["REPO_ROOT"]
APP = os.path.join(ROOT, "src", "{{PRODUCT}}.Application")
UT = os.path.join(ROOT, "tests", "{{PRODUCT}}.UnitTests")
CT = os.path.join(ROOT, "tests", "{{PRODUCT}}.ContractTests")
SUITES = [UT, CT]
SKIP_DIRS = {"bin", "obj", "bin-linux", "obj-linux", "Properties"}

raw = os.environ["FILE_PATH"]
target = raw if os.path.isabs(raw) else os.path.join(ROOT, raw)
target = os.path.normpath(target)

in_app = target.startswith(APP + os.sep)
in_ut = any(target.startswith(s + os.sep) for s in SUITES)
if not (in_app or in_ut):
    sys.exit(0)
if not (target.endswith(".cs") or os.path.basename(target) == "CLAUDE.md"):
    sys.exit(0)


def fold(s):
    """Compare section titles without depending on case or accents: a repo migrated
    from the French headings may still carry stray diacritics."""
    return "".join(c for c in unicodedata.normalize("NFD", s.strip().lower())
                   if unicodedata.category(c) != "Mn")


def walk_cs(root):
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith(".cs"):
                yield os.path.join(base, f)


def read(path):
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read()


HANDLER_CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+\w*Handler\b", re.M)


def is_handler_file(path):
    """A class, not an interface. Testing `not f.startswith("I")` would take
    `IFooCommandHandler.cs` for an interface, but would also exclude
    `ImportGraphsCommandHandler.cs` — any handler whose name starts with I."""
    try:
        return bool(HANDLER_CLASS.search(read(path)))
    except OSError:
        return False


def is_handler_dir(d):
    """A handler folder carries its handler. The Application tree mixes depths
    (Studio/X/Y/, Catalog/X/Y/Z/): depth is not a discriminator."""
    try:
        names = os.listdir(d)
    except OSError:
        return False
    return any(f.endswith("Handler.cs") and is_handler_file(os.path.join(d, f)) for f in names)


# --- Index 1: rules declared in the handler CLAUDE.md files ------------------
# rules[claude_md] = [(rule_id, label, [Class.Method, ...]), ...]
RULE_ROW = re.compile(r"^\|\s*(R[ML]-\d+)\s*\|(.*)$")
SECTION = re.compile(r"^##\s+Business\s+rules?\b", re.I)

rules = {}
all_md = set()
for base, dirs, files in os.walk(APP):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    if "CLAUDE.md" not in files:
        continue
    md = os.path.join(base, "CLAUDE.md")
    rows, in_section, empty_ok = [], False, False
    for line in read(md).splitlines():
        if line.startswith("## "):
            in_section = bool(SECTION.match(line))
            continue
        if not in_section:
            continue
        if line.strip().lower().startswith("none"):
            empty_ok = True
        m = RULE_ROW.match(line.strip())
        if not m:
            continue
        cells = [c.strip() for c in m.group(2).split("|")]
        label = cells[0] if cells else ""
        tests_cell = cells[2] if len(cells) > 2 else ""
        refs = [r.strip(" `") for r in tests_cell.split(",") if r.strip(" `")]
        rows.append((m.group(1), label, refs))
    if rows:
        rules[md] = rows
    elif empty_ok:
        rules[md] = []
    # A feature or root CLAUDE.md is an index: no fixed shape to check.
    # Keep the folder that carries a handler, plus any file declaring rules
    # (Core/GroupAccess documents its own without being a handler).
    if md in rules or is_handler_dir(base):
        all_md.add(md)

# --- Index 2: tests actually present ----------------------------------------
# present[Class.Method] = path
CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)")
ATTR = re.compile(r"^\s*\[(?:Fact|Theory)[\](]")
METHOD = re.compile(r"^\s*(?:public|internal)\s+(?:async\s+)?(?:Task|void|ValueTask)\s+(\w+)\s*\(")

present = {}
for suite in SUITES:
    if not os.path.isdir(suite):
        continue
    for path in walk_cs(suite):
        cls, armed = None, False
        for line in read(path).splitlines():
            cm = CLASS.match(line)
            if cm:
                cls, armed = cm.group(1), False
                continue
            if ATTR.match(line):
                armed = True
                continue
            if armed:
                mm = METHOD.match(line)
                if mm and cls:
                    present[f"{cls}.{mm.group(1)}"] = path
                    armed = False

# --- Scope of the report -----------------------------------------------------
all_referenced = {r for rows in rules.values() for _, _, refs in rows for r in refs}
cited_classes = {r.split(".")[0] for r in all_referenced}


focus = set()
if os.path.basename(target) == "CLAUDE.md":
    if target in all_md:
        focus.add(target)
elif in_app:
    d = os.path.dirname(target)
    md = os.path.join(d, "CLAUDE.md")
    if md in all_md:
        focus.add(md)
    elif is_handler_dir(d):
        rel = os.path.relpath(d, APP)
        print(f"Reminder: no CLAUDE.md in {rel} — create one (Business rules table, Flow, Emitted events).")
        sys.exit(0)
    else:
        sys.exit(0)
else:
    # test file: walk back up to the CLAUDE.md files citing one of its classes
    classes = {k.split(".")[0] for k, p in present.items() if p == target}
    for md, rows in rules.items():
        if any(r.split(".")[0] in classes for _, _, refs in rows for r in refs):
            focus.add(md)
    if not focus:
        orphans = sorted(k for k, p in present.items() if p == target and k.split(".")[0] in cited_classes)
        if orphans:
            print("Tests bound to no rule: " + ", ".join(orphans[:5]))
        sys.exit(0)

if not focus:
    sys.exit(0)

# --- Fixed shape -------------------------------------------------------------
ALLOWED = ["Business rules", "Flow", "Emitted events"]
ALLOWED_FOLDED = {fold(s): s for s in ALLOWED}


def shape_issues(md):
    secs = [l[3:].strip() for l in read(md).splitlines() if l.startswith("## ")]
    issues = []
    extra = [s for s in secs if fold(s) not in ALLOWED_FOLDED]
    if extra:
        issues.append("forbidden sections: " + ", ".join(f"'{s}'" for s in extra))
    seen = {fold(s) for s in secs}
    missing = [s for s in ALLOWED if fold(s) not in seen]
    if missing:
        issues.append("missing sections: " + ", ".join(missing))
    kept = [ALLOWED_FOLDED[fold(s)] for s in secs if fold(s) in ALLOWED_FOLDED]
    if kept != [s for s in ALLOWED if s in kept]:
        issues.append("expected order: Business rules, Flow, Emitted events")
    return issues


# --- Report ------------------------------------------------------------------
out = []
for md in sorted(focus):
    rel_md = os.path.relpath(md, ROOT)
    if md not in rules:
        issues = shape_issues(md)
        detail = (" — " + " ; ".join(issues)) if issues else ""
        out.append(f"{rel_md}: no '## Business rules' table — fixed shape: title + description, Business rules, Flow, Emitted events{detail}.")
        continue
    untested = [rid for rid, _, refs in rules[md] if not refs]
    stale = sorted({r for _, _, refs in rules[md] for r in refs if r not in present})

    dup = {}
    for rid, _, refs in rules[md]:
        for r in refs:
            dup.setdefault(r, []).append(rid)
    shared = sorted(f"{r} ({', '.join(ids)})" for r, ids in dup.items() if len(ids) > 1)

    md_classes = {r.split(".")[0] for _, _, refs in rules[md] for r in refs}
    # A cross-cutting class (StoredFileModificationServiceTests) spreads its tests over
    # several handlers: a test bound in another CLAUDE.md is not an orphan here.
    orphans = sorted(k for k in present if k.split(".")[0] in md_classes and k not in all_referenced)

    # The fixed shape only applies to a handler folder. Core/GroupAccess declares
    # shared rules without being one: keep its traceability, not its shape.
    lines = shape_issues(md) if is_handler_dir(os.path.dirname(md)) else []
    lines = [f"  {i}" for i in lines]
    if untested:
        lines.append(f"  rules with no test: {', '.join(untested)}")
    if stale:
        lines.append(f"  referenced tests not found: {', '.join(stale[:5])}")
    if orphans:
        lines.append(f"  tests bound to no rule: {', '.join(orphans[:5])}" + (f" (+{len(orphans)-5})" if len(orphans) > 5 else ""))
    if shared:
        lines.append(f"  test shared by several rules: {'; '.join(shared[:3])}")
    if lines:
        out.append(f"{rel_md}\n" + "\n".join(lines))
    elif os.path.basename(target) != "CLAUDE.md":
        out.append(f"{rel_md}: rule/test traceability up to date.")

if out:
    print("Business rule <-> test traceability")
    print("\n".join(out))
    total_untested = sum(1 for rows in rules.values() for _, _, refs in rows if not refs)
    if total_untested:
        print(f"({total_untested} rules with no test across all of Application/)")
PYEOF

exit 0
