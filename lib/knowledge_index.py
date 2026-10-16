#!/usr/bin/env python3
"""The knowledge base's derived index — `<root>/.index/`, git-ignored — and `INDEX.md`.

    refresh(c, save)      re-parses the base files whose stamp changed since the last
                          run, rewrites `.index/knowledge.jsonl` unless `save` is False;
                          returns the rows and the count of files parsed and left as
                          they were
    index_md(c, rows)     the text of `INDEX.md`
    write_index_md(c, rows)  writes it when it differs; True when written

Incremental: `.index/files.json` keeps, per base file, its stamp (mtime, size), its
digest and what it defines. A file whose stamp moved is read again; its digest
unchanged, its parse is kept. What crosses files — the use cases a rule applies to, the
handlers they carry — is recomputed over every row on each refresh, in memory: a
citation added in one use case changes the row of a rule defined elsewhere.

A row, one per object: `id`, `kind` (CU, RM, D, ADR), `context` (its folder; none for
an ADR), `contexts` (an ADR's: the prefixes of the ids it cites), `title`, `text` (its
own lines, nested objects left out), `status` (`specified` | `observed`), `level`,
`path`, `line` and `end` (1-based, the object's lines in its file), `cites`,
`usecases`, `handlers`. `HISTORY.md` is not indexed: `knowledge.history()` reads it.
"""
import hashlib
import json
import os
import re

import knowledge

INDEX_DIR = ".index"
CACHE = "files.json"
ROWS = "knowledge.jsonl"
VERSION = 1
SKIP = {"INDEX.md", "HISTORY.md"}
SENTENCE = re.compile(r"^(.+?[.!?])(?=\s|$)")


def index_dir(c):
    return os.path.join(knowledge.base_dir(c), INDEX_DIR)


def base_files(c):
    """Repo-relative paths of the base files that hold objects — every `.md` but
    `INDEX.md` and `HISTORY.md`, staging and index folders left out."""
    base = knowledge.base_dir(c)
    return sorted(c.rel(p) for p in knowledge.markdown_files(base) if os.path.basename(p) not in SKIP)


def stamp(path):
    try:
        st = os.stat(path)
    except OSError:
        return None
    return [st.st_mtime_ns, st.st_size]


def parse(c, rel, text):
    """What one file holds, nothing that depends on another file."""
    lines = text.splitlines()
    parts = rel.split("/")
    base_parts = c.knowledge_root.split("/")
    under = parts[len(base_parts):]
    ctx = under[0] if len(under) > 1 and under[0] != knowledge.ADR_DIR else None
    objs = knowledge.objects(text)
    rows = []
    for o in objs:
        own_end = next((p.start for p in objs if o.start < p.start < o.end), o.end)
        own = "\n".join(lines[o.start + 1:own_end]).strip("\n")
        rows.append({
            "id": o.id, "kind": o.kind, "context": ctx, "title": o.title, "text": own,
            "status": "observed" if o.observed else "specified", "level": o.observed,
            "path": rel, "line": o.start + 1, "end": o.end,
            "cites": sorted({i for i in knowledge.ID_RE.findall(own) if i != o.id}),
        })
    defined = {r["id"] for r in rows}
    return {
        "rows": rows,
        # A use-case file applies every id it cites, wherever the citation stands in it.
        "cites": sorted(set(knowledge.ID_RE.findall(text)) - defined),
        "handlers": knowledge.handlers(text),
    }


def derive(c, files):
    """Rows of every file, with the fields that cross files."""
    rows = [r for f in files.values() for r in f["rows"]]
    prefixes = {p: ctx for ctx, p in (c.contexts.items() if isinstance(c.contexts, dict) else [])}
    applies, handlers = {}, {}
    for f in files.values():
        cu = next((r["id"] for r in f["rows"] if r["kind"] == "CU"), None)
        if not cu:
            continue
        handlers[cu] = f["handlers"]
        for oid in [r["id"] for r in f["rows"]] + f["cites"]:
            applies.setdefault(oid, []).append(cu)
    cited_by = {}
    for r in rows:
        for oid in r["cites"]:
            cited_by.setdefault(oid, []).append(r["id"])
    for r in rows:
        if r["kind"] == "CU":
            cus = [r["id"]]
        elif r["kind"] == "RM":
            cus = applies.get(r["id"], [])
        else:
            # A decision or an ADR: the use cases it links, and those citing it.
            cus = [i for i in r["cites"] if knowledge.kind_of(i) == "CU"] + applies.get(r["id"], [])
        r["usecases"] = sorted(set(cus))
        r["handlers"] = sorted({h for cu in r["usecases"] for h in handlers.get(cu, [])})
        r["cited_by"] = sorted(set(cited_by.get(r["id"], [])))
        if r["kind"] == "ADR":
            r["contexts"] = sorted({prefixes[p] for p in (i.split("-")[0] for i in r["cites"]) if p in prefixes})
        else:
            r["contexts"] = [r["context"]] if r["context"] else []
    return sorted(rows, key=lambda r: (r["path"], r["line"]))


def load_cache(c):
    try:
        with open(os.path.join(index_dir(c), CACHE), encoding="utf-8") as fh:
            data = json.load(fh)
        if data.get("version") == VERSION and isinstance(data.get("files"), dict):
            return data["files"]
    except (OSError, ValueError, AttributeError):
        pass
    return {}


def refresh(c, save=True):
    """(rows, parsed, unchanged). Writes `.index/` only when a file moved, never without
    `save` (`knowledge-index --check`, read only)."""
    cache = load_cache(c)
    files, parsed, unchanged, moved = {}, 0, 0, False
    for rel in base_files(c):
        path = os.path.join(c.root, rel)
        st = stamp(path)
        old = cache.get(rel)
        if old and old.get("stamp") == st:
            files[rel] = old
            unchanged += 1
            continue
        text = knowledge.read(path)
        sha = hashlib.sha1(text.encode("utf-8", errors="replace")).hexdigest()
        moved = True
        if old and old.get("sha") == sha:
            files[rel] = dict(old, stamp=st)
            unchanged += 1
            continue
        files[rel] = dict(parse(c, rel, text), stamp=st, sha=sha)
        parsed += 1
    moved = moved or set(cache) != set(files)
    rows = derive(c, files)
    out = index_dir(c)
    if save and (moved or not os.path.exists(os.path.join(out, ROWS))):
        try:
            os.makedirs(out, exist_ok=True)
            with open(os.path.join(out, CACHE), "w", encoding="utf-8") as fh:
                json.dump({"version": VERSION, "files": files}, fh)
            with open(os.path.join(out, ROWS), "w", encoding="utf-8") as fh:
                for r in rows:
                    fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        except OSError:
            pass
    return rows, parsed, unchanged


def summary(c, ctx):
    """First sentence of the context's `OVERVIEW.md`: the line after its title."""
    text = knowledge.read(os.path.join(knowledge.base_dir(c), ctx, "OVERVIEW.md"))
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("<!--"):
            continue
        m = SENTENCE.match(line)
        return (m.group(1) if m else line).replace("|", "\\|")
    return "—"


def index_md(c, rows):
    out = [
        "# Business knowledge", "",
        "<!-- generated by cctoolkit knowledge-index — do not edit -->", "",
        "<!-- kit:cols context,prefix,usecases,rules,decisions,summary -->",
        "| Context | Prefix | Use cases | Rules | Decisions | Summary |",
        "|---------|--------|-----------|-------|-----------|---------|",
    ]
    base = knowledge.base_dir(c)
    prefixes = c.contexts if isinstance(c.contexts, dict) else {}
    for ctx in knowledge.contexts(c):
        n = {k: sum(1 for r in rows if r["context"] == ctx and r["kind"] == k) for k in ("CU", "RM", "D")}
        name = f"[{ctx}]({ctx}/OVERVIEW.md)" if os.path.isfile(os.path.join(base, ctx, "OVERVIEW.md")) else ctx
        out.append(f"| {name} | {prefixes.get(ctx, '—')} | {n['CU']} | {n['RM']} | {n['D']} | {summary(c, ctx)} |")
    out += ["", f"ADR: {sum(1 for r in rows if r['kind'] == 'ADR')}.", ""]
    return "\n".join(out)


def write_index_md(c, rows):
    path = os.path.join(knowledge.base_dir(c), "INDEX.md")
    text = index_md(c, rows)
    if knowledge.read(path) == text:
        return False
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return True
