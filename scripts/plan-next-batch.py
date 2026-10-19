#!/usr/bin/env python3
"""Next runnable batches of a global *-PLAN.md, read by the run-plan workflow.

Reads the `### Batch execution` table (`Batch`, `Depends on`, optional `Repo`; French
headings too) and the `### Batch FX — … — ✅ DONE` headings. Prints, for the batches in scope:

    FX <repo-dir> <sheet>     one line per batch to launch now
    END                       every batch in scope is ✅ DONE, or only batches set aside by
                              --skip and their dependents remain (`END F2:skipped F4:F2`)
    WAITING FX:F1,F3 …        batches remain, none has its dependencies done
                              (`FX:excluded` for a batch removed by --exclude)

At most one batch per repository: two batches of one repo share a working tree.

    cctoolkit plan-next-batch <plan> [--until FX | --only FX] [--exclude FX,FY] [--skip FX,FY] [--check]

--until FX    scope = FX and its transitive dependencies
--only FX     scope = FX alone; its dependencies must already be ✅ DONE
--exclude     batches suspended on an open question: never launched, nor their dependents
--skip        batches set aside by this run: read as not done, never launched, nor their
              dependents; when only those remain the plan ends (END)
--check       validate the plan (ids, dependencies, cycles, sheets, repos), exit 1 on error
--outside FX  modified paths of FX's repo `cctoolkit pre-audit` will flag as outside the
              batch; exit 1 when any
--next WORK   next batch, out-of-batch check and journal in one JSON line for run-plan:
              `kind` END|WAITING|BATCHES,
              `line` = the text output, `batches`, `held` (`[{"batch", "by"}]`), then
              `outsideBatch` and `outsidePaths`; when nothing is outside, appends the journal
              line `FX launched — <sheet>` of run --run STAMP to WORK
--context FX  design context of FX for run-lot: earlier batches' audit gaps, the sheets'
              `user decision`/GAPS lines, FX's stopped report and saved cycles, the sheet's
              source and test paths that do not exist
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "lib"))
import kit_config  # noqa: E402
import work_file  # noqa: E402

DONE = re.compile(r"^### (?:Batch|Lot) (F\d+)\b.*✅ DONE", re.M)
SECTION = "### Batch execution"
# Frozen literals, English and French, compared folded (case, accents).
SECTIONS = {"batch execution", "execution des lots"}
COLUMN_BATCH = {"batch", "lot"}
COLUMN_DEPENDS = {"depends on", "depend de"}
COLUMN_REPO = {"repo", "depot"}
AUDIT_GAPS = {"## audit gaps", "## ecarts d'audit"}
DECISION_MARKS = re.compile(r"user decision|décision user|décision utilisateur|GAPS|ECARTS")
REPORTS = ("batches/{b}.md",)


fold = kit_config.fold


def first_column(header, aliases):
    return next((i for i, h in enumerate(header) if fold(h) in aliases), None)


def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def parse(plan):
    text = plan.read_text(encoding="utf-8")
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if fold(l) in {"### " + a for a in SECTIONS}), None)
    if start is None:
        fail(f"{plan}: section «{SECTION}» missing")
    table = []
    for line in lines[start + 1:]:
        if line.startswith("|"):
            table.append(line)
        elif table or line.startswith("#"):
            break
    if len(table) < 3:
        fail(f"{plan}: table «{SECTION}» empty or missing")
    header = cells(table[0])
    ilot, idep = first_column(header, COLUMN_BATCH), first_column(header, COLUMN_DEPENDS)
    if ilot is None or idep is None:
        fail(f"{plan}: columns «Batch» and «Depends on» expected, read {[h.lower() for h in header]}")
    irepo = first_column(header, COLUMN_REPO)
    batches = []
    for row in table[2:]:
        c = cells(row)
        repo = c[irepo] if irepo is not None and c[irepo] not in ("", "—", "-") else "."
        batches.append({"id": c[ilot], "deps": re.findall(r"F\d+", c[idep]), "repo": repo})
    return batches, set(DONE.findall(text))


def closure(target, by_id):
    seen, stack = set(), [target]
    while stack:
        lot = stack.pop()
        if lot in seen or lot not in by_id:
            continue
        seen.add(lot)
        stack.extend(by_id[lot]["deps"])
    return seen


def find_cycle(by_id):
    state = {}

    def visit(lot, path):
        state[lot] = "open"
        for dep in by_id[lot]["deps"]:
            if dep not in by_id:
                continue
            if state.get(dep) == "open":
                return path + [lot, dep]
            if dep not in state:
                cycle = visit(dep, path + [lot])
                if cycle:
                    return cycle
        state[lot] = "closed"
        return None

    for lot in by_id:
        if lot not in state:
            cycle = visit(lot, [])
            if cycle:
                return cycle
    return None


def default_root(plan):
    probe = subprocess.run(["git", "-C", str(plan.parent), "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True)
    return Path(probe.stdout.strip()) if probe.returncode == 0 else plan.parent


def outside_batch(repo, plan, sheet):
    listing = [f for args in (["diff", "--name-only"], ["ls-files", "--others", "--exclude-standard"])
               for f in subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True).stdout.split()]
    plan_dir = plan.parent.relative_to(repo).as_posix() if plan.parent.is_relative_to(repo) else None
    named = sheet.read_text(encoding="utf-8") if sheet.is_file() else ""
    config = kit_config.load(str(repo))
    code = re.compile("(" + "|".join(kit_config.glob_to_ere(r) for r in config.source_roots + config.test_roots) + ")/")
    outside = []
    for path in dict.fromkeys(listing):
        if code.match(path) or path.startswith((".claude/", "todo/")) or "/__pycache__/" in path:
            continue
        if plan_dir and path.startswith(plan_dir + "/"):
            continue
        if Path(path).name in named:
            continue
        outside.append(path)
    return outside


def current_repo():
    probe = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return Path(probe.stdout.strip() if probe.returncode == 0 else ".").resolve()


def first_existing(run, patterns, batch, want):
    for pattern in patterns:
        path = run / pattern.format(b=batch)
        if want(path):
            return path
    return None


def design_context(plan, batches, target, sheet, repo):
    run = plan.parent / "run"
    ids = [b["id"] for b in batches]
    earlier = ids[:ids.index(target)]
    report_of = lambda lot: first_existing(run, REPORTS, lot, Path.is_file)
    out = ["## Audit gaps of earlier batches"]
    for lot in earlier:
        report = report_of(lot)
        gaps = audit_gaps(report.read_text(encoding="utf-8")) if report else None
        out.append(f"### {lot}\n{gaps}" if gaps else f"### {lot} — {'empty section' if report else 'no report'}")
    out.append("\n## User decisions and gaps in the sheets")
    found = [f"{sheet(lot).name}:{n}: {line.strip()}"
             for lot in earlier + [target] if sheet(lot).is_file()
             for n, line in enumerate(sheet(lot).read_text(encoding="utf-8").splitlines(), 1)
             if DECISION_MARKS.search(line)]
    out.extend(found or ["none"])
    out.append(f"\n## Resume state of {target}")
    report = report_of(target)
    first = report.read_text(encoding="utf-8").splitlines()[:1] if report else []
    out.append(f"report: {first[0] if first else 'none'}")
    states = work_file.cycle_states(work_file.read(work_file.work_path(run)), target)
    for key, state in sorted(states.items()):
        out.append(f"cycle {key}: {state.get('behaviour', '?')} — {'green' if state.get('green') else 'no green'}")
    if not states:
        out.append("cycles: none")
    out.append("\n## Cited paths that do not exist")
    config = kit_config.load(str(repo))
    roots = "|".join(kit_config.glob_to_ere(r) for r in config.source_roots + config.test_roots)
    text = sheet(target).read_text(encoding="utf-8") if sheet(target).is_file() else ""
    cited = dict.fromkeys(re.findall(r"`((?:" + roots + r")/[^`\s*]+\.\w+)`", text)) if roots else {}
    out.extend([p for p in cited if not (repo / p).exists()] or ["none"])
    return "\n".join(out)


def audit_gaps(text):
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if fold(l) in AUDIT_GAPS), None)
    if start is None:
        return None
    body = []
    for line in lines[start + 1:]:
        if line.startswith("## "):
            break
        body.append(line)
    return "\n".join(body).strip() or None


def dependents(roots, batches):
    grown = set(roots)
    while True:
        more = grown | {b["id"] for b in batches if set(b["deps"]) & grown}
        if more == grown:
            return grown
        grown = more


def next_batches(batches, done, in_scope, excluded, skipped, repo_dir, sheet):
    skipped = set(re.findall(r"F\d+", skipped))
    done = done - skipped
    pending = [b for b in batches if b["id"] in in_scope and b["id"] not in done]
    if not pending:
        return "END", "END", [], []
    by_id = {b["id"]: b for b in batches}
    held_by = {b["id"]: sorted(skipped & closure(b["id"], by_id) - {b["id"]})
               for b in pending if b["id"] in dependents(skipped, batches)}
    held = [{"batch": lot, "by": by} for lot, by in held_by.items() if lot not in skipped]
    excluded = dependents(set(re.findall(r"F\d+", excluded)) | skipped, batches)
    launched, repos = [], set()
    for b in pending:
        if b["id"] not in excluded and set(b["deps"]) <= done and repo_dir(b) not in repos:
            repos.add(repo_dir(b))
            launched.append({"batch": b["id"], "repo": repo_dir(b).as_posix(), "sheet": sheet(b["id"]).as_posix()})
    if launched:
        return "BATCHES", "\n".join(f"{x['batch']} {x['repo']} {x['sheet']}" for x in launched), launched, held
    if all(b["id"] in held_by for b in pending):
        left = [f"{b['id']}:{'skipped' if b['id'] in skipped else ','.join(held_by[b['id']])}" for b in pending]
        return "END", "END " + " ".join(left), [], held
    waiting = [f"{b['id']}:{','.join(sorted(set(b['deps']) - done)) or 'excluded'}" for b in pending]
    return "WAITING", "WAITING " + " ".join(waiting), [], held


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plan")
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--until")
    scope.add_argument("--only")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--outside")
    parser.add_argument("--exclude", dest="excluded", default="")
    parser.add_argument("--skip", default="")
    parser.add_argument("--next", dest="journal")
    parser.add_argument("--run", default="")
    parser.add_argument("--context")
    args = parser.parse_args()

    plan = Path(args.plan).resolve()
    if not plan.is_file():
        fail(f"{args.plan}: plan not found")
    root = default_root(plan)
    batches, done = parse(plan)
    by_id = {b["id"]: b for b in batches}
    sheet = lambda lot: plan.parent / f"{plan.stem}-{lot}.md"
    repo_dir = lambda b: (root / b["repo"]).resolve()

    target = args.until or args.only
    if target and target not in by_id:
        fail(f"{target}: batch missing from table «{SECTION}»")
    in_scope = closure(target, by_id) if args.until else {args.only} if args.only else set(by_id)

    if args.outside:
        if args.outside not in by_id:
            fail(f"{args.outside}: batch missing from table «{SECTION}»")
        outside = outside_batch(repo_dir(by_id[args.outside]), plan, sheet(args.outside))
        if outside:
            print("\n".join(outside))
            sys.exit(1)
        return

    if args.context:
        if args.context not in by_id:
            fail(f"{args.context}: batch missing from table «{SECTION}»")
        print(design_context(plan, batches, args.context, sheet, repo_dir(by_id[args.context])))
        return

    if args.check:
        errors = []
        if len(by_id) != len(batches):
            errors.append("duplicate batch id")
        for b in batches:
            errors += [f"{b['id']}: unknown dependency {d}" for d in b["deps"] if d not in by_id]
            if b["id"] in done:
                continue
            if not sheet(b["id"]).is_file():
                errors.append(f"{b['id']}: sheet missing {sheet(b['id'])}")
            if not repo_dir(b).is_dir():
                errors.append(f"{b['id']}: repo missing {repo_dir(b)}")
        cycle = find_cycle(by_id)
        if cycle:
            errors.append("dependency cycle " + " > ".join(cycle))
        if errors:
            fail("\n".join(errors))
        print(f"OK {len(batches)} batches, {len(done & set(by_id))} DONE")
        return

    kind, line, launched, held = next_batches(batches, done, in_scope, args.excluded, args.skip, repo_dir, sheet)
    if not args.journal:
        print(line)
        return
    result = {"kind": kind, "line": line, "batches": launched, "held": held, "outsideBatch": "", "outsidePaths": []}
    here = current_repo()
    mine = next((x for x in launched if Path(x["repo"]) == here), None)
    if mine:
        result["outsideBatch"] = mine["batch"]
        result["outsidePaths"] = outside_batch(here, plan, Path(mine["sheet"]))
        if not result["outsidePaths"]:
            work_file.append(args.journal, {"kind": "journal", "run": args.run, "text": f"{mine['batch']} launched — {mine['sheet']}"})
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
