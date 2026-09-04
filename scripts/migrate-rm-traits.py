#!/usr/bin/env python3
"""Migration: the `Tests` column of the handler CLAUDE.md files becomes an xUnit trait.

The mapping already exists: the `Tests` column carries exactly the rule <-> test
correspondence to write into the traits. This script reads it, puts the attributes
in place, then removes the column.

Trait shape: `[Trait("RM", "<HandlerFolder>/<RM|RL-xx>")]`. The prefix is the handler
folder, not the aggregate: `RM` numbering is not unique per feature (13 collisions
measured in one feature on the reference repo).

    python3 scripts/migrate-rm-traits.py                 # report (dry run)
    python3 scripts/migrate-rm-traits.py --apply-traits  # writes the attributes
    python3 scripts/migrate-rm-traits.py --strip-column  # removes the 4th column
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "src", "{{PRODUCT}}.Application")
TESTS = os.path.join(ROOT, "tests")
SKIP = {"bin", "obj", "bin-linux", "obj-linux", "Properties"}

CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)")
ATTR = re.compile(r"^(\s*)\[(?:Fact|Theory)[\](]")
METHOD = re.compile(r"^\s*(?:public|internal)\s+(?:async\s+)?(?:Task|void|ValueTask)\s+(\w+)\s*\(")
TRAIT = re.compile(r'^\s*\[Trait\("RM",\s*"([^"]+)"\)\]')
ROW = re.compile(r"^\|\s*(R[ML]-\d+)\s*\|(.*)$")
SECTION = re.compile(r"^##\s+R[eè]gles?\s+m[eé]tier", re.I)


def read(path):
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read()


def rule_rows(md):
    """(rule_id, refs) of the rows of the `## Règles métier` table."""
    rows, in_section = [], False
    for line in read(md).splitlines():
        if line.startswith("## "):
            in_section = bool(SECTION.match(line))
            continue
        if not in_section:
            continue
        m = ROW.match(line.strip())
        if not m:
            continue
        cells = [c.strip() for c in m.group(2).split("|")]
        refs = [r.strip(" `") for r in (cells[2] if len(cells) > 2 else "").split(",") if r.strip(" `")]
        rows.append((m.group(1), refs))
    return rows


def handler_mds():
    """Every CLAUDE.md carrying a rules table, under Application/."""
    for base, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in SKIP]
        if "CLAUDE.md" not in files:
            continue
        md = os.path.join(base, "CLAUDE.md")
        if rule_rows(md):
            yield os.path.basename(base), md


def wanted_traits():
    """{Class.Method: [trait value, ...]} and [(prefix, rule_id)] with no test."""
    wanted, untested = {}, []
    for prefix, md in handler_mds():
        for rule_id, refs in rule_rows(md):
            value = f"{prefix}/{rule_id}"
            if not refs:
                untested.append((value, md))
                continue
            for ref in refs:
                wanted.setdefault(ref, [])
                if value not in wanted[ref]:
                    wanted[ref].append(value)
    return wanted, untested


def scan_tests():
    """{Class.Method: [(path, index of the [Fact]/[Theory] line, indentation,
    traits already present)]} — a list, to detect homonyms."""
    found = {}
    for base, dirs, files in os.walk(TESTS):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for f in sorted(files):
            if not f.endswith(".cs"):
                continue
            path = os.path.join(base, f)
            lines = read(path).splitlines()
            cls, anchor, indent, traits = None, None, "", []
            for i, line in enumerate(lines):
                cm = CLASS.match(line)
                if cm:
                    cls, anchor, traits = cm.group(1), None, []
                    continue
                am = ATTR.match(line)
                if am:
                    anchor, indent, traits = i, am.group(1), []
                    continue
                if anchor is None:
                    continue
                tm = TRAIT.match(line)
                if tm:
                    traits.append(tm.group(1))
                    continue
                mm = METHOD.match(line)
                if mm and cls:
                    found.setdefault(f"{cls}.{mm.group(1)}", []).append(
                        (path, anchor, indent, list(traits)))
                    anchor = None
    return found


def apply_traits(wanted, present, dry):
    """Inserts the missing attributes under the [Fact]/[Theory]."""
    edits = {}
    posed = 0
    for ref, values in sorted(wanted.items()):
        for path, anchor, indent, traits in present.get(ref, []):
            missing = [v for v in values if v not in traits]
            if not missing:
                continue
            edits.setdefault(path, []).append((anchor, indent, missing))
            posed += len(missing)
    for path, items in edits.items():
        lines = read(path).splitlines(keepends=True)
        for anchor, indent, missing in sorted(items, reverse=True):
            block = "".join(f'{indent}[Trait("RM", "{v}")]\n' for v in missing)
            lines.insert(anchor + 1, block)
        if not dry:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("".join(lines))
    return posed, len(edits)


def strip_column(dry):
    """Removes the 4th column of the `## Règles métier` tables."""
    touched, malformed = 0, []
    for base, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in SKIP]
        if "CLAUDE.md" not in files:
            continue
        md = os.path.join(base, "CLAUDE.md")
        src = read(md)
        out, in_section, changed = [], False, False
        for line in src.splitlines():
            if line.startswith("## "):
                in_section = bool(SECTION.match(line))
                out.append(line)
                continue
            if not in_section or not line.strip().startswith("|"):
                out.append(line)
                continue
            cells = line.rstrip().split("|")
            if len(cells) != 6:
                if len(cells) > 6:
                    malformed.append(f"{os.path.relpath(md, ROOT)}: {line[:80]}")
                out.append(line)
                continue
            out.append("|".join(cells[:4]) + "|")
            changed = True
        if changed:
            touched += 1
            if not dry:
                with open(md, "w", encoding="utf-8") as fh:
                    fh.write("\n".join(out) + ("\n" if src.endswith("\n") else ""))
    return touched, malformed


def main():
    do_traits = "--apply-traits" in sys.argv
    do_strip = "--strip-column" in sys.argv
    dry = not (do_traits or do_strip)

    if do_strip:
        touched, malformed = strip_column(False)
        print(f"Tests column removed: {touched} CLAUDE.md")
        for m in malformed:
            print(f"  ROW NOT SPLIT: {m}")
        return

    wanted, untested = wanted_traits()
    present = scan_tests()

    dead = sorted(r for r in wanted if r not in present)
    ambiguous = sorted(r for r in wanted if len(present.get(r, [])) > 1)

    total_values = sum(len(v) for v in wanted.values())
    print(f"rules with test: {total_values} | methods cited: {len(wanted)}")
    print(f"rules with no test: {len(untested)}")
    print(f"dead references: {len(dead)} | homonym methods: {len(ambiguous)}")
    print()

    if do_traits:
        if dead:
            print("Dead references present — handle them before --apply-traits:")
            for d in dead:
                print(f"  DEAD REFERENCE: {d}")
            sys.exit(1)
        posed, files = apply_traits(wanted, present, dry=False)
        print(f"traits written: {posed} across {files} files")
        return

    posed, files = apply_traits(wanted, present, dry=True)
    print(f"traits to write: {posed} across {files} files")
    for d in dead:
        print(f"  DEAD REFERENCE: {d}")
    for a in ambiguous:
        print(f"  HOMONYM: {a} → {len(present[a])} occurrences")
    for value, md in untested:
        print(f"  NO TEST: {value} ({os.path.relpath(md, ROOT)})")
    _, malformed = strip_column(True)
    for m in malformed:
        print(f"  ROW NOT SPLIT: {m}")


if __name__ == "__main__":
    main()
