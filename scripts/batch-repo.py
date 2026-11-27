#!/usr/bin/env python3
"""A batch of a plan run in another repository than the checkout's — run-plan, a `Repo` column naming it.

    cctoolkit batch-repo branch --repo <dir> [--check]
        <dir> put on the branch named after the checkout's: checked out when it exists, else created from
        <dir>'s HEAD, kept when <dir> is on it already; left there after the run. Refused (exit 1) when the
        checkout is on a detached HEAD or a default branch (`git.defaultBranches` of the checkout's
        kit.config.json, `main`, `master`, `develop` by default, and the `origin/HEAD` of either repository): a
        batch is never committed on one. Refused too when <dir>'s local changes block the switch (git's own
        refusal): the batch is set aside. `--check` switches nothing. One JSON line `branch`, `switched`
        (`kept` | `checked out` | `created`), or `refused`.
    cctoolkit batch-repo carry FX --repo <dir> --plan <plan>
        <dir> put on the checkout's branch first (`branch`), then the plan's folder copied into <dir> at the path it has in the checkout (`run/` included: earlier
        batch reports, read by `plan-next-batch --context`), git-ignored there through
        `<dir>/.git/info/exclude`; its top-level `.md` files kept as the base `back` merges against
        (`<dir>/.git/cctoolkit-carry/FX/`); <dir> registered in `<checkout>/.git/cctoolkit-linked-repos`:
        the hooks follow an agent working there as in a batch worktree (`kit_config.worktree_of`).
        One JSON line `repo`, `plan` (the copy of the plan), `folder`, `branch`, `switched`. Refused (exit 1,
        one JSON line `refused`) when <dir> is not the top level of a git repository, is the checkout, has no
        `.claude/kit.config.json` (`/cctoolkit:kit-init` there first), cannot take the branch (`branch`), or
        tracks files under that path.
    cctoolkit batch-repo back FX --repo <dir>
        the copy's top-level `.md` files (plan heading, sheet) brought back into the checkout: taken as they
        are when the checkout's file did not move since `carry`, else merged three ways (`git merge-file`,
        another batch wrote the same plan meanwhile); a conflict leaves the checkout's file as it is and
        keeps the copy as `<plan folder>/run/FX-carried-<name>`. Then the copy, its base, its exclude line
        and the registration removed. One JSON line `back`, `merged`, `conflict`, `kept`.
    cctoolkit batch-repo prune
        `back` for every carry a stopped run left in a registered repository, then the registry removed.

The checkout is the main worktree of `kit_config.project_root()`. Exit 0, 1 refused, 2 usage.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402

MAIN = os.path.realpath(kit_config._native(kit_config.main_worktree(kit_config.project_root())))
REGISTRY = os.path.join(MAIN, ".git", kit_config.LINKED_REPOS)
CARRY = "cctoolkit-carry"
STATE = "carry.json"


class Refused(Exception):
    pass


def slashed(p):
    return str(p).replace(os.sep, "/")


def out(record, code=0):
    print(json.dumps(record, ensure_ascii=False))
    return code


def toplevel(path):
    r = subprocess.run(["git", "-C", path, "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return os.path.realpath(kit_config._native(r.stdout.strip())) if r.returncode == 0 else None


def resolved(path):
    """Absolute, links and Windows short names (`PBELIN~1`) resolved: two spellings of one folder compare equal."""
    return os.path.realpath(os.path.abspath(kit_config._native(str(path))))


def registered():
    return kit_config.linked_repos(MAIN)


def register(repo):
    if any(kit_config._same(repo, resolved(r)) for r in registered()):
        return
    with open(REGISTRY, "a", encoding="utf-8") as fh:
        fh.write(slashed(repo) + "\n")


def unregister(repo):
    left = [r for r in registered() if not kit_config._same(repo, resolved(r))]
    if left:
        with open(REGISTRY, "w", encoding="utf-8") as fh:
            fh.write("".join(slashed(r) + "\n" for r in left))
    elif os.path.exists(REGISTRY):
        os.remove(REGISTRY)


def exclude_path(repo):
    return os.path.join(repo, ".git", "info", "exclude")


def set_exclude(repo, line, present):
    path = exclude_path(repo)
    lines = open(path, encoding="utf-8").read().splitlines() if os.path.isfile(path) else []
    if present == (line in lines):
        return
    lines = lines + [line] if present else [x for x in lines if x != line]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("".join(x + "\n" for x in lines))


def head_branch(repo):
    r = subprocess.run(["git", "-C", repo, "symbolic-ref", "--short", "-q", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def origin_head(repo):
    r = subprocess.run(["git", "-C", repo, "symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"],
                       capture_output=True, text=True)
    return r.stdout.strip().split("/", 1)[-1] if r.returncode == 0 and r.stdout.strip() else ""


def branch(repo, check=False):
    """Put <repo> on the branch named after the checkout's: (branch, how)."""
    name = head_branch(MAIN)
    if not name:
        raise Refused("the checkout is on a detached HEAD: a batch of another repository is committed on a branch "
                      "named after the checkout's — put the checkout on a feature branch first")
    try:
        defaults = kit_config.load(MAIN).default_branches
    except kit_config.KitConfigError:
        defaults = list(kit_config.GIT_DEFAULT_BRANCHES)
    if name in defaults or name in (origin_head(MAIN), origin_head(repo)):
        raise Refused(f"the checkout is on {name}, a default branch: a batch of another repository is never "
                      f"committed on one — put the checkout on a feature branch first (git.defaultBranches)")
    if head_branch(repo) == name:
        return name, "kept"
    exists = subprocess.run(["git", "-C", repo, "show-ref", "--verify", "-q", f"refs/heads/{name}"]).returncode == 0
    if check:
        return name, "checked out" if exists else "created"
    switch = ["checkout", "-q", name, "--"] if exists else ["checkout", "-q", "-b", name]
    r = subprocess.run(["git", "-C", repo, *switch], capture_output=True, text=True)
    if r.returncode != 0:
        why = next((l.strip() for l in (r.stderr or r.stdout).splitlines() if l.strip()), "git refused")
        raise Refused(f"{slashed(repo)} cannot switch to {name}: {why} — its local changes block it, the batch is set aside")
    return name, "checked out" if exists else "created"


def tops(folder):
    return sorted(f for f in os.listdir(folder) if f.endswith(".md") and os.path.isfile(os.path.join(folder, f)))


def read(path):
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except OSError:
        return None


def carry(batch, repo, plan):
    repo = resolved(repo)
    top = toplevel(repo)
    if not top or not kit_config._same(top, repo):
        raise Refused(f"{slashed(repo)} is not the top level of a git repository")
    if kit_config._same(repo, MAIN):
        raise Refused(f"{slashed(repo)} is the checkout itself: its batches run there")
    if not os.path.isfile(os.path.join(repo, ".claude", "kit.config.json")):
        raise Refused(f"no .claude/kit.config.json in {slashed(repo)}: run /cctoolkit:kit-init there first")
    name, how = branch(repo)
    folder = os.path.dirname(resolved(plan))
    rel = slashed(os.path.relpath(folder, MAIN))
    if rel.startswith("../"):
        raise Refused(f"plan {slashed(plan)} is not under the checkout {slashed(MAIN)}")
    tracked = subprocess.run(["git", "-C", repo, "ls-files", "--", rel], capture_output=True, text=True).stdout.split()
    if tracked:
        raise Refused(f"{slashed(repo)} tracks files under {rel}: the copy would overwrite them")
    dst = os.path.join(repo, rel)
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(folder, dst)
    base = os.path.join(repo, ".git", CARRY, batch)
    if os.path.isdir(base):
        shutil.rmtree(base)
    os.makedirs(base)
    for name in tops(folder):
        shutil.copy2(os.path.join(folder, name), os.path.join(base, name))
    with open(os.path.join(base, STATE), "w", encoding="utf-8") as fh:
        json.dump({"folder": slashed(folder), "rel": rel}, fh)
    set_exclude(repo, f"/{rel}/", True)
    register(repo)
    return {"repo": slashed(repo), "plan": slashed(os.path.join(dst, os.path.basename(plan))), "folder": slashed(dst),
            "branch": name, "switched": how}


def back(batch, repo):
    repo = resolved(repo)
    base = os.path.join(repo, ".git", CARRY, batch)
    try:
        with open(os.path.join(base, STATE), encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        raise Refused(f"no carry of {batch} in {slashed(repo)}")
    folder, rel = kit_config._native(state["folder"]), state["rel"]
    dst = os.path.join(repo, rel)
    done = {"back": [], "merged": [], "conflict": [], "kept": []}
    for name in tops(dst) if os.path.isdir(dst) else []:
        theirs, mine, was = read(os.path.join(dst, name)), read(os.path.join(folder, name)), read(os.path.join(base, name))
        target = os.path.join(folder, name)
        if theirs == was or theirs == mine:
            continue
        if mine == was or mine is None:
            with open(target, "wb") as fh:
                fh.write(theirs)
            done["back"].append(name)
            continue
        merged = subprocess.run(["git", "merge-file", "-p", "--", target, os.path.join(base, name), os.path.join(dst, name)],
                                capture_output=True)
        if merged.returncode == 0:
            with open(target, "wb") as fh:
                fh.write(merged.stdout)
            done["merged"].append(name)
        else:
            keep = os.path.join(folder, "run", f"{batch}-carried-{name}")
            os.makedirs(os.path.dirname(keep), exist_ok=True)
            with open(keep, "wb") as fh:
                fh.write(theirs)
            done["conflict"].append(name)
            done["kept"].append(slashed(keep))
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    parent = os.path.dirname(dst)
    while not kit_config._same(parent, repo) and os.path.isdir(parent) and not os.listdir(parent):
        os.rmdir(parent)
        parent = os.path.dirname(parent)
    shutil.rmtree(base)
    if not os.listdir(os.path.dirname(base)):
        os.rmdir(os.path.dirname(base))
    set_exclude(repo, f"/{rel}/", False)
    if not os.path.isdir(os.path.join(repo, ".git", CARRY)):
        unregister(repo)
    return done


def prune():
    done = []
    for repo in registered():
        root = os.path.join(repo, ".git", CARRY)
        for batch in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            try:
                done.append({"repo": slashed(repo), "batch": batch, **back(batch, repo)})
            except Refused as e:
                done.append({"repo": slashed(repo), "batch": batch, "refused": str(e)})
        unregister(repo)
    return {"pruned": done}


def main(argv):
    opts = {k: argv[argv.index(k) + 1] for k in ("--repo", "--plan") if k in argv and argv.index(k) + 1 < len(argv)}
    cmd = argv[1] if len(argv) > 1 else ""
    batch = argv[2] if len(argv) > 2 and not argv[2].startswith("--") else ""
    try:
        if cmd == "carry" and batch and "--repo" in opts and "--plan" in opts:
            return out(carry(batch, opts["--repo"], opts["--plan"]))
        if cmd == "back" and batch and "--repo" in opts:
            return out(back(batch, opts["--repo"]))
        if cmd == "prune":
            return out(prune())
        if cmd == "branch" and "--repo" in opts:
            repo = resolved(opts["--repo"])
            top = toplevel(repo)
            if not top or not kit_config._same(top, repo):
                raise Refused(f"{slashed(repo)} is not the top level of a git repository")
            name, how = branch(repo, "--check" in argv)
            return out({"branch": name, "switched": how})
    except Refused as e:
        return out({"refused": str(e)}, 1)
    except (OSError, subprocess.SubprocessError) as e:
        return out({"refused": f"{type(e).__name__}: {e}"}, 1)
    print(__doc__.split("\n\n")[1], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
