#!/usr/bin/env python3
"""The model-free measures of the quality report, in one call and one JSON object.

    cctoolkit audit-collect --stack dotnet|js [--ref <branch|sha>] [--exclude <glob>]... [--out <file>]

`--out` writes the report fragment, `{activity, codebase}`, for `cctoolkit report-assemble`;
stdout carries it too, with `commit`, `stack` and `hotspots_markdown` (the §2 section).

Run from the audit worktree (`cctoolkit audit-worktree create`), after the tests
restored the dependencies. Each block carries `{status, reason, commit}` like
`activity.hotspots`: `measured`, `not_configured` (the stack or the repo has no such
thing) or `missing` (the tool exists but gave nothing usable — its numbers are `null`).

- `activity.hotspots` — `cctoolkit hotspots --json`, plus its Markdown as `hotspots_markdown`.
- `codebase.rules_coverage` — `rules-coverage --json` and `untagged-tests --json`, one
  traceability block: rules with and without a test, dead references, unbound tests,
  untagged tests per suite. `not_configured` when no rule sheet holds a rules table.
- `codebase.suppressions` — `#pragma warning disable`, `SuppressMessage`, `NOSONAR`,
  `eslint-disable`, `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, `ReSharper disable`,
  counted in the sources at the commit (git objects, not the working tree), test roots,
  `skipDirs` and `--exclude` left out; per kind, per layer, top files.
- `codebase.vulnerabilities` — `dotnet list package --vulnerable --include-transitive`
  or `npm audit`; no network or no lock file → `missing`.
- `codebase.loop_calls` — `access-cost --all --json`: Infrastructure awaited in a loop
  or a lambda, in-memory filters on an awaited result. C# only: `not_configured` for js.

The blocks that read the working tree (traceability, vulnerabilities, loop calls) are
`missing` when it does not match the commit: uncommitted changes measure something else.
Exit 0 whatever the statuses; 2 on bad arguments.
"""
import argparse
import collections
import fnmatch
import glob
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(HERE, "scripts")
for _lib in (os.path.join(HERE, "lib"), os.path.join(HERE, ".claude", "lib")):
    if os.path.isfile(os.path.join(_lib, "kit_config.py")):
        sys.path.insert(0, _lib)
        break
try:
    import kit_config
    ROOT = kit_config.project_root()
    C = kit_config.load(ROOT)
except ImportError:
    sys.exit("kit_config.py not found beside scripts/ — reinstall the cctoolkit plugin")
except kit_config.KitConfigError as e:
    sys.exit(f"kit.config.json: {e} — cctoolkit doctor")

SUPPRESSIONS = {
    "pragma warning disable": re.compile(r"#pragma\s+warning\s+disable"),
    "SuppressMessage": re.compile(r"\bSuppressMessage\s*\("),
    "NOSONAR": re.compile(r"NOSONAR"),
    "eslint-disable": re.compile(r"eslint-disable"),
    "ts-ignore": re.compile(r"@ts-(?:ignore|expect-error|nocheck)\b"),
    "ReSharper disable": re.compile(r"ReSharper\s+disable"),
}
TOP_FILES = 10
LISTED = 30
SEVERITIES = ("critical", "high", "moderate", "low")
TOOL_TIMEOUT = 300


def git(*args, check=True):
    r = subprocess.run(["git", "-C", ROOT, "-c", "core.quotePath=false", *args],
                       capture_output=True, text=True, errors="replace")
    if check and r.returncode != 0:
        sys.exit(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


def block(status, sha, reason=None, **fields):
    return {"status": status, "reason": reason, "commit": sha if status == "measured" else None, **fields}


def last_line(text):
    lines = [l.strip() for l in (text or "").splitlines() if l.strip()]
    return lines[-1][:300] if lines else "no output"


def run(args, timeout=TOOL_TIMEOUT):
    """(exit code, stdout, stderr); (None, '', reason) when the tool cannot run."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, errors="replace", cwd=ROOT, timeout=timeout)
    except FileNotFoundError:
        return None, "", f"{args[0]} not found"
    except subprocess.TimeoutExpired:
        return None, "", f"{' '.join(args[:3])} timed out after {timeout}s"
    return r.returncode, r.stdout, r.stderr


def tree_differs(sha):
    """Why the working tree is not the commit, or None. Untracked files do not count:
    `audit-worktree` copies the untracked kit config in."""
    head = git("rev-parse", "HEAD").strip()
    if head != sha:
        return f"working tree at {head[:12]}, not at the report commit {sha[:12]}"
    if git("status", "--porcelain", "--untracked-files=no").strip():
        return "working tree holds uncommitted changes"
    return None


# --- hotspots ----------------------------------------------------------------------------
def hotspots(sha, excludes):
    spec = importlib.util.spec_from_file_location("hotspots", os.path.join(SCRIPTS, "hotspots.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    args = argparse.Namespace(ref=sha, days=365, exclude=excludes, ignore_rev=[], top=10, top_worst=5)
    report = mod.build(args)
    return report, mod.markdown(report)


# --- traceability ------------------------------------------------------------------------
def rules_coverage(sha, differs):
    if differs:
        return block("missing", sha, differs, **dict.fromkeys(
            ("rules", "with_test", "without_test", "handlers_without_test", "dead_references",
             "unbound_tests", "unbound_tests_count", "untagged")))
    outs = {}
    for name in ("rules-coverage", "untagged-tests"):
        code, out, err = run([sys.executable, os.path.join(SCRIPTS, f"{name}.py"), "--json"])
        try:
            outs[name] = json.loads(out) if code == 0 else None
        except ValueError:
            outs[name] = None
        if outs[name] is None:
            return rules_coverage_missing(sha, f"{name}: {last_line(err or out)}")
    rc, ut = outs["rules-coverage"], outs["untagged-tests"]
    if rc["rules"] == 0:
        return block("not_configured", sha, "no rules table in the rule sheets of the use-case roots",
                     rules=None, with_test=None, without_test=None, handlers_without_test=None,
                     dead_references=None, unbound_tests=None, unbound_tests_count=None, untagged=None)
    return block("measured", sha, rules=rc["rules"], with_test=rc["with_test"], without_test=rc["without_test"],
                 handlers_without_test=rc["handlers_without_test"], dead_references=rc["dead_references"],
                 unbound_tests=rc["unbound_tests"][:LISTED], unbound_tests_count=len(rc["unbound_tests"]),
                 untagged=ut)


def rules_coverage_missing(sha, reason):
    return block("missing", sha, reason, rules=None, with_test=None, without_test=None,
                 handlers_without_test=None, dead_references=None, unbound_tests=None,
                 unbound_tests_count=None, untagged=None)


# --- suppressions ------------------------------------------------------------------------
def layer_of(path):
    parts = path.split("/")
    layer = parts[1] if len(parts) > 2 else "(root)"
    if C.product and layer.startswith(C.product + "."):
        layer = layer[len(C.product) + 1:]
    return layer


def production_files(sha, excludes):
    out = []
    for p in git("ls-tree", "-r", "--name-only", sha).splitlines():
        if not p or not C.is_source(p) or not C.under(p, C.source_roots) or C.under(p, C.test_roots):
            continue
        if any(seg in C.skip for seg in p.split("/")[:-1]) or any(fnmatch.fnmatchcase(p, g) for g in excludes):
            continue
        out.append(p)
    return out


def blobs(sha, paths):
    stdin = "".join(f"{sha}:{p}\n" for p in paths).encode()
    out = subprocess.run(["git", "-C", ROOT, "cat-file", "--batch"], input=stdin, capture_output=True).stdout
    texts, i = {}, 0
    for p in paths:
        nl = out.index(b"\n", i)
        header = out[i:nl].split()
        i = nl + 1
        if len(header) == 3 and header[1] == b"blob":
            size = int(header[2])
            texts[p] = out[i:i + size].decode("utf-8", errors="replace")
            i += size + 1
    return texts


def suppressions(sha, excludes):
    files = production_files(sha, excludes)
    by_kind = dict.fromkeys(SUPPRESSIONS, 0)
    by_layer, per_file = collections.Counter(), collections.Counter()
    for path, text in blobs(sha, files).items():
        for kind, pattern in SUPPRESSIONS.items():
            n = len(pattern.findall(text))
            if n:
                by_kind[kind] += n
                by_layer[layer_of(path)] += n
                per_file[path] += n
    top = sorted(per_file.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_FILES]
    return block("measured", sha, files_scanned=len(files), total=sum(by_kind.values()),
                 files_with_suppressions=len(per_file), by_kind=by_kind,
                 by_layer=dict(sorted(by_layer.items())), top_files=[{"file": f, "count": n} for f, n in top])


# --- vulnerabilities ---------------------------------------------------------------------
def vulnerabilities_missing(sha, status, reason):
    return block(status, sha, reason, tool=None, total=None, by_severity=None, packages=None)


def dotnet_vulnerabilities(sha):
    if not shutil.which("dotnet"):
        return vulnerabilities_missing(sha, "missing", "dotnet not found")
    solutions = sorted(glob.glob(os.path.join(ROOT, "*.sln")) + glob.glob(os.path.join(ROOT, "*.slnx")))
    if len(solutions) > 1:
        return vulnerabilities_missing(sha, "missing", f"{len(solutions)} solution files at the root, none chosen")
    target = [solutions[0]] if solutions else []
    code, out, err = run(["dotnet", "list", *target, "package", "--vulnerable", "--include-transitive",
                          "--format", "json"])
    try:
        data = json.loads(out)
    except ValueError:
        return vulnerabilities_missing(sha, "missing", f"dotnet list package: {last_line(err or out)}")
    problems = [p.get("text", "") for p in data.get("problems", []) if p.get("level") == "error"]
    if code != 0 or problems:
        return vulnerabilities_missing(sha, "missing", f"dotnet list package: {last_line(problems[0] if problems else err)}")
    found = {}
    for project in data.get("projects", []):
        for fw in project.get("frameworks", []):
            for kind in ("topLevelPackages", "transitivePackages"):
                for pkg in fw.get(kind, []):
                    for v in pkg.get("vulnerabilities", []):
                        sev = (v.get("severity") or "").lower()
                        key = (pkg.get("id"), pkg.get("resolvedVersion"), v.get("advisoryurl"))
                        found[key] = {"name": pkg.get("id"), "version": pkg.get("resolvedVersion"), "severity": sev,
                                      "direct": kind == "topLevelPackages", "advisory": v.get("advisoryurl")}
    return vulnerability_block(sha, "dotnet list package --vulnerable --include-transitive", list(found.values()))


def npm_vulnerabilities(sha):
    if not shutil.which("npm"):
        return vulnerabilities_missing(sha, "missing", "npm not found")
    if not os.path.isfile(os.path.join(ROOT, "package-lock.json")):
        return vulnerabilities_missing(sha, "missing", "no package-lock.json: npm audit needs one")
    code, out, err = run(["npm", "audit", "--json"])
    try:
        data = json.loads(out)
    except ValueError:
        return vulnerabilities_missing(sha, "missing", f"npm audit: {last_line(err or out)}")
    if "error" in data:
        return vulnerabilities_missing(sha, "missing", f"npm audit: {data['error'].get('summary') or data['error'].get('code')}")
    found = []
    for name, v in (data.get("vulnerabilities") or {}).items():
        sev = (v.get("severity") or "").lower()
        found.append({"name": name, "version": v.get("range"), "severity": "low" if sev == "info" else sev,
                      "direct": bool(v.get("isDirect")),
                      "advisory": next((x.get("url") for x in v.get("via", []) if isinstance(x, dict)), None)})
    return vulnerability_block(sha, "npm audit", found)


def vulnerability_block(sha, tool, found):
    by_severity = dict.fromkeys(SEVERITIES, 0)
    for f in found:
        by_severity[f["severity"] if f["severity"] in by_severity else "low"] += 1
    rank = {s: i for i, s in enumerate(SEVERITIES)}
    listed = sorted((f for f in found if f["severity"] in ("critical", "high")),
                    key=lambda f: (rank.get(f["severity"], 9), f["name"] or ""))
    return block("measured", sha, tool=tool, total=len(found), by_severity=by_severity, packages=listed)


def vulnerabilities(sha, stack, differs):
    if differs:
        return vulnerabilities_missing(sha, "missing", differs)
    return dotnet_vulnerabilities(sha) if stack == "dotnet" else npm_vulnerabilities(sha)


# --- loop calls --------------------------------------------------------------------------
def loop_calls(sha, stack, differs):
    empty = dict(files_scanned=None, in_loop=None, in_lambda=None, memory_filter=None, files=None)
    if stack != "dotnet":
        return block("not_configured", sha, "access-cost reads C# only", **empty)
    if differs:
        return block("missing", sha, differs, **empty)
    code, out, err = run([sys.executable, os.path.join(SCRIPTS, "access-cost.py"), "--all", "--json"], timeout=600)
    if code == 3:
        return block("missing", sha, "ast-grep is not installed (brew install ast-grep)", **empty)
    try:
        data = json.loads(out) if code == 0 else None
    except ValueError:
        data = None
    if data is None:
        return block("missing", sha, f"access-cost: {last_line(err or out)}", **empty)
    data["files"] = data["files"][:LISTED]
    return block("measured", sha, **data)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--stack", choices=("dotnet", "js"), required=True)
    ap.add_argument("--ref", help="branch or commit analysed (default: origin/HEAD, else the current branch)")
    ap.add_argument("--exclude", action="append", default=[], help="glob of paths left out (repeatable)")
    ap.add_argument("--out", help="also write the JSON into this file")
    args = ap.parse_args()
    ref = args.ref
    if not ref:
        head = git("symbolic-ref", "refs/remotes/origin/HEAD", check=False).strip()
        ref = head.replace("refs/remotes/origin/", "", 1) if head else "HEAD"
    sha = git("rev-parse", "--verify", f"{ref}^{{commit}}").strip()
    differs = tree_differs(sha)
    hot, hot_md = hotspots(sha, args.exclude)
    result = {
        "commit": sha,
        "stack": args.stack,
        "activity": {"hotspots": hot},
        "codebase": {
            "rules_coverage": rules_coverage(sha, differs),
            "suppressions": suppressions(sha, args.exclude),
            "vulnerabilities": vulnerabilities(sha, args.stack, differs),
            "loop_calls": loop_calls(sha, args.stack, differs),
        },
        "hotspots_markdown": hot_md,
    }
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({k: result[k] for k in ("activity", "codebase")}, f, indent=2, ensure_ascii=False)
            f.write("\n")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
