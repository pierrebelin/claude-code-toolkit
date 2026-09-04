#!/usr/bin/env python3
"""Business-rule coverage by the tests.

Reads the `## Règles métier` tables of the handler CLAUDE.md files
(`src/{{PRODUCT}}.Application/**/<Handler>/`) and matches them against the
`[Trait("RM", "<Handler>/<RM|RL-xx>")]` traits placed on the `[Fact]`/`[Theory]`
methods under `tests/`. Every suite counts: a response-shape rule is proved by a
contract snapshot, a persistence rule by an integration test.

    python3 scripts/rules-coverage.py               # report
    python3 scripts/rules-coverage.py --untested    # only the rules with no test
    python3 scripts/rules-coverage.py --fix-index   # recompute the feature index counters
"""
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "src", "{{PRODUCT}}.Application")
TESTS = os.path.join(ROOT, "tests")
SKIP = {"bin", "obj", "bin-linux", "obj-linux", "Properties"}
# A trait is read from any suite. But only these two cover rule by rule: an
# integration or E2E test proves persistence or a journey, never a single table
# row — demanding a trait per test there produces nothing but noise.
BOUND_SUITES = [
    os.path.join(TESTS, "{{PRODUCT}}.UnitTests"),
    os.path.join(TESTS, "{{PRODUCT}}.ContractTests"),
]

CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)")
ATTR = re.compile(r"^\s*\[(?:Fact|Theory)[\](]")
TRAIT = re.compile(r'^\s*\[Trait\("RM",\s*"([^"]+)"\)\]')
METHOD = re.compile(r"^\s*(?:public|internal)\s+(?:async\s+)?(?:Task|void|ValueTask)\s+(\w+)\s*\(")
ROW = re.compile(r"^\|\s*(R[ML]-\d+)\s*\|(.*)$")
SECTION = re.compile(r"^##\s+R[eè]gles?\s+m[eé]tier", re.I)


def fold(s):
    """Section titles compared without accents: the repo mixes "Regles metier"
    and "Règles métier"."""
    return "".join(c for c in unicodedata.normalize("NFD", s.strip().lower())
                   if unicodedata.category(c) != "Mn")


def scan_traits():
    """Two indexes over `tests/`:
    - traits[value] = [Class.Method, ...]
    - methods[Class.Method] = (class, [values carried], binding required)"""
    traits, methods = {}, {}
    for base, dirs, files in os.walk(TESTS):
        dirs[:] = [d for d in dirs if d not in SKIP]
        bound = any(base.startswith(s + os.sep) for s in BOUND_SUITES)
        for f in sorted(files):
            if not f.endswith(".cs"):
                continue
            cls, armed, carried = None, False, []
            for line in open(os.path.join(base, f), encoding="utf-8", errors="ignore"):
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
                    methods[key] = (cls, carried, bound)
                    for v in carried:
                        traits.setdefault(v, []).append(key)
                    armed = False
    return traits, methods


def rules_of(md):
    """(rule_id, label) of the rows of the `## Règles métier` table."""
    rows, in_section = [], False
    for line in open(md, encoding="utf-8").read().splitlines():
        if line.startswith("## "):
            in_section = bool(SECTION.match(line))
            continue
        if not in_section:
            continue
        m = ROW.match(line.strip())
        if not m:
            continue
        cells = [c.strip() for c in m.group(2).split("|")]
        rows.append((m.group(1), cells[0] if cells else ""))
    return rows


HANDLER_CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+\w*Handler\b", re.M)


def is_handler_file(path):
    """A class, not an interface. Testing `not f.startswith("I")` would take
    `IFooCommandHandler.cs` for an interface, but would also exclude
    `ImportGraphsCommandHandler.cs` — any handler whose name starts with I."""
    try:
        return bool(HANDLER_CLASS.search(open(path, encoding="utf-8", errors="ignore").read()))
    except OSError:
        return False


def handlers():
    """A handler folder carries its handler. The Application tree mixes depths
    (Studio/X/Y/, Catalog/X/Y/Z/): depth does not discriminate."""
    for base, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in SKIP]
        if "CLAUDE.md" not in files:
            continue
        if not any(f.endswith("Handler.cs") and is_handler_file(os.path.join(base, f)) for f in files):
            continue
        yield os.path.relpath(base, APP), os.path.join(base, "CLAUDE.md")


def declared_values():
    """Every legitimate trait value, including those of the CLAUDE.md files that
    declare rules without carrying a handler (Core/GroupAccess)."""
    values = set()
    for base, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in SKIP]
        if "CLAUDE.md" not in files:
            continue
        prefix = os.path.basename(base)
        for rule_id, _ in rules_of(os.path.join(base, "CLAUDE.md")):
            values.add(f"{prefix}/{rule_id}")
    return values


def fix_index(traits):
    counts = {}
    for rel, md in handlers():
        feature = os.path.dirname(rel)
        handler = os.path.basename(rel)
        rows = rules_of(md)
        covered = sum(1 for rid, _ in rows if f"{handler}/{rid}" in traits)
        counts[(feature, handler)] = (len(rows), covered)
    for feature in sorted({f for f, _ in counts}):
        idx = os.path.join(APP, feature, "CLAUDE.md")
        if not os.path.isfile(idx):
            continue
        src = open(idx, encoding="utf-8").read()

        def repl(m):
            st = counts.get((feature, m.group(1)))
            if st is None:
                return m.group(0)
            total, covered = st
            head = m.group(0).rsplit("|", 2)[0]
            return head + (f"| {total} rules, {covered} tested |" if total else "| — |")

        out = re.sub(r"^\| \[(\w+)\]\([^)]*\) \|.*\|.*\|$", repl, src, flags=re.M)
        if out != src:
            open(idx, "w", encoding="utf-8").write(out)
            print(f"index recomputed: {feature}")


def main():
    only_untested = "--untested" in sys.argv
    traits, methods = scan_traits()

    if "--fix-index" in sys.argv:
        fix_index(traits)
        return

    total, untested = 0, 0
    lines = []
    for rel, md in sorted(handlers()):
        rows = rules_of(md)
        if not rows:
            continue
        handler = os.path.basename(rel)
        miss = [rid for rid, _ in rows if f"{handler}/{rid}" not in traits]
        total += len(rows)
        untested += len(miss)
        if miss:
            lines.append(f"  {rel}: {len(miss)}/{len(rows)} with no test — {', '.join(miss)}")
        elif not only_untested:
            lines.append(f"  {rel}: {len(rows)}/{len(rows)} ✓")

    declared = declared_values()
    stale = sorted(v for v in traits if v not in declared)
    # A class carrying traits documents its rules: one of its tests with no trait
    # is an unbound test. A class with no trait at all is out of scope.
    traited_classes = {cls for cls, carried, bound in methods.values() if carried and bound}
    orphans = sorted(k for k, (cls, carried, bound) in methods.items()
                     if bound and cls in traited_classes and not carried)

    print(f"rules: {total} | with test: {total - untested} | with no test: {untested}")
    print(f"dead references: {len(stale)} | unbound tests: {len(orphans)}")
    print()
    print("\n".join(lines))
    for s in stale:
        print(f"  DEAD REFERENCE: {s} — trait citing a rule absent from the tables")
    for o in orphans:
        print(f"  UNBOUND TEST: {o}")


if __name__ == "__main__":
    main()
