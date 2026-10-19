#!/usr/bin/env python3
"""Business-rule coverage by the tests: the `kit:rules` tables of the rule sheets against the rule tags of every suite.

    cctoolkit rules-coverage               # report
    cctoolkit rules-coverage --untested    # only the rules with no test
    cctoolkit rules-coverage --json        # the same counts and lists, as JSON
    cctoolkit rules-coverage --ids <sheet>  # DDD/APP/PERF ids the plan never classifies
"""
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
import kit_testtag  # noqa: E402
ROOT = kit_config.project_root()
C = AD = None


def load_kit():
    """Layout and tag adapter, for the coverage report only: `--ids` works on a broken config."""
    global C, AD
    _, C, AD = kit_config.script_config(testtag=True)


# Sections are found by their `<!-- kit:… -->` anchor; a sheet without anchors by its folded EN/FR title.
ANCHOR = re.compile(r"<!--\s*kit:([a-z][a-z0-9-]*)")
COLS = re.compile(r"<!--\s*kit:cols\s+([\w,-]+)\s*-->")
RULE_ID = re.compile(r"R[ML]-\d+")
RULES_TITLE = re.compile(r"(business rules?|regles? metier)\b")
APPLIED_LABEL = re.compile(r"(applied rules|regles appliquees)\b")
NA_LABEL = re.compile(r"(non-applicable rules|regles non applicables)\b")


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.strip().lower()) if unicodedata.category(c) != "Mn")

# The DDD/APP/PERF referential: one markdown table per file, the id in the first cell.
_SKILLS = next((d for d in (os.path.join(HERE, "skills"), os.path.join(HERE, ".claude", "skills")) if os.path.isdir(d)),
               os.path.join(HERE, "skills"))
REFS = [os.path.join(_SKILLS, "plan-implementation", "references", f)
        for f in ("ddd-rules.md", "architecture-rules.md")]
REF_ROW = re.compile(r"^\|\s*((?:DDD|APP|PERF)-\d+)\s*\|")
# An id is classified when a `kit:applied-rules` row of a sheet or the plan's `kit:na-rules` line cites it.
APPLIED_ROW = re.compile(r"^\|([^|]+)\|(.*)$")
NA_LINE = re.compile(r"<!--\s*kit:na-rules\s*-->(.*)$")
NA_LABELLED = re.compile(r"^\s*[-*]\s*\*\*([^*]+)\*\*\s*:(.*)$")
SHEET = re.compile(r"-PLAN(?:-F\d+)?\.md$")
ID = re.compile(r"(DDD|APP|PERF)-(\d+)")
RANGE = re.compile(r"(DDD|APP|PERF)-(\d+)\s*(?:→|->)\s*(DDD|APP|PERF)-(\d+)")

L_IDS, L_CITED, L_UNCITED = "ids", "cited", "not cited"
L_UNKNOWN, L_NONE_M, L_NONE_F = "unknown references", "(none)", "(none)"
L_USAGE = "--ids expects the path of a batch sheet"


def scan_traits():
    """traits[value] = [Class.Method, ...]; methods[Class.Method] = (class, [values], bound).
    Tags are read from every suite; only `layout.tests.bound` suites require one per test."""
    traits, methods = {}, {}
    for t, bound in kit_testtag.scan_tree(C, AD):
        methods[t.key] = (t.cls, t.tags, bound)
        for v in t.tags:
            traits.setdefault(v, []).append(t.key)
    return traits, methods


def rules_of(md):
    """(rule_id, label) of the `kit:rules` table rows, by position or by the `kit:cols` anchor."""
    rows, in_section, cols = [], False, ["id", "rule"]
    for line in open(md, encoding="utf-8").read().splitlines():
        if line.startswith("## "):
            m = ANCHOR.search(line)
            title = fold(re.sub(r"<!--.*?-->", "", line[3:]))
            in_section = m.group(1) == "rules" if m else bool(RULES_TITLE.match(title))
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
    """Use-case folders with a rule sheet, found by marker: depth does not discriminate."""
    for base, files in C.walk(C.use_case_roots):
        if C.rule_sheet not in files:
            continue
        if not C.is_use_case_dir(base):
            continue
        yield os.path.relpath(base, C.root_of(base, C.use_case_roots)).replace(os.sep, "/"), os.path.join(base, C.rule_sheet)


def declared_values():
    """Every legitimate tag value, sheets without a handler included."""
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
    """Ids cited by `kit:applied-rules` rows and the `kit:na-rules` line, ranges expanded.
    Only absence is decided here: applied vs N/A is free prose, left to the audit."""
    cited = set()
    for line in open(fiche, encoding="utf-8").read().splitlines():
        m = APPLIED_ROW.match(line.strip())
        if m and (re.search(r"<!--\s*kit:applied-rules\s*-->", m.group(1)) or APPLIED_LABEL.match(fold(m.group(1)))):
            cited |= ids_in(m.group(2))
            continue
        m = NA_LINE.search(line)
        if m:
            cited |= ids_in(m.group(1))
            continue
        m = NA_LABELLED.match(line)
        if m and NA_LABEL.match(fold(m.group(1))):
            cited |= ids_in(m.group(2))
    return cited


def plan_ids(fiche):
    """Ids classified anywhere in the sheet's plan folder (global plan and every batch sheet)."""
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
    lines, handlers_missing = [], []
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
            handlers_missing.append({"handler": rel, "rules": len(rows), "untested": miss})
        elif not only_untested:
            lines.append(f"  {rel}: {len(rows)}/{len(rows)} ✓")

    declared = declared_values()
    stale = sorted(v for v in traits if v not in declared)
    # Unbound: a test with no trait in a class whose other tests carry one.
    traited_classes = {cls for cls, carried, bound in methods.values() if carried and bound}
    orphans = sorted(k for k, (cls, carried, bound) in methods.items()
                     if bound and cls in traited_classes and not carried)

    if "--json" in sys.argv:
        print(json.dumps({"rules": total, "with_test": total - untested, "without_test": untested,
                          "handlers_without_test": handlers_missing, "dead_references": stale,
                          "unbound_tests": orphans}, indent=2, ensure_ascii=False))
        return

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
