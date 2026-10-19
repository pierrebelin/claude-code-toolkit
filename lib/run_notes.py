#!/usr/bin/env python3
"""A note the user leaves for a batch in the run-lot-pane mod, delivered to the batch's agents while they work.

PostToolUse, every tool of a subagent (`hooks/run-notes.sh`). The agent's first prompt opens on
run-lot's frame, `Workflow run-lot, batch FX. … Run work file: <path>.`: every note of FX in
`run/.pane.jsonl` this agent has not received goes to it as additional context, then one `ack`
line per note (`what` `note-taken`, `agent` its id) records it. Every agent of the batch, those
running and those to come, gets every note once, at its next tool call.

State: `HOOK_STATE` (`/tmp/claude-runnotes-<session>-<agent>`) caches `<batch>\\t<work file>`,
`-` for an agent outside a run. Not written while the agent's transcript cannot be read.
"""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pane_file  # noqa: E402
import tdd_scope  # noqa: E402
import work_file  # noqa: E402

# Frozen literal (docs/FROZEN-LITERALS.md): the first line of run-lot.js's FRAME.
FRAME = re.compile(r"^Workflow run-lot, batch (\S+)\. .*Run work file: (.+)\.$", re.M)


def run_of(d, state):
    try:
        batch, work = Path(state).read_text(encoding="utf-8").rstrip("\n").split("\t", 1)
        return batch, work
    except (OSError, ValueError):
        pass
    prompt = tdd_scope.prompt_of(d.get("transcript_path", ""), d.get("agent_id", ""))
    if not prompt:
        return "-", ""
    m = FRAME.search(prompt)
    batch, work = (m.group(1), m.group(2)) if m else ("-", "")
    try:
        Path(state).write_text(f"{batch}\t{work}\n", encoding="utf-8")
    except OSError:
        pass
    return batch, work


def main():
    try:
        d = json.loads(os.environ.get("HOOK_INPUT") or "{}")
    except ValueError:
        return
    agent, state = d.get("agent_id") or "", os.environ.get("HOOK_STATE") or ""
    if not agent or not state:
        return
    batch, work = run_of(d, state)
    if batch == "-" or not work:
        return
    work = Path(work)
    notes = pane_file.pending_notes(work.parent, work, batch, agent)
    if not notes:
        return
    for note in notes:
        work_file.append(work, {"kind": "ack", "batch": batch, "ref": note["id"], "what": "note-taken", "agent": agent})
    text = "\n".join(f"Note from the user for {batch}, binding over the sheet and your contract: "
                     f"{' '.join(str(n.get('text', '')).split())}" for n in notes)
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": text}}))


if __name__ == "__main__":
    main()
