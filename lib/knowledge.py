#!/usr/bin/env python3
"""The knowledge base, read — the one parser of `knowledge.root` every script goes through.

Reads ids in headings, `kit:` anchors and code in backticks only
(`skills/knowledge-sync/references/knowledge-format.md` § What a script reads). Nothing here writes.

    python3 lib/knowledge.py guarded <path>   exit 0 when guarded, 1 otherwise
"""
import os
import re
import subprocess
import sys

ID = r"(?:[A-Z][A-Z0-9]{1,5}-(?:CU|RM|D)-\d+|ADR-\d+)"
ID_RE = re.compile(rf"(?<![A-Za-z0-9-]){ID}(?![0-9A-Za-z])")
HEADING = re.compile(rf"^(#{{1,6}})\s+({ID})\s+—\s+(.*?)\s*$")
ANY_HEADING = re.compile(r"^(#{1,6})\s")
HANDLERS = re.compile(r"^##\s.*<!--\s*kit:handlers\s*-->")
OBSERVED = re.compile(r"<!--\s*kit:observed\s+(high|medium|low)\s*-->\s*$")
CODE = re.compile(r"`([^`]+)`")
COLS = re.compile(r"^\s*<!--\s*kit:cols\s")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SYNC = re.compile(r"^sync\s+([0-9a-f]{4,40})$")
DELTA = re.compile(r"\s*<!--\s*kit:(new|modified|retired)\s*-->\s*$")
ADR_DIR = "adr"
PENDING = "todo"
GUARDED = ("rules.md", "decisions.md", "HISTORY.md")


def kind_of(oid):
    if oid.startswith("ADR-"):
        return "ADR"
    return oid.split("-")[-2]


class Obj:
    __slots__ = ("id", "kind", "level", "title", "start", "end", "body", "observed")

    def __init__(self, oid, level, title, start):
        self.id, self.kind, self.level, self.title, self.start = oid, kind_of(oid), level, title, start
        self.end, self.body, self.observed = start, "", None


def objects(text):
    """Objects in heading order; body runs to the next heading of the same or a higher level."""
    lines = text.splitlines()
    out, open_ = [], []
    for i, line in enumerate(lines):
        h = ANY_HEADING.match(line)
        if not h:
            continue
        level = len(h.group(1))
        for o in [o for o in open_ if o.level >= level]:
            o.end = i
            open_.remove(o)
        m = HEADING.match(line)
        if m:
            o = Obj(m.group(2), level, m.group(3), i)
            out.append(o)
            open_.append(o)
    for o in open_:
        o.end = len(lines)
    for o in out:
        o.body = "\n".join(lines[o.start + 1:o.end]).strip("\n")
        # Its own lines only: a rule's `kit:observed` line never marks the use case holding it.
        own = next((p.start for p in out if o.start < p.start < o.end), o.end)
        for line in lines[o.start + 1:own]:
            m = OBSERVED.search(line)
            if m:
                o.observed = m.group(1)
                break
    return out


def handlers(text):
    """First code span of each list item under the `kit:handlers` heading."""
    out, inside = [], False
    for line in text.splitlines():
        if ANY_HEADING.match(line):
            inside = bool(HANDLERS.match(line))
            continue
        if inside and re.match(r"^\s*[-*]\s", line):
            m = CODE.search(line)
            if m:
                out.append(m.group(1).strip())
    return out


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def base_dir(c):
    return os.path.join(c.root, c.knowledge_root)


def contexts(c):
    """Context folders present in the base, sorted."""
    base = base_dir(c)
    try:
        names = os.listdir(base)
    except OSError:
        return []
    return sorted(d for d in names if os.path.isdir(os.path.join(base, d)) and not d.startswith(".") and d != ADR_DIR)


def use_case_files(c, ctx):
    d = os.path.join(base_dir(c), ctx, "usecases")
    try:
        return sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".md"))
    except OSError:
        return []


def use_cases(c, only=None):
    """{handler name: (context, use-case id, repo-relative path)}; the first citing use case wins."""
    out = {}
    for ctx in contexts(c):
        if only and ctx not in only:
            continue
        for path in use_case_files(c, ctx):
            text = read(path)
            cu = next((o.id for o in objects(text) if o.kind == "CU"), None)
            for h in handlers(text):
                out.setdefault(h, (ctx, cu, c.rel(path)))
    return out


def history_path(c, ctx):
    return os.path.join(base_dir(c), ctx, "HISTORY.md")


def history(path):
    """[(date, feature, delta)] of the table under `<!-- kit:cols date,feature,delta -->`, by position."""
    rows, state = [], "before"
    for line in read(path).splitlines():
        if state == "before":
            if COLS.match(line):
                state = "cols"
            continue
        if not line.startswith("|"):
            if state == "table":
                break
            continue
        state = "table"
        cells = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(cells) >= 3 and DATE.match(cells[0]):
            rows.append((cells[0], cells[1], cells[2]))
    return rows


PROVISIONAL = re.compile(r"(?<![A-Za-z0-9-])((?:[A-Z][A-Z0-9]{1,5}-(?:CU|RM|D))|ADR)-\?(\d+)(?![0-9A-Za-z])")


def refuse(lines, tail):
    """Each refusal on stderr, then the tail line (`nothing written`, `nothing staged`): exit 1."""
    for line in lines:
        print(f"refused: {line}", file=sys.stderr)
    print(tail, file=sys.stderr)
    return 1


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def base_texts(c):
    """{rel: text} of the base's files but HISTORY.md and INDEX.md."""
    top = base_dir(c)
    return {os.path.relpath(p, top): read(p) for p in markdown_files(top)
            if os.path.basename(p) not in ("HISTORY.md", "INDEX.md")}


def git(root, *args):
    p = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    return p.returncode, p.stdout


def head(root):
    rc, out = git(root, "rev-parse", "--short", "HEAD")
    return out.strip() if rc == 0 else None


def sync_marks(c, ctx):
    """Full hashes of the context's sync rows that git knows and that are ancestors of HEAD."""
    marks = []
    for _, feature, _ in history(history_path(c, ctx)):
        m = SYNC.match(feature)
        if not m:
            continue
        rc, full = git(c.root, "rev-parse", "--verify", "--quiet", m.group(1) + "^{commit}")
        if rc != 0:
            continue
        full = full.strip()
        if full in marks:
            continue
        if git(c.root, "merge-base", "--is-ancestor", full, "HEAD")[0] == 0:
            marks.append(full)
    return marks


def markdown_files(top):
    for base, dirs, files in os.walk(top):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            if f.endswith(".md"):
                yield os.path.join(base, f)


def largest(c, stem):
    """Largest number after `<stem>-` in any `.md` path or content under the base and `todo/`.
    Bounded: not inside XCAT-RM-012 nor CAT-RM-012x; `-CAT-RM-007` (retired) is read."""
    rx = re.compile(rf"(?<![A-Za-z0-9]){re.escape(stem)}-(\d+)(?![0-9A-Za-z])")
    top = 0
    for rel in (c.knowledge_root, PENDING):
        for path in markdown_files(os.path.join(c.root, rel)):
            for m in rx.finditer(os.path.relpath(path, c.root) + "\n" + read(path)):
                top = max(top, int(m.group(1)))
    return top


def cites(text, oid):
    rx = re.compile(rf"(?<![A-Za-z0-9-]){re.escape(oid)}(?![0-9A-Za-z])")
    return [i for i, line in enumerate(text.splitlines()) if rx.search(line)]


def misplaced(texts):
    """[(rule id, where it is, where it belongs, use-case ids applying it)] from {path: text}:
    a rule two use cases apply belongs in `rules.md`, one applied by a single use case in its file."""
    by_ctx = {}
    for rel, text in texts.items():
        parts = rel.split(os.sep)
        if len(parts) >= 2 and parts[0] != ADR_DIR and text.strip():
            by_ctx.setdefault(parts[0], {})[rel] = text
    out = []
    for ctx, files in sorted(by_ctx.items()):
        shared = os.path.join(ctx, "rules.md")
        ucs = {}
        for rel, text in sorted(files.items()):
            parts = rel.split(os.sep)
            if len(parts) == 3 and parts[1] == "usecases":
                cu = next((o.id for o in objects(text) if o.kind == "CU"), None)
                if cu:
                    ucs[rel] = cu
        for rel in [r for r in [shared] if r in files] + sorted(ucs):
            for o in objects(files[rel]):
                if o.kind != "RM":
                    continue
                appliers = [cu for urel, cu in ucs.items()
                            if urel == rel or cites(files[urel], o.id)]
                if rel != shared and len(appliers) >= 2:
                    out.append((o.id, rel, shared, appliers))
                elif rel == shared and len(appliers) == 1:
                    home = next(u for u, cu in ucs.items() if cu == appliers[0])
                    out.append((o.id, rel, home, appliers))
    return out


def guarded(c, path):
    """`<root>/<Context>/rules.md`, `decisions.md` or `HISTORY.md` — the files that grow with the repo."""
    rel = os.path.relpath(os.path.realpath(path), os.path.realpath(c.root)).split(os.sep)
    root = c.knowledge_root.split("/")
    under = rel[len(root):]
    return (rel[:len(root)] == root and len(under) == 2 and under[1] in GUARDED
            and not under[0].startswith(".") and under[0] != ADR_DIR)


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import kit_config
    if len(sys.argv) != 3 or sys.argv[1] != "guarded":
        sys.exit("usage: python3 lib/knowledge.py guarded <path>")
    try:
        sys.exit(0 if guarded(kit_config.load(), sys.argv[2]) else 1)
    except kit_config.KitConfigError:
        sys.exit(1)
