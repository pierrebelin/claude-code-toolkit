#!/usr/bin/env python3
"""cctoolkit run-notes — notes the user attached to a batch from the run-lot-pane mod.

    cctoolkit run-notes take <work> <batch>
        prints each note of <batch> not taken yet, one line `Note from the user for <batch>: <text>`,
        and records it taken (an `ack` line of the work file). Nothing pending: prints nothing, exit 0.
        Notes live in `run/.pane.jsonl` beside the work file (lib/pane_file.py).
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
import pane_file  # noqa: E402
import work_file  # noqa: E402


def main(argv):
    if len(argv) != 4 or argv[1] != "take":
        print(__doc__, file=sys.stderr)
        return 2
    work, batch = Path(argv[2]), argv[3]
    for note in pane_file.pending_notes(work.parent, work, batch):
        print(f"Note from the user for {batch}: {' '.join(str(note.get('text', '')).split())}")
        work_file.append(work, {"kind": "ack", "batch": batch, "ref": note["id"], "what": "note-taken"})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
