#!/usr/bin/env python3
"""Business-rule coverage by the tests.

Reads the rules tables (heading anchored `<!-- kit:rules -->`) of the rule sheets
(`layout.ruleSheet` in each `layout.useCase` folder of `.claude/kit.config.json`;
clean-architecture: `src/<Product>.Application/**/<Handler>/CLAUDE.md`) and matches
them against the `<Folder>/<RM|RL-xx>` tags the tests carry (`testTag` adapter;
xUnit: `[Trait("RM", "…")]` on the `[Fact]`/`[Theory]` methods) under the test roots.
Every suite counts: a response-shape rule is proved by a contract snapshot, a
persistence rule by an integration test.

    cctoolkit rules-coverage               # report
    cctoolkit rules-coverage --untested    # only the rules with no test
    cctoolkit rules-coverage --ids <sheet>  # DDD/APP/PERF ids the plan never classifies
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The kit (plugin cache, toolkit checkout): scripts/ next to lib/. A copy predating
# the plugin: <repo>/scripts/ next to <repo>/.claude/lib/.
for _lib in (os.path.join(HERE, "lib"), os.path.join(HERE, ".claude", "lib")):
    if os.path.isfile(os.path.join(_lib, "kit_config.py")):
        sys.path.insert(0, _lib)
        break
try:
    from kit_config import project_root
    ROOT = project_root()
except ImportError:
    ROOT = HERE
C = AD = None


def load_kit():
    """Layout and tag adapter — loaded for the coverage report only: `--ids`
    reads the plan, never the layout, and keeps working on a broken config."""
    global C, AD, kit_testtag
    try:
        import kit_config
        import kit_testtag
        C = kit_config.load(ROOT)
        AD = kit_testtag.adapter(C)
    except ImportError:
        sys.exit("kit_config.py not found beside scripts/ — reinstall the cctoolkit plugin")
    except (kit_config.KitConfigError, kit_testtag.TestTagError) as e:
        sys.exit(f"kit.config.json: {e} — cctoolkit doctor")


# Sections and rows are found by their `<!-- kit:… -->` anchor, never by their
# title: titles are prose in the language of kit.config.json `language.docs`.
ANCHOR = re.compile(r"<!--\s*kit:([a-z][a-z0-9-]*)")
COLS = re.compile(r"<!--\s*kit:cols\s+([\w,-]+)\s*-->")
RULE_ID = re.compile(r"R[ML]-\d+")

# The DDD/APP/PERF referential: one markdown table per file, the id in the first
# cell. `/plan-implementation` owns those two files; the sheets cite them.
_SKILLS = next((d for d in (os.path.join(HERE, "skills"), os.path.join(HERE, ".claude", "skills")) if os.path.isdir(d)),
               os.path.join(HERE, "skills"))
REFS = [os.path.join(_SKILLS, "plan-implementation", "references", f)
        for f in ("ddd-rules.md", "architecture-rules.md")]
REF_ROW = re.compile(r"^\|\s*((?:DDD|APP|PERF)-\d+)\s*\|")
# A sheet declares the ids it applies on the row anchored `kit:applied-rules`, and
# on the deviation variant when it carries one. The global plan lists the others
# once, on its line anchored `kit:na-rules`: an id is classified when either says so.
APPLIED_ROW = re.compile(r"^\|([^|]*<!--\s*kit:applied-rules\s*-->[^|]*)\|(.*)$")
NA_LINE = re.compile(r"<!--\s*kit:na-rules\s*-->(.*)$")
SHEET = re.compile(r"-PLAN(?:-F\d+)?\.md$")
ID = re.compile(r"(DDD|APP|PERF)-(\d+)")
# `DDD-05 → DDD-08` stands for the four ids: the sheets write ranges.
RANGE = re.compile(r"(DDD|APP|PERF)-(\d+)\s*(?:→|->)\s*(DDD|APP|PERF)-(\d+)")

L_IDS, L_CITED, L_UNCITED = "ids", "cited", "not cited"
L_UNKNOWN, L_NONE_M, L_NONE_F = "unknown references", "(none)", "(none)"
L_USAGE = "--ids expects the path of a batch sheet"


def scan_traits():
    """Two indexes over the test roots:
    - traits[value] = [Class.Method, ...]
    - methods[Class.Method] = (class, [values carried], binding required)

    A tag is read from any suite. But only the `layout.tests.bound` ones cover rule
    by rule: an integration or E2E test proves persistence or a journey, never a
    single table row — demanding a tag per test there produces nothing but noise."""
    traits, methods = {}, {}
    for t, bound in kit_testtag.scan_tree(C, AD):
        methods[t.key] = (t.cls, t.tags, bound)
        for v in t.tags:
            traits.setdefault(v, []).append(t.key)
    return traits, methods


def rules_of(md):
    """(rule_id, label) of the rows of the table anchored `kit:rules`, read by
    position or by the `kit:cols` schema anchor."""
    rows, in_section, cols = [], False, ["id", "rule"]
    for line in open(md, encoding="utf-8").read().splitlines():
        if line.startswith("## "):
            m = ANCHOR.search(line)
            in_section = bool(m) and m.group(1) == "rules"
            continue
        if not in_section:
            continue
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
    return rows


def handlers():
    """A use-case folder carries its handler (`layout.useCase.marker`). The tree
    mixes depths (Studio/X/Y/, Catalog/X/Y/Z/): depth does not discriminate."""
    for base, files in C.walk(C.use_case_roots):
        if C.rule_sheet not in files:
            continue
        if not C.is_use_case_dir(base):
            continue
        yield os.path.relpath(base, C.root_of(base, C.use_case_roots)), os.path.join(base, C.rule_sheet)


def declared_values():
    """Every legitimate tag value, including those of the sheets that declare
    rules without carrying a handler (Core/GroupAccess)."""
    values = set()
    for base, files in C.walk(C.use_case_roots):
        if C.rule_sheet not in files:
            continue
        prefix = os.path.basename(base)
        for rule_id, _ in rules_of(os.path.join(base, C.rule_sheet)):
            values.add(f"{prefix}/{rule_id}")
    return values



def referential_ids():
    """Every id the referential defines, in file order."""
    ids = []
    for path in REFS:
        if not os.path.isfile(path):
            continue
        for line in open(path, encoding="utf-8").read().splitlines():
            m = REF_ROW.match(line)
            if m and m.group(1) not in ids:
                ids.append(m.group(1))
    return ids


def ids_in(cell):
    """Ids of one cell, `DDD-05 → DDD-08` ranges expanded."""
    found = set()
    for prefix, low, _, high in RANGE.findall(cell):
        found.update(f"{prefix}-{n:02d}" for n in range(int(low), int(high) + 1))
    found.update(f"{prefix}-{num}" for prefix, num in ID.findall(cell))
    return found


def cited_ids(fiche):
    """Ids cited by the sheet's `kit:applied-rules` rows and the global plan's
    `kit:na-rules` line, ranges expanded.

    Only the absence of a citation is decided here. Whether an id is applied or
    `N/A` is left to the audit: those cells are free prose — `**N/A**`,
    `: N/A —`, dated arbitrations — and a parser claiming to classify them
    would report deviations that are not there."""
    cited = set()
    for line in open(fiche, encoding="utf-8").read().splitlines():
        m = APPLIED_ROW.match(line.strip())
        if m:
            cited |= ids_in(m.group(2))
            continue
        m = NA_LINE.search(line)
        if m:
            cited |= ids_in(m.group(1))
    return cited


def plan_ids(fiche):
    """Ids classified anywhere in the sheet's plan folder: the global plan and
    every batch sheet. An id applied in F2 is not missing from F1."""
    folder = os.path.dirname(os.path.abspath(fiche))
    cited = set()
    for name in sorted(os.listdir(folder)):
        if SHEET.search(name):
            cited |= cited_ids(os.path.join(folder, name))
    return cited | cited_ids(fiche)


def ids_coverage(fiche):
    """Report line for the audit bundle: what the plan forgot to classify."""
    known = referential_ids()
    cited = plan_ids(fiche)
    missing = [i for i in known if i not in cited]
    unknown = sorted(cited - set(known))
    print(f"{L_IDS} : {len(known)} | {L_CITED} : {len(known) - len(missing)} | "
          f"{L_UNCITED} : {', '.join(missing) if missing else L_NONE_M}")
    print(f"{L_UNKNOWN} : {', '.join(unknown) if unknown else L_NONE_F}")


def main():
    if "--ids" in sys.argv:
        i = sys.argv.index("--ids")
        if i + 1 >= len(sys.argv):
            sys.exit(L_USAGE)
        ids_coverage(sys.argv[i + 1])
        return

    load_kit()
    only_untested = "--untested" in sys.argv
    traits, methods = scan_traits()


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
