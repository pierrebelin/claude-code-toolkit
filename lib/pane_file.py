#!/usr/bin/env python3
"""The pane file — `<plan folder>/run/.pane.jsonl`, what the user said through the run-lot-pane mod.

Why a second file. `run/.work.jsonl` is appended by the workflow's agents under `flock`; the mod
writes a file whole (`$.fs.write`, no append, no lock), so the two never share a file. The mod is
the only writer here; the scripts answer in the work file with `ack` lines, never here.

    {"kind": "pause", "on": true|false, "at": <epoch s>}
        the last line wins; `on` is spent once `plan-next-batch --next` paused the plan
        (an `ack` of ref `pause` later than it)
    {"kind": "note", "id": "<id>", "batch": "F3", "text": "...", "at": ...}
        a note for a batch, taken once (`cctoolkit run-notes take`, `ack` what `note-taken`)
    {"kind": "validation", "id": "<id>", "entry": {"batch", "step", "text", "sheet"?},
     "decision": "keep"|"reject"|"amend", "text": "...", "at": ...}
        the user's answer to one `## To validate` entry; the last line of an id wins;
        applied once (`cctoolkit run-validate apply`, `ack` what `applied`)

The `ack` line of the work file: `{"kind": "ack", "batch", "ref": "<id>|pause", "what":
"note-taken"|"applied"|"paused", "at", ...}`.
"""
import json
from pathlib import Path

import work_file

NAME = ".pane.jsonl"


def pane_path(run_root) -> Path:
    return Path(run_root) / NAME


def read(run_root) -> list[dict]:
    path = pane_path(run_root)
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict) and record.get("kind") in ("pause", "note", "validation"):
            out.append(record)
    return out


def acks(work) -> list[dict]:
    return work_file.of(work_file.read(work), "ack")


def last_by_id(records, kind) -> dict:
    found = {}
    for r in records:
        if r.get("kind") == kind and r.get("id"):
            found[r["id"]] = r
    return found


def pause_requested(run_root, work) -> bool:
    pauses = [r for r in read(run_root) if r.get("kind") == "pause"]
    if not pauses or not pauses[-1].get("on"):
        return False
    spent = [a.get("at", 0) for a in acks(work) if a.get("ref") == "pause"]
    return not spent or max(spent) < pauses[-1].get("at", 0)


def pending_notes(run_root, work, batch) -> list[dict]:
    taken = {a.get("ref") for a in acks(work) if a.get("what") == "note-taken"}
    return [n for n in last_by_id(read(run_root), "note").values() if n.get("batch") == batch and n["id"] not in taken]


def pending_validations(run_root, work) -> list[dict]:
    applied = {}
    for a in acks(work):
        if a.get("what") == "applied":
            applied[a.get("ref")] = a.get("at", 0)
    return [v for v in last_by_id(read(run_root), "validation").values()
            if v.get("decision") in ("keep", "reject", "amend") and applied.get(v["id"], -1) < v.get("at", 0)]
