#!/usr/bin/env python3
"""The knowledge base's index, rebuilt: `<root>/.index/` (git-ignored) and `INDEX.md`.

    cctoolkit knowledge-index           refreshes `.index/knowledge.jsonl` — only the files
                                        whose stamp changed are parsed again — and writes
                                        `INDEX.md` when it differs
    cctoolkit knowledge-index --check   writes nothing: exit 1 and `INDEX.md stale` when the
                                        committed `INDEX.md` is not what the base gives;
                                        `cctoolkit doctor` and the opt-in pre-commit run it

`cctoolkit knowledge-write apply` and `mark` run the same refresh; `cctoolkit ask`
refreshes `.index/` on its own and never writes `INDEX.md`. Run this after editing the
base by hand. Formats: `skills/knowledge-sync/references/knowledge-format.md`.

Exit 0, 1 stale (`--check`) or no base, 2 usage, 3 config defect.
"""
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402
import knowledge  # noqa: E402
import knowledge_index  # noqa: E402


def main(argv):
    if argv not in ([], ["--check"]):
        print("usage: cctoolkit knowledge-index [--check]", file=sys.stderr)
        return 2
    try:
        c = kit_config.load()
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 3
    if not os.path.isdir(knowledge.base_dir(c)):
        print(f"no knowledge base under {c.knowledge_root} — /cctoolkit:knowledge-sync builds it", file=sys.stderr)
        return 1
    rows, parsed, unchanged = knowledge_index.refresh(c, save=argv != ["--check"])
    if argv == ["--check"]:
        path = os.path.join(knowledge.base_dir(c), "INDEX.md")
        if knowledge.read(path) != knowledge_index.index_md(c, rows):
            print(f"INDEX.md stale — cctoolkit knowledge-index")
            return 1
        return 0
    written = knowledge_index.write_index_md(c, rows)
    print(f"indexed: {len(rows)} object(s) — {parsed} file(s) parsed, {unchanged} unchanged; "
          f"INDEX.md {'written' if written else 'unchanged'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
