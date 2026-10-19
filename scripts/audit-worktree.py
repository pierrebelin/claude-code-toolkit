#!/usr/bin/env python3
"""The throwaway worktree `/quality-report` measures in — the main branch's commit, clean, in the system temp.

    cctoolkit audit-worktree create [--ref <branch|sha>]   # one JSON line: path, commit, branch, copied
    cctoolkit audit-worktree remove [<path>]               # this commit's worktree, or <path>
    cctoolkit audit-worktree prune                         # every cctoolkit-audit-* worktree of the repo

`create` prunes leftovers first, then adds `<temp>/cctoolkit-audit-<repo>-<sha12>` detached.
The ref defaults to the target of `origin/HEAD`, else the current branch. Untracked files
the kit reads (UNTRACKED) are copied when the commit lacks them, listed in `copied`.
Exit 0 on success, 1 when git refuses.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
from kit_config import project_root  # noqa: E402
ROOT = project_root()

PREFIX = "cctoolkit-audit-"
UNTRACKED = (".claude/kit.config.json", ".claude/settings.local.json", ".claude/presets")


def git(*args, check=True):
    r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        print(f"git {' '.join(args)}: {r.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return r.stdout.strip()


def main_branch():
    head = git("symbolic-ref", "refs/remotes/origin/HEAD", check=False)
    if head:
        return head.replace("refs/remotes/origin/", "", 1)
    return git("rev-parse", "--abbrev-ref", "HEAD")


def repo_tag():
    top = os.path.realpath(git("rev-parse", "--show-toplevel"))
    return f"{os.path.basename(top)}-{hashlib.sha1(top.encode()).hexdigest()[:6]}"


def audit_worktrees():
    paths, current = [], None
    for line in git("worktree", "list", "--porcelain").splitlines():
        if line.startswith("worktree "):
            current = line[len("worktree "):]
            if os.path.basename(current).startswith(PREFIX + repo_tag()):
                paths.append(current)
    return paths


def remove(path):
    git("worktree", "remove", "--force", path, check=False)
    shutil.rmtree(path, ignore_errors=True)


def prune():
    removed = audit_worktrees()
    for path in removed:
        remove(path)
    git("worktree", "prune", check=False)
    return removed


def create(ref):
    ref = ref or main_branch()
    sha = git("rev-parse", "--verify", f"{ref}^{{commit}}")
    prune()
    path = os.path.join(os.path.realpath(tempfile.gettempdir()), f"{PREFIX}{repo_tag()}-{sha[:12]}")
    shutil.rmtree(path, ignore_errors=True)
    # core.longpaths: under %TEMP% a deep .NET tree passes Windows' 260-character limit; ignored elsewhere.
    git("-c", "core.longpaths=true", "worktree", "add", "--detach", path, sha)
    copied = []
    for rel in UNTRACKED:
        src, dst = os.path.join(ROOT, rel), os.path.join(path, rel)
        if not os.path.exists(src) or os.path.exists(dst):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        (shutil.copytree if os.path.isdir(src) else shutil.copy2)(src, dst)
        copied.append(rel)
    print(json.dumps({"path": path, "commit": sha, "branch": ref, "copied": copied}))
    return 0


def main(argv):
    if not argv or argv[0] not in ("create", "remove", "prune"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    if argv[0] == "create":
        return create(argv[argv.index("--ref") + 1] if "--ref" in argv else None)
    if argv[0] == "prune":
        removed = prune()
        print(f"removed: {len(removed)}" + "".join(f"\n  {p}" for p in removed))
        return 0
    targets = argv[1:] or audit_worktrees()
    for path in targets:
        if not os.path.basename(path.rstrip("/")).startswith(PREFIX):
            print(f"refused: {path} is not an audit worktree", file=sys.stderr)
            return 2
        remove(path)
    git("worktree", "prune", check=False)
    print(f"removed: {len(targets)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
