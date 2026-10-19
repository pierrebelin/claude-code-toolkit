"""A rule sheet (`layout.ruleSheet`): its sections and its `kit:rules` table.

Read by hooks/handler-claude-md-check.sh and scripts/rules-coverage.py. A section is found by its
`<!-- kit:… -->` anchor, a sheet written without anchors by its exact folded title, English or French.
"""
import re

from kit_config import fold

ANCHOR = re.compile(r"<!--\s*kit:([a-z][a-z0-9-]*)")
COLS = re.compile(r"<!--\s*kit:cols\s+([\w,-]+)\s*-->")
RULE_ID = re.compile(r"R[ML]-\d+")
NONE_LINE = re.compile(r"(none|aucune?)\b")
TITLES = {"regles metier": "rules", "regle metier": "rules", "business rules": "rules",
          "business rule": "rules", "flux": "flow", "flow": "flow",
          "evenements emis": "events", "emitted events": "events"}
COL_LABELS = {"id": "id", "regle": "rule", "rule": "rule", "exception / resultat": "outcome",
              "exception / result": "outcome", "exception / outcome": "outcome"}
ALLOWED = ["rules", "flow", "events"]
SHAPE = "sections anchored <!-- kit:rules -->, <!-- kit:flow -->, <!-- kit:events -->, in that order"


def anchor_of(line):
    m = ANCHOR.search(line)
    return m.group(1) if m else None


def section_of(heading):
    """Anchor of a `## ` heading, else the section its bare title names."""
    return anchor_of(heading) or TITLES.get(fold(heading[3:].split("<!--")[0]))


def rule_rows(text):
    """(rows, explicitly empty) of the `kit:rules` section: rows (rule_id, label), columns by
    `<!-- kit:cols … -->`, else by the header row, else id then rule."""
    rows, in_section, empty_ok, cols, header = [], False, False, ["id", "rule"], False
    for line in text.splitlines():
        if line.startswith("## "):
            in_section = section_of(line) == "rules"
            cols, header = ["id", "rule"], False
            continue
        if not in_section:
            continue
        # An explicitly empty section carries `<!-- kit:none -->` ("None (pure query)").
        if anchor_of(line) == "none" or NONE_LINE.match(fold(line)):
            empty_ok = True
        c = COLS.search(line)
        if c:
            cols, header = c.group(1).split(","), True
            continue
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [x.strip() for x in s.strip("|").split("|")]
        if not header:
            header = True
            named = [COL_LABELS.get(fold(x), "") for x in cells]
            if "id" in named and not any(RULE_ID.fullmatch(x) for x in cells):
                cols = named
                continue
        i = cols.index("id") if "id" in cols else 0
        j = cols.index("rule") if "rule" in cols else 1
        if i < len(cells) and RULE_ID.fullmatch(cells[i]):
            rows.append((cells[i], cells[j] if j < len(cells) else ""))
    return rows, empty_ok


def shape_issues(text):
    """What departs from the fixed shape: kit:rules, kit:flow, kit:events, in that order, nothing else."""
    heads = [l for l in text.splitlines() if l.startswith("## ")]
    issues = []
    extra = [l[3:].split("<!--")[0].strip() for l in heads if section_of(l) not in ALLOWED]
    if extra:
        issues.append("forbidden sections: " + ", ".join(f"'{s}'" for s in extra))
    kept = [section_of(l) for l in heads if section_of(l) in ALLOWED]
    missing = [f"kit:{a}" for a in ALLOWED if a not in kept]
    if missing:
        issues.append("missing sections: " + ", ".join(missing))
    if kept != [a for a in ALLOWED if a in kept]:
        issues.append("expected order: kit:rules, kit:flow, kit:events")
    if heads and not kept:
        issues.append("no kit anchor and no recognised title — sheet written before the anchors: cctoolkit migrate-anchors --apply")
    return issues
