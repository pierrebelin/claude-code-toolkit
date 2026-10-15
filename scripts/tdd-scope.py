#!/usr/bin/env python3
"""cctoolkit tdd-scope — the CLI side of lib/tdd_scope.py (the hook that checks what the TDD agents write).

    cctoolkit tdd-scope restore <agent id> <path>...
        puts each path back as it was when that agent started (its snapshot copy, else HEAD,
        else removed when it did not exist); a path the agent did not change is left as is.
        The deny of the RED/GREEN check names the exact command.
    cctoolkit tdd-scope evidence [--since EPOCH]
        prints the evidence the auditor judges, one line each (`stub-logic <file>: <lines>`);
        `audit-capture` appends it to the capture. Nothing recorded = nothing printed.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
import kit_config  # noqa: E402
import tdd_scope  # noqa: E402


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0 if len(argv) > 1 else 2
    if argv[1] == "restore" and len(argv) >= 4:
        try:
            cfg = kit_config.load()
        except kit_config.KitConfigError as e:
            print(f"kit.config.json: {e}", file=sys.stderr)
            return 3
        return tdd_scope.restore(cfg, argv[2], argv[3:])
    if argv[1] == "evidence":
        since = float(argv[argv.index("--since") + 1]) if "--since" in argv else 0.0
        try:
            with open(os.path.join(tdd_scope.state_dir(), "evidence.jsonl"), encoding="utf-8") as fh:
                for line in fh:
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    if e.get("at", 0) >= since and e.get("kind") == "stub-logic":
                        print(f"stub-logic {e.get('file')}: {' | '.join(e.get('lines', []))}")
        except OSError:
            pass
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
