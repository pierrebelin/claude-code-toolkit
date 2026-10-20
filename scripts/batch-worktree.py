#!/usr/bin/env python3
"""The worktree a batch runs in beside another one — run-plan with `run.parallelBatches` 2.

    cctoolkit batch-worktree create FX --plan <plan> --sheet <sheet>
        `<checkout>/.claude/worktrees/cctoolkit-batch-FX`, detached at the checkout's HEAD; the untracked
        kit files copied (UNTRACKED), `commands.worktreeSetup` run there (a .NET restore: the builds pass
        `--no-restore`). One JSON line `path`, `commit`, `copied`, `setup`. Refused (exit 1, one JSON line
        `refused`) when the plan or the sheet differs from HEAD in the checkout — the worktree would not
        hold them — or when git or the setup fails.
    cctoolkit batch-worktree land FX
        the worktree's commits since its creation rebased onto the checkout's HEAD, then the checkout
        fast-forwarded to them. One JSON line `landed`, `commit` (short), `from` (the checkout's HEAD
        before); a conflict: `landed` false, `conflict` (paths), the rebase aborted; any other refusal
        (no commit, a local change in the way): `landed` false, `refused`. Exit 1 when not landed.
    cctoolkit batch-worktree undo FX --to <sha>
        the checkout's HEAD back to <sha> (`reset --keep`: local changes kept), only when HEAD is the
        batch commit of FX (trailer `Kit-Batch: <plan folder>/FX`) and <sha> its ancestor.
    cctoolkit batch-worktree remove FX
    cctoolkit batch-worktree prune
        removes the worktree of FX, or every `cctoolkit-batch-*` worktree of the repo.

The checkout is the main worktree of `kit_config.project_root()`: run from the checkout or from a batch
worktree, the commands act on the same repo. `.claude/worktrees/` is git-ignored through
`.git/info/exclude` when the repo does not ignore it already: an untracked worktree folder would land in
the batch commit (`batch-baseline commit` adds every changed file).
Exit 0, 1 refused, 2 usage.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402

MAIN = kit_config.main_worktree(kit_config.project_root())
FOLDER = ".claude/worktrees"
PREFIX = "cctoolkit-batch-"
UNTRACKED = (".claude/kit.config.json", ".claude/settings.local.json", ".claude/presets")
BASE = "cctoolkit-base"
SETUP_TIMEOUT = 540


def git(*args, cwd=MAIN, check=True):
    r = subprocess.run(["git", "-c", "core.quotePath=false", *args], cwd=cwd, capture_output=True, text=True, errors="replace")
    if check and r.returncode != 0:
        raise Refused(f"git {' '.join(args)}: {r.stderr.strip() or r.stdout.strip()}")
    return r


class Refused(Exception):
    pass


def path_of(batch):
    return os.path.join(MAIN, FOLDER, PREFIX + batch).replace(os.sep, "/")


def out(record, code=0):
    print(json.dumps(record, ensure_ascii=False))
    return code


def ignore_folder():
    """`.claude/worktrees/` ignored in the checkout, through the repo's own exclude file when needed."""
    if git("check-ignore", "-q", f"{FOLDER}/{PREFIX}x", check=False).returncode == 0:
        return
    common = git("rev-parse", "--git-common-dir").stdout.strip()
    exclude = os.path.join(MAIN, common, "info", "exclude")
    os.makedirs(os.path.dirname(exclude), exist_ok=True)
    with open(exclude, "a", encoding="utf-8") as fh:
        fh.write(f"\n{FOLDER}/\n")


def remove(batch):
    path = path_of(batch)
    git("worktree", "remove", "--force", path, check=False)
    shutil.rmtree(path, ignore_errors=True)
    git("worktree", "prune", check=False)
    return path


def create(batch, plan, sheet):
    rel = [os.path.relpath(os.path.abspath(p), MAIN).replace(os.sep, "/") for p in (plan, sheet)]
    dirty = [l[3:] for l in git("status", "--porcelain", "--untracked-files=all", "--", *rel).stdout.splitlines() if l.strip()]
    if dirty:
        raise Refused(f"not committed in the checkout, the worktree would miss them: {', '.join(dirty)}")
    ignore_folder()
    path = remove(batch)
    commit = git("rev-parse", "HEAD").stdout.strip()
    # core.longpaths: a deep .NET tree under .claude/worktrees passes Windows' 260-character limit.
    git("-c", "core.longpaths=true", "worktree", "add", "--detach", path, commit)
    gitdir = git("rev-parse", "--absolute-git-dir", cwd=path).stdout.strip()
    with open(os.path.join(gitdir, BASE), "w", encoding="utf-8") as fh:
        fh.write(commit + "\n")
    copied = []
    for rel_path in UNTRACKED:
        src, dst = os.path.join(MAIN, rel_path), os.path.join(path, rel_path)
        if not os.path.exists(src) or os.path.exists(dst):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        (shutil.copytree if os.path.isdir(src) else shutil.copy2)(src, dst)
        copied.append(rel_path)
    setup = {"run": "", "exit": 0}
    try:
        run = kit_config.load(path).command("worktreeSetup")
    except kit_config.KitConfigError as e:
        remove(batch)
        raise Refused(f"kit.config.json in the worktree: {e}")
    if run:
        env = dict(os.environ, CLAUDE_PROJECT_DIR=path)
        try:
            r = subprocess.run([shutil.which("bash") or "bash", "-c", run], cwd=path, env=env, capture_output=True,
                               text=True, errors="replace", timeout=SETUP_TIMEOUT)
            setup = {"run": run, "exit": r.returncode}
            last = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[-1:] or [""]
        except subprocess.TimeoutExpired:
            setup, last = {"run": run, "exit": 124}, [f"timeout after {SETUP_TIMEOUT} s"]
        if setup["exit"] != 0:
            remove(batch)
            raise Refused(f"commands.worktreeSetup exit {setup['exit']}: {last[0]}")
    return out({"path": path, "commit": commit, "copied": copied, "setup": setup})


def land(batch):
    path = path_of(batch)
    if not os.path.isdir(path):
        raise Refused(f"no worktree for {batch}: {path}")
    gitdir = git("rev-parse", "--absolute-git-dir", cwd=path).stdout.strip()
    try:
        with open(os.path.join(gitdir, BASE), encoding="utf-8") as fh:
            base = fh.read().strip()
    except OSError:
        raise Refused(f"{path} was not created by batch-worktree create")
    top = git("rev-parse", "HEAD", cwd=path).stdout.strip()
    if top == base:
        raise Refused(f"no batch commit in {path}")
    before = git("rev-parse", "HEAD").stdout.strip()
    if git("merge-base", "--is-ancestor", before, top, check=False).returncode != 0:
        r = git("rebase", "--onto", before, base, cwd=path, check=False)
        if r.returncode != 0:
            conflict = [p for p in git("diff", "--name-only", "--diff-filter=U", cwd=path, check=False).stdout.splitlines() if p]
            git("rebase", "--abort", cwd=path, check=False)
            return out({"landed": False, "conflict": conflict or ["rebase failed: " + ((r.stderr or r.stdout).strip().splitlines() or [""])[-1]]}, 1)
        top = git("rev-parse", "HEAD", cwd=path).stdout.strip()
    r = git("merge", "--ff-only", "-q", top, check=False)
    if r.returncode != 0:
        raise Refused(f"fast-forward of the checkout refused: {(r.stderr or r.stdout).strip()}")
    return out({"landed": True, "commit": git("rev-parse", "--short", "HEAD").stdout.strip(), "from": before})


def undo(batch, to):
    body = git("log", "-1", "--format=%B").stdout
    if not any(l.startswith("Kit-Batch: ") and l.rstrip().endswith(f"/{batch}") for l in body.splitlines()):
        raise Refused(f"HEAD is not the batch commit of {batch}")
    if git("merge-base", "--is-ancestor", to, "HEAD", check=False).returncode != 0:
        raise Refused(f"{to} is not an ancestor of HEAD")
    git("reset", "--keep", to)
    print(f"undone: HEAD {git('rev-parse', '--short', 'HEAD').stdout.strip()}")
    return 0


def prune():
    removed = []
    for line in git("worktree", "list", "--porcelain").stdout.splitlines():
        if line.startswith("worktree ") and os.path.basename(line[len("worktree "):].rstrip("/")).startswith(PREFIX):
            batch = os.path.basename(line[len("worktree "):].rstrip("/"))[len(PREFIX):]
            removed.append(remove(batch))
    git("worktree", "prune", check=False)
    print(f"removed: {len(removed)}" + "".join(f"\n  {p}" for p in removed))
    return 0


def main(argv):
    opts = {k: argv[argv.index(k) + 1] for k in ("--plan", "--sheet", "--to") if k in argv and argv.index(k) + 1 < len(argv)}
    words = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] not in opts)]
    cmd, batch = (words + ["", ""])[:2]
    try:
        if cmd == "prune" and len(words) == 1:
            return prune()
        if not batch.startswith("F") or not batch[1:].isdigit():
            print(__doc__.strip(), file=sys.stderr)
            return 2
        if cmd == "create" and "--plan" in opts and "--sheet" in opts:
            return create(batch, opts["--plan"], opts["--sheet"])
        if cmd == "land":
            return land(batch)
        if cmd == "undo" and "--to" in opts:
            return undo(batch, opts["--to"])
        if cmd == "remove":
            print(f"removed: {remove(batch)}")
            return 0
    except Refused as e:
        if cmd in ("create", "land"):
            return out({"landed": False, "refused": str(e)} if cmd == "land" else {"refused": str(e)}, 1)
        print(f"refused: {e}", file=sys.stderr)
        return 1
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
