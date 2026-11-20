#!/usr/bin/env python3
"""Business-rule <-> test traceability of the files a cycle or a batch touched.

    cctoolkit traceability <file>...

The rules table (`kit:rules`) of each rule sheet in focus against the `<SheetFolder>/<RM|RL-xx>`
tags the tests carry (`testTag` adapter): untested rules, tags citing a rule absent from the table,
orphan tests, a test shared by several rules, and the fixed shape of a handler's sheet. A sheet is
in focus when it is one of the files, sits beside a source file, or is cited by a tag of a test
file. A tag counts in every suite; only `layout.tests.bound` suites must tag every test. A file of
a linked worktree is judged against that worktree. Prints nothing when nothing is in focus.

Run by `cctoolkit pre-audit` on the batch's files, before the audit; `hooks/handler-claude-md-check.sh`
keeps only the reminder of a handler folder without a sheet. Exit 0, 3 on a config defect.
"""
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
import kit_testtag  # noqa: E402
from rule_sheet import SHAPE, rule_rows, shape_issues  # noqa: E402

TITLE = "Rules ↔ tests traceability"


def read(path):
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read()


class Index:
    """Rules declared in the rule sheets and tags placed on the tests, built once per root."""

    def __init__(self, C):
        self.C = C
        self.AD = kit_testtag.adapter(C)
        sheet = C.rule_sheet
        # rules[sheet] = [(rule_id, label), ...]  ;  prefix_of[sheet] = folder name
        self.rules, self.prefix_of, self.all_md = {}, {}, set()
        for base, files in C.walk(C.use_case_roots):
            if sheet not in files:
                continue
            md = os.path.join(base, sheet)
            rows, empty_ok = rule_rows(read(md))
            if rows or empty_ok:
                self.rules[md] = rows
                self.prefix_of[md] = os.path.basename(base)
            # A feature or root sheet is an index: no fixed structure to check.
            # Keep a handler folder, plus any shared folder declaring rules.
            if md in self.rules or C.is_use_case_dir(base):
                self.all_md.add(md)
                self.prefix_of.setdefault(md, os.path.basename(base))
        self.declared = {f"{self.prefix_of[md]}/{rid}" for md, rows in self.rules.items() for rid, _ in rows}
        # methods[Class.Method] = (path, class, [values], binding required) ; traits[value] = [Class.Method, ...]
        self.methods, self.traits = {}, {}
        for t, bound in kit_testtag.scan_tree(C, self.AD):
            self.methods[t.key] = (t.path, t.cls, t.tags, bound)
            for v in t.tags:
                self.traits.setdefault(v, []).append(t.key)
        # Windows: argument and walked paths may differ by case; compare the walked spelling.
        self.walked = {}
        if os.name == "nt":
            self.walked = {os.path.normcase(p): p for p in self.all_md} | \
                          {os.path.normcase(p): p for p, _, _, _ in self.methods.values()}

    def spelled(self, target):
        return self.walked.get(os.path.normcase(target), target) if self.walked else target


def focus_of(ix, target, notes):
    """The sheets a file brings into focus; a reminder or an untagged-test line goes to `notes`."""
    C = ix.C
    in_app = C.under(target, C.use_case_roots) is not None
    in_tests = C.under(target, C.test_roots) is not None
    if not (in_app or in_tests):
        return set()
    is_sheet = os.path.basename(target) == C.rule_sheet
    is_test = in_tests and ix.AD.is_test_file(target)
    if not (is_sheet or is_test or (in_app and C.is_source(target))):
        return set()
    target = ix.spelled(target)
    if is_sheet:
        return {target} if target in ix.all_md else set()
    if not is_test:
        d = os.path.dirname(target)
        md = os.path.join(d, C.rule_sheet)
        if md in ix.all_md:
            return {md}
        if C.is_use_case_dir(d):
            rel = os.path.relpath(d, C.root_of(d, C.use_case_roots)).replace(os.sep, "/")
            notes.append(f"Reminder: no {C.rule_sheet} in {rel} — create one ({SHAPE}).")
        return set()
    # A test file: the sheets whose prefix a tag of this file carries.
    prefixes = {v.split("/")[0] for p, _, carried, _ in ix.methods.values() if p == target for v in carried}
    focus = {md for md in ix.rules if ix.prefix_of[md] in prefixes}
    if not focus:
        untagged = sorted(k for k, (p, _, carried, bound) in ix.methods.items()
                          if p == target and bound and not carried)
        if untagged:
            notes.append("Tests with no `RM` trait: " + ", ".join(untagged[:5]))
    return focus


def report(ix, focus, sheets_given):
    C, out = ix.C, []
    for md in sorted(focus):
        rel_md = os.path.relpath(md, C.root).replace(os.sep, "/")
        if md not in ix.rules:
            issues = shape_issues(read(md))
            detail = (" — " + " ; ".join(issues)) if issues else ""
            out.append(f"{rel_md}: no rules table — fixed shape: title + description, {SHAPE}{detail}.")
            continue
        prefix = ix.prefix_of[md]
        untested = [rid for rid, _ in ix.rules[md] if f"{prefix}/{rid}" not in ix.traits]
        stale = sorted(v for v in ix.traits if v.split("/")[0] == prefix and v not in ix.declared)
        shared = sorted(f"{k} ({', '.join(carried)})" for k, (_, _, carried, _) in ix.methods.items()
                        if len([v for v in carried if v.split("/")[0] == prefix]) > 1)
        # A test bound to another handler is not an orphan here.
        md_classes = {ix.methods[k][1] for v in ix.traits if v.split("/")[0] == prefix for k in ix.traits[v]}
        orphans = sorted(k for k, (_, cls, carried, bound) in ix.methods.items()
                         if bound and cls in md_classes and not carried)
        # The fixed shape only applies to a handler folder, not a shared one.
        lines = shape_issues(read(md)) if C.is_use_case_dir(os.path.dirname(md)) else []
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
        elif md not in sheets_given:
            out.append(f"{rel_md}: rules/tests traceability up to date.")
    if not out:
        return None
    msg = [TITLE, "\n".join(out)]
    total_untested = sum(1 for md, rows in ix.rules.items() for rid, _ in rows
                         if f"{ix.prefix_of[md]}/{rid}" not in ix.traits)
    if total_untested:
        msg.append(f"({total_untested} rules with no test across {C.use_case_label})")
    return "\n".join(msg)


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    by_root = {}
    for raw in argv:
        wt = kit_config.worktree_of(raw)
        by_root.setdefault(wt, []).append(raw)
    blocks = []
    for wt, files in by_root.items():
        try:
            C = kit_config.load(wt or kit_config.project_root())
            ix = Index(C)
        except (kit_config.KitConfigError, kit_testtag.TestTagError) as e:
            print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
            return 3
        notes, focus, sheets_given = [], set(), set()
        for raw in files:
            raw = kit_config._native(raw)
            target = os.path.normpath(raw if os.path.isabs(raw) else os.path.join(C.root, raw))
            got = focus_of(ix, target, notes)
            focus |= got
            if os.path.basename(target) == C.rule_sheet:
                sheets_given |= got
        blocks += notes
        text = report(ix, focus, sheets_given)
        if text:
            blocks.append(text)
    if blocks:
        print("\n\n".join(blocks))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
