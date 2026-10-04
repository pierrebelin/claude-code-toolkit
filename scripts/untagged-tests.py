#!/usr/bin/env python3
"""Inventory of the test methods carrying no rule tag (`testTag` adapter of
`.claude/kit.config.json`; xUnit: `[Trait("RM", "…")]`).

Two categories, which do not read the same way:

- **in a class that carries some** — this is the `UNBOUND TEST` signal of
  `rules-coverage.py`: the class documents its rules, this test cites none;
- **in a class with no trait at all** — outside the mechanism: aggregates, value
  objects, DSL parser, `Core` library. Useful to spot a forgotten handler, not to
  put a trait on every test.

    cctoolkit untagged-tests                        # report on stdout
    cctoolkit untagged-tests -o <file.md>           # report into a file
"""
import collections
import datetime
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
try:
    import kit_config
    import kit_testtag
    C = kit_config.load(ROOT)
    AD = kit_testtag.adapter(C)
except ImportError:
    sys.exit("kit_config.py not found beside scripts/ — reinstall the cctoolkit plugin")
except (kit_config.KitConfigError, kit_testtag.TestTagError) as e:
    sys.exit(f"kit.config.json: {e} — cctoolkit doctor")


def scan():
    """(relative path, class, method, line, [tag values]) per test method."""
    return [(os.path.relpath(t.path, ROOT), t.cls, t.method, t.line, list(t.tags))
            for t, _ in kit_testtag.scan_tree(C, AD)]


def suite_of(rel):
    return C.suite_of(rel)


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

    roots = ", ".join(f"`{C.rel(d)}/`" for d in C.dirs(C.test_roots))
    bound = list(dict.fromkeys(C.suite_of(b + "/x") for b in C.bound))
    bound = " and ".join(f"`{b}`" for b in bound) if bound else "no suite"
    out = ["# Tests with no `RM` trait", ""]
    out.append(f"Generated on {datetime.date.today().isoformat()} by `scripts/untagged-tests.py`.")
    out.append("")
    out.append(f"**{len(rows)}** {AD.test_label} under {roots}, of which **{len(rows) - len(untagged)}** "
               f"carry at least one {AD.tag_label} and **{len(untagged)}** carry none.")
    out.append("")

    out.append("## 1. Tests with no trait inside a class that carries some")
    out.append("")
    out.append(f"**{len(strict)} methods.** This is the `UNBOUND TEST` signal of `rules-coverage.py` and of "
               "`handler-claude-md-check.sh`: the class documents its rules, this test cites none. Either it covers "
               "a rule missing from the table, or it covers no rule and the class is not the right place. Both "
               f"scanners raise this signal on {bound} only — an `IntegrationTests` class "
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
