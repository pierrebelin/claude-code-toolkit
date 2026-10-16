#!/usr/bin/env python3
"""The files of one batch: what it changed since it started, its diff, its commit, its undo.

Every batch is committed when it ends, so `HEAD` is the end of the previous batch and
`git diff HEAD` is the batch's own diff — except for the files the user had already
modified when the batch started. `snapshot` records those as a `preexisting` line of the
run work file (`run/.work.jsonl`, lib/work_file.py): path and blob hash only, computed
with `git hash-object` without `-w`, so no content is copied anywhere. A file of the batch
is then a file modified or untracked now, outside the run folder, that was either clean
at the start or has changed since.

    cctoolkit batch-baseline snapshot <work> FX
        records the preexisting files of FX. Kept when FX already has one: a resumed
        batch keeps the snapshot of its first start.
    cctoolkit batch-baseline diff <work> FX [--code] [--name-only]
        unified diff against HEAD of the batch files under the source and test roots,
        `a/` and `b/` prefixes as git. --code: `.md` and `*.verified.*` left out.
        --name-only: paths only.
    cctoolkit batch-baseline base <work> FX <path>
        prints the content <path> had at the batch start (HEAD; empty for a file the
        batch created).
    cctoolkit batch-baseline restore <work> FX [--save <patch>]
        sets a blocked batch aside: --save first writes the diff of the files it puts
        back, then every batch file under the source and test roots goes back to HEAD
        (`git show`, never checkout/restore/stash) and the files it created are deleted.
        A preexisting file the batch also modified is left as is and listed.
    cctoolkit batch-baseline commit <work> FX --sheet <sheet>
        commits the batch files (whole repo, run folder excluded) and nothing else, the
        index the user staged before left out (`git commit --only`). Message
        `<type>(<plan folder>): lot FX — <sheet title>`, type `refactor` when every cycle
        of the sheet is a refactor, `fix` when the title starts with fix/corrig, else
        `feat`, then the trailer `Kit-Batch: <plan folder>/FX`, which `knowledge-scan`
        reads to skip the commit. A preexisting file the batch also modified is committed whole and listed.
        The one commit the kit makes: `lib/guard-git.sh` still denies `git commit` typed
        in a Bash command.

--root DIR    repository the batch covers (default: the repo `kit_config.project_root()` resolves).

Exit 0, exit 2 on usage error, missing snapshot or unreadable kit.config.json, exit 1
when git refuses the commit.
"""
import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
for _lib in (HERE / "lib", HERE / ".claude" / "lib"):
    sys.path.insert(0, str(_lib))
import kit_config  # noqa: E402
import work_file  # noqa: E402

ROOT = Path(kit_config.project_root()).resolve()
SCOPE: list[str] = []
RUN_DIR = ""


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, cwd=ROOT).stdout


def dirty() -> list[str]:
    out = subprocess.run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
                         capture_output=True, cwd=ROOT).stdout.decode("utf-8", errors="replace")
    entries = out.split("\0")
    paths, i = set(), 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        paths.add(entry[3:])
        if entry[0] in "RC":
            paths.add(entries[i])
            i += 1
    return sorted(p for p in paths if not (RUN_DIR and (p + "/").startswith(RUN_DIR)))


def hashes(paths: list[str]) -> dict[str, str]:
    present = [p for p in paths if (ROOT / p).is_file()]
    found = dict.fromkeys(paths, "")
    if present:
        out = subprocess.run(["git", "hash-object", "--no-filters", "--stdin-paths"], input="\n".join(present) + "\n",
                             capture_output=True, text=True, cwd=ROOT).stdout.split()
        found.update(zip(present, out))
    return found


def in_scope(path: str) -> bool:
    return any(path == root or path.startswith(root.rstrip("/") + "/") for root in SCOPE)


def batch_files(work: Path, batch: str) -> tuple[list[str], list[str]]:
    """(files of the batch, preexisting files among them)."""
    before = work_file.preexisting(work_file.read(work), batch) or {}
    now = dirty()
    current = hashes([p for p in now if p in before])
    files = [p for p in now if p not in before or current.get(p) != before[p]]
    return files, [p for p in files if p in before]


def head(path: str) -> bytes | None:
    shown = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, cwd=ROOT)
    return shown.stdout if shown.returncode == 0 else None


def text(content: bytes | None) -> str:
    return content.decode("utf-8", errors="replace") if content else ""


def now(path: str) -> str:
    current = ROOT / path
    return current.read_text(encoding="utf-8", errors="replace") if current.is_file() else ""


def code(path: str) -> bool:
    return not path.endswith(".md") and ".verified." not in path


def write_diff(paths: list[str], only_code: bool, names: bool, out) -> None:
    for path in paths:
        if only_code and not code(path):
            continue
        before, after = text(head(path)), now(path)
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


def snapshot(work: Path, batch: str) -> int:
    if work_file.preexisting(work_file.read(work), batch) is not None:
        print(f"snapshot kept: {batch} in {work}")
        return 0
    files = hashes(dirty())
    work_file.append(work, {"kind": "preexisting", "batch": batch, "files": files})
    print(f"snapshot: {len(files)} preexisting file(s) -> {work}")
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
          f"{f', patch: {patch}' if patch else ''}")
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
    # The trailer marks the commit as covered by the knowledge base: `/knowledge-sync` skips it,
    # the merge at the end of the plan brings its change in (knowledge-format.md § HISTORY.md).
    return f"{kind}({plan}): lot {batch} — {title}\n\nKit-Batch: {plan}/{batch}"


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
    command, work, batch = argv[0], Path(argv[1]), argv[2]
    work = (work if work.is_absolute() else Path.cwd() / work).resolve()
    try:
        RUN_DIR = str(work.parent.relative_to(ROOT)) + "/"
    except ValueError:
        RUN_DIR = ""
    if command == "snapshot":
        return snapshot(work, batch)
    if work_file.preexisting(work_file.read(work), batch) is None:
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
