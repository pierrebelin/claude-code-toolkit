#!/usr/bin/env python3
"""The files of one batch against HEAD, those already modified at batch start left out.

    cctoolkit batch-baseline snapshot <work> FX
        records the preexisting files of FX (path and blob hash) in the work file; an
        existing snapshot is kept.
    cctoolkit batch-baseline diff <work> FX [--code] [--name-only]
        unified diff against HEAD of the batch files under the source and test roots.
        --code: `.md` and `*.verified.*` left out. --name-only: paths only.
    cctoolkit batch-baseline base <work> FX <path>
        prints the content <path> had at batch start (empty for a file the batch created).
    cctoolkit batch-baseline restore <work> FX [--save <patch>]
        --save writes the diff first, and the batch files as a commit on top of HEAD
        (created files included) under `refs/cctoolkit/aside/<plan folder>/FX` — no
        ref saved, the batch's `cycle`, `test-edit`, `closing` and `attempt` lines are
        dropped, its code being gone; then
        every batch file under the source and test roots goes back to HEAD and created
        files are deleted. A preexisting file the batch also modified is left as is and
        listed.
    cctoolkit batch-baseline resume <work> FX
        puts back the work `restore --save` kept under that ref, merged three-way with
        what HEAD changed since, then deletes the ref. Without a snapshot of FX one is
        taken first, before the files come back: they are the batch's, never preexisting.
        A file both sides changed that does not merge, or a batch file modified in the
        tree since: nothing is written, the batch's `cycle`, `test-edit`, `closing` and
        `attempt` lines are dropped (it starts over) and the ref deleted (the patch stays).
    cctoolkit batch-baseline commit <work> FX --sheet <sheet>
        commits the batch files only (`git commit --only`, run folder excluded). Message
        `<type>(<plan folder>): batch FX — <sheet title>`, type `refactor` when every cycle
        is a refactor, `fix` when the title starts with fix/corrig, else `feat`, then the
        trailer `Kit-Batch: <plan folder>/FX`. A preexisting file the batch also modified
        is committed whole and listed. The aside ref of FX, if any, is deleted.

    cctoolkit batch-baseline replay <work> FX [--base <rev>]
        a batch already delivered, for run-replay: its commits read off their trailer
        `Kit-Batch: <plan folder>/FX` (oldest first), `base` = the parent of the oldest,
        `head` = the newest, `files` = every file they touch; `--base <rev>`: the batch is
        `<rev>..HEAD` instead (a batch committed without the trailer). Recorded as the
        batch's `replay` line, an earlier one replaced. One JSON line `batch`, `base`,
        `head`, `commits`, `files` (under the source and test roots). Refused (exit 1, one
        JSON line `refused`) when FX has a snapshot — still open, or committed by hand — or
        no commit. With no snapshot of FX, `diff` and `base` read that line: the diff goes
        from `base` to `head`, the batch as delivered, whatever later batches changed.
    cctoolkit batch-baseline red <work> FX --root <worktree>
        in that worktree, the files the replay of FX touches under the source roots (the
        test roots left out) put back to their content at `base`, files it created
        deleted: the batch's tests left without its production code (run-replay `--red`).

--root DIR    repository the batch covers (default: `kit_config.project_root()`).

Exit 0, exit 2 on usage error, missing snapshot or replay, or unreadable kit.config.json,
exit 1 when git refuses the commit or the replay.
"""
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "lib"))
import kit_config  # noqa: E402
import work_file  # noqa: E402

ROOT = Path(kit_config.project_root()).resolve()
SCOPE: list[str] = []
TEST_ROOTS: list[str] = []
RUN_DIR = ""
# Frozen literal (docs/FROZEN-LITERALS.md): `message` writes it, `commits` reads it.
TRAILER = "Kit-Batch: "


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, cwd=ROOT).stdout


def dirty() -> list[str]:
    out = subprocess.run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
                         capture_output=True, cwd=ROOT).stdout.decode("utf-8", errors="replace")
    paths = set(kit_config.porcelain_paths(out))
    return sorted(p for p in paths if not (RUN_DIR and (p + "/").startswith(RUN_DIR)))


def hashes(paths: list[str]) -> dict[str, str]:
    present = [p for p in paths if (ROOT / p).is_file()]
    found = dict.fromkeys(paths, "")
    if present:
        out = subprocess.run(["git", "hash-object", "--no-filters", "--stdin-paths"], input="\n".join(present) + "\n",
                             capture_output=True, text=True, cwd=ROOT).stdout.split()
        found.update(zip(present, out))
    return found


def under(path: str, roots: list[str]) -> bool:
    return any(path == root or path.startswith(root.rstrip("/") + "/") for root in roots)


def in_scope(path: str) -> bool:
    return under(path, SCOPE)


def batch_files(work: Path, batch: str) -> tuple[list[str], list[str]]:
    """(files of the batch, preexisting files among them)."""
    before = work_file.preexisting(work_file.read(work), batch) or {}
    now = dirty()
    current = hashes([p for p in now if p in before])
    files = [p for p in now if p not in before or current.get(p) != before[p]]
    return files, [p for p in files if p in before]


def show(rev: str, path: str) -> bytes | None:
    shown = subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, cwd=ROOT)
    return shown.stdout if shown.returncode == 0 else None


def head(path: str) -> bytes | None:
    return show("HEAD", path)


def text(content: bytes | None) -> str:
    return content.decode("utf-8", errors="replace") if content else ""


def now(path: str) -> str:
    current = ROOT / path
    return current.read_text(encoding="utf-8", errors="replace") if current.is_file() else ""


def code(path: str) -> bool:
    return not path.endswith(".md") and ".verified." not in path


def write_diff(paths: list[str], only_code: bool, names: bool, out, before_of=None, after_of=None) -> None:
    before_of = before_of or (lambda p: text(head(p)))
    after_of = after_of or now
    for path in paths:
        if only_code and not code(path):
            continue
        before, after = before_of(path), after_of(path)
        if before == after:
            continue
        if names:
            out.write(path + "\n")
            continue
        out.writelines(difflib.unified_diff(
            before.splitlines(keepends=True), after.splitlines(keepends=True),
            fromfile=f"a/{path}" if before else "/dev/null", tofile=f"b/{path}" if after else "/dev/null", n=3,
        ))
        if after and not after.endswith("\n"):
            out.write("\n")


def snapshot(work: Path, batch: str, quiet: bool = False) -> int:
    if work_file.preexisting(work_file.read(work), batch) is not None:
        quiet or print(f"snapshot kept: {batch} in {work}")
        return 0
    files = hashes(dirty())
    work_file.append(work, {"kind": "preexisting", "batch": batch, "files": files})
    quiet or print(f"snapshot: {len(files)} preexisting file(s) -> {work}")
    return 0


def start_over(work: Path, batch: str) -> None:
    work_file.keep(work, lambda r: not (r.get("batch") == batch and r.get("kind") in work_file.START_OVER))


def save_ref(work: Path, batch: str, paths: list[str], patch: Path) -> str:
    """The batch files as a commit on HEAD, through a temporary index: the user's index is never touched."""
    with tempfile.TemporaryDirectory() as folder:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(folder) / "index")}

        def run(*args: str) -> subprocess.CompletedProcess:
            return subprocess.run(["git", *args], capture_output=True, text=True, cwd=ROOT, env=env)

        if run("read-tree", "HEAD").returncode or run("add", "-A", "--", *paths).returncode:
            return ""
        tree = run("write-tree").stdout.strip()
        tip = run("commit-tree", tree, "-p", "HEAD", "-m", f"aside {batch} — patch {patch.as_posix()}").stdout.strip()
    ref = work_file.aside_ref(work, batch)
    if not tip or subprocess.run(["git", "update-ref", ref, tip], capture_output=True, cwd=ROOT).returncode:
        return ""
    return ref


def merged(base: bytes | None, ours: bytes | None, theirs: bytes | None) -> tuple[bool, bytes | None]:
    """(merged cleanly, content — None for a deleted file) of one path, three-way."""
    if ours == base or ours == theirs:
        return True, theirs
    if theirs == base:
        return True, ours
    if None in (base, ours, theirs):
        return False, None
    with tempfile.TemporaryDirectory() as folder:
        files = [Path(folder) / name for name in ("ours", "base", "theirs")]
        for file, content in zip(files, (ours, base, theirs)):
            file.write_bytes(content)
        out = subprocess.run(["git", "merge-file", "-p", *map(str, files)], capture_output=True, cwd=ROOT)
    return out.returncode == 0, out.stdout if out.returncode == 0 else None


def resume(work: Path, batch: str) -> int:
    ref = work_file.aside_ref(work, batch)
    tip = git("rev-parse", "--verify", "-q", f"{ref}^{{commit}}").strip()
    if not tip:
        print("resume: nothing saved")
        return 0
    snapshot(work, batch, quiet=True)
    changed = [p for p in git("diff", "--name-only", "--no-renames", "-z", f"{tip}^", tip).split("\0") if p]
    now_dirty = set(dirty())
    plan, clash = {}, []
    for path in changed:
        theirs = show(tip, path)
        if path in now_dirty:
            current = (ROOT / path).read_bytes() if (ROOT / path).is_file() else None
            ok, content = current == theirs, theirs
        else:
            ok, content = merged(show(f"{tip}^", path), head(path), theirs)
        if ok:
            plan[path] = content
        else:
            clash.append(path)
    subprocess.run(["git", "update-ref", "-d", ref], capture_output=True, cwd=ROOT)
    if clash:
        start_over(work, batch)
        saved = git("log", "-1", "--format=%s", tip).strip().partition(" — patch ")[2]
        print(f"resume: conflict on {', '.join(clash)} — batch starts over, its saved cycles dropped"
              f"{f'; partial work: {saved}' if saved else ''}")
        return 0
    for path, content in plan.items():
        target = ROOT / path
        if content is None:
            if target.is_file():
                target.unlink()
                prune(target.parent)
        elif not target.is_file() or target.read_bytes() != content:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    print(f"resume: {len(plan)} file(s) reapplied from {ref}")
    return 0


def prune(folder: Path) -> None:
    while len(folder.relative_to(ROOT).parts) > 1 and folder.is_dir() and not any(folder.iterdir()):
        folder.rmdir()
        folder = folder.parent


def restore(work: Path, batch: str, patch: Path | None) -> int:
    files, kept = batch_files(work, batch)
    back = [p for p in files if in_scope(p) and p not in kept]
    if patch:
        patch.parent.mkdir(parents=True, exist_ok=True)
        with open(patch, "w", encoding="utf-8") as out:
            write_diff(back, False, False, out)
    ref = save_ref(work, batch, back, patch) if patch and back else ""
    if patch and not ref:
        start_over(work, batch)
    restored = deleted = 0
    for path in back:
        start, target = head(path), ROOT / path
        if start is None:
            if target.is_file():
                target.unlink()
                deleted += 1
                prune(target.parent)
            continue
        if not target.is_file() or target.read_bytes() != start:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(start)
            restored += 1
    left = [p for p in kept if in_scope(p)]
    print(f"restored: {restored} file(s), deleted: {deleted}"
          f"{f', left (modified before the batch): {', '.join(left)}' if left else ''}"
          f"{f', patch: {patch}' if patch else ''}"
          f"{f', ref: {ref}' if ref else ''}")
    return 0


def rev(name: str) -> str:
    return git("rev-parse", "--verify", "-q", f"{name}^{{commit}}").strip()


def commits(work: Path, batch: str) -> list[str]:
    """The commits carrying the batch's trailer as a whole line, oldest first (`--grep` alone takes F1 for F10)."""
    mark = f"{TRAILER}{work.parent.parent.name}/{batch}"
    out = git("log", "--format=%H%x00%B%x01", "--fixed-strings", f"--grep={mark}")
    found = []
    for entry in out.split("\x01"):
        sha, _, body = entry.lstrip("\n").partition("\x00")
        if sha and any(line.strip() == mark for line in body.splitlines()):
            found.append(sha)
    return found[::-1]


def refuse(why: str) -> int:
    print(json.dumps({"refused": why}, ensure_ascii=False))
    return 1


def replay(work: Path, batch: str, since: str | None) -> int:
    if work_file.preexisting(work_file.read(work), batch) is not None:
        return refuse(f"{batch} has a snapshot: a batch still open, or committed outside the kit — "
                      f"commit or set it aside first, or drop its `preexisting` line")
    if since:
        base, top = rev(since), rev("HEAD")
        if not base:
            return refuse(f"{since}: no such commit")
        shas = [x for x in git("rev-list", "--reverse", f"{base}..{top}").split() if x]
        files = [p for p in git("diff", "--name-only", "--no-renames", "-z", base, top).split("\0") if p]
    else:
        shas = commits(work, batch)
        if not shas:
            return refuse(f"no commit carries `{TRAILER}{work.parent.parent.name}/{batch}` — "
                          f"pass --base <rev> for a batch committed without it")
        base, top = rev(f"{shas[0]}^"), shas[-1]
        if not base:
            return refuse(f"{shas[0][:12]} has no parent")
        files = sorted({p for sha in shas
                        for p in git("diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", sha).split("\0") if p})
    if not shas:
        return refuse(f"{base[:12]}..HEAD holds no commit")
    files = [p for p in files if not (RUN_DIR and (p + "/").startswith(RUN_DIR))]
    work_file.keep(work, lambda r: not (r.get("kind") == "replay" and r.get("batch") == batch))
    work_file.append(work, {"kind": "replay", "batch": batch, "base": base, "head": top, "commits": shas, "files": files})
    print(json.dumps({"batch": batch, "base": base, "head": top, "commits": shas,
                      "files": [p for p in files if in_scope(p)]}, ensure_ascii=False))
    return 0


def red(record: dict) -> int:
    restored = deleted = 0
    for path in record.get("files", []):
        if not in_scope(path) or under(path, TEST_ROOTS):
            continue
        start, target = show(record["base"], path), ROOT / path
        if start is None:
            if target.is_file():
                target.unlink()
                deleted += 1
                prune(target.parent)
        elif not target.is_file() or target.read_bytes() != start:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(start)
            restored += 1
    print(f"red: {restored} production file(s) back to {record['base'][:12]}, {deleted} deleted, tests left as they are")
    return 0


def message(batch: str, sheet: Path) -> str:
    first = next((l for l in sheet.read_text(encoding="utf-8").splitlines() if l.startswith("# ")), f"# {batch}")
    title = re.sub(r"\s+—\s+✅ DONE.*$", "", first[2:]).strip()
    title = re.sub(rf"^.*?-{batch}\s+—\s+", "", title)
    index = subprocess.run([sys.executable, str(HERE / "scripts" / "sheet-cycles.py"), str(sheet), "--index", "--root", str(ROOT)],
                           capture_output=True, text=True, cwd=ROOT).stdout
    try:
        cycles = json.loads(index).get("cycles", [])
    except ValueError:
        cycles = []
    kind = ("refactor" if cycles and all(c.get("refactor") for c in cycles)
            else "fix" if re.match(r"(fix|corrig)", title, re.I) else "feat")
    plan = sheet.resolve().parent.name
    # Trailer is a frozen literal: knowledge-scan skips commits carrying it.
    return f"{kind}({plan}): batch {batch} — {title}\n\n{TRAILER}{plan}/{batch}"


def commit(work: Path, batch: str, sheet: Path) -> int:
    files, whole = batch_files(work, batch)
    if not files:
        print("nothing to commit")
        return 0
    added = subprocess.run(["git", "add", "-A", "--", *files], capture_output=True, text=True, cwd=ROOT)
    done = added.returncode == 0 and subprocess.run(
        ["git", "commit", "-q", "--only", "-m", message(batch, sheet), "--", *files],
        capture_output=True, text=True, cwd=ROOT)
    if not done or done.returncode != 0:
        print((done.stderr if done else added.stderr).strip() or "git refused the commit", file=sys.stderr)
        return 1
    subprocess.run(["git", "update-ref", "-d", work_file.aside_ref(work, batch)], capture_output=True, cwd=ROOT)
    print(f"committed {git('rev-parse', '--short', 'HEAD').strip()}: {len(files)} file(s)"
          f"{f', committed whole with changes made before the batch: {', '.join(whole)}' if whole else ''}")
    return 0


def main(argv: list[str]) -> int:
    global ROOT, RUN_DIR
    if "--root" in argv:
        i = argv.index("--root")
        ROOT = Path(argv[i + 1]).resolve()
        argv = argv[:i] + argv[i + 2:]
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        config = kit_config.load(str(ROOT))
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 2
    SCOPE[:] = list(dict.fromkeys(config.source_roots + config.test_roots))
    TEST_ROOTS[:] = config.test_roots
    command, work, batch = argv[0], Path(argv[1]), argv[2]
    work = (work if work.is_absolute() else Path.cwd() / work).resolve()
    try:
        RUN_DIR = work.parent.relative_to(ROOT).as_posix() + "/"
    except ValueError:
        RUN_DIR = ""
    if command == "snapshot":
        return snapshot(work, batch)
    if command == "resume":
        return resume(work, batch)
    if command == "replay":
        since = argv[argv.index("--base") + 1] if "--base" in argv and argv.index("--base") + 1 < len(argv) else None
        return replay(work, batch, since)
    records = work_file.read(work)
    replayed = work_file.replay(records, batch) if work_file.preexisting(records, batch) is None else None
    if command == "red":
        if replayed is None:
            print(f"no replay of {batch} in {work} — batch-baseline replay first", file=sys.stderr)
            return 2
        return red(replayed)
    if replayed is not None and command in ("diff", "base"):
        at = lambda sha: (lambda p: text(show(sha, p)))  # noqa: E731
        if command == "diff":
            write_diff([p for p in replayed.get("files", []) if in_scope(p)], "--code" in argv, "--name-only" in argv,
                       sys.stdout, at(replayed["base"]), at(replayed["head"]))
            return 0
        if len(argv) == 4:
            sys.stdout.write(at(replayed["base"])(argv[3]))
            return 0
    if work_file.preexisting(records, batch) is None:
        print(f"no snapshot of {batch} in {work}", file=sys.stderr)
        return 2
    if command == "diff":
        write_diff([p for p in batch_files(work, batch)[0] if in_scope(p)], "--code" in argv, "--name-only" in argv, sys.stdout)
        return 0
    if command == "restore":
        return restore(work, batch, Path(argv[argv.index("--save") + 1]).resolve() if "--save" in argv else None)
    if command == "base" and len(argv) == 4:
        sys.stdout.write(text(head(argv[3])))
        return 0
    if command == "commit" and "--sheet" in argv:
        return commit(work, batch, Path(argv[argv.index("--sheet") + 1]))
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
