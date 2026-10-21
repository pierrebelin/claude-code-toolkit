#!/usr/bin/env python3
"""cctoolkit suites-plan — the global green of a run-lot batch, resolved: build, suites, commands.

    cctoolkit suites-plan <work> FX [--root DIR] [--lock]
    cctoolkit suites-plan <work> FX --tests-changed [--root DIR]
    cctoolkit suites-plan --failed <output>

Plan: the suites `commands.suites` of kit.config.json requires for the batch diff
(`cctoolkit batch-baseline diff <work> FX --name-only`), each with the shell line that runs it
(`env` prefix, `commands.test`, the filter of a filtered suite, output to a file of
`cctoolkit run-work tmp FX`). A suite entry is `{"name", "when": "<path regex>", "filter":
"<runner filter, {namespace} expanded>", "project": "<test project glob>", "env": "<VAR=value>"}`:
no `when` = always, `filter` = filtered, its namespaces read off the production folders the diff
touches matched against the first-level folders of `project` (test-scope.md §3). A namespace
not found leaves the suite `unresolved`, its scope a judgement. The plan also records the
dirty files under `layout.tests.roots` and their hashes, read back by `--tests-changed`.

Prints one JSON object: {"tmp", "build": {"run", "output"}, "suites": [{"name", "scope",
"run", "output"}], "unresolved": [{"name", "why"}], "notRun": [{"name", "why"}]}.
`--lock`: each run line holds its command under `cctoolkit build-lock` — a batch run beside another
(run-plan, `run.parallelBatches`): the solution builds and whole suites of the two pass one at a time.
`--tests-changed`: {"changed": [{"path", "shared"}]}, the files under the test roots written
since the plan, `shared` = under `layout.tests.shared`.
`--failed`: the failed test names `tdd.failedTest` reads in a suite output, one per line.
Exit 0; 2 on usage error, missing snapshot or unreadable kit.config.json.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
import work_file  # noqa: E402

STATE = "tests-state.json"


def batch_files(root, work, batch):
    p = subprocess.run([sys.executable, os.path.join(HERE, "scripts", "batch-baseline.py"), "diff", work, batch,
                        "--name-only", "--root", root], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"suites-plan: {p.stderr.strip() or 'batch-baseline diff failed'}")
    return [l.strip() for l in p.stdout.splitlines() if l.strip()]


def namespaces(c, entry, paths):
    """(namespaces, paths without one): `Catalog.Products` for src/<P>/Catalog/Products/X.cs when the test
    project holds Catalog/Products, `Catalog` when it holds Catalog only."""
    projects = c.dirs([c.expand(entry.get("project", ""))]) if entry.get("project") else []
    found, missing = set(), []
    for p in paths:
        segs = p.split("/")[2:-1]
        ns = None
        for proj in projects:
            for i, s in enumerate(segs):
                if os.path.isdir(os.path.join(proj, s)):
                    deeper = i + 1 < len(segs) and os.path.isdir(os.path.join(proj, s, segs[i + 1]))
                    ns = f"{s}.{segs[i + 1]}" if deeper else s
                    break
            if ns:
                break
        if ns:
            found.add(ns)
        else:
            missing.append(p)
    return sorted(found), missing


ASSIGNMENT = re.compile(r"[A-Za-z_]\w*=")


def line(cmd, out, lock=False):
    if lock:
        # The command as words after `--`, never one quoted string: the Bash guards read it.
        cmd = f"cctoolkit build-lock -- {'env ' if ASSIGNMENT.match(cmd) else ''}{cmd}"
    return f'{cmd} > "{out}" 2>&1; echo "exit=$?"; tail -15 "{out}"'


def plan(c, root, work, batch, lock=False):
    tmp = work_file.tmp_dir(batch)
    tmp.mkdir(parents=True, exist_ok=True)
    files = batch_files(root, work, batch)
    build = c.command("build")
    result = {"tmp": tmp.as_posix(), "build": {"run": line(build, f"{tmp.as_posix()}/build.txt", lock) if build else "",
                                                "output": f"{tmp.as_posix()}/build.txt" if build else ""},
              "suites": [], "unresolved": [], "notRun": []}
    entries = c.commands.get("suites")
    if not isinstance(entries, list) or not entries:
        result["unresolved"].append({"name": "*", "why": "commands.suites unset — suites and scope per test-scope.md §2"})
        return result, tmp
    for e in entries:
        name = e.get("name", "")
        cmd = c.command("test", name)
        if not cmd:
            result["notRun"].append({"name": name, "why": "commands.test unset"})
            continue
        hit = files
        if e.get("when"):
            when = re.compile(c.expand(e["when"]))
            hit = [p for p in files if when.search(p)]
            if not hit:
                result["notRun"].append({"name": name, "why": f"no batch file matches {e['when']}"})
                continue
        scope, filters = "whole suite", ""
        if e.get("filter"):
            found, missing = namespaces(c, e, hit)
            if missing or not found:
                result["unresolved"].append({"name": name, "why": f"no test namespace for {', '.join((missing or hit)[:5])}"})
                continue
            filters = " ".join(e["filter"].replace("{namespace}", ns) for ns in found)
            scope = filters
        env = (e.get("env") or "").strip()
        out = f"{tmp.as_posix()}/test-{name}.txt"
        run = " ".join(x for x in (env, cmd, filters) if x)
        result["suites"].append({"name": name, "scope": scope, "run": line(run, out, lock), "output": out})
    return result, tmp


def dirty_tests(c, root):
    """{path: sha1} of the files under the test roots differing from HEAD, untracked included."""
    if not c.test_roots:
        return {}
    p = subprocess.run(["git", "status", "--porcelain", "-z", "-uall", "--", *c.test_roots],
                       cwd=root, capture_output=True)
    out, parts, i = {}, p.stdout.decode("utf-8", errors="replace").split("\0"), 0
    while i < len(parts):
        entry = parts[i]
        i += 1
        if len(entry) < 4:
            continue
        if entry[0] in "RC":
            i += 1
        path = entry[3:]
        try:
            with open(os.path.join(root, path), "rb") as f:
                out[path] = hashlib.sha1(f.read()).hexdigest()
        except OSError:
            out[path] = ""
    return out


def main(argv):
    args = argv[1:]
    if len(args) == 2 and args[0] == "--failed":
        try:
            text = open(args[1], encoding="utf-8", errors="replace").read()
            c = kit_config.load()
        except (OSError, kit_config.KitConfigError) as e:
            print(f"suites-plan: {e}", file=sys.stderr)
            return 2
        rx = (c.data.get("tdd") or {}).get("failedTest", "")
        names = sorted({m.group(1) for m in re.finditer(rx, text, re.M)}) if rx else []
        print("\n".join(names))
        return 0
    root = None
    if "--root" in args:
        i = args.index("--root")
        if i + 1 >= len(args):
            print(__doc__, file=sys.stderr)
            return 2
        root = args[i + 1]
        del args[i:i + 2]
    changed = "--tests-changed" in args
    lock = "--lock" in args
    args = [a for a in args if a not in ("--tests-changed", "--lock")]
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    work, batch = args
    root = root or kit_config.project_root()
    try:
        c = kit_config.load(root)
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 2
    state = work_file.tmp_dir(batch) / STATE
    if changed:
        try:
            before = json.loads(state.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            print(f"suites-plan: no test snapshot at {state.as_posix()} — run the plan first", file=sys.stderr)
            return 2
        now = dirty_tests(c, root)
        shared = c._list(c.layout["tests"].get("shared", []))
        paths = sorted(p for p in set(before) | set(now) if before.get(p) != now.get(p))
        print(json.dumps({"changed": [{"path": p, "shared": c.under(p, shared) is not None} for p in paths]}, ensure_ascii=False))
        return 0
    try:
        result, tmp = plan(c, root, work, batch, lock)
    except SystemExit as e:
        print(str(e), file=sys.stderr)
        return 2
    (tmp / STATE).write_text(json.dumps(dirty_tests(c, root)), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
