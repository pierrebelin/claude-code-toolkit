#!/usr/bin/env python3
"""The knowledge base against the code: what `/knowledge-sync` has to look at — read only.

    cctoolkit knowledge-scan [--context C[,C]] [--since <commit> | --full] [--json]
    cctoolkit knowledge-scan --reminder [--staged | <path>...]

Per bounded context, three modes:

- `bootstrap` — the context has no folder in the base: the inventory the first sync
  starts from. Handlers (kind read off the name), their rule sheets
  (`layout.ruleSheet`) and rule rows, tests tagged and untagged, `DESIGN.md` chapters,
  exceptions and events, aggregates, the `feat`/`refactor` commits touching the
  context (the one read of git for past decisions), and a proposed prefix.
- `incremental` — the context has sync marks (`HISTORY.md` rows `sync <commit>` that
  are ancestors of HEAD, lib/knowledge.py): the commits since them plus the working
  tree. Skipped as already covered: a commit carrying `Kit-Batch:` (the kit's batch
  commit) and one that adds a `sync` row to the context's `HISTORY.md`. Each file a
  foreign commit touched is routed to its use cases (handler by `kit:handlers`,
  use-case folder, aggregate by grep of the handlers, test by its tags or its class
  name) with its diff — foreign commits only, whitespace, import and comment lines
  removed (`layout.sources.imports`, `layout.sources.comment`). A pure rename or a
  deletion of a handler is `mechanical`: no agent needed. `tokens` estimates the
  packet; above `knowledge.syncBudget` it is `overBudget`.
- `full` — a folder but no mark git still knows (rebase, squash, shallow clone): the
  inventory again, the base beside it.

`--since` replaces every mark by one commit; `--full` ignores them — the inventory of
a context the base holds, for a packet too big to read as a diff. The context of a file: the folder at
`layout.useCase.contextDepth` under a use-case root (0: one context for the repo),
else a path segment naming a known context.

Default output: a summary per context for the session. `--json`: everything, for the
extraction agent (one context at a time) and the evals.

`--reminder`: one line per context whose use cases the given paths (or the staged
files) touch — a file of a use-case folder, or an aggregate (`layout.aggregate`) routed
as the incremental packet routes it, to the use cases whose handlers name it; a test
never: it follows a rule, it does not make one — unless the same change
stages a `sync` row for that context. The pre-commit hook and the PostToolUse hook
print it. Silent without a base. Always exit 0.

Exit 2 on usage, 3 on a config defect.
"""
import fnmatch
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
import knowledge  # noqa: E402

PENDING = "todo"
SINGLE = "Main"  # the context name when layout.useCase.contextDepth is 0 and none is configured
HISTORY_CAP = 100
NAMES_CAP = 60
TYPE_RE = re.compile(r"\b(?:class|record|interface|struct)\s+(\w+(?:Exception|Error|Event))\b")
CONV_RE = re.compile(r"^(?:feat|refactor)(?:\([^)]*\))?!?:")
SYNC_ROW = re.compile(r"^\+\s*\|[^|]*\|\s*sync\s+[0-9a-f]{4,40}\s*\|")
RULE_ROW = re.compile(r"^\|\s*(?:RM|RL)-\w+\s*\|")
OLD_TAG = re.compile(r"^([^/\s]+)/(?:RM|RL)-\w+$")
CHAPTER = re.compile(r"^##\s+(.*?)\s*(?:<!--.*-->)?\s*$")


def usage(msg=None):
    if msg:
        print(f"knowledge-scan: {msg}", file=sys.stderr)
    print("usage: cctoolkit knowledge-scan [--context C[,C]] [--since <commit> | --full] [--json]\n"
          "       cctoolkit knowledge-scan --reminder [--staged | <path>...]", file=sys.stderr)
    sys.exit(2)


def git(*args, ok=(0,)):
    p = subprocess.run(["git", *args], cwd=C.root, capture_output=True, text=True, errors="replace")
    return p.stdout if p.returncode in ok else None


# --- the code ---------------------------------------------------------------------------
class Handler:
    def __init__(self, name, path, folder, ctx):
        self.name, self.path, self.folder, self.ctx = name, path, folder, ctx

    @property
    def kind(self):
        return "query" if "Query" in self.name else "command" if "Command" in self.name else "other"


def marker_files(d):
    out = []
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return out
    for f in names:
        for glob_, rx in C.markers:
            if not fnmatch.fnmatchcase(f, glob_):
                continue
            if rx is not None:
                try:
                    with open(os.path.join(d, f), encoding="utf-8", errors="ignore") as fh:
                        if not rx.search(fh.read()):
                            continue
                except OSError:
                    continue
            out.append(f)
            break
    return out


def single_name():
    return next(iter(C.contexts)) if len(C.contexts) == 1 else SINGLE


def context_of_use_case(rel):
    """Context of a path under a use-case root, or None when it sits elsewhere."""
    p = C.under(rel, C.use_case_roots)
    if p is None:
        return None
    if C.context_depth == 0:
        return single_name()
    parts = C.rel(rel).split(os.sep)
    i = len(p.split("/")) + C.context_depth - 1
    # A file directly in the root, above the context level, belongs to no context.
    return parts[i] if i < len(parts) - 1 else None


def code_inventory():
    """{context: [Handler]} — every use-case folder under the use-case roots — and the
    handlers above the context level, which belong to none."""
    out, none = {}, []
    for base, files in C.walk(C.use_case_roots):
        found = marker_files(base)
        if not found:
            continue
        rel = C.rel(base)
        for f in found:
            ctx = context_of_use_case(os.path.join(rel, f))
            if ctx is None:
                none.append(os.path.join(rel, f))
                continue
            out.setdefault(ctx, []).append(Handler(os.path.splitext(f)[0].split(".")[0], os.path.join(rel, f), rel, ctx))
    return out, none


def context_of(rel, known):
    """Context of any repo path: its use-case folder, else a segment naming a context."""
    ctx = context_of_use_case(rel)
    if ctx is not None:
        return ctx
    if C.context_depth == 0 and C.under(rel, C.source_roots + C.test_roots):
        return single_name()
    for seg in rel.split("/")[:-1]:
        if seg in known:
            return seg
    return None


# --- tests ------------------------------------------------------------------------------
def tests_by_handler(handlers, ad):
    """{handler name: [tagged, untagged]} and the tags seen per handler folder."""
    by_folder = {os.path.basename(h.folder): h.name for h in handlers}
    names = sorted((h.name for h in handlers), key=len, reverse=True)
    counts = {h.name: [0, 0] for h in handlers}
    try:
        import kit_testtag
        tests = kit_testtag.scan_tree(C, ad)
    except Exception:
        return counts
    for t, _ in tests:
        owner = None
        for v in t.tags:
            m = OLD_TAG.match(v)
            if m and m.group(1) in by_folder:
                owner = by_folder[m.group(1)]
                break
        if owner is None:
            owner = next((n for n in names if t.cls.startswith(n)), None)
        if owner is not None:
            counts[owner][0 if t.tags else 1] += 1
    return counts


def test_owner(rel, handlers, ad, base_ids):
    """Use cases and handlers a test file points at: its tags, else its class name."""
    by_folder = {os.path.basename(h.folder): h.name for h in handlers}
    names = sorted((h.name for h in handlers), key=len, reverse=True)
    hs, cus = set(), set()
    try:
        tests = ad.scan(os.path.join(C.root, rel)) if os.path.isfile(os.path.join(C.root, rel)) else []
    except Exception:
        tests = []
    for t in tests:
        for v in t.tags:
            m = OLD_TAG.match(v)
            if m and m.group(1) in by_folder:
                hs.add(by_folder[m.group(1)])
            elif v in base_ids:
                cus.add(base_ids[v])
        if not t.tags:
            n = next((n for n in names if t.cls.startswith(n)), None)
            if n:
                hs.add(n)
    if not tests:
        stem = os.path.basename(rel).split(".")[0]
        n = next((n for n in names if stem.startswith(n)), None)
        if n:
            hs.add(n)
    return hs, cus


# --- inventory (bootstrap, full) -----------------------------------------------------------
def tracked(pattern):
    out = git("ls-files", "--", f":(glob){pattern}")
    return [l for l in (out or "").splitlines() if l]


def walk_sources():
    for base, files in C.walk(C.source_roots):
        for f in files:
            if C.is_source(f):
                yield os.path.join(C.rel(base), f)


def proposed_prefix(name, taken):
    letters = re.sub(r"[^A-Za-z0-9]", "", name).upper()
    cands = [letters[:3]] + [letters[0] + a + b for i, a in enumerate(letters[1:], 1) for b in letters[i + 1:]]
    for p in cands + [letters[:4], letters[:5]]:
        if len(p) >= 2 and p != "ADR" and p not in taken:
            return p
    return None


def inventory(ctx, handlers, known, ad, sources):
    counts = tests_by_handler(handlers, ad)
    hs, sheets, rules = [], 0, 0
    for h in sorted(handlers, key=lambda h: h.path):
        sheet = os.path.join(h.folder, C.rule_sheet)
        n = None
        if os.path.isfile(os.path.join(C.root, sheet)):
            sheets += 1
            n = sum(1 for l in knowledge.read(os.path.join(C.root, sheet)).splitlines() if RULE_ROW.match(l))
            rules += n
        tagged, untagged = counts.get(h.name, [0, 0])
        hs.append({"name": h.name, "kind": h.kind, "path": h.path, "ruleSheet": sheet if n is not None else None,
                   "rules": n, "tests": {"tagged": tagged, "untagged": untagged}})
    design = []
    for rel in tracked("**/DESIGN.md"):
        if context_of(rel, known) == ctx:
            chapters = [m.group(1) for m in map(CHAPTER.match, knowledge.read(os.path.join(C.root, rel)).splitlines()) if m]
            design.append({"path": rel, "chapters": chapters})
    types, aggregates = set(), []
    for rel in sources:
        if context_of(rel, known) != ctx:
            continue
        if any(fnmatch.fnmatchcase(rel, p) for p in C.aggregate):
            aggregates.append(rel)
        types.update(TYPE_RE.findall(knowledge.read(os.path.join(C.root, rel))))
    paths = [f":(glob)**/{ctx}/**"] if C.context_depth else ["."]
    log = git("log", "-E", "--format=%h\t%s", "--", *paths) or ""
    commits = [dict(zip(("commit", "subject"), l.split("\t", 1))) for l in log.splitlines() if "\t" in l]
    commits = [x for x in commits if CONV_RE.match(x["subject"])]
    return {
        "handlers": hs,
        "counts": {"handlers": len(hs), "commands": sum(h["kind"] == "command" for h in hs),
                   "queries": sum(h["kind"] == "query" for h in hs), "ruleSheets": sheets, "rules": rules,
                   "withoutSheet": len(hs) - sheets},
        "design": design,
        "exceptions": sorted(t for t in types if not t.endswith("Event"))[:NAMES_CAP],
        "events": sorted(t for t in types if t.endswith("Event"))[:NAMES_CAP],
        "aggregates": sorted(aggregates),
        "history": {"total": len(commits), "commits": commits[:HISTORY_CAP]},
    }


# --- incremental ----------------------------------------------------------------------------
def in_scope(rel):
    kr = C.knowledge_root.rstrip("/") + "/"
    if rel.startswith((kr, PENDING + "/", ".claude/")):
        return False
    return C.under(rel, C.source_roots + C.test_roots + C.use_case_roots) is not None or rel.endswith("/DESIGN.md")


def commits_since(marks):
    """[(full, short, subject, kit_batch, [(status, path, from)])] oldest first, merges left out."""
    fmt = "%x1e%H%x1f%h%x1f%s%x1f%(trailers:key=Kit-Batch,valueonly,separator=%x2c)"
    out = git("log", "--reverse", "--no-merges", "-M", "--name-status", f"--format={fmt}", "HEAD", "--not", *marks, "--")
    commits = []
    for rec in (out or "").split("\x1e")[1:]:
        head, _, body = rec.partition("\n")
        full, short, subject, trailer = (head.split("\x1f") + [""] * 4)[:4]
        files = []
        for line in body.splitlines():
            parts = line.split("\t")
            if len(parts) == 3 and parts[0].startswith(("R", "C")):
                files.append((parts[0], parts[2], parts[1]))
            elif len(parts) == 2:
                files.append((parts[0], parts[1], None))
        commits.append((full, short, subject, trailer.strip(), files))
    return commits


def adds_sync_row(full, ctx):
    hist = os.path.join(C.knowledge_root, ctx, "HISTORY.md")
    diff = git("show", "--format=", "-U0", full, "--", hist) or ""
    return any(SYNC_ROW.match(l) for l in diff.splitlines())


def worktree_changes():
    out = []
    for line in (git("diff", "HEAD", "-M", "--name-status") or "").splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            out.append((parts[0], parts[2], parts[1]))
        elif len(parts) == 2:
            out.append((parts[0], parts[1], None))
    for rel in (git("ls-files", "--others", "--exclude-standard") or "").splitlines():
        out.append(("A", rel, None))
    return out


def noise_free(diff, rel):
    """The diff without whitespace-only, import and comment lines; hunks left empty dropped."""
    mark = C.comment_of(rel)
    imp = C.imports_of(rel)
    out, hunk, keep = [], [], False
    for line in diff.splitlines():
        if line.startswith("@@"):
            if keep:
                out.extend(hunk)
            hunk, keep = [line], False
            continue
        if not hunk:
            continue  # file header
        if line[:1] in "+-" and not line.startswith(("+++", "---")):
            text = line[1:]
            if not text.strip() or (mark and text.lstrip().startswith(mark)) or (imp and imp.match(text)):
                continue
            keep = True
        hunk.append(line)
    if keep:
        out.extend(hunk)
    return "\n".join(out)


def file_diff(rel, old, shas, worktree, untracked):
    paths = [rel] + ([old] if old else [])
    parts = []
    for full in shas:
        parts.append(git("show", "--format=", "-w", "-M", full, "--", *paths) or "")
    if worktree:
        if untracked:
            parts.append(git("diff", "--no-index", "-w", "--", "/dev/null", rel, ok=(0, 1)) or "")
        else:
            parts.append(git("diff", "-w", "-M", "HEAD", "--", *paths) or "")
    return noise_free("\n".join(parts), rel)


def incremental(ctx, marks, handlers, all_handlers, known, ad, base_ids, base_uc):
    commits = commits_since(marks)
    files, skipped, foreign = {}, [], 0
    for full, short, subject, trailer, changed in commits:
        mine = [(s, p, o) for s, p, o in changed
                if in_scope(p) and (context_of(p, known) == ctx or (o and context_of(o, known) == ctx))]
        why = "Kit-Batch" if trailer else "sync" if adds_sync_row(full, ctx) else None
        if why:
            if mine:
                skipped.append({"commit": short, "subject": subject, "why": why})
            for _, p, _ in mine:
                files.setdefault(p, {"status": None, "from": None, "shas": [], "covered": True})
            continue
        if mine:
            foreign += 1
        for s, p, o in mine:
            f = files.setdefault(p, {"status": None, "from": None, "shas": [], "covered": True})
            f["covered"] = False
            f["shas"].append(full)
            f["status"] = s if f["status"] is None or s[0] in "DR" else f["status"]
            if o:
                f["from"] = o
    untracked = set((git("ls-files", "--others", "--exclude-standard") or "").splitlines())
    wt = False
    for s, p, o in worktree_changes():
        if not in_scope(p) or not (context_of(p, known) == ctx or (o and context_of(o, known) == ctx)):
            continue
        wt = True
        f = files.setdefault(p, {"status": None, "from": None, "shas": [], "covered": True})
        f.update(covered=False, worktree=True, status=s, untracked=p in untracked)
        if o:
            f["from"] = o
    by_name = {h.name: h for h in all_handlers}
    by_folder = {}
    for h in all_handlers:
        by_folder.setdefault(h.folder, []).append(h.name)
    changes, mechanical, noise, covered = [], [], [], 0
    cu_files = set()
    # A handler renamed since the mark is still known to the base by its old name.
    renamed = {stem_of(p): stem_of(f["from"]) for p, f in files.items()
               if not f["covered"] and f["from"] and stem_of(f["from"]) in base_uc}
    for rel in sorted(files):
        f = files[rel]
        if f["covered"]:
            covered += 1
            continue
        status, old = f["status"] or "M", f["from"]
        stem = stem_of(rel)
        old_stem = stem_of(old) if old else None
        hs, cus = route(rel, stem, old_stem, by_folder, handlers, ad, base_ids, base_uc, renamed)
        if status.startswith("D") and stem in base_uc:
            mechanical.append({"action": "retire", "handler": stem, "useCase": base_uc[stem][1], "path": rel})
            continue
        if status == "R100" and old_stem in base_uc and old_stem != stem:
            mechanical.append({"action": "rename", "from": old_stem, "to": stem, "useCase": base_uc[old_stem][1], "path": rel})
            continue
        diff = "" if status.startswith("D") else file_diff(rel, old, f["shas"], f.get("worktree"), f.get("untracked"))
        if not status.startswith(("D", "R")) and not diff:
            noise.append(rel)
            continue
        # Only a change the agent reads brings its use-case files into the packet.
        for cu in cus:
            path = next((p for (cx, c, p) in base_uc.values() if c == cu), None)
            if path:
                cu_files.add(path)
        entry = {"path": rel, "status": status[0], "useCases": sorted(cus), "handlers": sorted(hs)}
        if old:
            entry["from"] = old
        if stem in by_name and stem not in base_uc and stem not in renamed and rel == by_name[stem].path:
            entry["newHandler"] = stem
        entry["diff"] = diff
        changes.append(entry)
    size = sum(len(c["diff"]) for c in changes) + sum(len(knowledge.read(os.path.join(C.root, p))) for p in cu_files)
    tokens = size // 4
    return {
        "commits": foreign, "skipped": skipped, "worktree": wt, "covered": covered,
        "changes": changes, "mechanical": mechanical, "noise": noise,
        "tokens": tokens, "overBudget": tokens > C.sync_budget, "needsAgent": bool(changes),
    }


def language_docs():
    lang = C.data.get("language")
    return lang.get("docs", "en") if isinstance(lang, dict) else "en"


def stem_of(path):
    return os.path.splitext(os.path.basename(path))[0].split(".")[0]


def route(rel, stem, old_stem, by_folder, handlers, ad, base_ids, base_uc, renamed):
    """(handler names, use-case ids) a changed file points at."""
    hs, cus = set(), set()
    for name in (stem, old_stem):
        if name and name in base_uc:
            hs.add(name)
    d = os.path.dirname(rel)
    while d and not hs:
        if d in by_folder:
            hs.update(by_folder[d])
            break
        if C.under(d, C.use_case_roots) is None:
            break
        d = os.path.dirname(d)
    if any(fnmatch.fnmatchcase(rel, p) for p in C.aggregate):
        word = re.compile(rf"\b{re.escape(stem)}\b")
        for h in handlers:
            if word.search(knowledge.read(os.path.join(C.root, h.path))):
                hs.add(h.name)
    if C.under(rel, C.test_roots) is not None and ad is not None:
        th, tc = test_owner(rel, handlers, ad, base_ids)
        hs.update(th)
        cus.update(tc)
    for h in hs:
        h = h if h in base_uc else renamed.get(h)
        if h in base_uc and base_uc[h][1]:
            cus.add(base_uc[h][1])
    return hs, cus


# --- reminder ---------------------------------------------------------------------------------
def reminder(paths, staged):
    if not os.path.isdir(knowledge.base_dir(C)):
        return 0
    base_uc = knowledge.use_cases(C)
    known = set(knowledge.contexts(C)) | set(C.contexts)
    if staged:
        out = git("diff", "--cached", "--name-only", "-M") or ""
        paths = out.splitlines()
        synced = {ctx for ctx in known
                  if any(SYNC_ROW.match(l) for l in (git("diff", "--cached", "-U0", "--",
                         os.path.join(C.knowledge_root, ctx, "HISTORY.md")) or "").splitlines())}
    else:
        paths = [C.rel(p) for p in paths]
        synced = set()
    hits, code = {}, None
    for rel in paths:
        aggregate = any(fnmatch.fnmatchcase(rel, p) for p in C.aggregate)
        if not in_scope(rel) or (C.under(rel, C.use_case_roots) is None and not aggregate):
            continue
        ctx = context_of(rel, known)
        if ctx is None or ctx in synced:
            continue
        if aggregate:
            # The sync's own routing: the use cases whose handlers name the aggregate.
            if code is None:
                code = code_inventory()[0]
            _, cus = route(rel, stem_of(rel), None, {}, code.get(ctx, []), None, {}, base_uc, {})
            for cu in sorted(cus):
                hits.setdefault(ctx, []).append(f"{cu} ← {os.path.basename(rel)}")
            continue
        d = os.path.dirname(rel)
        found = marker_files(os.path.join(C.root, d)) if os.path.isdir(os.path.join(C.root, d)) else []
        names = [os.path.splitext(f)[0].split(".")[0] for f in found] or [os.path.splitext(os.path.basename(rel))[0]]
        for n in names:
            label = base_uc[n][1] if n in base_uc else "new use case"
            hits.setdefault(ctx, []).append(f"{label} ← {os.path.basename(rel)}")
    for ctx in sorted(hits):
        items = list(dict.fromkeys(hits[ctx]))
        more = f" (+{len(items) - 3})" if len(items) > 3 else ""
        print(f"knowledge base possibly behind: {', '.join(items[:3])}{more} — /cctoolkit:knowledge-sync {ctx}")
    return 0


# --- main ----------------------------------------------------------------------------------------
def summary(result):
    print(f"knowledge-scan — {result['root']} at {result['head'] or 'no commit'}")
    for x in result["contexts"]:
        prefix = x["prefix"] or f"{x['proposedPrefix']} (proposed)"
        print(f"\n{x['name']} — {prefix} — {x['mode']}")
        if x["mode"] in ("bootstrap", "full"):
            n = x["inventory"]["counts"]
            print(f"  handlers {n['handlers']} (commands {n['commands']}, queries {n['queries']}), rule sheets {n['ruleSheets']}"
                  f" ({n['rules']} rules), without sheet {n['withoutSheet']}")
            print(f"  DESIGN.md {len(x['inventory']['design'])}, aggregates {len(x['inventory']['aggregates'])}, "
                  f"exceptions {len(x['inventory']['exceptions'])}, events {len(x['inventory']['events'])}, "
                  f"feat/refactor commits {x['inventory']['history']['total']}")
        if x["mode"] in ("incremental", "full") and "delta" in x:
            d = x["delta"]
            print(f"  since {', '.join(x['marks']) or '—'}: {d['commits']} foreign commit(s), {len(d['skipped'])} covered,"
                  f" working tree {'changed' if d['worktree'] else 'clean'}")
            print(f"  changes {len(d['changes'])}, mechanical {len(d['mechanical'])}, noise only {len(d['noise'])},"
                  f" ~{d['tokens']} tokens{' — OVER BUDGET' if d['overBudget'] else ''}"
                  f"{'' if d['needsAgent'] else ' — no agent needed'}")
            for m in d["mechanical"]:
                print(f"  {m['action']}: {m.get('handler') or m['from'] + ' → ' + m['to']} ({m['useCase']})")
            for ch in d["changes"]:
                print(f"  {ch['status']} {ch['path']} → {', '.join(ch['useCases']) or ch.get('newHandler') or 'context'}")
    if result["unassigned"]:
        print(f"\nno context: {len(result['unassigned'])} handler(s), e.g. {', '.join(result['unassigned'][:3])}")


def main(argv):
    global C
    ctx_filter, since, full, as_json, remind, staged, paths = None, None, False, False, False, False, []
    it = iter(argv)
    for a in it:
        if a == "--context":
            ctx_filter = set(next(it, "").split(",")) - {""} or usage("--context expects a name")
        elif a == "--since":
            since = next(it, None) or usage("--since expects a commit")
        elif a == "--full":
            full = True
        elif a == "--json":
            as_json = True
        elif a == "--reminder":
            remind = True
        elif a == "--staged":
            staged = True
        elif a.startswith("-"):
            usage(f"unknown option {a}")
        else:
            paths.append(a)
    if since and full:
        usage("--since and --full exclude each other")
    if (staged or paths) and not remind:
        usage("--staged and paths go with --reminder")
    try:
        C = kit_config.load()
    except kit_config.KitConfigError as e:
        if remind:
            return 0
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 3
    if remind:
        try:
            return reminder(paths, staged)
        except Exception:
            return 0
    try:
        import kit_testtag
        ad = kit_testtag.adapter(C)
    except Exception:
        ad = None
    if since and git("rev-parse", "--verify", "--quiet", since + "^{commit}") is None:
        print(f"knowledge-scan: unknown commit {since}", file=sys.stderr)
        return 2
    code, unassigned = code_inventory()
    in_base = knowledge.contexts(C)
    known = set(code) | set(in_base) | set(C.contexts)
    names = sorted(known)
    if ctx_filter:
        unknown = ctx_filter - known
        if unknown:
            print(f"knowledge-scan: unknown context {', '.join(sorted(unknown))} — known: {', '.join(names) or 'none'}", file=sys.stderr)
            return 2
        names = [n for n in names if n in ctx_filter]
    base_uc = knowledge.use_cases(C)
    base_ids = {}
    for ctx in in_base:
        for path in knowledge.use_case_files(C, ctx):
            objs = knowledge.objects(knowledge.read(path))
            cu = next((o.id for o in objs if o.kind == "CU"), None)
            for o in objs:
                base_ids[o.id] = cu
    all_handlers = [h for hs in code.values() for h in hs]
    sources = list(walk_sources())
    taken = set(C.contexts.values())
    result = {"root": C.knowledge_root, "head": knowledge.head(C.root), "budget": C.sync_budget,
              "overviewBudget": C.overview_budget, "language": language_docs(), "contexts": [],
              "unassigned": unassigned}
    for ctx in names:
        prefix = C.contexts.get(ctx)
        proposed = None
        if not prefix:
            proposed = proposed_prefix(ctx, taken)
            taken.add(proposed)
        marks = [since] if since else [] if full else (knowledge.sync_marks(C, ctx) if ctx in in_base else [])
        mode = "incremental" if marks else "full" if ctx in in_base else "bootstrap"
        x = {"name": ctx, "prefix": prefix, "proposedPrefix": proposed, "mode": mode,
             "marks": [m[:7] for m in marks], "inBase": ctx in in_base}
        handlers = code.get(ctx, [])
        if mode in ("bootstrap", "full"):
            x["inventory"] = inventory(ctx, handlers, known, ad, sources)
        if mode == "incremental" and knowledge.head(C.root):
            x["delta"] = incremental(ctx, marks, handlers, all_handlers, known, ad, base_ids, base_uc)
        result["contexts"].append(x)
    if as_json:
        json.dump(result, sys.stdout, indent=1, ensure_ascii=False)
        print()
    else:
        summary(result)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
