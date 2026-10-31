#!/usr/bin/env python3
"""The run work file — `<plan folder>/run/.work.jsonl`, the one scratch file of run-plan and run-lot.

One line of JSON per event:

    {"kind": "preexisting", "batch": "F2", "at": 1760000000.0, "files": {"<path>": "<blob sha>"}}
        files dirty when the batch started (hash only); the batch commit and restore leave them alone
    {"kind": "cycle", "batch": "F2", "slug": "<behaviour slug>", "state": {...}}
        RED then GREEN state of one cycle; the last line of a slug wins
    {"kind": "question", "batch": "F2", "id": "F2-1", "at": ..., "payload": {...}}
    {"kind": "answer", "batch": "F2", "id": "F2-1", "at": ..., "answers": [...]}
    {"kind": "journal", "run": "<stamp>", "at": ..., "text": "..."}
    {"kind": "audit-round", "batch": "F2", "round": 1, "open": 3, "files": [...], "contested": [...], "responses": [...], "after": 1, "diverged": false}
        one audit fix round (`after`, `diverged` written once the audit answered); the last line of a round wins
    {"kind": "attempt", "batch": "F2", "step": "GREEN …", "n": 2, "reason": "..."}
        a rejected attempt of a step and why, written with the next attempt
    {"kind": "breaker", "run": "<stamp>", "asides": [...], "decision": "stop"|"continue", "cause": "..."}
        run-plan's check of the batches set aside for a common cause
    {"kind": "ack", "batch": "F2", "ref": "<id>", "what": "note-taken"|"applied", "agent"?: "<id>"}
        a script's answer to a line of the pane file `run/.pane.jsonl` (lib/pane_file.py)
    {"kind": "test-edit", "batch": "F2", "agent": "<id>", "cycle": "C1", "file": "<test path>", "removed": [...], "added": [...]}
        a test file a GREEN changed after the RED checkpoint, its assertion lines (`tdd.assertion`) on each
        side; written by lib/tdd_scope.py, read by `cctoolkit audit-capture`
    {"kind": "replay", "batch": "F2", "base": "<sha>", "head": "<sha>", "commits": [...], "files": [...]}
        a delivered batch under replay (`batch-baseline replay`): the range its commits span and the files
        they touch; with no snapshot of the batch, `batch-baseline diff` and `base` read it; dropped at the
        end of the replay

Every append and rewrite holds an exclusive `flock`; a rewrite truncates in place (a rename would
strand an appender on the unlinked inode). Windows locks one byte past the content (`msvcrt.locking`).
"""
import hashlib
import json
import os
import re
import tempfile
import time
import unicodedata
from pathlib import Path

if os.name == "nt":
    import msvcrt

    _FAR = 0x7FFFFFF0

    def _lock(f, exclusive: bool) -> None:
        os.lseek(f.fileno(), _FAR, os.SEEK_SET)
        while True:
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
                break
            except OSError:  # LK_LOCK gives up after ten tries, one per second
                time.sleep(0.05)
        f.seek(0)

    def _unlock(f) -> None:
        f.flush()
        os.lseek(f.fileno(), _FAR, os.SEEK_SET)
        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
else:
    import fcntl

    def _lock(f, exclusive: bool) -> None:
        fcntl.flock(f, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)

    def _unlock(f) -> None:
        fcntl.flock(f, fcntl.LOCK_UN)

NAME = ".work.jsonl"
KINDS = ("preexisting", "cycle", "question", "answer", "journal", "audit-round", "attempt", "breaker", "ack", "closing", "test-edit", "replay")


def tmp_dir(name: str, root=None) -> Path:
    """`$TMPDIR/cctoolkit-run/<repo>-<hash>/<name>`: the run's scratch folder, stable per repo, outside it.
    `root` defaults to `kit_config.project_root()`."""
    import kit_config
    root = Path(root or kit_config.project_root()).resolve()
    repo = f"{root.name}-{hashlib.sha1(str(root).encode()).hexdigest()[:8]}"
    return Path(tempfile.gettempdir()) / "cctoolkit-run" / repo / name


def work_path(run_root) -> Path:
    return Path(run_root) / NAME


# The lines that describe a batch's code: dropped together when that code is gone and the batch starts over.
START_OVER = ("cycle", "test-edit", "closing", "attempt")


def aside_ref(work, batch: str) -> str:
    """The ref `batch-baseline restore --save` keeps a set-aside batch's work under, named after the plan folder
    of `<plan folder>/run/.work.jsonl`."""
    plan = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(work).resolve().parent.parent.name).strip("-") or "plan"
    return f"refs/cctoolkit/aside/{plan}/{batch}"


def slug(text: str) -> str:
    """Same as run-lot.js and sheet-cycles.py `slug`: the key of a cycle."""
    plain = "".join(c for c in unicodedata.normalize("NFD", text) if not ("\u0300" <= c <= "\u036f"))
    return re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")[:60]


def _parse(lines) -> list[dict]:
    records = []
    for line in lines:
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict) and record.get("kind") in KINDS:
            records.append(record)
    return records


def _dump(record: dict) -> str:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"


def read(path) -> list[dict]:
    path = Path(path)
    if not path.is_file():
        return []
    with open(path, encoding="utf-8") as f:
        _lock(f, exclusive=False)
        try:
            return _parse(f)
        finally:
            _unlock(f)


def append(path, record: dict) -> dict:
    if record.get("kind") not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    record.setdefault("at", time.time())
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        _lock(f, exclusive=True)
        try:
            f.write(_dump(record))
            f.flush()
        finally:
            _unlock(f)
    return record


def keep(path, predicate) -> int:
    """Rewrites the file with the records `predicate` keeps; returns how many were dropped.
    Never removes the file: an appender blocked on the lock would write to the unlinked inode."""
    path = Path(path)
    if not path.is_file():
        return 0
    with open(path, "r+", encoding="utf-8") as f:
        _lock(f, exclusive=True)
        try:
            records = _parse(f)
            kept = [r for r in records if predicate(r)]
            f.seek(0)
            f.truncate()
            f.writelines(_dump(r) for r in kept)
            f.flush()
        finally:
            _unlock(f)
    return len(records) - len(kept)


def of(records, kind: str, batch: str | None = None) -> list[dict]:
    return [r for r in records if r.get("kind") == kind and (batch is None or r.get("batch") == batch)]


def cycle_states(records, batch: str) -> dict:
    """Last saved state per behaviour slug of a batch."""
    found = {}
    for r in of(records, "cycle", batch):
        if isinstance(r.get("state"), dict) and r.get("slug"):
            found[r["slug"]] = r["state"]
    return found


def preexisting(records, batch: str) -> dict | None:
    """Files dirty at the batch start: the FIRST snapshot of the batch, a resumed batch keeps it."""
    lines = of(records, "preexisting", batch)
    return lines[0].get("files", {}) if lines else None


def replay(records, batch: str) -> dict | None:
    """The range of a delivered batch under replay: the LAST `replay` line of the batch."""
    lines = of(records, "replay", batch)
    return lines[-1] if lines else None
