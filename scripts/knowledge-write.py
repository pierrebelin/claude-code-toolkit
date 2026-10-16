#!/usr/bin/env python3
"""The one writer of the knowledge base: staged drafts in, files, ids and history out.

`/knowledge-sync` and its extraction agent never write under `knowledge.root` directly:
they write drafts into the staging folder `<root>/.sync/`, git-ignored, one folder per
context laid out as the base (`<root>/.sync/Catalog/usecases/…`). An ADR is global in
the base but belongs to the context whose sync drafts it: staged under
`<root>/.sync/Catalog/adr/…`, written to `<root>/adr/…`, counted in that context's
`HISTORY.md` delta. A staged file replaces the base file at the same path, whole; an
empty staged file deletes it. A new object carries a provisional id — `CAT-CU-?1`,
`CAT-RM-?2`, `CAT-D-?1`, `ADR-?1`, in a use-case file name too — numbered only at
`apply`, so a draft dropped at validation takes no id. Format:
`skills/knowledge-sync/references/knowledge-format.md`.

    cctoolkit knowledge-write init
        creates the staging folder, `<root>/.gitignore` (`.index/`, `.sync/`) and
        `<root>/.gitattributes` (`*/HISTORY.md merge=union`: two branches that each added
        a row keep both) when absent; prints the staging path.
    cctoolkit knowledge-write status [--context C[,C]]
        per staged context, its ADRs included: files, new and rewritten objects,
        `specified` objects by kind, `kit:observed` objects by level, provisional ids
        cited but defined nowhere.
    cctoolkit knowledge-write validate --context C[,C] [--accept high[,medium]] [--drop low[,medium]] [--keep <id>[,<id>]]
        batch validation in the staging: `--accept` deletes the `kit:observed` lines at
        those levels (their objects become `specified`), `--drop` removes the new objects
        at those levels, nested ones included — never an object the base already holds.
        `--keep` leaves the objects named untouched by both: a conflict left open stays
        `observed`.
    cctoolkit knowledge-write rename <Context> <OldHandler> <NewHandler>
    cctoolkit knowledge-write retire <Context> <Handler>
        the mechanical changes `knowledge-scan` lists, staged: the handler's name in the
        `kit:handlers` section of its use case; a use case left without handler is
        staged empty, so `apply` deletes it.
    cctoolkit knowledge-write apply [--context C[,C]]
        the staged drafts of the contexts named (all of them without `--context`):
        numbers their provisional ids (one above the largest in the base and `todo/`, as
        `next-id`), writes their files, then one `HISTORY.md` row per context —
        `| <date> | sync <HEAD> | <delta> |`, `—` when nothing changed — on top of its
        table, and clears their drafts; the other contexts' drafts stay staged. A context
        named with nothing staged gets its row too: the sync ran, the mark moves on.
        Refused, nothing written: a provisional id cited but defined nowhere in what is
        applied, an id defined twice, a prefix outside `knowledge.contexts`, a file staged
        outside a context folder, a base file staged by two contexts. Warns on an
        `OVERVIEW.md` above `knowledge.overviewBudget`. Rebuilds the index and `INDEX.md`
        (`lib/knowledge_index.py`).
    cctoolkit knowledge-write mark --context C[,C]
        `apply` for contexts with nothing staged: the row `sync <HEAD> | —`.
    cctoolkit knowledge-write status|apply --merge <CODE>
        the same on the merge of a delivered feature, staged by `cctoolkit
        knowledge-merge stage` in `<root>/.merge/<CODE>/`: no provisional id, the row's
        `Feature` is the spec's code (`<CODE> partial` for a partial merge, from
        `.merge/<CODE>/.feature`), no `HEAD` needed, an `OVERVIEW.md` above budget
        refused instead of warned; the whole `.merge/<CODE>/` cleared once applied.

`apply` refuses a rule a draft leaves in a use case's file while several use cases apply
it — its place is `rules.md` (`lib/knowledge.py` `misplaced`); a misplacement the base
already had, or a rule of `rules.md` a single use case applies, is only warned.

Delta: `+id` defined now and not before, `-id` defined before and not now, `~id` whose
body changed. An ADR counts in the context that staged it, and only there: a context
the sync did not look at keeps its mark.

Exit 0, 1 refused (nothing written), 2 usage, 3 config defect.
"""
import datetime
import hashlib
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
import knowledge  # noqa: E402
import knowledge_index  # noqa: E402

STAGING = ".sync"
LEVELS = ("high", "medium", "low")
PROVISIONAL = re.compile(r"(?<![A-Za-z0-9-])((?:[A-Z][A-Z0-9]{1,5}-(?:CU|RM|D))|ADR)-\?(\d+)(?![0-9A-Za-z])")
PROV_HEADING = re.compile(r"^(#{1,6})\s+((?:[A-Z][A-Z0-9]{1,5}-(?:CU|RM|D)|ADR)-\?\d+)\s+—\s")
WIDTH = {"CU": 2, "RM": 3, "D": 3, "ADR": 3}
IGNORE = (".index/", ".sync/", ".merge/")
MERGES = ".merge"
ATTRIBUTES = "*/HISTORY.md merge=union\n"
HISTORY_HEAD = "# {ctx} — history\n\n<!-- kit:cols date,feature,delta -->\n| Date | Feature | Delta |\n|------|---------|-------|\n"


def usage(msg=None):
    if msg:
        print(f"knowledge-write: {msg}", file=sys.stderr)
    print("usage: cctoolkit knowledge-write init | status [--context C,…] | validate --context C,… [--accept L,…] [--drop L,…] [--keep id,…]\n"
          "       cctoolkit knowledge-write rename <Context> <Old> <New> | retire <Context> <Handler>\n"
          "       cctoolkit knowledge-write apply [--context C,…] | mark --context C,…\n"
          "       cctoolkit knowledge-write status|apply --merge <CODE>", file=sys.stderr)
    sys.exit(2)


def refuse(lines):
    for line in lines:
        print(f"refused: {line}", file=sys.stderr)
    print("nothing written", file=sys.stderr)
    return 1


# --- paths ---------------------------------------------------------------------------------
def base():
    return knowledge.base_dir(C)


MERGE = None


def staging():
    return os.path.join(base(), MERGES, MERGE) if MERGE else os.path.join(base(), STAGING)


def staged_files():
    """Repo-relative paths under the base of every staged file: {rel to base: abs}."""
    out = {}
    top = staging()
    for d, dirs, files in os.walk(top):
        dirs[:] = [x for x in dirs if not x.startswith(".")]
        for f in files:
            if f.endswith(".md"):
                p = os.path.join(d, f)
                out[os.path.relpath(p, top)] = p
    return out


def context_of_rel(rel):
    """Context of a path under the base or the staging: its first folder — none for the
    base's `adr/` or a loose file."""
    parts = rel.split(os.sep)
    return parts[0] if len(parts) > 1 and parts[0] != knowledge.ADR_DIR else None


def base_rel(rel):
    """Where a staged file lands: `<Context>/adr/<f>` in the global `adr/<f>`, any
    other at the same path."""
    parts = rel.split(os.sep)
    return os.path.join(*parts[1:]) if len(parts) > 2 and parts[1] == knowledge.ADR_DIR else rel


def staged_contexts():
    return sorted({c for c in map(context_of_rel, staged_files()) if c})


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def digest(text):
    return hashlib.sha1(" ".join(text.split()).encode()).hexdigest()


# --- the base, as a state ------------------------------------------------------------------
def state(files):
    """{id: (rel, body digest)} of every object the files define; duplicates listed apart."""
    out, dup = {}, []
    for rel, text in sorted(files.items()):
        for o in knowledge.objects(text):
            if o.id in out:
                dup.append(f"{o.id} defined in {out[o.id][0]} and {rel}")
            out[o.id] = (rel, digest(o.body + o.title))
    return out, dup


def base_texts():
    out = {}
    for path in knowledge.markdown_files(base()):
        rel = os.path.relpath(path, base())
        if os.path.basename(rel) in ("HISTORY.md", "INDEX.md"):
            continue
        out[rel] = knowledge.read(path)
    return out


# --- status --------------------------------------------------------------------------------
def provisional_defined(text):
    return {m.group(2) for m in map(PROV_HEADING.match, text.splitlines()) if m}


def dangling(texts):
    """Provisional ids cited in any staged file and defined in none: [(id, rel, line)]."""
    defined = set()
    for text in texts.values():
        defined |= provisional_defined(text)
    out = []
    for rel, text in sorted(texts.items()):
        for i, line in enumerate(text.splitlines(), 1):
            for m in PROVISIONAL.finditer(line):
                if m.group(0) not in defined:
                    out.append((m.group(0), rel, i))
        for m in PROVISIONAL.finditer(os.path.basename(rel)):
            if m.group(0) not in defined:
                out.append((m.group(0), rel, 0))
    return out


def status(ctxs):
    files = staged_files()
    texts = {rel: knowledge.read(p) for rel, p in files.items()}
    shown = ctxs or staged_contexts()
    if not files:
        print("nothing staged")
        return 0
    known, _ = state(base_texts())
    for ctx in shown:
        mine = {r: t for r, t in texts.items() if context_of_rel(r) == ctx}
        if not mine:
            continue
        new, rewritten, deleted, levels = 0, 0, 0, dict.fromkeys(LEVELS, 0)
        specified = dict.fromkeys(("CU", "RM", "D", "ADR"), 0)
        for rel, text in mine.items():
            if not text.strip():
                deleted += 1
                continue
            for o in knowledge.objects(text) + provisional_objects(text):
                if "?" in o.id or o.id not in known:
                    new += 1
                else:
                    rewritten += 1
                if o.observed:
                    levels[o.observed] += 1
                else:
                    specified[o.kind] += 1
        spec = ", ".join(f"{k} {v}" for k, v in specified.items())
        obs = ", ".join(f"{k} {v}" for k, v in levels.items())
        print(f"{ctx}: {len(mine)} file(s) — new {new}, rewritten {rewritten}, deleted files {deleted}"
              f" — specified: {spec} — observed: {obs}")
    for oid, rel, line in dangling(texts):
        print(f"dangling: {oid} cited in {rel}{':' + str(line) if line else ''}, defined nowhere")
    return 0


def provisional_objects(text):
    """The objects whose heading carries a provisional id, parsed like real ones."""
    swapped = PROVISIONAL.sub(lambda m: f"{m.group(1)}-9{m.group(2)}0000", text)
    out = []
    for o in knowledge.objects(swapped):
        m = re.match(r"^(.*)-9(\d+)0000$", o.id)
        if m and f"{m.group(1)}-?{m.group(2)}" in text:
            o.id = f"{m.group(1)}-?{m.group(2)}"
            out.append(o)
    return out


# --- validate ------------------------------------------------------------------------------
def own_lines(objs, o):
    """The lines of an object before its first nested object: its `kit:observed` line is there."""
    own = next((p.start for p in objs if o.start < p.start < o.end), o.end)
    return range(o.start, own)


def validate(ctxs, accept, drop, keep):
    touched = 0
    for rel, path in sorted(staged_files().items()):
        if context_of_rel(rel) not in ctxs:
            continue
        text = knowledge.read(path)
        cut, kept_lines = set(), set()
        for o in provisional_objects(text):
            if o.observed in drop and o.id not in keep:
                cut.update(range(o.start, o.end))
        objs = sorted(knowledge.objects(text) + provisional_objects(text), key=lambda o: o.start)
        for o in objs:
            if o.id in keep:
                kept_lines.update(own_lines(objs, o))
        kept = []
        for i, line in enumerate(text.splitlines()):
            m = knowledge.OBSERVED.search(line)
            if i in cut or (m and m.group(1) in accept and i not in kept_lines):
                continue
            kept.append(line)
        new = "\n".join(kept).rstrip("\n") + "\n"
        if new == text:
            continue
        touched += 1
        # A new use case whose heading went is gone whole: nothing of it reaches the base.
        if "?" in rel and not provisional_objects(new):
            os.remove(path)
        else:
            write(path, new)
    print(f"validated: {touched} staged file(s) changed")
    texts = {rel: knowledge.read(p) for rel, p in staged_files().items()}
    for oid, rel, line in dangling(texts):
        print(f"dangling: {oid} cited in {rel}{':' + str(line) if line else ''}, defined nowhere — remove the citation")
    return 0


# --- mechanical ----------------------------------------------------------------------------
def stage_copy(rel):
    """The staged copy of a base file, made from the base when not staged yet."""
    dst = os.path.join(staging(), rel)
    if not os.path.exists(dst):
        write(dst, knowledge.read(os.path.join(base(), rel)))
    return dst


def handler_file(ctx, name):
    for path in knowledge.use_case_files(C, ctx):
        rel = os.path.relpath(path, base())
        staged = os.path.join(staging(), rel)
        text = knowledge.read(staged if os.path.exists(staged) else path)
        if name in knowledge.handlers(text):
            return rel
    return None


def rename(ctx, old, new):
    rel = handler_file(ctx, old)
    if rel is None:
        print(f"knowledge-write: {old} is in no use case of {ctx}", file=sys.stderr)
        return 1
    path = stage_copy(rel)
    text = knowledge.read(path)
    out, inside = [], False
    for line in text.splitlines():
        if knowledge.ANY_HEADING.match(line):
            inside = bool(knowledge.HANDLERS.match(line))
        elif inside:
            line = line.replace(f"`{old}`", f"`{new}`", 1)
        out.append(line)
    write(path, "\n".join(out) + "\n")
    print(f"staged: {old} → {new} in {rel}")
    return 0


def retire(ctx, name):
    rel = handler_file(ctx, name)
    if rel is None:
        print(f"knowledge-write: {name} is in no use case of {ctx}", file=sys.stderr)
        return 1
    path = stage_copy(rel)
    text = knowledge.read(path)
    out, inside = [], False
    for line in text.splitlines():
        if knowledge.ANY_HEADING.match(line):
            inside = bool(knowledge.HANDLERS.match(line))
        elif inside and re.match(r"^\s*[-*]\s", line) and (knowledge.CODE.search(line) or [None, None])[1] == name:
            continue
        out.append(line)
    text = "\n".join(out) + "\n"
    if not knowledge.handlers(text):
        write(path, "")
        print(f"staged: {rel} deleted — {name} was its only handler")
    else:
        write(path, text)
        print(f"staged: {name} removed from {rel}")
    return 0


# --- apply ---------------------------------------------------------------------------------
def numbering(texts):
    """{provisional id: real id}, one series per stem, in reading order: use cases, then
    rules.md, decisions.md, the rest, ADRs last — each in path then text order."""
    nxt, out = {}, {}
    rank = {"usecases": 0, "rules.md": 1, "decisions.md": 2}

    def order(rel):
        parts = rel.split(os.sep)
        return (base_rel(rel) != rel, parts[0], rank.get(parts[1] if len(parts) > 1 else "", 3), rel)

    for rel, text in sorted(texts.items(), key=lambda kv: order(kv[0])):
        for m in PROVISIONAL.finditer(rel + "\n" + text):
            pid = m.group(0)
            if pid in out:
                continue
            stem = m.group(1)
            if stem not in nxt:
                nxt[stem] = knowledge.largest(C, stem) + 1
            kind = "ADR" if stem == "ADR" else stem.split("-")[-1]
            out[pid] = f"{stem}-{nxt[stem]:0{WIDTH[kind]}d}"
            nxt[stem] += 1
    return out


def history_row(ctx, row):
    path = knowledge.history_path(C, ctx)
    text = knowledge.read(path) or HISTORY_HEAD.format(ctx=ctx)
    lines = text.splitlines()
    at = None
    for i, line in enumerate(lines):
        if knowledge.COLS.match(line):
            j = i + 1
            while j < len(lines) and lines[j].startswith("|") and (j - i) <= 2:
                j += 1
            at = j
            break
    if at is None:
        lines += ["", "<!-- kit:cols date,feature,delta -->", "| Date | Feature | Delta |", "|------|---------|-------|"]
        at = len(lines)
    lines.insert(at, row)
    write(path, "\n".join(lines) + "\n")


def ensure_git_files():
    path = os.path.join(base(), ".gitignore")
    text = knowledge.read(path)
    missing = [x for x in IGNORE if x not in text.splitlines()]
    if missing:
        write(path, text + ("" if not text or text.endswith("\n") else "\n") + "".join(f"{x}\n" for x in missing))
    path = os.path.join(base(), ".gitattributes")
    if not os.path.exists(path):
        write(path, ATTRIBUTES)


def init():
    os.makedirs(staging(), exist_ok=True)
    ensure_git_files()
    print(C.rel(staging()))
    return 0


def apply(ctxs):
    staged = staged_files()
    errors = [f"{rel}: staged outside a context folder — an ADR goes under <Context>/{knowledge.ADR_DIR}/"
              for rel in staged if context_of_rel(rel) is None]
    files = {r: p for r, p in staged.items() if context_of_rel(r) and (not ctxs or context_of_rel(r) in ctxs)}
    if not files and not ctxs and not errors:
        print("nothing staged")
        return 0
    texts = {rel: knowledge.read(p) for rel, p in files.items()}
    errors += [f"{oid} cited in {rel}{':' + str(line) if line else ''}, defined nowhere" for oid, rel, line in dangling(texts)]
    known = set(C.contexts.values())
    for rel, text in texts.items():
        for m in PROVISIONAL.finditer(rel + "\n" + text):
            p = m.group(1).split("-")[0]
            if m.group(1) != "ADR" and p not in known:
                errors.append(f"{m.group(0)} in {rel}: prefix {p} absent from knowledge.contexts")
        ctx = context_of_rel(rel)
        if ctx not in C.contexts:
            errors.append(f"{rel}: context {ctx} absent from knowledge.contexts")
    if errors:
        return refuse(sorted(set(errors)))
    ids = numbering(texts)
    swap = lambda s: PROVISIONAL.sub(lambda m: ids[m.group(0)], s)  # noqa: E731
    final, owner = {}, {}
    for rel, text in texts.items():
        dst = base_rel(swap(rel))
        if dst in owner:
            errors.append(f"{dst} staged by {owner[dst]} and {context_of_rel(rel)}")
        final[dst], owner[dst] = swap(text), context_of_rel(rel)
    if errors:
        return refuse(sorted(set(errors)))
    before_texts = base_texts()
    after_texts = dict(before_texts)
    for rel, text in final.items():
        if text.strip():
            after_texts[rel] = text
        else:
            after_texts.pop(rel, None)
    before, _ = state(before_texts)
    after, dup = state(after_texts)
    if dup:
        return refuse(dup)
    applied = {context_of_rel(r) for r in files} | set(ctxs)
    was = {(m[0], m[1]) for m in knowledge.misplaced(before_texts)}
    moved, kept = [], []
    for oid, rel, home, cus in knowledge.misplaced(after_texts):
        if rel.split(os.sep)[0] not in applied:
            continue
        line = f"{oid} in {rel}, applied by {', '.join(cus)} — belongs in {home}"
        # Refused: a rule left in a use case's file that several apply. Warned: one rule of
        # rules.md a single use case still applies — a retire leaves it so, nothing to draft.
        (moved if (oid, rel) not in was and os.path.basename(home) == "rules.md" else kept).append(line)
    if moved:
        return refuse(moved)
    for ctx in sorted(applied):
        ov = os.path.join(ctx, "OVERVIEW.md")
        n = len(after_texts.get(ov, "")) // 4
        if MERGE and ov in final and n > C.overview_budget:
            errors.append(f"{ov} ~{n} tokens, above knowledge.overviewBudget {C.overview_budget} — condense it")
    if errors:
        return refuse(errors)
    if MERGE:
        label = knowledge.read(os.path.join(staging(), ".feature")).strip() or MERGE
    else:
        head = knowledge.head(C.root)
        if head is None:
            return refuse(["no commit yet: a sync row needs HEAD"])
        label = f"sync {head}"
    # Rows: the contexts applied and those named. Only a file applied changes, so every
    # object in the delta sits in one: an ADR counts in the context that staged it.
    deltas = {}
    for oid in sorted(set(before) | set(after), key=sort_key):
        if oid in after and oid not in before:
            sign = "+"
        elif oid in before and oid not in after:
            sign = "-"
        elif before[oid] != after[oid]:
            sign = "~"
        else:
            continue
        rel = (after.get(oid) or before.get(oid))[0]
        deltas.setdefault(owner.get(rel) or context_of_rel(rel), []).append(sign + oid)
    rows = set(ctxs) | set(owner.values())
    for rel, text in final.items():
        path = os.path.join(base(), rel)
        if text.strip():
            write(path, text)
        elif os.path.exists(path):
            os.remove(path)
    for path in files.values():
        os.remove(path)
    date = datetime.date.today().isoformat()
    for ctx in sorted(rows):
        delta = " ".join(deltas.get(ctx, [])) or "—"
        history_row(ctx, f"| {date} | {label} | {delta} |")
        print(f"{ctx}: {label} | {delta}")
    for line in kept:
        print(f"WARN {line}")
    ensure_git_files()
    if MERGE:
        shutil.rmtree(staging(), ignore_errors=True)
        if os.path.isdir(os.path.dirname(staging())) and not os.listdir(os.path.dirname(staging())):
            os.rmdir(os.path.dirname(staging()))
    elif staged_files():
        prune(staging())
    else:
        shutil.rmtree(staging(), ignore_errors=True)
    for ctx in sorted(rows):
        ov = os.path.join(base(), ctx, "OVERVIEW.md")
        n = len(knowledge.read(ov)) // 4
        if n > C.overview_budget:
            print(f"WARN {ctx}/OVERVIEW.md ~{n} tokens, above knowledge.overviewBudget {C.overview_budget} — condense it")
    if ids:
        print("ids: " + ", ".join(f"{k} → {v}" for k, v in ids.items()))
    indexed, _, _ = knowledge_index.refresh(C)
    if knowledge_index.write_index_md(C, indexed):
        print("INDEX.md written")
    return 0


def prune(top):
    """Remove the folders left empty under the staging once some drafts are applied."""
    for d, _, _ in sorted(os.walk(top), key=lambda w: -len(w[0])):
        if d != top and not os.listdir(d):
            os.rmdir(d)


def sort_key(oid):
    order = {"CU": 0, "RM": 1, "D": 2, "ADR": 3}
    return (order[knowledge.kind_of(oid)], oid)


# --- main ----------------------------------------------------------------------------------
def levels(arg):
    out = set(arg.split(",")) - {""}
    if not out <= set(LEVELS):
        usage(f"levels are {', '.join(LEVELS)}")
    return out


def main(argv):
    global C, MERGE
    if not argv:
        usage()
    cmd, rest = argv[0], argv[1:]
    ctxs, accept, drop, keep, args = [], set(), set(), set(), []
    it = iter(rest)
    for a in it:
        if a == "--merge":
            MERGE = next(it, "")
            if not re.match(r"^[A-Za-z0-9][A-Za-z0-9_-]*$", MERGE):
                usage("--merge takes the spec's code")
        elif a == "--context":
            ctxs = [x for x in next(it, "").split(",") if x]
        elif a == "--accept":
            accept = levels(next(it, ""))
        elif a == "--drop":
            drop = levels(next(it, ""))
        elif a == "--keep":
            keep = set(next(it, "").split(",")) - {""}
        elif a.startswith("-"):
            usage(f"unknown option {a}")
        else:
            args.append(a)
    if accept & drop:
        usage("a level is either accepted or dropped")
    try:
        C = kit_config.load()
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 3
    if MERGE and (cmd not in ("status", "apply") or ctxs):
        usage("--merge goes with status or apply, without --context")
    if MERGE and not os.path.isdir(staging()):
        print(f"nothing staged for {MERGE} — cctoolkit knowledge-merge stage <plan>", file=sys.stderr)
        return 1
    if cmd == "init" and not args and not ctxs:
        return init()
    if cmd == "status" and not args:
        return status(ctxs)
    if cmd == "validate" and ctxs and not args and (accept or drop):
        return validate(set(ctxs), accept, drop, keep)
    if cmd == "rename" and len(args) == 3:
        return rename(*args)
    if cmd == "retire" and len(args) == 2:
        return retire(*args)
    if cmd == "apply" and not args:
        return apply(ctxs)
    if cmd == "mark" and ctxs and not args:
        busy = sorted({context_of_rel(r) for r in staged_files()} & set(ctxs))
        if busy:
            print(f"knowledge-write: drafts are staged for {', '.join(busy)} — apply them, or clear them first", file=sys.stderr)
            return 1
        return apply(ctxs)
    usage()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
