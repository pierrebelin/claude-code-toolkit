#!/usr/bin/env python3
"""Migration: removes a manual copy of the kit, keeps what the repo added to it.

A copy made before the plugin sits in `.claude/{hooks,lib,skills,agents,tools,presets,evals}`,
`.claude/scripts/` (a copy that moved the kit's scripts there) or `scripts/`, and the
mods' former marketplace in `.claude/mods/`. The repo grew its own files beside the
kit's in those folders (a skill, a script, an eval case): deleting the folders whole
deletes them too. A file is the kit's when the kit ships the same path; the rest is
the repo's.

    cctoolkit remove-copy           # report (dry run)
    cctoolkit remove-copy --apply   # deletes the DELETE lines, then the folders left empty

Report lines:
    DELETE  <path>   the kit ships it — the plugin replaces it
    KEEP    <path>   the repo's own (a skill or script the kit does not ship): stays
    MOVE    <path>   the repo's, inside a kit skill folder the plugin never reads: read by
                     a repo skill → move it there; read by the copy's own version of a kit
                     file → a local extension of the kit, port both to the toolkit
                     (`kit-diff` shows that file DRIFT) before deleting; read by nothing → drop
    ORPHAN  <path>   the repo's eval case, whose runner `evals/run.sh` is deleted

`--apply` never touches KEEP, MOVE or ORPHAN, nor the settings files: their `hooks`
key and the mods' marketplace entries are /cctoolkit:kit-init's (Edit tool). It
deletes files, never stages: `git status` shows the deletions, the user commits.
"""
import os
import shutil
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(KIT, "lib"))
try:
    from kit_config import project_root
except ImportError:
    sys.exit("kit_config.py not found beside scripts/ — reinstall the cctoolkit plugin")

FOLDERS = ("hooks", "lib", "skills", "agents", "tools", "presets", "evals")
GENERATED_DIRS = {"__pycache__"}
SKIP_DIRS = {"node_modules", ".fixtures"}


def files_under(base):
    out = []
    for b, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            out.append(os.path.relpath(os.path.join(b, f), base))
    return sorted(out)


def generated(rel):
    return rel.endswith(".pyc") or any(p in GENERATED_DIRS for p in rel.split(os.sep)) or rel.endswith(".DS_Store")


def main(argv):
    apply = "--apply" in argv[1:]
    unknown = [a for a in argv[1:] if a != "--apply"]
    if unknown:
        print("usage: cctoolkit remove-copy [--apply]", file=sys.stderr)
        return 2
    root = project_root()
    cl = os.path.join(root, ".claude")
    if os.path.realpath(root) == os.path.realpath(KIT):
        print("remove-copy: run it from the repo, not from the toolkit checkout", file=sys.stderr)
        return 2

    # (kit-relative path, repo path) of every place a copy lands.
    homes = [(d, os.path.join(cl, d)) for d in FOLDERS if os.path.isdir(os.path.join(cl, d))]
    if os.path.isfile(os.path.join(cl, "scripts", "pre-audit.sh")):
        homes.append(("scripts", os.path.join(cl, "scripts")))
    root_scripts = os.path.isfile(os.path.join(root, "scripts", "pre-audit.sh"))

    delete, keep, move, orphan = [], [], [], []
    for kit_rel, home in homes:
        for rel in files_under(home):
            path = os.path.join(home, rel)
            if generated(rel) or os.path.isfile(os.path.join(KIT, kit_rel, rel)):
                delete.append(path)
                continue
            parts = rel.split(os.sep)
            if kit_rel == "skills" and len(parts) > 1 and os.path.isdir(os.path.join(KIT, "skills", parts[0])):
                move.append(path)
            elif kit_rel == "evals" and parts[0] == "cases":
                orphan.append(path)
            else:
                keep.append(path)
    # scripts/ at the root holds the repo's own tooling too: only the kit's names go.
    if root_scripts:
        for rel in files_under(os.path.join(root, "scripts")):
            if os.path.isfile(os.path.join(KIT, "scripts", rel)) or (generated(rel) and os.sep in rel):
                delete.append(os.path.join(root, "scripts", rel))
    mods = os.path.join(cl, "mods")
    mods_market = os.path.isfile(os.path.join(mods, ".claude-plugin", "marketplace.json"))

    # Who reads a MOVE file: any file of the copy naming it.
    readers = {}
    for path in move:
        name = os.path.basename(path)
        hits = []
        for other in keep + move + delete:
            if other == path:
                continue
            try:
                with open(other, encoding="utf-8", errors="ignore") as fh:
                    if name in fh.read():
                        hits.append(os.path.relpath(other, root))
            except OSError:
                pass
        readers[path] = hits

    rel = lambda p: os.path.relpath(p, root)
    for p in delete:
        print(f"DELETE  {rel(p)}")
    if mods_market:
        print(f"DELETE  {rel(mods)}/  (the mods' former marketplace, {len(files_under(mods))} files)")
    for p in keep:
        print(f"KEEP    {rel(p)}")
    for p in move:
        own = [r for r in readers[p] if os.path.join(root, r) not in delete]
        kit = [r for r in readers[p] if os.path.join(root, r) in delete]
        why = (f"read by {', '.join(own)}: move it there" if own else
               f"read by the copy's {', '.join(kit)}: a local extension of the kit, port it to the toolkit" if kit else
               "read by nothing: drop it")
        print(f"MOVE    {rel(p)}  — {why}")
    for p in orphan:
        print(f"ORPHAN  {rel(p)}  — eval case of the repo; evals/run.sh goes with the copy")
    summary = f"delete {len(delete)}{' + mods/' if mods_market else ''} · keep {len(keep)} · move {len(move)} · orphan {len(orphan)}"
    if not apply:
        print(f"{summary} — dry run, `cctoolkit remove-copy --apply` deletes")
        return 0

    for p in delete:
        os.remove(p)
    if mods_market:
        shutil.rmtree(mods)
    emptied = 0
    for _, home in homes + ([("scripts", os.path.join(root, "scripts"))] if root_scripts else []):
        for b, dirs, files in os.walk(home, topdown=False):
            if not os.listdir(b):
                os.rmdir(b)
                emptied += 1
    print(f"{summary} — deleted, {emptied} empty folder(s) removed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
