#!/usr/bin/env python3
"""cctoolkit closing-level — the run-lot closing of a batch, `full` or `light`, from its diff.

    cctoolkit closing-level <sheet> <work> [--record] [--batch FX] [--root DIR]

The files are the batch diff (`cctoolkit batch-baseline diff <work> FX --name-only`), each
added, modified or deleted against HEAD; the rules and the cap are `closing` of
kit.config.json, a forced `closing` the sheet's `## Cycles` block (lib/closing_level.py).
`--record`: the result is also appended to <work> as a `closing` line.

Prints one JSON line: {"level", "reasons", "production"}.
Exit 0; 2 on usage error, missing snapshot or unreadable kit.config.json.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import closing_level  # noqa: E402
import kit_config  # noqa: E402
import work_file  # noqa: E402


def _sheet_cycles():
    spec = importlib.util.spec_from_file_location("sheet_cycles", os.path.join(HERE, "scripts", "sheet-cycles.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def batch_files(root, work, batch):
    p = subprocess.run([sys.executable, os.path.join(HERE, "scripts", "batch-baseline.py"), "diff", work, batch,
                        "--name-only", "--root", root], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"closing-level: {p.stderr.strip() or 'batch-baseline diff failed'}")
    out = []
    for path in (l.strip() for l in p.stdout.splitlines() if l.strip()):
        in_head = subprocess.run(["git", "cat-file", "-e", f"HEAD:{path}"], cwd=root, capture_output=True).returncode == 0
        out.append((path, "A" if not in_head else "M" if os.path.isfile(os.path.join(root, path)) else "D"))
    return out


def main(argv):
    args = [a for a in argv[1:]]
    opt = {}
    for key in ("--batch", "--root"):
        if key in args:
            i = args.index(key)
            if i + 1 >= len(args):
                print(__doc__, file=sys.stderr)
                return 2
            opt[key] = args[i + 1]
            del args[i:i + 2]
    record = "--record" in args
    args = [a for a in args if a != "--record"]
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    sheet, work = args
    named = re.search(r"-(F\d+)\.md$", sheet)
    batch = opt.get("--batch") or (named.group(1) if named else "")
    sc = _sheet_cycles()
    root = opt.get("--root") or sc.repo_root(sheet)
    try:
        cfg = kit_config.load(root)
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 2
    data, _ = sc.load(sheet) if os.path.isfile(sheet) else (None, [])
    try:
        files = batch_files(root, work, batch)
    except SystemExit as e:
        print(str(e), file=sys.stderr)
        return 2
    result = closing_level.decide(cfg, files, (data or {}).get("closing", ""))
    if record:
        work_file.append(work, {"kind": "closing", "batch": batch, "level": result["level"], "reasons": result["reasons"]})
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
