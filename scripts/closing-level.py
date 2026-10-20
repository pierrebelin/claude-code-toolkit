#!/usr/bin/env python3
"""cctoolkit closing-level — the run-lot closing of a batch, `full` or `light`, from its diff.

    cctoolkit closing-level <sheet> <work> [--next <next sheet>] [--record] [--batch FX] [--root DIR]

The files are the batch diff (`cctoolkit batch-baseline diff <work> FX --name-only`), each
added, modified or deleted against HEAD; the rules and the cap are `closing` of
kit.config.json, the ripples and a forced `closing` the sheet's `## Cycles` block
(lib/closing_level.py). `--next`: whether the next batch needs the review of its sheet — it
does when that sheet names a production type this batch modified or deleted.
`--record`: the result is also appended to <work> as a `closing` line.

Prints one JSON line: {"level", "reasons", "production", "review", "reviewWhy"}.
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


def review_of(cfg, files, next_sheet):
    """(review needed, why): the next sheet names a production type this batch modified or deleted."""
    if not next_sheet:
        return False, "no next batch"
    try:
        text = open(next_sheet, encoding="utf-8").read()
    except OSError:
        return True, f"next sheet unreadable: {next_sheet}"
    changed = sorted({os.path.splitext(os.path.basename(p))[0] for p, ch in files
                      if ch in "MD" and closing_level.production(cfg, p)})
    named = [t for t in changed if re.search(rf"\b{re.escape(t)}\b", text)]
    if named:
        return True, f"the next sheet names types this batch changed: {', '.join(named[:5])}"
    return False, "the next sheet names no type this batch changed"


def main(argv):
    args = [a for a in argv[1:]]
    opt = {}
    for key in ("--next", "--batch", "--root"):
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
    cycles = data["cycles"] if data else []
    try:
        files = batch_files(root, work, batch)
    except SystemExit as e:
        print(str(e), file=sys.stderr)
        return 2
    result = closing_level.decide(cfg, files, cycles, (data or {}).get("closing", ""))
    result["review"], result["reviewWhy"] = review_of(cfg, files, opt.get("--next", ""))
    if record:
        work_file.append(work, {"kind": "closing", "batch": batch, "level": result["level"], "reasons": result["reasons"]})
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
