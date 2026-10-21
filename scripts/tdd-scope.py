#!/usr/bin/env python3
"""cctoolkit tdd-scope — the CLI side of lib/tdd_scope.py.

    cctoolkit tdd-scope restore <agent id> <path>...
        puts each path back as it was when that agent started (snapshot copy, else HEAD,
        else removed); a path the agent did not change is left as is.
    cctoolkit tdd-scope evidence [--since EPOCH]
        prints the evidence the auditor judges, one `stub-logic <file>: <lines>` line each, and one
        `test-edit <file>: removed <lines> + added <lines>` per test file a GREEN changed outside
        run-lot (under run-lot, those lines go to the run work file).
    cctoolkit tdd-scope red   (RED report as JSON on stdin)
        the RED checkpoint of a `tdd-cycle` agent: the RED checks run on the tree; passed, the
        agent is at GREEN. Exit 0 passed, 1 refused (the reason printed).
        The TDD scope hook adds `--agent <id> --transcript <path>`: typed by hand, it is refused.
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
    if argv[1] == "red":
        opt = {k: argv[argv.index(k) + 1] for k in ("--agent", "--transcript") if k in argv and argv.index(k) + 1 < len(argv)}
        if not opt.get("--agent"):
            print("tdd-scope red: no agent id — run it from a tdd-cycle agent, the TDD scope hook adds it", file=sys.stderr)
            return 2
        try:
            report = json.loads(sys.stdin.read() or "null")
        except ValueError as e:
            print(f"RED checkpoint refused: the report is no JSON ({e})")
            return 1
        try:
            cfg = kit_config.load()
        except kit_config.KitConfigError as e:
            print(f"kit.config.json: {e}", file=sys.stderr)
            return 3
        passed, message = tdd_scope.checkpoint(cfg, opt["--agent"], opt.get("--transcript", "-"), report)
        print(message if passed else f"RED checkpoint refused: {message}")
        return 0 if passed else 1
    if argv[1] == "evidence":
        since = float(argv[argv.index("--since") + 1]) if "--since" in argv else 0.0
        try:
            with open(os.path.join(tdd_scope.state_dir(), "evidence.jsonl"), encoding="utf-8") as fh:
                for line in fh:
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    if e.get("at", 0) < since:
                        continue
                    if e.get("kind") == "stub-logic":
                        print(f"stub-logic {e.get('file')}: {' | '.join(e.get('lines', []))}")
                    elif e.get("kind") == tdd_scope.TEST_EDIT:
                        print(f"test-edit {e.get('file')}: removed {' | '.join(e.get('removed', [])) or 'none'}"
                              f" + added {' | '.join(e.get('added', [])) or 'none'}")
        except OSError:
            pass
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
