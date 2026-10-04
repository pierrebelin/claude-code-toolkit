#!/usr/bin/env python3
"""Migration: produced documents written before the `<!-- kit:… -->` anchors get them.

The parsers (`.claude/hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`,
`scripts/migrate-rm-traits.py`, the `/plan-implementation` gate) match anchors, never
titles. A document written earlier carries its English or French title and no anchor:
the parsers no longer see it. This script appends the anchor to every heading, row
and line it recognises, by folded title (accents and case ignored), English or French.

    cctoolkit migrate-anchors           # report (dry run)
    cctoolkit migrate-anchors --apply   # writes the anchors

Scope: the rule sheets (`layout.ruleSheet`, handler `CLAUDE.md`) under the use-case
roots of `.claude/kit.config.json` (clean-architecture: `src/<Product>.Application/`), and under
`todo/` the specs (`SPEC-*.md`), global plans (`*-PLAN.md`) and batch sheets
(`*-PLAN-F<n>.md`). Idempotent: a line already carrying a `kit:` anchor is left as is.
A `## ` heading it does not recognise is reported, never guessed.
"""
import os
import re
import sys
import unicodedata

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
    C = kit_config.load(ROOT)
except ImportError:
    sys.exit("kit_config.py not found beside scripts/ — reinstall the cctoolkit plugin")
except kit_config.KitConfigError as e:
    sys.exit(f"kit.config.json: {e} — cctoolkit doctor")
APPS = C.dirs(C.use_case_roots)
TODO = os.path.join(ROOT, "todo")
SKIP = {"bin", "obj", "bin-linux", "obj-linux", "Properties", "node_modules"}

# Folded title prefix -> anchor, per document type. Prefix, so that a suffix such
# as "(if applicable)" still matches; numbering ("12. ") is stripped before.
HEADINGS = {
    "handler": [
        (("regles metier", "regle metier", "business rules"), "rules"),
        (("flux", "flow"), "flow"),
        (("evenements emis", "emitted events"), "events"),
    ],
    "spec": [
        (("context",), "context"),
        (("vocabula",), "vocabulary"),
        (("overview", "vue d'ensemble", "vue d’ensemble"), "overview"),
        (("use cases", "cas d'usage", "cas d’usage", "cas d'utilisation"), "use-cases"),
        (("business rules", "regles metier"), "business-rules"),
        (("data", "donnees"), "data"),
        (("states", "etats"), "states"),
        (("cross-cutting", "comportements transverses"), "cross-cutting"),
        (("relations",), "relations"),
        (("out of scope", "hors perimetre", "hors scope", "hors champ"), "out-of-scope"),
        (("assumptions", "hypotheses"), "assumptions"),
        (("open questions", "questions ouvertes"), "open-questions"),
    ],
    "plan": [
        (("summary", "resume", "synthese"), "summary"),
        (("scope", "perimetre"), "scope"),
        (("traceability", "tracabilite"), "traceability"),
        (("ddd and architecture", "conception ddd"), "ddd-design"),
        (("cross-cutting", "elements transverses"), "cross-cutting"),
    ],
    "sheet": [
        (("intent", "intention"), "intent"),
        (("design", "conception"), "design"),
        (("decisions",), "decisions"),
        (("tdd sequence", "sequence tdd"), "tdd-sequence"),
        (("test policy", "politique de test"), "test-policy"),
        (("code elements", "elements de code"), "code-elements"),
        (("ancrages", "anchors"), "ancrages"),
        (("assumptions", "hypotheses"), "assumptions"),
    ],
}
COLS_RULES = "<!-- kit:cols id,rule,outcome -->"
COLS_QUESTIONS = "<!-- kit:cols n,severity,question,impact,options -->"
HAS_ANCHOR = re.compile(r"<!--\s*kit:")
NUMBER = re.compile(r"^\d+\.\s*")
APPLIED = re.compile(r"^(\s*\|\s*)([^|]+?)(\s*\|.*)$")
NA_LINE = re.compile(r"^(\s*[-*]\s*\*\*([^*]+)\*\*)(.*)$")


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.strip().lower())
                   if unicodedata.category(c) != "Mn")


def kind_of(path):
    name = os.path.basename(path)
    if name == C.rule_sheet:
        return "handler"
    if name.startswith("SPEC-"):
        return "spec"
    if re.search(r"-PLAN-F\d+\.md$", name):
        return "sheet"
    if name.endswith("-PLAN.md"):
        return "plan"
    return None


def anchor_for(kind, title):
    t = NUMBER.sub("", fold(title.split("<!--")[0]))
    for prefixes, anchor in HEADINGS[kind]:
        if t.startswith(prefixes):
            return anchor
    return None


def migrate(path, kind):
    """(new text, anchors added, unrecognised headings)."""
    src = open(path, encoding="utf-8").read()
    out, added, unknown = [], 0, []
    section, table_anchored = None, False
    for line in src.splitlines():
        if line.startswith("## "):
            table_anchored = False
            if HAS_ANCHOR.search(line):
                m = re.search(r"kit:([a-z-]+)", line)
                section = m.group(1) if m else None
                out.append(line)
                continue
            section = anchor_for(kind, line[3:])
            if section:
                line = f"{line.rstrip()} <!-- kit:{section} -->"
                added += 1
            else:
                unknown.append(line[3:].strip())
            out.append(line)
            continue
        stripped = line.strip()
        if HAS_ANCHOR.search(line):
            if "kit:cols" in line:
                table_anchored = True
            out.append(line)
            continue
        # Schema anchor above the first table of a parsed section.
        cols = {("handler", "rules"): COLS_RULES, ("spec", "open-questions"): COLS_QUESTIONS}.get((kind, section))
        if cols and stripped.startswith("|") and not table_anchored:
            if not (out and "kit:cols" in out[-1]):
                out.append(cols)
                added += 1
            table_anchored = True
        if kind == "handler" and section == "rules" and fold(stripped).startswith(("none", "aucun")):
            line = f"{line.rstrip()} <!-- kit:none -->"
            added += 1
        elif kind == "sheet":
            m = APPLIED.match(line)
            if m and fold(m.group(2)) in ("applied rules", "regles appliquees"):
                line = f"{m.group(1)}{m.group(2)} <!-- kit:applied-rules -->{m.group(3)}"
                added += 1
        elif kind == "plan":
            m = NA_LINE.match(line)
            if m and fold(m.group(2)) in ("non-applicable rules", "regles non applicables"):
                line = f"{m.group(1)} <!-- kit:na-rules -->{m.group(3)}"
                added += 1
        out.append(line)
    text = "\n".join(out) + ("\n" if src.endswith("\n") else "")
    return text, added, unknown


def documents():
    for top in APPS + [TODO]:
        for base, dirs, files in os.walk(top):
            dirs[:] = [d for d in dirs if d not in SKIP]
            for f in sorted(files):
                path = os.path.join(base, f)
                kind = kind_of(path)
                if kind == "handler" and top not in APPS:
                    continue
                if kind:
                    yield path, kind


def main():
    apply = "--apply" in sys.argv
    files, total = 0, 0
    for path, kind in documents():
        text, added, unknown = migrate(path, kind)
        rel = os.path.relpath(path, ROOT)
        if added:
            files += 1
            total += added
            print(f"  {rel}: {added} anchor(s)")
            if apply:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text)
        for u in unknown:
            print(f"  UNRECOGNISED HEADING: {rel}: '{u}'")
    verb = "written" if apply else "to write"
    print(f"anchors {verb}: {total} across {files} files")


if __name__ == "__main__":
    main()
