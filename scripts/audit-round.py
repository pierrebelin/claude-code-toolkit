#!/usr/bin/env python3
"""cctoolkit audit-round — the change set of one audit fix round, read off the tree, never the fix's own list.

    cctoolkit audit-round open <work> <batch> <round>
        before the fix: snapshot of every modified or untracked file under the source and
        test roots, in the batch's temp folder
    cctoolkit audit-round close <work> <batch> <round>  <<'ROUND_JSON' {"open": N, "contested": [...]} ROUND_JSON
        after the fix: the files changed since `open`, their diff in
        `<tmp>/audit-round-<round>.diff`, one `audit-round` line appended to the work file;
        prints `{"files": [...], "diff": "<path>"}` on one line. Without `open`: exit 2.

`open` = Blocking and Major findings the fix answered. Exit 2 bad arguments, 3 unreadable kit.config.json.
"""
import difflib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
import kit_config  # noqa: E402
import tdd_scope  # noqa: E402
import work_file  # noqa: E402


def folder(batch, round_):
    return os.path.join(str(work_file.tmp_dir(batch)), f"audit-round-{round_}")


def open_round(cfg, batch, round_):
    base = folder(batch, round_)
    snap = tdd_scope.snapshot(cfg, os.path.join(base, "copies"))
    with open(os.path.join(base, "snapshot.json"), "w", encoding="utf-8") as fh:
        json.dump(snap, fh)
    print(f"audit-round open {round_}: {len(snap)} dirty file(s)")
    return 0


def close_round(cfg, work, batch, round_, payload):
    base = folder(batch, round_)
    try:
        with open(os.path.join(base, "snapshot.json"), encoding="utf-8") as fh:
            snap = json.load(fh)
    except (OSError, ValueError):
        print(f"no open round {round_} for {batch}: run `cctoolkit audit-round open` before the fix", file=sys.stderr)
        return 2
    files = sorted(tdd_scope.changed_since(cfg, snap))
    diff_path = os.path.join(os.path.dirname(base), f"audit-round-{round_}.diff")
    with open(diff_path, "w", encoding="utf-8") as out:
        for path in files:
            before = tdd_scope.text_before(cfg, snap, os.path.join(base, "copies"), path).splitlines(keepends=True)
            try:
                with open(os.path.join(cfg.root, path), encoding="utf-8", errors="replace") as fh:
                    after = fh.readlines()
            except OSError:
                after = []
            out.writelines(difflib.unified_diff(before, after, f"a/{path}", f"b/{path}"))
    work_file.append(work, {"kind": "audit-round", "batch": batch, "round": round_,
                            "open": int(payload.get("open", 0)), "files": files,
                            "contested": payload.get("contested", [])})
    print(json.dumps({"files": files, "diff": diff_path}, ensure_ascii=False))
    return 0


def main(argv):
    if len(argv) < 5 or argv[1] not in ("open", "close"):
        print(__doc__, file=sys.stderr)
        return 2
    command, work, batch = argv[1], argv[2], argv[3]
    try:
        round_ = int(argv[4])
        cfg = kit_config.load()
    except ValueError:
        print("round must be a number", file=sys.stderr)
        return 2
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e}", file=sys.stderr)
        return 3
    if command == "open":
        return open_round(cfg, batch, round_)
    try:
        payload = json.loads(sys.stdin.read() or "{}") if not sys.stdin.isatty() else {}
    except ValueError:
        payload = {}
    return close_round(cfg, work, batch, round_, payload if isinstance(payload, dict) else {})


if __name__ == "__main__":
    sys.exit(main(sys.argv))
