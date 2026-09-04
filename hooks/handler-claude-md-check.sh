#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): checks the business-rule <-> test traceability.
#
# Every handler CLAUDE.md (src/{{PRODUCT}}.Application/**/<Handler>/CLAUDE.md) carries a
# three-column "## Règles métier" table. The rule -> test link lives on the test, as
# `[Trait("RM", "<HandlerFolder>/<RM|RL-xx>")]`. The hook builds two global indexes
# (rules declared / traits placed under tests/) and reports the gaps. Every suite counts:
# a response-shape rule is only provable by a contract snapshot, a persistence rule only
# by an integration test.
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
TESTS = os.path.join(ROOT, "tests")
# A trait is read from any suite. But only these two cover rule by rule: an integration or
# E2E test proves persistence or a journey, never a single table row — demanding a trait
# per test there produces nothing but noise.
BOUND_SUITES = [
    os.path.join(TESTS, "{{PRODUCT}}.UnitTests"),
    os.path.join(TESTS, "{{PRODUCT}}.ContractTests"),
]
SKIP_DIRS = {"bin", "obj", "bin-linux", "obj-linux", "Properties"}

raw = os.environ["FILE_PATH"]
target = raw if os.path.isabs(raw) else os.path.join(ROOT, raw)
target = os.path.normpath(target)

in_app = target.startswith(APP + os.sep)
in_tests = target.startswith(TESTS + os.sep)
if not (in_app or in_tests):
    sys.exit(0)
if not (target.endswith(".cs") or os.path.basename(target) == "CLAUDE.md"):
    sys.exit(0)


def fold(s):
    """Compare section titles without depending on accents: the repo mixes
    "Regles metier" and "Règles métier"."""
    return "".join(c for c in unicodedata.normalize("NFD", s.strip().lower())
                   if unicodedata.category(c) != "Mn")


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
    (Studio/X/Y/, Catalog/X/Y/Z/): depth does not discriminate."""
    try:
        names = os.listdir(d)
    except OSError:
        return False
    return any(f.endswith("Handler.cs") and is_handler_file(os.path.join(d, f)) for f in names)


# --- Index 1: rules declared in the handler CLAUDE.md files -------------------
# rules[claude_md] = [(rule_id, label), ...]  ;  prefix_of[claude_md] = folder name
RULE_ROW = re.compile(r"^\|\s*(R[ML]-\d+)\s*\|(.*)$")
SECTION = re.compile(r"^##\s+R[eè]gles?\s+m[eé]tier", re.I)

rules, prefix_of = {}, {}
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
        # An explicitly empty section reads "None"; "Aucun" is tolerated for
        # the handler sheets written before the kit switched to English.
        if line.strip().lower().startswith(("none", "aucun")):
            empty_ok = True
        m = RULE_ROW.match(line.strip())
        if not m:
            continue
        cells = [c.strip() for c in m.group(2).split("|")]
        rows.append((m.group(1), cells[0] if cells else ""))
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

# --- Index 2: traits placed on the tests -------------------------------------
# methods[Class.Method] = (path, class, [values], binding required)
# traits[value] = [Class.Method, ...]
CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)")
ATTR = re.compile(r"^\s*\[(?:Fact|Theory)[\](]")
TRAIT = re.compile(r'^\s*\[Trait\("RM",\s*"([^"]+)"\)\]')
METHOD = re.compile(r"^\s*(?:public|internal)\s+(?:async\s+)?(?:Task|void|ValueTask)\s+(\w+)\s*\(")

methods, traits = {}, {}
for base, dirs, files in os.walk(TESTS):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    bound = any(base.startswith(s + os.sep) for s in BOUND_SUITES)
    for f in files:
        if not f.endswith(".cs"):
            continue
        path = os.path.join(base, f)
        cls, armed, carried = None, False, []
        for line in read(path).splitlines():
            cm = CLASS.match(line)
            if cm:
                cls, armed, carried = cm.group(1), False, []
                continue
            if ATTR.match(line):
                armed, carried = True, []
                continue
            if not armed:
                continue
            tm = TRAIT.match(line)
            if tm:
                carried.append(tm.group(1))
                continue
            mm = METHOD.match(line)
            if mm and cls:
                key = f"{cls}.{mm.group(1)}"
                methods[key] = (path, cls, carried, bound)
                for v in carried:
                    traits.setdefault(v, []).append(key)
                armed = False

# --- Report scope ------------------------------------------------------------
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
        print(f"Reminder: no CLAUDE.md in {rel} — create one (Règles métier table, Flux, Événements émis).")
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
ALLOWED = ["Règles métier", "Flux", "Événements émis"]
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
        issues.append("expected order: Règles métier, Flux, Événements émis")
    return issues


# --- Report ------------------------------------------------------------------
out = []
for md in sorted(focus):
    rel_md = os.path.relpath(md, ROOT)
    if md not in rules:
        issues = shape_issues(md)
        detail = (" — " + " ; ".join(issues)) if issues else ""
        out.append(f"{rel_md}: no '## Règles métier' table — fixed shape: title + description, Règles métier, Flux, Événements émis{detail}.")
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
    elif os.path.basename(target) != "CLAUDE.md":
        out.append(f"{rel_md}: rules/tests traceability up to date.")

if out:
    print("Rules ↔ tests traceability")
    print("\n".join(out))
    total_untested = sum(1 for md, rows in rules.items() for rid, _ in rows
                         if f"{prefix_of[md]}/{rid}" not in traits)
    if total_untested:
        print(f"({total_untested} rules with no test across Application/)")
PYEOF

exit 0
