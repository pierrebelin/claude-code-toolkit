#!/usr/bin/env python3
"""The run work file — `<plan folder>/run/.work.jsonl`, the one scratch file of run-plan and run-lot.

Why. The runs used to leave a tree of drafts under `run/.work/` (a folder per run, a folder
per batch with a copy of every file being modified, one file per cycle, per question, per
log) that no purge rule kept small. Every batch is now committed when it ends, so the batch
diff is `git diff HEAD`: no file copy is needed. What a run must keep between two agents
fits in one line of JSON per event:

    {"kind": "preexisting", "batch": "F2", "at": 1760000000.0, "files": {"<path>": "<blob sha>"}}
        files modified or untracked when the batch started (hash only, `git hash-object`
        without -w: no content stored anywhere); the batch commit and the set-aside restore
        leave them alone
    {"kind": "cycle", "batch": "F2", "slug": "<behaviour slug>", "state": {...}}
        RED then GREEN state of one cycle; the last line of a slug wins
    {"kind": "question", "batch": "F2", "id": "F2-1", "at": ..., "payload": {...}}
    {"kind": "answer", "batch": "F2", "id": "F2-1", "at": ..., "answers": [...]}
    {"kind": "journal", "run": "<stamp>", "at": ..., "text": "..."}
    {"kind": "audit-round", "batch": "F2", "round": 1, "open": 3, "files": [...], "contested": [...], "responses": [...], "after": 1, "diverged": false}
        one audit fix round: findings it answered, files it changed (read off the tree by
        `cctoolkit audit-round`), contests, the audit's responses and the findings left (`after`, `diverged`, written once
        the audit answered); the last line of a round wins
    {"kind": "attempt", "batch": "F2", "step": "GREEN …", "n": 2, "reason": "..."}
        a rejected attempt of a step and why, written with the next attempt
    {"kind": "breaker", "run": "<stamp>", "asides": [...], "decision": "stop"|"continue", "cause": "..."}
        run-plan's check of the batches set aside for a common cause
    {"kind": "ack", "batch": "F2", "ref": "<id>|pause", "what": "note-taken"|"applied"|"paused"}
        a script's answer to a line of the pane file `run/.pane.jsonl` (lib/pane_file.py)

Concurrent RED and GREEN agents append at the same time: every append and every rewrite
holds an exclusive `flock` on the file itself, and a rewrite truncates in place (a
replace by rename would leave an appender writing to the unlinked inode). Windows has no
`flock`: there the lock is one byte far past the content (`msvcrt.locking`, mandatory, so
never on the data itself), exclusive for readers too.
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
KINDS = ("preexisting", "cycle", "question", "answer", "journal", "audit-round", "attempt", "breaker", "ack")


def tmp_dir(name: str) -> Path:
    """`$TMPDIR/cctoolkit-run/<repo>-<hash>/<name>`: the run's scratch folder, the same on every
    call for one repo, outside the repo. `cctoolkit run-work tmp` prints it; hooks keep state there."""
    import kit_config
    root = Path(kit_config.project_root()).resolve()
    repo = f"{root.name}-{hashlib.sha1(str(root).encode()).hexdigest()[:8]}"
    return Path(tempfile.gettempdir()) / "cctoolkit-run" / repo / name


def work_path(run_root) -> Path:
    return Path(run_root) / NAME


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
    Never removes the file, even empty: an appender blocked on the lock would then write
    to the unlinked inode. `run-work purge`, run before any agent starts, removes it."""
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
