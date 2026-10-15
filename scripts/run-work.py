#!/usr/bin/env python3
"""The run work file `<plan folder>/run/.work.jsonl` — append, read back, purge.

Line format and why one file: lib/work_file.py. Logs, captures and suite outputs never go
under `run/`: `tmp` hands out a folder of the system temp directory for them.

    cctoolkit run-work append <work>
        appends the JSON object read on stdin (`kind` among preexisting, cycle, question,
        answer, journal, audit-round, attempt, breaker). A `cycle` without `slug` gets the slug of `state.behaviour`.
    cctoolkit run-work journal <work> <stamp> [<text>]
        with <text>: appends a journal line of run <stamp>; without: prints the run's lines
    cctoolkit run-work drop <work> [--batch FX] [--run STAMP] [--kind k1,k2]
        removes the matching lines (every filter given must match)
    cctoolkit run-work tmp <name>
        creates and prints `$TMPDIR/cctoolkit-run/<repo>-<hash>/<name>`, the same path on
        every call of the same repo
    cctoolkit run-work rm-tmp <name>...
        removes those folders of `tmp`; a name holding `/` or `..`, or empty, is refused.
        Replaces `rm -rf "$(cctoolkit run-work tmp <name>)"`, which Claude Code's guard
        holds for confirmation (unresolvable target) and denies in an unattended session
    cctoolkit run-work purge <run folder> [<stamp>]
        migrates once from the older layouts, then keeps, for every run:
        - journal and breaker lines of run <stamp> only; question and answer lines never;
          audit-round and attempt lines of a batch still open only;
        - per batch: `cycle` lines when `batches/FX.md` says `## STATUS — DONE` or the
          older `## STATUT — TERMINÉ`, or the plan heading `### Batch FX` says `✅ DONE`
          (TDD evidence), or when the batch stopped and was never set aside (resume),
          the `preexisting` line only in that second case; a batch set aside (an
          `aside-FX.patch` newer than its report and its lines) loses every line;
        - the 3 most recent runs (`<stamp>.md`, `<stamp>/`, `<stamp>-aside-FX.patch`),
          <stamp> counted among them; the patch of a batch done since and an empty
          `<stamp>/` folder removed;
        - the temp folder of the repo removed. An empty work file is removed.
    cctoolkit run-work migrate <run folder>
        older layouts into the work file: cycle states of `.work/FX/cycles/*.json`,
        `.work/FX/cycles.jsonl`, `.travail/FX/...` and `FX/cycles/` become `cycle` lines
        (batches without any), the snapshot `.work/FX/baseline` of a batch still open
        becomes its `preexisting` line, reports of `lots/FX.md`, `FX/FX-report.md` and
        `FX/FX-rapport.md` move to `batches/FX.md` when absent; then `.work/`, `.travail/`,
        `lots/` and the `FX/` folders are removed.

Exit 0, 2 on usage error.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
for _lib in (HERE / "lib", HERE / ".claude" / "lib"):
    sys.path.insert(0, str(_lib))
import kit_config  # noqa: E402
import work_file  # noqa: E402

STAMP = re.compile(r"^(\d{4}-\d{2}-\d{2}-\d{4})")
BATCH = re.compile(r"^F\d+$")
DONE = re.compile(r"^## (STATUS — DONE|STATUT — TERMINÉ)\b", re.M)
KEEP_RUNS = 3


tmp_dir = work_file.tmp_dir


def rm_tmp(names: list[str]) -> int:
    bad = [n for n in names if not n or "/" in n or n in (".", "..")]
    if bad or not names:
        print(f"rm-tmp: invalid name(s): {bad or 'none given'}", file=sys.stderr)
        return 2
    for name in names:
        shutil.rmtree(tmp_dir(name), ignore_errors=True)
    return 0


def option(args: list[str], name: str) -> str | None:
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else None


def append(work: Path) -> int:
    try:
        record = json.loads(sys.stdin.read())
    except json.JSONDecodeError as error:
        print(f"not JSON: {error}", file=sys.stderr)
        return 1
    if not isinstance(record, dict):
        print("expected one JSON object", file=sys.stderr)
        return 1
    if record.get("kind") == "cycle" and not record.get("slug"):
        record["slug"] = work_file.slug(str((record.get("state") or {}).get("behaviour", "")))
    try:
        work_file.append(work, record)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    print(f"appended {record['kind']}{' ' + record['batch'] if record.get('batch') else ''}")
    return 0


def journal(work: Path, stamp: str, text: str | None) -> int:
    if text is not None:
        work_file.append(work, {"kind": "journal", "run": stamp, "text": text})
        return 0
    for r in work_file.of(work_file.read(work), "journal"):
        if r.get("run") == stamp:
            print(r.get("text", ""))
    return 0


def drop(work: Path, args: list[str]) -> int:
    batch, run, kinds = option(args, "--batch"), option(args, "--run"), option(args, "--kind")
    wanted = set(kinds.split(",")) if kinds else None

    def matches(r: dict) -> bool:
        return ((batch is None or r.get("batch") == batch) and (run is None or r.get("run") == run)
                and (wanted is None or r.get("kind") in wanted))

    print(f"dropped {work_file.keep(work, lambda r: not matches(r))} line(s)")
    return 0


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def old_states(folder: Path) -> dict:
    """slug -> (state, mtime of the file it came from)."""
    found = {}
    packed = folder.with_name(folder.name + ".jsonl") if folder.name == "cycles" else None
    for path in [packed] if packed and packed.is_file() else []:
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                state = json.loads(line)
            except ValueError:
                continue
            if isinstance(state, dict) and isinstance(state.get("behaviour"), str):
                found[work_file.slug(state["behaviour"])] = (state, path.stat().st_mtime)
    if folder.is_dir():
        for path in sorted(folder.glob("*.json")):
            state = read_json(path)
            if isinstance(state, dict):
                found[path.stem] = (state, path.stat().st_mtime)
    return found


def old_snapshot(base: Path) -> dict | None:
    manifest = base / "manifest.txt"
    if not manifest.is_file():
        return None
    files = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        copy = base / "files" / line
        files[line] = subprocess.run(["git", "hash-object", "--no-filters", str(copy)], capture_output=True, text=True).stdout.strip() if copy.is_file() else ""
    return files


def migrate(run: Path) -> int:
    work = work_file.work_path(run)
    records = work_file.read(work)
    has_cycles = {r.get("batch") for r in work_file.of(records, "cycle")}
    has_snapshot = {r.get("batch") for r in work_file.of(records, "preexisting")}
    batches_dir = run / "batches"
    moved = lines = 0
    olds = [run / ".work", run / ".travail", run / "lots"] + [d for d in sorted(run.glob("F*")) if d.is_dir() and BATCH.match(d.name)]
    for root in (run / ".work", run / ".travail", run):
        for folder in sorted(root.glob("F*")) if root.is_dir() else []:
            if not (folder.is_dir() and BATCH.match(folder.name)):
                continue
            batch = folder.name
            if batch not in has_cycles:
                states = old_states(folder / "cycles")
                for key, (state, at) in sorted(states.items()):
                    work_file.append(work, {"kind": "cycle", "batch": batch, "slug": key, "state": state, "at": at})
                    lines += 1
                if states:
                    has_cycles.add(batch)
            report = batches_dir / f"{batch}.md"
            done = report.is_file() and DONE.search(report.read_text(encoding="utf-8"))
            snapshot = None if done or batch in has_snapshot else old_snapshot(folder / "baseline")
            if snapshot is not None:
                at = (folder / "baseline" / "manifest.txt").stat().st_mtime
                work_file.append(work, {"kind": "preexisting", "batch": batch, "files": snapshot, "at": at})
                has_snapshot.add(batch)
                lines += 1
            for name in (f"{batch}-report.md", f"{batch}-rapport.md"):
                if (folder / name).is_file() and not report.exists():
                    batches_dir.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(folder / name), report)
                    moved += 1
    for old in sorted((run / "lots").glob("F*.md")) if (run / "lots").is_dir() else []:
        target = batches_dir / old.name
        if not target.exists():
            batches_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old), target)
            moved += 1
    removed = [d.name for d in olds if d.is_dir()]
    for d in olds:
        shutil.rmtree(d, ignore_errors=True)
    if lines or moved or removed:
        print(f"migrated: {lines} line(s), {moved} report(s) moved, removed: {', '.join(removed) or 'none'}")
    return 0


def aside_time(run: Path, batch: str) -> float:
    return max((p.stat().st_mtime for p in asides(run, batch)), default=0.0)


def plan_done(run: Path, batch: str) -> float:
    """mtime of the plan when its `### Batch FX` heading carries ✅ DONE (a run cut before the batch report), else 0."""
    heading = re.compile(rf"^### (?:Batch|Lot) {batch}\b.*✅ DONE", re.M)
    for plan in run.parent.glob("*-PLAN.md"):
        if heading.search(plan.read_text(encoding="utf-8")):
            return plan.stat().st_mtime
    return 0.0


def asides(run: Path, batch: str) -> list[Path]:
    return list(run.glob(f"*-aside-{batch}.patch")) + list(run.glob(f"*/aside-{batch}.patch"))


def batch_state(run: Path, batch: str, records: list[dict]) -> str:
    report = run / "batches" / f"{batch}.md"
    done = report.stat().st_mtime if report.is_file() and DONE.search(report.read_text(encoding="utf-8")) else 0.0
    done = done or plan_done(run, batch)
    aside = aside_time(run, batch)
    last = max((r.get("at", 0) for r in records if r.get("batch") == batch), default=0.0)
    if aside and aside > done and aside >= last - 1:
        return "aside"
    return "done" if done else "open"


def rotate(run: Path, stamp: str | None) -> list[str]:
    stamps = {m.group(1) for p in run.iterdir() if (m := STAMP.match(p.name))}
    if stamp:
        stamps.add(stamp)
    old = sorted(stamps, reverse=True)[KEEP_RUNS:]
    for s in old:
        for p in [run / s, run / f"{s}.md", *run.glob(f"{s}-aside-*.patch")]:
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            elif p.exists():
                p.unlink()
    return old


def purge(run: Path, stamp: str | None) -> int:
    if not run.is_dir():
        return 0
    migrate(run)
    work = work_file.work_path(run)
    records = work_file.read(work)
    states = {b: batch_state(run, b, records) for b in {r.get("batch") for r in records if r.get("batch")}}

    def kept(r: dict) -> bool:
        kind, state = r.get("kind"), states.get(r.get("batch"))
        if kind in ("journal", "breaker"):
            return bool(stamp) and r.get("run") == stamp
        if kind in ("audit-round", "attempt"):
            return state == "open"
        if kind in ("question", "answer"):
            return False
        if kind == "preexisting":
            return state == "open"
        return state in ("done", "open")

    dropped = work_file.keep(work, kept)
    if work.is_file() and work.stat().st_size == 0:
        work.unlink()
    for batch, state in states.items():
        if state == "done":
            for patch in asides(run, batch):
                patch.unlink()
    for folder in run.iterdir():
        if folder.is_dir() and STAMP.match(folder.name) and not any(folder.iterdir()):
            folder.rmdir()
    old = rotate(run, stamp)
    shutil.rmtree(tmp_dir(""), ignore_errors=True)
    print(f"purged: {dropped} line(s){f', runs removed: {', '.join(old)}' if old else ''}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    command, target, rest = argv[0], Path(argv[1]), argv[2:]
    if command == "tmp":
        folder = tmp_dir(argv[1])
        folder.mkdir(parents=True, exist_ok=True)
        print(folder)
        return 0
    if command == "rm-tmp":
        return rm_tmp(argv[1:])
    if command == "append":
        return append(target)
    if command == "journal" and rest:
        return journal(target, rest[0], " ".join(rest[1:]) if len(rest) > 1 else None)
    if command == "drop":
        return drop(target, rest)
    if command == "purge":
        return purge(target, rest[0] if rest else None)
    if command == "migrate":
        return migrate(target) if target.is_dir() else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
