#!/usr/bin/env python3
"""The merge of a delivered feature into the knowledge base — its mechanical part.

The spec's delta is `<!-- kit:new|modified|retired -->` on its headings; the plan's sheets carry
the ADRs. `agents/knowledge-merger.md` writes the prose, `knowledge-write apply --merge <CODE>`
writes the base. Staging `<root>/.merge/<CODE>/`: `.drafts/<Context>/` one fragment per object
(a use case or an ADR whole as `<id>-<slug>.md`, a rule or a decision alone as `<id>.md`,
`OVERVIEW.md` whole), `<Context>/…` the files `stage` assembles.

    cctoolkit knowledge-merge prepare <plan> [--partial]
        clears the staging, drafts the spec's decisions and the sheets' ADRs, prints the
        merger's packet. Every batch ✅ DONE, or with `--partial` the objects whose batches
        are. `nothing to merge: ` — no delta, or the feature's `HISTORY.md` row exists.
        Refused: a batch not done, a `new` id the base holds under another title
        (`collision: `, with the next free id), a `modified`/`retired` id the base lacks.
    cctoolkit knowledge-merge stage <plan>
        assembles the drafts over the base. Refused, nothing staged: a delta object without
        draft, a draft no delta announces, a provisional id, a new dead citation, a new
        misplaced rule, an `OVERVIEW.md` over budget. Prints `+added −removed <file>` per
        file, then the `apply` command.
    cctoolkit knowledge-merge renumber <plan> <old id> <new id>
        the id rewritten in the plan folder and the source and test roots, the staging cleared.

Exit 0, 1 refused (nothing staged), 2 usage, 3 config defect.
"""
import collections
import difflib
import glob
import importlib.util
import json
import os
import re
import shutil
import sys
import unicodedata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
import knowledge  # noqa: E402

MERGES = ".merge"
DRAFTS = ".drafts"
PACKET = ".packet.json"
FEATURE = ".feature"
PROVISIONAL = re.compile(r"(?<![A-Za-z0-9-])(?:[A-Z][A-Z0-9]{1,5}-(?:CU|RM|D)|ADR)-\?\d+")
PLAN_ID = re.compile(r"(?<![\w-])T\d+(?![\w-])(?:,\s*)?")
DRAFT_FILE = re.compile(rf"^({knowledge.ID})(?:-[a-z0-9-]+)?\.md$")
SECTIONS = ("vocabulary", "states", "relations")
HEADS = {"RM": "# {ctx} — cross-cutting rules\n", "D": "# {ctx} — decisions\n"}


def usage(msg=None):
    if msg:
        print(f"knowledge-merge: {msg}", file=sys.stderr)
    print("usage: cctoolkit knowledge-merge prepare <plan> [--partial] | stage <plan>\n"
          "       cctoolkit knowledge-merge renumber <plan> <old id> <new id>", file=sys.stderr)
    sys.exit(2)


def refuse(lines):
    for line in lines:
        print(f"refused: {line}", file=sys.stderr)
    print("nothing staged", file=sys.stderr)
    return 1


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


# --- the feature ---------------------------------------------------------------------------
class Feature:
    """The plan, its folder, its spec and sheets, its staging."""

    def __init__(self, plan):
        self.plan = os.path.abspath(plan)
        name = os.path.basename(self.plan)
        if not name.endswith("-PLAN.md") or not os.path.isfile(self.plan):
            usage(f"{plan}: a global plan `todo/<code>/<CODE>-PLAN.md` expected")
        self.code = name[:-len("-PLAN.md")]
        self.folder = os.path.dirname(self.plan)
        specs = sorted(glob.glob(os.path.join(self.folder, "SPEC-*.md")))
        if len(specs) != 1:
            usage(f"{C.rel(self.folder)}: one SPEC-*.md expected, found {len(specs)}")
        self.spec = specs[0]
        self.sheets = sorted(glob.glob(os.path.join(self.folder, f"{self.code}-PLAN-F*.md")),
                             key=lambda p: int(re.search(r"-F(\d+)\.md$", p).group(1)))
        self.staging = os.path.join(knowledge.base_dir(C), MERGES, self.code)
        self.drafts = os.path.join(self.staging, DRAFTS)


def batches(plan):
    """(every batch id, the ✅ DONE ones), through the one parser of the plan."""
    path = os.path.join(HERE, "scripts", "plan-next-batch.py")
    spec = importlib.util.spec_from_file_location("plan_next_batch", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    from pathlib import Path
    rows, done = mod.parse(Path(plan))
    return [r["id"] for r in rows], done


def sheet_batch(path):
    return "F" + re.search(r"-F(\d+)\.md$", path).group(1)


def section(text, anchor):
    """The lines under the heading carrying `<!-- kit:<anchor> -->`, to the next heading of its level."""
    lines = text.splitlines()
    rx = re.compile(rf"^(#{{1,6}})\s.*<!--\s*kit:{anchor}\s*-->")
    for i, line in enumerate(lines):
        m = rx.match(line)
        if m:
            level = len(m.group(1))
            out = []
            for nxt in lines[i + 1:]:
                h = knowledge.ANY_HEADING.match(nxt)
                if h and len(h.group(1)) <= level:
                    break
                out.append(nxt)
            return out
    return None


def traceability(text):
    """{id: {batch, …}} from the first table of the plan's `kit:traceability` section:
    ids of the first cell, batches of the third."""
    out = collections.defaultdict(set)
    rows = [l for l in (section(text, "traceability") or []) if l.startswith("|")]
    for row in rows[2:]:
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        for oid in knowledge.ID_RE.findall(cells[0]):
            out[oid] |= set(re.findall(r"F\d+", cells[2]))
    return out


def block(lines):
    """A decision or an ADR: its lines to the first blank one."""
    out = []
    for line in lines:
        if not line.strip():
            if out:
                break
            continue
        out.append(line)
    return out


def slug(title):
    ascii_ = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    return "-".join(re.findall(r"[a-z0-9]+", ascii_)[:6]) or "decision"


def norm(title):
    return " ".join(title.lower().split())


# --- the base ------------------------------------------------------------------------------
def base_texts():
    out = {}
    top = knowledge.base_dir(C)
    for path in knowledge.markdown_files(top):
        rel = os.path.relpath(path, top)
        if os.path.basename(rel) not in ("HISTORY.md", "INDEX.md"):
            out[rel] = knowledge.read(path)
    return out


def defined(texts):
    """{id: (rel, Obj)} of every object the files define."""
    out = {}
    for rel, text in sorted(texts.items()):
        for o in knowledge.objects(text):
            out.setdefault(o.id, (rel, o))
    return out


def context_of(oid, prefixes):
    return None if oid.startswith("ADR-") else prefixes.get(oid.split("-")[0])


def merged_rows(code):
    """Contexts whose `HISTORY.md` has a row of this feature, merged whole."""
    return [ctx for ctx in knowledge.contexts(C)
            if any(f == code for _, f, _ in knowledge.history(knowledge.history_path(C, ctx)))]


def retired_once(oid):
    return any(f"-{oid}" in d.split() for ctx in knowledge.contexts(C)
               for _, _, d in knowledge.history(knowledge.history_path(C, ctx)))


# --- prepare -------------------------------------------------------------------------------
def spec_delta(text):
    """[(Obj, change)] of the spec: the objects whose heading ends with a delta anchor."""
    lines = text.splitlines()
    out = []
    for o in knowledge.objects(text):
        m = knowledge.DELTA.search(lines[o.start])
        if m:
            o.title = knowledge.DELTA.sub("", o.title).strip()
            out.append((o, m.group(1)))
    return out


def appliers(oid, spec_objs, base):
    """Use cases applying a rule, by citation either way in the spec or in the base; retired ones left out."""
    rule = next((o for o, _ in spec_objs if o.id == oid), None)
    gone = {o.id for o, change in spec_objs if change == "retired"}
    out = [i for i in knowledge.ID_RE.findall(rule.body) if knowledge.kind_of(i) == "CU"] if rule else []
    out += [o.id for o, _ in spec_objs if o.kind == "CU" and knowledge.cites(o.body, oid) and o.id not in out]
    for rel, text in base.items():
        parts = rel.split(os.sep)
        if len(parts) == 3 and parts[1] == "usecases" and knowledge.cites(text, oid):
            cu = next((o.id for o in knowledge.objects(text) if o.kind == "CU"), None)
            if cu and cu not in out:
                out.append(cu)
    return [cu for cu in out if cu not in gone]


def holder(text, i, skip):
    """The innermost object holding line i, other than `skip`."""
    inside = [o for o in knowledge.objects(text) if o.start <= i < o.end and o.id != skip]
    return max(inside, key=lambda o: o.start) if inside else None


def prepare(f, partial):
    prefixes = {v: k for k, v in C.contexts.items()}
    spec_text = knowledge.read(f.spec)
    spec_objs = spec_delta(spec_text)
    head = f"merge {f.code} — spec {C.rel(f.spec)} — staging {C.rel(f.staging)}"
    print(head)
    if not os.path.isdir(knowledge.base_dir(C)):
        print(f"nothing to merge: no knowledge base under {C.knowledge_root}")
        return 0
    if not spec_objs:
        print("nothing to merge: the spec carries no delta anchor")
        return 0
    done_rows = merged_rows(f.code)
    if done_rows:
        print(f"nothing to merge: {f.code} already merged ({', '.join(c + '/HISTORY.md' for c in done_rows)})")
        return 0

    every, done = batches(f.plan)
    left = []
    keep = {o.id for o, _ in spec_objs}
    sheets = f.sheets
    if not partial:
        pending = [b for b in every if b not in done]
        if pending:
            return refuse([f"batches not ✅ DONE: {', '.join(pending)} — finish the plan, or "
                           f"`cctoolkit knowledge-merge prepare {C.rel(f.plan)} --partial` merges what the done ones cover"])
    else:
        trace = traceability(knowledge.read(f.plan))
        for o, change in spec_objs:
            if o.kind == "D":
                continue
            if o.id not in trace:
                keep.discard(o.id)
                left.append(f"{o.id} — in no row of the plan's traceability")
            elif not trace[o.id] <= done:
                keep.discard(o.id)
                left.append(f"{o.id} — batch {', '.join(sorted(trace[o.id] - done))} not done")
        for o, _ in spec_objs:
            if o.kind == "D":
                linked = {i for i in knowledge.ID_RE.findall(o.body) if i in {x.id for x, _ in spec_objs} and i != o.id}
                if linked - keep:
                    keep.discard(o.id)
                    left.append(f"{o.id} — links {', '.join(sorted(linked - keep))}, left out")
        sheets = [s for s in f.sheets if sheet_batch(s) in done]

    base = base_texts()
    base_def = defined(base)
    errors, collisions, plan = [], [], []
    taken = collections.Counter()

    def next_free(oid):
        stem = oid.rsplit("-", 1)[0]
        taken[stem] += 1
        width = len(oid.rsplit("-", 1)[1])
        return f"{stem}-{knowledge.largest(C, stem) + taken[stem]:0{width}d}"

    def check(oid, title, change, where):
        if change == "new" and oid in base_def:
            rel, bo = base_def[oid]
            if norm(bo.title) == norm(title):
                return "merged"
            nf = next_free(oid)
            collisions.append(f"collision: {oid} — base: \"{bo.title}\" ({rel}) — {where}: \"{title}\" — next free {nf}: "
                              f"cctoolkit knowledge-merge renumber {C.rel(f.plan)} {oid} {nf}")
            return None
        if change == "modified" and oid not in base_def:
            errors.append(f"{oid} marked modified in {where}, absent from the base")
            return None
        if change == "retired" and oid not in base_def:
            if retired_once(oid):
                return "merged"
            errors.append(f"{oid} marked retired in {where}, absent from the base")
            return None
        return "todo"

    for o, change in spec_objs:
        if o.id not in keep:
            continue
        ctx = context_of(o.id, prefixes)
        if ctx is None:
            errors.append(f"{o.id}: prefix absent from knowledge.contexts")
            continue
        st = check(o.id, o.title, change, C.rel(f.spec))
        if st:
            plan.append({"id": o.id, "kind": o.kind, "change": change, "context": ctx, "title": o.title,
                         "status": st, "line": o.start + 1})

    adrs = []
    spec_ids = {o.id for o, _ in spec_objs}
    for path in sheets:
        text = knowledge.read(path)
        lines = text.splitlines()
        for o in knowledge.objects(text):
            if o.kind != "ADR":
                continue
            body = [PLAN_ID.sub("", l).rstrip().rstrip(",") for l in block(lines[o.start + 1:o.end])]
            cited = [context_of(i, prefixes) for i in knowledge.ID_RE.findall("\n".join(body))]
            cited = [c for c in cited if c]
            ctx = (collections.Counter(cited).most_common(1)[0][0] if cited
                   else next((p["context"] for p in plan), None))
            if ctx is None:
                errors.append(f"{o.id} in {C.rel(path)}: no context — it cites no id of the base")
                continue
            out = sorted(i for i in knowledge.ID_RE.findall("\n".join(body)) if i in spec_ids and i not in keep)
            if out:
                left.append(f"{o.id} — links {', '.join(out)}, left out")
                continue
            st = check(o.id, o.title, "new", C.rel(path))
            if st:
                adrs.append({"id": o.id, "kind": "ADR", "change": "new", "context": ctx, "title": o.title,
                             "status": st, "sheet": C.rel(path), "line": o.start + 1,
                             "text": f"# {o.id} — {o.title}\n\n" + "\n".join(body) + "\n"})
    if collisions or errors:
        for line in collisions:
            print(line, file=sys.stderr)
        return refuse(errors + ([f"{len(collisions)} collision(s): renumber, then prepare again"] if collisions else []))

    shutil.rmtree(f.staging, ignore_errors=True)
    os.makedirs(f.drafts)
    write(os.path.join(f.staging, FEATURE), f"{f.code} partial\n" if partial else f"{f.code}\n")
    objs = plan + adrs
    todo = [p for p in objs if p["status"] == "todo"]
    for p in objs:
        if p["status"] == "merged":
            print(f"merged already: {p['id']}")
    for line in left:
        print(f"left: {line}")
    if not todo:
        shutil.rmtree(f.staging, ignore_errors=True)
        print("nothing to merge: every object of the delta is in the base")
        return 0

    for ctx in {p["context"] for p in todo}:
        os.makedirs(os.path.join(f.drafts, ctx), exist_ok=True)
    spec_lines = spec_text.splitlines()
    reads, asks, dead = set(), set(), []
    for p in todo:
        ctx = p["context"]
        if p["kind"] == "ADR":
            name = os.path.basename(base_def[p["id"]][0]) if p["id"] in base_def else f"{p['id']}-{slug(p['title'])}.md"
            write(os.path.join(f.drafts, ctx, name), p.pop("text"))
            print(f"drafted: {p['id']} — from {p['sheet']}:{p['line']} — {DRAFTS}/{ctx}/{name}")
        elif p["kind"] == "D" and p["change"] != "retired":
            o = next(o for o, _ in spec_objs if o.id == p["id"])
            text = f"### {p['id']} — {p['title']}\n" + "\n".join(block(spec_lines[o.start + 1:o.end])) + "\n"
            write(os.path.join(f.drafts, ctx, f"{p['id']}.md"), text)
            print(f"drafted: {p['id']} — from {C.rel(f.spec)}:{p['line']} — {DRAFTS}/{ctx}/{p['id']}.md")
        elif p["change"] == "retired":
            rel = base_def[p["id"]][0]
            home = next((q["id"] for q in todo if q["kind"] == "CU" and q["id"] in base_def
                         and base_def[q["id"]][0] == rel and q["id"] != p["id"]), None)
            print(f"retire: {p['id']} — {rel}" + (f" — leave it out of the draft of {home}" if home else " — cut by stage"))
            for crel, text in sorted(base.items()):
                if crel == rel:
                    continue
                for i in knowledge.cites(text, p["id"]):
                    o = holder(text, i, p["id"])
                    dead.append(f"dead: {p['id']} cited in {crel}:{i + 1}" + (f" — rewrite {o.id}" if o else ""))
                    if o and knowledge.guarded(C, os.path.join(knowledge.base_dir(C), crel)):
                        asks.add(o.id)
                    else:
                        reads.add(crel)
        else:
            where = f"{C.rel(f.spec)}:{p['line']}"
            if p["kind"] == "CU" and p["id"] in base_def:
                rel = base_def[p["id"]][0]
                reads.add(rel)
                print(f"write: {p['id']} {p['change']} use case — {where} — {rel} — draft {DRAFTS}/{ctx}/{os.path.basename(rel)}")
            elif p["kind"] == "CU":
                print(f"write: {p['id']} {p['change']} use case — {where} — {ctx}/usecases/ — "
                      f"draft {DRAFTS}/{ctx}/{p['id']}-<slug>.md, slug in English kebab-case")
            else:
                cus = appliers(p["id"], spec_objs, base)
                if p["id"] in base_def:
                    asks.add(p["id"])
                place = (f"{ctx}/rules.md" if len(cus) != 1
                         else f"the file of {cus[0]} — written inside its use-case draft")
                print(f"write: {p['id']} {p['change']} rule — {where} — applied by {', '.join(cus) or 'no use case'} — {place}"
                      + (f" — draft {DRAFTS}/{ctx}/{p['id']}.md" if len(cus) != 1 else ""))
                writing = {q["id"] for q in todo}
                for cu in cus:
                    if cu not in base_def:
                        continue
                    rel = base_def[cu][0]
                    if len(cus) == 1:
                        reads.add(rel)
                    elif cu not in writing and not knowledge.cites(base[rel], p["id"]):
                        reads.add(rel)
                        print(f"cite: {p['id']} in {cu} — {rel}, draft {DRAFTS}/{ctx}/{os.path.basename(rel)}")
    for line in dead:
        print(line)
    for rel in sorted(reads):
        print(f"read: {C.knowledge_root}/{rel}")
    if asks:
        print(f"ask: cctoolkit ask --id {','.join(sorted(asks))}")
    spec_ctxs = sorted({p["context"] for p in plan if p["status"] == "todo"})
    reached = [s for s in SECTIONS if any(l.strip() and not re.match(r"^\|[-\s|:]*\|$", l) and not l.startswith("<!--")
                                          for l in (section(spec_text, s) or []))]
    for ctx in spec_ctxs:
        if reached:
            print(f"overview: {ctx} — rewrite, the spec reaches {', '.join(reached)} — "
                  f"{C.knowledge_root}/{ctx}/OVERVIEW.md, draft {DRAFTS}/{ctx}/OVERVIEW.md, under {C.overview_budget} tokens")
        else:
            print(f"overview: {ctx} — unchanged")
    print(f"sheets: {', '.join(C.rel(s) for s in sheets) or 'none'} — sections kit:code-elements, kit:design")
    write(os.path.join(f.staging, PACKET), json.dumps({"code": f.code, "partial": partial, "objects": objs}, indent=1) + "\n")
    print(f"next: the drafts under {C.rel(f.drafts)}, then cctoolkit knowledge-merge stage {C.rel(f.plan)}")
    return 0


# --- stage ---------------------------------------------------------------------------------
def splice(text, o, new):
    """The text with the object's lines replaced by `new` (empty: cut), one blank line kept after."""
    lines = text.splitlines()
    rest = lines[o.end:]
    mid = new.rstrip("\n").splitlines() if new.strip() else []
    head = lines[:o.start]
    if not mid:
        while head and not head[-1].strip() and (not rest or not rest[0].strip()):
            head.pop()
    out = head + mid + ([""] if mid and rest and rest[0].strip() else []) + rest
    return "\n".join(out).rstrip("\n") + "\n"


def append(text, new):
    return text.rstrip("\n") + "\n\n" + new.rstrip("\n") + "\n"


def stage(f):
    packet_path = os.path.join(f.staging, PACKET)
    if not os.path.isfile(packet_path):
        print(f"knowledge-merge: nothing prepared for {f.code} — cctoolkit knowledge-merge prepare {C.rel(f.plan)}", file=sys.stderr)
        return 1
    packet = json.load(open(packet_path, encoding="utf-8"))
    objs = {p["id"]: p for p in packet["objects"] if p["status"] == "todo"}
    base = base_texts()
    base_def = defined(base)
    work = dict(base)
    errors, warns, whole, owner = [], [], {}, {}
    blocks = []
    for path in sorted(glob.glob(os.path.join(f.drafts, "*", "*.md"))):
        ctx, name = os.path.basename(os.path.dirname(path)), os.path.basename(path)
        text = knowledge.read(path)
        drel = f"{DRAFTS}/{ctx}/{name}"
        if PROVISIONAL.search(text):
            errors.append(f"{drel}: provisional id {PROVISIONAL.search(text).group(0)} — a merge carries the spec's ids")
            continue
        if ctx not in C.contexts:
            errors.append(f"{drel}: context {ctx} absent from knowledge.contexts")
            continue
        if name == "OVERVIEW.md":
            work[os.path.join(ctx, "OVERVIEW.md")] = text
            continue
        m = DRAFT_FILE.match(name)
        top = knowledge.objects(text)
        if not m or not top or top[0].id != m.group(1):
            errors.append(f"{drel}: a draft is named after the object it opens with — <id>.md, <id>-<slug>.md, OVERVIEW.md")
            continue
        oid, kind = m.group(1), knowledge.kind_of(m.group(1))
        if kind == "CU":
            dst = base_def[oid][0] if oid in base_def else os.path.join(ctx, "usecases", name)
        elif kind == "ADR":
            dst = base_def[oid][0] if oid in base_def else os.path.join(knowledge.ADR_DIR, name)
        else:
            blocks.append((oid, kind, ctx, text, drel))
            continue
        work[dst], owner[dst] = text, ctx
        for o in top:
            if o.id in whole:
                errors.append(f"{o.id} defined in {whole[o.id]} and {drel}")
            whole[o.id] = drel
    for oid, kind, ctx, text, drel in blocks:
        if oid in whole:
            errors.append(f"{oid} defined in {whole[oid]} and {drel}")
            continue
        whole[oid] = drel
        at = defined(work).get(oid)
        if at:
            rel, o = at
            work[rel] = splice(work[rel], o, text)
        else:
            rel = os.path.join(ctx, "rules.md" if kind == "RM" else "decisions.md")
            work[rel] = append(work.get(rel) or HEADS[kind].format(ctx=ctx), text)
        owner.setdefault(rel, ctx)
    for oid, p in objs.items():
        if p["change"] == "retired" and oid not in whole:
            at = defined(work).get(oid)
            if at:
                rel, o = at
                work[rel] = "" if p["kind"] == "CU" else splice(work[rel], o, "")
                owner.setdefault(rel, p["context"])

    after = defined({r: t for r, t in work.items() if t.strip()})
    for oid, p in sorted(objs.items()):
        if p["change"] == "retired" and oid in after:
            errors.append(f"{oid} retired by the spec, still defined in {after[oid][0]}")
        elif p["change"] != "retired" and oid not in after:
            hint = "drafted by prepare" if p["kind"] in ("D", "ADR") else "the merger's"
            errors.append(f"{oid} {p['change']}: no draft defines it ({hint})")
    for oid, (rel, _) in sorted(base_def.items()):
        if oid not in after and objs.get(oid, {}).get("change") != "retired":
            errors.append(f"{oid} gone from {rel}: the spec does not retire it")
    for oid, (rel, _) in sorted(after.items()):
        if oid not in base_def and oid not in objs:
            errors.append(f"{oid} in {rel}: in no delta of the spec nor sheet — a merge adds only what they announce")

    def dead(texts, known):
        out = set()
        for rel, text in texts.items():
            for i, line in enumerate(text.splitlines(), 1):
                for oid in knowledge.ID_RE.findall(line):
                    if oid not in known:
                        out.add((oid, rel, i))
        return out

    was_dead = {(o, r) for o, r, _ in dead(base, set(base_def))}
    for oid, rel, i in sorted(dead({r: t for r, t in work.items() if t.strip()}, set(after))):
        if (oid, rel) not in was_dead:
            errors.append(f"dead citation: {oid} in {rel}:{i} — defined nowhere: rewrite the object holding it")
    was = {(m[0], m[1]) for m in knowledge.misplaced(base)}
    for oid, rel, home, cus in knowledge.misplaced({r: t for r, t in work.items() if t.strip()}):
        line = f"{oid} in {rel}, applied by {', '.join(cus)} — belongs in {home}"
        if (oid, rel) not in was and os.path.basename(home) == "rules.md":
            errors.append(line)
        else:
            warns.append(line)
    for rel, text in sorted(work.items()):
        if os.path.basename(rel) == "OVERVIEW.md" and text != base.get(rel):
            n = len(text) // 4
            if n > C.overview_budget:
                errors.append(f"{rel} ~{n} tokens, above knowledge.overviewBudget {C.overview_budget} — condense it: "
                              f"say what is no longer true and remove it")

    for top in glob.glob(os.path.join(f.staging, "*")):
        if os.path.isdir(top):
            shutil.rmtree(top)
    if errors:
        return refuse(sorted(set(errors)))

    for line in warns:
        print(f"WARN {line}")
    for oid, (rel, o) in sorted(after.items()):
        if oid in base_def and oid in objs:
            old = [l.strip() for l in base_def[oid][1].body.splitlines() if l.strip()]
            new = [l.strip() for l in o.body.splitlines() if l.strip()]
            if old != new and set(old) <= set(new):
                print(f"WARN {oid}: rewritten without a line removed — say what is no longer true")
    changed = sorted(r for r in work if work[r] != base.get(r, None) and (work[r].strip() or r in base))
    for rel in changed:
        ctx = owner.get(rel) or rel.split(os.sep)[0]
        dst = os.path.join(f.staging, ctx, rel) if rel.split(os.sep)[0] == knowledge.ADR_DIR else os.path.join(f.staging, rel)
        write(dst, work[rel])
        if not work[rel].strip():
            print(f"−{len(base[rel].splitlines())} deleted {C.knowledge_root}/{rel}")
            continue
        diff = list(difflib.unified_diff(base.get(rel, "").splitlines(), work[rel].splitlines(), lineterm="", n=0))
        plus = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
        minus = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))
        print(f"+{plus} −{minus} {C.knowledge_root}/{rel}{'' if rel in base else ' (new)'}")
    print(f"staged: {len(changed)} file(s) — cctoolkit knowledge-write apply --merge {f.code}")
    return 0


# --- renumber ------------------------------------------------------------------------------
def renumber(f, old, new):
    if not re.fullmatch(knowledge.ID, old) or not re.fullmatch(knowledge.ID, new):
        usage("renumber takes two knowledge-base ids")
    if old.rsplit("-", 1)[0] != new.rsplit("-", 1)[0]:
        usage(f"{old} and {new}: same prefix and kind expected")
    rx = lambda i: re.compile(rf"(?<![A-Za-z0-9-]){re.escape(i)}(?![0-9A-Za-z])")  # noqa: E731
    for top in (knowledge.base_dir(C), os.path.join(C.root, knowledge.PENDING)):
        for path in knowledge.markdown_files(top):
            if rx(new).search(knowledge.read(path)):
                print(f"refused: {new} already used in {C.rel(path)} — cctoolkit next-id gives a free one")
                return 1
    paths = [os.path.join(d, n) for d, _, names in os.walk(f.folder) for n in names
             if n.endswith((".md", ".json", ".jsonl"))]
    exts = tuple(C.source_ext) + (".md",)
    for top, names in C.walk(C.source_roots + C.test_roots):
        paths += [os.path.join(top, n) for n in names if n.endswith(exts)]
    count = 0
    for path in sorted(set(paths)):
        text = knowledge.read(path)
        out, n = rx(old).subn(new, text)
        if n:
            write(path, out)
            count += 1
            print(f"renumbered: {C.rel(path)} ({n})")
    shutil.rmtree(f.staging, ignore_errors=True)
    print(f"{old} → {new}: {count} file(s) — staging cleared, prepare again")
    return 0


# --- main ----------------------------------------------------------------------------------
def main(argv):
    global C
    if len(argv) < 2:
        usage()
    cmd, args = argv[0], argv[1:]
    partial = "--partial" in args
    args = [a for a in args if a != "--partial"]
    if any(a.startswith("-") for a in args):
        usage(f"unknown option {next(a for a in args if a.startswith('-'))}")
    try:
        C = kit_config.load()
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 3
    if cmd == "prepare" and len(args) == 1:
        return prepare(Feature(args[0]), partial)
    if cmd == "stage" and len(args) == 1 and not partial:
        return stage(Feature(args[0]))
    if cmd == "renumber" and len(args) == 3 and not partial:
        return renumber(Feature(args[0]), args[1], args[2])
    usage()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
