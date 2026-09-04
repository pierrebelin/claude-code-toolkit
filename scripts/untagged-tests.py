#!/usr/bin/env python3
"""Inventory of the test methods carrying no `[Trait("RM", "…")]`.

Two categories, which do not read the same way:

- **in a class that carries some** — this is the `UNBOUND TEST` signal of
  `rules-coverage.py`: the class documents its rules, this test cites none;
- **in a class with no trait at all** — outside the mechanism: aggregates, value
  objects, DSL parser, `Core` library. Useful to spot a forgotten handler, not to
  put a trait on every test.

    python3 scripts/untagged-tests.py                        # report on stdout
    python3 scripts/untagged-tests.py -o <file.md>           # report into a file
"""
import collections
import datetime
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(ROOT, "tests")
SKIP = {"bin", "obj", "bin-linux", "obj-linux", "Properties"}
PRODUCT = "{{PRODUCT}}."

CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)")
ATTR = re.compile(r"^\s*\[(?:Fact|Theory)[\](]")
TRAIT = re.compile(r'^\s*\[Trait\("RM",\s*"([^"]+)"\)\]')
METHOD = re.compile(r"^\s*(?:public|internal)\s+(?:async\s+)?(?:Task|void|ValueTask)\s+(\w+)\s*\(")


def scan():
    """(relative path, class, method, line, [trait values]) per test method."""
    rows = []
    for base, dirs, files in os.walk(TESTS):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for f in sorted(files):
            if not f.endswith(".cs"):
                continue
            path = os.path.join(base, f)
            rel = os.path.relpath(path, ROOT)
            cls, armed, carried = None, False, []
            for i, line in enumerate(open(path, encoding="utf-8", errors="ignore"), 1):
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
                    rows.append((rel, cls, mm.group(1), i, list(carried)))
                    armed = False
    return rows


def suite_of(rel):
    return rel.split(os.sep)[1].replace(PRODUCT, "")


def by_file(items):
    d = collections.OrderedDict()
    for rel, cls, method, line, _ in sorted(items):
        d.setdefault((suite_of(rel), rel), []).append((cls, method, line))
    return d


def report():
    rows = scan()
    traited = {(suite_of(r), c) for r, c, _, _, t in rows if t}
    untagged = [r for r in rows if not r[4]]
    strict = [r for r in untagged if (suite_of(r[0]), r[1]) in traited]
    loose = [r for r in untagged if (suite_of(r[0]), r[1]) not in traited]

    out = ["# Tests with no `RM` trait", ""]
    out.append(f"Generated on {datetime.date.today().isoformat()} by `scripts/untagged-tests.py`.")
    out.append("")
    out.append(f"**{len(rows)}** `[Fact]`/`[Theory]` methods under `tests/`, of which **{len(rows) - len(untagged)}** "
               f"carry at least one `[Trait(\"RM\", …)]` and **{len(untagged)}** carry none.")
    out.append("")

    out.append("## 1. Tests with no trait inside a class that carries some")
    out.append("")
    out.append(f"**{len(strict)} methods.** This is the `UNBOUND TEST` signal of `rules-coverage.py` and of "
               "`handler-claude-md-check.sh`: the class documents its rules, this test cites none. Either it covers "
               "a rule missing from the table, or it covers no rule and the class is not the right place. Both "
               "scanners raise this signal on `UnitTests` and `ContractTests` only — an `IntegrationTests` class "
               "covers persistence, not a row of a table.")
    out.append("")
    current = None
    for (suite, rel), items in by_file(strict).items():
        if suite != current:
            out += [f"### {suite}", ""]
            current = suite
        out += [f"`{rel}`", "", "| Line | Class | Method |", "|------|-------|--------|"]
        out += [f"| {line} | `{cls}` | `{method}` |" for cls, method, line in items]
        out.append("")

    out.append("## 2. Tests inside a class with no trait at all")
    out.append("")
    out.append(f"**{len(loose)} methods.** Outside the traceability mechanism: aggregates, value objects, DSL "
               "parser, `Core` library, architecture tests. `.claude/rules/tests.md` puts them explicitly out of "
               "scope — no rule to bind them to. This list is there to spot a handler that escaped the "
               "documentation, not to put a trait on each of them.")
    out.append("")
    per_suite = collections.Counter()
    per_class = collections.defaultdict(set)
    for rel, cls, _, _, _ in loose:
        per_suite[suite_of(rel)] += 1
        per_class[suite_of(rel)].add(cls)
    out += ["| Suite | Classes | Methods |", "|-------|---------|---------|"]
    out += [f"| {s} | {len(per_class[s])} | {per_suite[s]} |" for s in sorted(per_suite)]
    out += ["", "Detail per file:", ""]
    current = None
    for (suite, rel), items in by_file(loose).items():
        if suite != current:
            out += [f"### {suite}", ""]
            current = suite
        out.append(f"- `{rel}` — {len(items)} methods: " + ", ".join(f"`{m}`" for _, m, _ in items))
    out.append("")
    return "\n".join(out) + "\n"


def main():
    text = report()
    if "-o" in sys.argv:
        dest = sys.argv[sys.argv.index("-o") + 1]
        open(dest, "w", encoding="utf-8").write(text)
        print(f"report written: {dest}")
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
