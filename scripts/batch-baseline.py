#!/usr/bin/env python3
"""Snapshot of the working tree when a batch starts, so the batch diff excludes the
earlier uncommitted batches.

Nothing is committed between batches: `git diff` against HEAD carries every earlier
batch of the plan. The audit then judged a diff several batches wide, truncated, and
the GREEN `Cost` line flagged loops an earlier batch wrote. The snapshot copies every
file modified or untracked under the source and test roots (`kit.config.json`
`layout.sources.roots` and `layout.tests.roots`) at batch start; the batch diff of a
file compares it with that copy, or with HEAD when the file was clean at start.

    cctoolkit batch-baseline snapshot <dir>
        copies the dirty files under <dir>/files/ and lists them in <dir>/manifest.txt.
        Kept when <dir>/manifest.txt already exists: a resumed batch keeps the snapshot
        of its first start.
    cctoolkit batch-baseline diff <dir> [--code] [--name-only]
        unified diff of the tree against the snapshot, `a/` and `b/` prefixes as git.
        --code: `.md` and `*.verified.*` left out. --name-only: paths only.
    cctoolkit batch-baseline base <dir> <path>
        prints the content <path> had at batch start (empty for a file created since).
    cctoolkit batch-baseline restore <dir> [--save <patch>]
        sets a blocked batch aside: --save first writes the batch diff (every file) to
        <patch>, then every file under the source and test roots goes back to its
        batch-start content (snapshot copy, else HEAD through `git show`, never
        checkout/restore/stash), files created since are deleted, and the snapshot is
        removed: it is consumed.

--root DIR    repository the snapshot covers (default: the repo `kit_config.project_root()` resolves).

Exit 0, exit 2 on usage error, missing snapshot or unreadable kit.config.json.
"""
import difflib
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
for _lib in (HERE / "lib", HERE / ".claude" / "lib"):
    sys.path.insert(0, str(_lib))
import kit_config  # noqa: E402

ROOT = Path(kit_config.project_root()).resolve()
SCOPE: list[str] = []


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, cwd=ROOT).stdout


def dirty() -> list[str]:
    changed = git("diff", "--name-only", "HEAD", "--", *SCOPE).split("\n")
    untracked = git("ls-files", "--others", "--exclude-standard", "--", *SCOPE).split("\n")
    return sorted({p for p in changed + untracked if p})


def manifest(base: Path) -> set[str]:
    return {line for line in (base / "manifest.txt").read_text(encoding="utf-8").split("\n") if line}


def snapshot(base: Path) -> int:
    if (base / "manifest.txt").exists():
        print(f"snapshot kept: {base / 'manifest.txt'}")
        return 0
    paths = dirty()
    for p in paths:
        source = ROOT / p
        if source.is_file():
            target = base / "files" / p
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    base.mkdir(parents=True, exist_ok=True)
    (base / "manifest.txt").write_text("\n".join(paths) + "\n", encoding="utf-8")
    print(f"snapshot: {len(paths)} file(s) -> {base}")
    return 0


def at_start(base: Path, known: set[str], path: str) -> str:
    if path in known:
        copy = base / "files" / path
        return copy.read_text(encoding="utf-8", errors="replace") if copy.exists() else ""
    return subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True, cwd=ROOT).stdout


def now(path: str) -> str:
    current = ROOT / path
    return current.read_text(encoding="utf-8", errors="replace") if current.is_file() else ""


def head(path: str) -> bytes | None:
    shown = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, cwd=ROOT)
    return shown.stdout if shown.returncode == 0 else None


def restore(base: Path, patch: Path | None) -> int:
    known = manifest(base)
    if patch:
        patch.parent.mkdir(parents=True, exist_ok=True)
        with open(patch, "w", encoding="utf-8") as out:
            stdout, sys.stdout = sys.stdout, out
            try:
                diff(base, False, False)
            finally:
                sys.stdout = stdout
    restored = deleted = 0
    for path in sorted(known | set(dirty())):
        copy = base / "files" / path
        start = copy.read_bytes() if path in known and copy.is_file() else None if path in known else head(path)
        target = ROOT / path
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
    shutil.rmtree(base)
    print(f"restored: {restored} file(s), deleted: {deleted}{f', patch: {patch}' if patch else ''}")
    return 0


def prune(folder: Path) -> None:
    while len(folder.relative_to(ROOT).parts) > 1 and folder.is_dir() and not any(folder.iterdir()):
        folder.rmdir()
        folder = folder.parent


def code(path: str) -> bool:
    return not path.endswith(".md") and ".verified." not in path


def diff(base: Path, only_code: bool, names: bool) -> int:
    known = manifest(base)
    for path in sorted(known | set(dirty())):
        if only_code and not code(path):
            continue
        before, after = at_start(base, known, path), now(path)
        if before == after:
            continue
        if names:
            print(path)
            continue
        sys.stdout.writelines(difflib.unified_diff(
            before.splitlines(keepends=True), after.splitlines(keepends=True),
            fromfile=f"a/{path}" if before else "/dev/null", tofile=f"b/{path}" if after else "/dev/null", n=3,
        ))
        if after and not after.endswith("\n"):
            print()
    return 0


def main(argv: list[str]) -> int:
    global ROOT
    if "--root" in argv:
        i = argv.index("--root")
        ROOT = Path(argv[i + 1]).resolve()
        argv = argv[:i] + argv[i + 2:]
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        config = kit_config.load(str(ROOT))
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 2
    SCOPE[:] = list(dict.fromkeys(config.source_roots + config.test_roots))
    command, base = argv[0], Path(argv[1])
    if not base.is_absolute():
        base = ROOT / base
    if command == "snapshot":
        return snapshot(base)
    if not (base / "manifest.txt").exists():
        print(f"no snapshot under {base}", file=sys.stderr)
        return 2
    if command == "diff":
        return diff(base, "--code" in argv, "--name-only" in argv)
    if command == "restore":
        return restore(base, Path(argv[argv.index("--save") + 1]).resolve() if "--save" in argv else None)
    if command == "base" and len(argv) == 3:
        sys.stdout.write(at_start(base, manifest(base), argv[2]))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
