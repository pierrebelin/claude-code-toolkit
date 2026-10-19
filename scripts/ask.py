#!/usr/bin/env python3
"""Questions to the knowledge base — the one way a skill, an agent or the user reads it
beyond `INDEX.md`, an `OVERVIEW.md` or a use-case file.

    cctoolkit ask "<question>" [--context C[,C]] [--kind usecase|rule|decision|adr]
        ranked cards (id, title, kind, use cases, status, first line, `path:line`);
        an id written in the question comes first.
    cctoolkit ask --id <id>[,<id>]
        the object whole, what it applies to and what cites it; a retired id, its `HISTORY.md` row.
    cctoolkit ask --handler <Name>
        the use case listing that handler and the rules it cites, whole; linked decisions
        and ADRs as cards.
    cctoolkit ask --context C[,C]
        the context's summary, one line per use case, rule, decision and citing ADR.
    cctoolkit ask --history [--context C[,C]] [--id <id>]
        `HISTORY.md` rows, newest first.

Every answer ends with `shown N of M`: N printed, M found; N below M is the budget
(`knowledge.askBudget`, tokens = characters / 4) cutting.

Refreshes `.index/`, never `INDEX.md`. Exit 0, 1 no base, 2 usage, 3 config defect.
"""
import math
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
import knowledge  # noqa: E402
import knowledge_index  # noqa: E402

KINDS = {"usecase": "CU", "rule": "RM", "decision": "D", "adr": "ADR"}
NAMES = {v: k for k, v in KINDS.items()}
FIRST = 160
STOP = set("""
a an and are as at be by can do does for from how in is it its no not of on only or that the this to
what when which who with au aux ce ces cette comment d dans de des du elle en est et il la le les l
ne on ou par pas pour qu quand que quel quelle quelles quels qui quoi sa se ses son sont sur un une y
""".split())


def usage(msg=None):
    if msg:
        print(f"ask: {msg}", file=sys.stderr)
    print('usage: cctoolkit ask "<question>" [--context C,…] [--kind usecase|rule|decision|adr]\n'
          "       cctoolkit ask --id <id>[,<id>] | --handler <Name> | --context C,… | --history [--context C,…] [--id <id>]",
          file=sys.stderr)
    sys.exit(2)


# --- ranking ---------------------------------------------------------------------------
def fold(s):
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def stem(w):
    """archive, archives, archived, archivés: one stem."""
    if len(w) > 4 and w[-1] in "sx":
        w = w[:-1]
    if len(w) > 5 and w.endswith("ed"):
        return w[:-2]
    return w[:-1] if len(w) > 4 and w[-1] == "e" else w


def tokens(s):
    """Words folded to ASCII lower case, stop words out, stemmed; a CamelCase name also gives its parts."""
    out = []
    for w in re.findall(r"[A-Za-z0-9]+", fold(s)):
        parts = re.findall(r"[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])", w)
        for t in [w] + (parts if len(parts) > 1 else []):
            t = t.lower()
            if len(t) > 1 and t not in STOP:
                out.append(stem(t))
    return out


def rank(rows, question):
    """[(score, row)] above zero, best first — BM25, k1 1.2, b 0.75; the title counts twice."""
    docs = []
    for r in rows:
        own = r["handlers"] if r["kind"] == "CU" else []
        docs.append(tokens(" ".join([r["id"], r["title"], r["title"], r["text"]] + own)))
    q = set(tokens(question))
    if not q or not docs:
        return []
    n, avg = len(docs), sum(map(len, docs)) / len(docs) or 1
    df = {t: sum(1 for d in docs if t in d) for t in q}
    out = []
    for r, d in zip(rows, docs):
        s = 0.0
        for t in q:
            f = d.count(t)
            if f:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                s += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * len(d) / avg))
        if s > 0:
            out.append((s, r))
    return sorted(out, key=lambda x: (-x[0], x[1]["id"]))


# --- output ----------------------------------------------------------------------------
class Out:
    """Items under a budget: the first always printed, the next only while they fit."""

    def __init__(self, budget):
        self.budget, self.used, self.shown, self.found, self.lines = budget, 0, 0, 0, []

    def item(self, text):
        self.found += 1
        cost = len(text) // 4 + 1
        if self.shown and self.used + cost > self.budget:
            return
        self.used += cost
        self.shown += 1
        self.lines.append(text)

    def head(self, text):
        self.used += len(text) // 4 + 1
        self.lines.append(text)

    def close(self):
        tail = "" if self.shown == self.found else " — budget reached: narrow with --context, --kind or --id"
        self.lines.append(f"shown {self.shown} of {self.found}{tail}")
        text = "\n".join(self.lines)
        print(text)


def tag(r):
    bits = [NAMES[r["kind"]]]
    if r["kind"] != "CU" and r["usecases"]:
        bits.append(", ".join(r["usecases"]))
    if r["status"] == "observed":
        bits.append(f"observed {r['level']}")
    return " · ".join(bits)


def first_line(r):
    for line in r["text"].splitlines():
        line = line.strip()
        if line and not knowledge.OBSERVED.search(line) and not line.startswith("#"):
            return line if len(line) <= FIRST else line[:FIRST - 1] + "…"
    return ""


def card(r):
    out = [f"- {r['id']} — {r['title']} · {tag(r)}"]
    line = first_line(r)
    if line:
        out.append(f"  {line}")
    out.append(f"  {r['path']}:{r['line']}")
    return "\n".join(out)


def whole(c, r):
    lines = knowledge.read(os.path.join(c.root, r["path"])).splitlines()
    body = "\n".join(lines[r["line"] - 1:r["end"]]).rstrip()
    rel = []
    if r["kind"] != "CU" and r["usecases"]:
        rel.append("applies to: " + ", ".join(r["usecases"]))
    if r["handlers"]:
        rel.append("handlers: " + ", ".join(f"`{h}`" for h in r["handlers"]))
    if r["cited_by"]:
        rel.append("cited by: " + ", ".join(r["cited_by"]))
    return f"{r['path']}:{r['line']}\n{body}" + ("\n" + " · ".join(rel) if rel else "")


def in_contexts(r, ctxs):
    return not ctxs or bool(set(r["contexts"]) & ctxs)


def history_rows(c, ctxs):
    """[(date, context, feature, delta)], newest first."""
    out = []
    for ctx in knowledge.contexts(c):
        if ctxs and ctx not in ctxs:
            continue
        for date, feature, delta in knowledge.history(knowledge.history_path(c, ctx)):
            out.append((date, ctx, feature, delta))
    return sorted(out, key=lambda x: x[0], reverse=True)


def retired(c, oid):
    for date, ctx, feature, delta in history_rows(c, set()):
        if "-" + oid in delta.split():
            return f"{oid}: retired — {ctx}/HISTORY.md, {date} {feature}"
    return f"{oid}: not in the base"


# --- modes -----------------------------------------------------------------------------
def ask_question(rows, question, ctxs, kind, out):
    pool = [r for r in rows if in_contexts(r, ctxs) and (not kind or r["kind"] == kind)]
    named = [i for i in knowledge.ID_RE.findall(question)]
    first = [r for i in named for r in pool if r["id"] == i]
    ranked = first + [r for _, r in rank(pool, question) if r not in first]
    for r in ranked:
        out.item(card(r))


def ask_ids(c, rows, ids, out):
    by_id = {r["id"]: r for r in rows}
    for oid in ids:
        r = by_id.get(oid)
        out.item(whole(c, r) if r else retired(c, oid))


def ask_handler(c, rows, name, out):
    cus = [r for r in rows if r["kind"] == "CU" and name in r["handlers"]]
    if not cus:
        out.head(f"no use case lists `{name}` — a new handler, or the base is behind: /cctoolkit:knowledge-sync")
        return
    for cu in cus:
        out.item(whole(c, cu))
        rules = [r for r in rows if r["kind"] == "RM" and cu["id"] in r["usecases"] and r["path"] != cu["path"]]
        for r in rules:
            out.item(whole(c, r))
        for r in rows:
            if r["kind"] in ("D", "ADR") and cu["id"] in r["usecases"]:
                out.item(card(r))


def ask_context(c, rows, ctxs, out):
    for ctx in [x for x in knowledge.contexts(c) if x in ctxs]:
        mine = [r for r in rows if r["context"] == ctx]
        n = {k: sum(1 for r in mine if r["kind"] == k) for k in ("CU", "RM", "D")}
        prefix = c.contexts.get(ctx, "—") if isinstance(c.contexts, dict) else "—"
        out.head(f"# {ctx} ({prefix}) — {n['CU']} use case(s), {n['RM']} rule(s), {n['D']} decision(s)"
                 f" · {c.knowledge_root}/{ctx}/OVERVIEW.md")
        mark = lambda r: f" [observed {r['level']}]" if r["status"] == "observed" else ""  # noqa: E731
        for cu in [r for r in mine if r["kind"] == "CU"]:
            hs = ", ".join(f"`{h}`" for h in cu["handlers"])
            item = [f"{cu['id']} — {cu['title']}{mark(cu)}" + (f" · {hs}" if hs else "")]
            item += [f"  {r['id']} — {r['title']}{mark(r)}" for r in mine if r["kind"] == "RM" and r["path"] == cu["path"]]
            out.item("\n".join(item))
        for r in mine:
            if r["kind"] == "RM" and not r["path"].split("/")[-2] == "usecases":
                out.item(f"{r['id']} — {r['title']}{mark(r)} · " + (", ".join(r["usecases"]) or "no use case"))
        for r in mine:
            if r["kind"] == "D":
                out.item(f"{r['id']} — {r['title']}{mark(r)}")
        for r in rows:
            if r["kind"] == "ADR" and ctx in r["contexts"]:
                out.item(f"{r['id']} — {r['title']}{mark(r)}")


def ask_history(c, ctxs, oid, out):
    for date, ctx, feature, delta in history_rows(c, ctxs):
        if oid and not any(t.lstrip("+-~") == oid for t in delta.split()):
            continue
        out.item(f"{date} · {ctx} · {feature} · {delta}")


def main(argv):
    opts = {"context": None, "kind": None, "id": None, "handler": None}
    flags, words = set(), []
    it = iter(argv)
    for a in it:
        if a == "--history":
            flags.add(a[2:])
        elif a.startswith("--") and a[2:] in opts:
            v = next(it, None)
            if v is None or v.startswith("--"):
                usage(f"{a} needs a value")
            opts[a[2:]] = v
        elif a.startswith("--"):
            usage(f"unknown option {a}")
        else:
            words.append(a)
    question = " ".join(words).strip()
    ctxs = {x for x in (opts["context"] or "").split(",") if x}
    kind = None
    if opts["kind"]:
        kind = KINDS.get(opts["kind"]) or usage(f"--kind is one of {', '.join(KINDS)}")
    ids = [x for x in (opts["id"] or "").split(",") if x]
    modes = [m for m, on in (("question", question), ("id", ids and "history" not in flags), ("handler", opts["handler"]),
                             ("history", "history" in flags)) if on]
    if not modes and ctxs:
        modes = ["context"]
    if len(modes) != 1:
        usage("one of a question, --id, --handler, --context, --history")
    mode = modes[0]
    if kind and mode != "question":
        usage("--kind narrows a question")
    if ctxs and mode in ("id", "handler"):
        usage(f"--context does not apply to --{mode}")
    if "history" in flags and len(ids) > 1:
        usage("--history takes one --id")
    try:
        c = kit_config.load()
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 3
    if not os.path.isdir(knowledge.base_dir(c)):
        print(f"no knowledge base under {c.knowledge_root} — /cctoolkit:knowledge-sync builds it", file=sys.stderr)
        return 1
    unknown = sorted(ctxs - set(knowledge.contexts(c)))
    if unknown:
        print(f"ask: no context {', '.join(unknown)} in {c.knowledge_root} — contexts: {', '.join(knowledge.contexts(c)) or 'none'}",
              file=sys.stderr)
        return 2
    rows, _, _ = knowledge_index.refresh(c)
    out = Out(c.ask_budget)
    if mode == "question":
        ask_question(rows, question, ctxs, kind, out)
    elif mode == "id":
        ask_ids(c, rows, ids, out)
    elif mode == "handler":
        ask_handler(c, rows, opts["handler"], out)
    elif mode == "context":
        ask_context(c, rows, ctxs, out)
    else:
        ask_history(c, ctxs, ids[0] if ids else None, out)
    out.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
