#!/usr/bin/env python3
"""Migration: the `Tests` column of the rule sheets becomes a tag on each test.

The mapping already exists: the `Tests` column carries exactly the rule <-> test
correspondence to write into the traits. This script reads it, puts the attributes
in place, then removes the column.

Tag value: `<HandlerFolder>/<RM|RL-xx>`, written in the carrier of the `testTag`
adapter (xUnit: `[Trait("RM", "…")]`). The prefix is the handler folder, not the
aggregate: `RM` numbering is not unique per feature (13 collisions measured in one
feature on the reference repo).

    cctoolkit migrate-rm-traits                 # report (dry run)
    cctoolkit migrate-rm-traits --apply-traits  # writes the attributes
    cctoolkit migrate-rm-traits --strip-column  # removes the 4th column
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
try:
    import kit_config
    import kit_testtag
    C = kit_config.load(ROOT)
    AD = kit_testtag.adapter(C)
except ImportError:
    sys.exit("kit_config.py not found beside scripts/ — reinstall the cctoolkit plugin")
except (kit_config.KitConfigError, kit_testtag.TestTagError) as e:
    sys.exit(f"kit.config.json: {e} — cctoolkit doctor")

# The rules section is the `## ` heading anchored `<!-- kit:rules -->`, whatever its
# title. A sheet older than the anchors gets them first: scripts/migrate-anchors.py.
ANCHOR = re.compile(r"<!--\s*kit:rules\s*-->")
ROW = re.compile(r"^\|\s*(R[ML]-\d+)\s*\|(.*)$")


def read(path):
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read()


def rule_rows(md):
    """(rule_id, refs) of the rows of the `kit:rules` table."""
    rows, in_section = [], False
    for line in read(md).splitlines():
        if line.startswith("## "):
            in_section = bool(ANCHOR.search(line))
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
    """Every rule sheet carrying a rules table, under the use-case roots."""
    for base, files in C.walk(C.use_case_roots):
        if C.rule_sheet not in files:
            continue
        md = os.path.join(base, C.rule_sheet)
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
    """{Class.Method: [Test, ...]} — a list, to detect homonyms."""
    found = {}
    for t, _ in kit_testtag.scan_tree(C, AD):
        found.setdefault(t.key, []).append(t)
    return found


def apply_traits(wanted, present, dry):
    """Writes the missing tags in the adapter's carrier (xUnit: under the [Fact]/[Theory])."""
    edits = {}
    posed = 0
    for ref, values in sorted(wanted.items()):
        for t in present.get(ref, []):
            missing = [v for v in values if v not in t.tags]
            if not missing:
                continue
            edits.setdefault(t.path, []).append((t.anchor, t, missing))
            posed += len(missing)
    for path, items in edits.items():
        lines = read(path).splitlines(keepends=True)
        for _, t, missing in sorted(items, key=lambda x: x[0], reverse=True):
            AD.apply(lines, t, missing)
        if not dry:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("".join(lines))
    return posed, len(edits)


def strip_column(dry):
    """Removes the 4th column of the `kit:rules` tables."""
    touched, malformed = 0, []
    for base, files in C.walk(C.use_case_roots):
        if C.rule_sheet not in files:
            continue
        md = os.path.join(base, C.rule_sheet)
        src = read(md)
        out, in_section, changed = [], False, False
        for line in src.splitlines():
            if line.startswith("## "):
                in_section = bool(ANCHOR.search(line))
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
        print(f"Tests column removed: {touched} {C.rule_sheet}")
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
