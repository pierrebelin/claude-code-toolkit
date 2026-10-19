#!/usr/bin/env python3
"""Churn against complexity per source file — the hotspot map of the quality report.

- Files: `layout.sources` at the analysed commit, minus test roots, `skipDirs`,
  `linguist-generated` / `linguist-vendored` paths and every `--exclude` glob.
- Churn: merges, file creations, pure renames, `.git-blame-ignore-revs` and `--ignore-rev`
  left out; renames followed. Ranked over `--days` ending at the commit date; whole
  history counted beside it. Fixes: `fix:` subjects, `null` when the history has none.
- Complexity: cyclomatic by lizard at the analysed commit, per file total and worst
  function; `missing` without lizard (churn alone never ranks a file).
- Danger Zone: above the median on both axes. Score = sqrt(u² + v²), each axis
  log1p-normalised to its max. Ranked on the total, then on the worst function.

    cctoolkit hotspots                              # Markdown section on stdout
    cctoolkit hotspots --json                       # activity.hotspots of the report JSON
    cctoolkit hotspots --days 0                     # rank over the whole history
    cctoolkit hotspots --exclude '*/Migrations/*' --exclude '*.g.cs'
    cctoolkit hotspots --ref <branch|sha> --ignore-rev <sha>
"""
import argparse
import datetime
import fnmatch
import json
import math
import os
import re
import statistics
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
ROOT, C = kit_config.script_config()

MASS_SHARE = 0.25          # a commit touching more of the tracked files is a mass change
PARSER_SUSPECT_NLOC = 200  # that many code lines and no function found: check the parser
FIX_SUBJECT = re.compile(r"^fix(\([^)]*\))?!?:", re.I)
QUADRANT = {(True, True): "danger_zone", (False, True): "cowboy_code",
            (True, False): "fertile_ground", (False, False): "healthy_closure"}

TOP, TOP_WORST = 10, 5  # Danger Zone files listed on the total complexity, then on the worst function


def git(*args, check=True):
    return kit_config.git(ROOT, *args, check=check)


def default_ref():
    head = git("symbolic-ref", "refs/remotes/origin/HEAD", check=False).strip()
    if head:
        return head.replace("refs/remotes/origin/", "", 1)
    return git("rev-parse", "--abbrev-ref", "HEAD").strip()


def split_rename(path):
    """(old, new) for a numstat rename (`a => b`, `dir/{a => b}/f`), else (None, path)."""
    m = re.match(r"^(.*)\{(.*) => (.*)\}(.*)$", path)
    if m:
        pre, a, b, post = m.groups()
        return re.sub("/+", "/", pre + a + post), re.sub("/+", "/", pre + b + post)
    if " => " in path:
        old, new = path.split(" => ", 1)
        return old, new
    return None, path


def candidate_files(ref, excludes):
    """(analysed paths, {group: count} excluded, tracked file count) at `ref`."""
    tracked = [p for p in git("ls-tree", "-r", "--name-only", ref).splitlines() if p]
    excluded = {"tests": 0, "skipped dirs": 0, "generated or vendored": 0, "--exclude": 0}
    kept = []
    for p in tracked:
        if not C.is_source(p) or not C.under(p, C.source_roots):
            continue
        if C.under(p, C.test_roots):
            excluded["tests"] += 1
        elif any(seg in C.skip for seg in p.split("/")[:-1]):
            excluded["skipped dirs"] += 1
        elif any(fnmatch.fnmatchcase(p, g) for g in excludes):
            excluded["--exclude"] += 1
        else:
            kept.append(p)
    generated = linguist_marked(ref, kept)
    excluded["generated or vendored"] = len(generated)
    return [p for p in kept if p not in generated], excluded, len(tracked)


def linguist_marked(ref, paths):
    if not paths:
        return set()
    stdin = "\n".join(paths) + "\n"
    out = None
    for extra in (["--source", ref], []):
        r = subprocess.run(["git", "-C", ROOT, "check-attr", *extra, "--stdin",
                            "linguist-generated", "linguist-vendored"],
                           input=stdin, capture_output=True, text=True, errors="replace")
        if r.returncode == 0:
            out = r.stdout
            break
    marked = set()
    for line in (out or "").splitlines():
        parts = line.rsplit(": ", 2)
        if len(parts) == 3 and parts[2] in ("set", "true"):
            marked.add(parts[0])
    return marked


def ignore_file_revs(ref):
    text = git("show", f"{ref}:.git-blame-ignore-revs", check=False)
    return {line.split("#", 1)[0].strip() for line in text.splitlines()} - {""}


def churn(ref, cutoff, current, ignored, tracked_count):
    """Per current path: window commits, lines and fixes, all-history commits, authors,
    last change. Plus the run facts. `cutoff` = oldest date of the window, or None."""
    log = git("log", ref, "--no-merges", "-M", "--numstat", "--summary",
              "--format=%x00%H%x09%aN%x09%cI%x09%s")
    stats = {p: {"commits": 0, "lines": 0, "fixes": 0, "commits_all": 0,
                 "authors": set(), "last_change": None} for p in current}
    alias, renames, mass, oldest, skipped, fix_seen = {}, 0, [], None, 0, False

    for block in log.split("\x00")[1:]:
        lines = block.split("\n")
        sha, author, date, subject = (lines[0].split("\t", 3) + [""])[:4]
        oldest = date
        in_window = cutoff is None or datetime.datetime.fromisoformat(date) >= cutoff
        is_fix = bool(FIX_SUBJECT.match(subject))
        fix_seen = fix_seen or is_fix
        created, touched = set(), []
        for line in lines[1:]:
            if line.startswith(" create mode "):
                created.add(line.split(" ", 4)[4])
            elif "\t" in line:
                add, dele, path = line.split("\t", 2)
                old, new = split_rename(path)
                touched.append((add, dele, old, new))
        is_ignored = sha in ignored or any(sha.startswith(i) for i in ignored if len(i) < 40)
        edited = sum(1 for t in touched if t[3] not in created)
        if edited > tracked_count * MASS_SHARE and not is_ignored:
            mass.append({"commit": sha[:12], "files": edited})
        for add, dele, old, new in touched:
            target = alias.get(new, new)
            if old is not None:
                alias[old] = target
                renames += 1 if target in stats else 0
            if target not in stats:
                continue
            s = stats[target]
            s["authors"].add(author)
            s["last_change"] = s["last_change"] or date
            changed = int(add) + int(dele) if add != "-" else None
            if is_ignored or new in created or changed == 0:
                continue
            s["commits_all"] += 1
            if in_window:
                s["commits"] += 1
                s["lines"] += changed or 0
                s["fixes"] += 1 if is_fix else 0
        skipped += 1 if is_ignored else 0
    facts = {"renames_followed": renames, "mass_commits": mass, "history_from": oldest,
             "ignored_commits": skipped, "fix_convention": fix_seen}
    return stats, facts


def blobs(ref, paths):
    return kit_config.git_blobs(ROOT, ref, paths)


def complexity(ref, paths):
    """({path: {total, worst, worst_function, worst_line, functions, nloc}}, tool) or (None, reason)."""
    try:
        import lizard
        from lizard import analyze_file
    except ImportError:
        return None, "lizard is not installed (pip install lizard)"
    out = {}
    for p, text in blobs(ref, paths).items():
        info = analyze_file.analyze_source_code(p, text)
        funcs = sorted(info.function_list, key=lambda f: (-f.cyclomatic_complexity, f.start_line))
        worst = funcs[0] if funcs else None
        out[p] = {
            "total": sum(f.cyclomatic_complexity for f in funcs),
            "worst": worst.cyclomatic_complexity if worst else 0,
            "worst_function": worst.name if worst else None,
            "worst_line": worst.start_line if worst else None,
            "functions": len(funcs),
            "nloc": info.nloc,
        }
    return out, f"lizard {getattr(lizard, 'version', '?')}"


def rank(files, stats, cx, key, fixes):
    """(quadrant counts, Danger Zone rows by score, median thresholds) with complexity = cx[key]."""
    t_churn = statistics.median(stats[p]["commits"] for p in files)
    t_cx = statistics.median(cx[p][key] for p in files)
    max_churn = max(stats[p]["commits"] for p in files)
    max_cx = max(cx[p][key] for p in files)
    norm = lambda v, m: math.log1p(v) / math.log1p(m) if m else 0.0
    counts = dict.fromkeys(QUADRANT.values(), 0)
    rows = []
    for p in files:
        s, c = stats[p], cx[p]
        q = QUADRANT[(s["commits"] > t_churn, c[key] > t_cx)]
        counts[q] += 1
        if q == "danger_zone":
            rows.append({
                "file": p,
                "commits": s["commits"],
                "commits_all": s["commits_all"],
                "lines_changed": s["lines"],
                "fixes": s["fixes"] if fixes else None,
                "complexity_total": c["total"],
                "complexity_worst": c["worst"],
                "worst_function": c["worst_function"],
                "worst_line": c["worst_line"],
                "authors": len(s["authors"]),
                "last_change": (s["last_change"] or "")[:10] or None,
                "score": round(math.hypot(norm(s["commits"], max_churn), norm(c[key], max_cx)), 3),
            })
    rows.sort(key=lambda d: (-d["score"], d["file"]))
    return counts, rows, (t_churn, t_cx)


def build(args):
    ref = args.ref or default_ref()
    sha = git("rev-parse", ref).strip()
    commit_date = git("show", "-s", "--format=%cI", sha).strip()
    cutoff = (datetime.datetime.fromisoformat(commit_date) - datetime.timedelta(days=args.days)
              if args.days else None)
    files, excluded, tracked_count = candidate_files(sha, args.exclude)
    ignored = ignore_file_revs(sha) | set(args.ignore_rev)
    stats, facts = churn(sha, cutoff, files, ignored, tracked_count)
    cx, tool = complexity(sha, files)
    report = {
        "status": "measured" if cx is not None else "missing",
        "reason": None if cx is not None else tool,
        "commit": sha,
        "commit_date": commit_date,
        "shallow": git("rev-parse", "--is-shallow-repository").strip() == "true",
        "window_days": args.days or None,
        "window_from": cutoff.isoformat() if cutoff else None,
        "history_from": facts["history_from"],
        "fix_convention": facts["fix_convention"],
        "tool": tool if cx is not None else None,
        "metric": "cyclomatic",
        "files_analysed": len(files),
        "excluded": excluded,
        "ignore_revs_file": bool(ignore_file_revs(sha)),
        "ignored_commits": facts["ignored_commits"],
        "mass_commits": facts["mass_commits"],
        "renames_followed": facts["renames_followed"],
        "thresholds": None,
        "quadrants": None,
        "parser_suspect": None,
        "danger_zone_top": None,
        "worst_function_top": None,
    }
    if cx is None or not files:
        return report
    fixes = facts["fix_convention"]
    counts, rows, (t_churn, t_cx) = rank(files, stats, cx, "total", fixes)
    _, worst_rows, (_, t_worst) = rank(files, stats, cx, "worst", fixes)
    shown = {d["file"] for d in rows[:TOP]}
    report.update({
        "thresholds": {"commits": t_churn, "complexity_total": t_cx, "complexity_worst": t_worst,
                       "rule": "median of the analysed files"},
        "quadrants": counts,
        "parser_suspect": sorted(p for p in files
                                 if cx[p]["functions"] == 0 and cx[p]["nloc"] >= PARSER_SUSPECT_NLOC),
        "danger_zone_top": rows[:TOP],
        "worst_function_top": [d for d in worst_rows if d["file"] not in shown][:TOP_WORST],
    })
    return report


def table(rows, with_fixes):
    head = ["File", "Commits (window / all)", "Lines changed"] + (["Fixes"] if with_fixes else []) + [
        "Complexity (total / worst)", "Worst function", "Authors", "Last change", "Score"]
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for d in rows:
        fn = f"`{d['worst_function']}` :{d['worst_line']}" if d["worst_function"] else "—"
        cells = [f"`{d['file']}`", f"{d['commits']} / {d['commits_all']}", str(d["lines_changed"])]
        cells += [str(d["fixes"])] if with_fixes else []
        cells += [f"{d['complexity_total']} / {d['complexity_worst']}", fn, str(d["authors"]),
                  d["last_change"] or "—", str(d["score"])]
        out.append("| " + " | ".join(cells) + " |")
    if not rows:
        out.append("| — |" + " |" * (len(head) - 1))
    return out


def markdown(r):
    window = (f"last {r['window_days']} days ({r['window_from'][:10]} → {r['commit_date'][:10]})"
              if r["window_days"] else "whole history")
    out = [f"Commit `{r['commit'][:12]}` ({r['commit_date'][:10]}) — ranked on the churn of the {window}"
           + (f", history from {r['history_from'][:10]}" if r["history_from"] else "")
           + (" — **shallow clone, history truncated**" if r["shallow"] else "") + "."]
    excl = ", ".join(f"{n} {g}" for g, n in r["excluded"].items() if n) or "none"
    out.append(f"{r['files_analysed']} files analysed — excluded: {excl}.")
    if r["status"] != "measured":
        out.append(f"\n**Missing** — {r['reason']}. No file is ranked on churn alone.")
        return "\n".join(out)
    t, q = r["thresholds"], r["quadrants"]
    out.append(f"Complexity: {r['metric']}, {r['tool']}. Thresholds (median): {t['commits']} commits, "
               f"complexity {t['complexity_total']} total / {t['complexity_worst']} worst function. "
               "Score = √(u² + v²), log1p-normalised.")
    out.append(f"Danger Zone **{q['danger_zone']}** — Cowboy Code {q['cowboy_code']} — "
               f"Fertile Ground {q['fertile_ground']} — Healthy Closure {q['healthy_closure']}.")
    fixes = r["fix_convention"]
    out += ["", "**On the total complexity**", ""] + table(r["danger_zone_top"], fixes)
    out += ["", "**On the worst function** — files the total misses", ""] + table(r["worst_function_top"], fixes)
    notes = [f"{r['renames_followed']} renames followed"]
    notes.append(f"{r['ignored_commits']} commits ignored"
                 + (" (`.git-blame-ignore-revs`)" if r["ignore_revs_file"] else ""))
    if not fixes:
        notes.append("no `fix:` commit in the history — fixes not counted")
    if r["mass_commits"]:
        notes.append("mass commits kept in the churn: " + ", ".join(
            f"`{m['commit']}` ({m['files']} files)" for m in r["mass_commits"]))
    if r["parser_suspect"]:
        notes.append("no function found, check the parser: " + ", ".join(f"`{p}`" for p in r["parser_suspect"]))
    out += ["", "; ".join(notes) + "."]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ref", help="branch or commit analysed (default: origin/HEAD, else the current branch)")
    ap.add_argument("--days", type=int, default=365,
                    help="churn window ending at the analysed commit's date; 0 = whole history (default 365)")
    ap.add_argument("--exclude", action="append", default=[], help="glob of paths left out (repeatable)")
    ap.add_argument("--ignore-rev", action="append", default=[], help="commit left out of the churn (repeatable)")
    ap.add_argument("--json", action="store_true", help="print the activity.hotspots object")
    args = ap.parse_args()
    report = build(args)
    print(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) if args.json else markdown(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
