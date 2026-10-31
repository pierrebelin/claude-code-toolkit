#!/usr/bin/env python3
"""The run work file `<plan folder>/run/.work.jsonl` — append, read back, purge.

Line format and why one file: lib/work_file.py. Logs, captures and suite outputs never go
under `run/`: `tmp` hands out a folder of the system temp directory for them.

    cctoolkit run-work append <work>
        appends the JSON object read on stdin (`kind` among preexisting, cycle, question,
        answer, journal, audit-round, attempt, breaker, ack, closing, test-edit, replay). A `cycle` without `slug` gets the slug of `state.behaviour`.
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
        keeps, for every run:
        - journal and breaker lines of run <stamp> only; question, answer and replay lines
          never (a replay drops its own, one left behind was interrupted);
          audit-round and attempt lines of a batch still open only; ack lines always (an
          answer of the pane applied twice would write its decision twice);
        - per batch: `cycle` lines when `batches/FX.md` says `## STATUS — DONE`, or the plan heading `### Batch FX` says `✅ DONE`
          (TDD evidence), or when the batch stopped and was never set aside (resume),
          the `preexisting` line only in that second case; a batch set aside (an
          `aside-FX.patch` newer than its report and its lines) keeps its `cycle`,
          `preexisting`, `test-edit` and `closing` lines while its work waits under
          `refs/cctoolkit/aside/<plan folder>/FX` (`batch-baseline resume` puts it back),
          and loses every line without that ref;
        - the 3 most recent runs (`<stamp>.md`, `<stamp>/`, `<stamp>-aside-FX.patch`),
          <stamp> counted among them; the patch of a batch done since and an empty
          `<stamp>/` folder removed;
        - the temp folder of the repo removed. An empty work file is removed.
Exit 0, 2 on usage error.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "lib"))
import kit_config  # noqa: E402
import work_file  # noqa: E402

STAMP = re.compile(r"^(\d{4}-\d{2}-\d{2}-\d{4})")
DONE = re.compile(r"^## STATUS — DONE\b", re.M)
KEEP_RUNS = 3


tmp_dir = work_file.tmp_dir


def rm_tmp(names: list[str]) -> int:
    bad = [n for n in names if not n or any(c in n for c in "/\\:") or n in (".", "..")]
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


def saved(run: Path, work: Path, batch: str) -> bool:
    """The work of a set-aside batch waits under its ref, for `batch-baseline resume`."""
    ref = work_file.aside_ref(work, batch)
    return subprocess.run(["git", "rev-parse", "--verify", "-q", ref], capture_output=True, cwd=run).returncode == 0


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
    work = work_file.work_path(run)
    records = work_file.read(work)
    states = {b: batch_state(run, b, records) for b in {r.get("batch") for r in records if r.get("batch")}}
    for batch, state in states.items():
        if state == "aside" and saved(run, work, batch):
            states[batch] = "saved"

    def kept(r: dict) -> bool:
        kind, state = r.get("kind"), states.get(r.get("batch"))
        if kind in ("journal", "breaker"):
            return bool(stamp) and r.get("run") == stamp
        if kind == "ack":
            return True
        if kind in ("audit-round", "attempt"):
            return state == "open"
        if kind in ("question", "answer", "replay"):
            return False
        if kind == "preexisting":
            return state in ("open", "saved")
        return state in ("done", "open", "saved")

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
        print(folder.as_posix())
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
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
