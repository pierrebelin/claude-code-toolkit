#!/usr/bin/env python3
"""Test methods carrying no rule tag: in a class that carries some (the `UNBOUND TEST` signal), or in a class with none.

    cctoolkit untagged-tests                        # report on stdout
    cctoolkit untagged-tests --json                 # counts per category and suite, as JSON
"""
import collections
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
import kit_testtag  # noqa: E402
ROOT, C, AD = kit_config.script_config(testtag=True)


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


def split(rows):
    """(untagged, in a class carrying some, in a class carrying none)."""
    traited = {(suite_of(r), c) for r, c, _, _, t in rows if t}
    untagged = [r for r in rows if not r[4]]
    strict = [r for r in untagged if (suite_of(r[0]), r[1]) in traited]
    loose = [r for r in untagged if (suite_of(r[0]), r[1]) not in traited]
    return untagged, strict, loose


def counts():
    rows = scan()
    untagged, strict, loose = split(rows)
    by_suite = collections.OrderedDict()
    for key, items in (("in_tagged_class", strict), ("in_untagged_class", loose)):
        for rel, _, _, _, _ in items:
            entry = by_suite.setdefault(suite_of(rel), {"in_tagged_class": 0, "in_untagged_class": 0})
            entry[key] += 1
    return {"tests": len(rows), "tagged": len(rows) - len(untagged), "untagged": len(untagged),
            "in_tagged_class": len(strict), "in_untagged_class": len(loose),
            "by_suite": dict(sorted(by_suite.items()))}


def report():
    rows = scan()
    untagged, strict, loose = split(rows)

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
    if "--json" in sys.argv:
        print(json.dumps(counts(), indent=2, ensure_ascii=False))
        return
    sys.stdout.write(report())


if __name__ == "__main__":
    main()
