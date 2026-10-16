#!/usr/bin/env python3
"""Next free id of the knowledge base — the only way an id is taken.

    cctoolkit next-id <Context|PREFIX> CU|RM|D [--count N]   # CAT-CU-03, CAT-RM-014, CAT-D-005
    cctoolkit next-id ADR [--count N]                        # ADR-008

Prints N consecutive ids, one per line. The next number is one above the largest
already used in any `.md` under `knowledge.root` (`HISTORY.md` included: the only
place a retired id survives) and under `todo/` (specs, plans and sheets not merged
yet: an id they hold is taken). An id is never given twice, so a gap stays a gap.
`--count`: a spec is written once, at the end — two calls before it would return
the same id.

The prefix comes from `knowledge.contexts` of `.claude/kit.config.json`; a context
or prefix absent from that table is refused (a typo would open a new series).
Format: `skills/knowledge-sync/references/knowledge-format.md`. Exit 2 on usage,
3 on a config defect.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
import kit_config  # noqa: E402
import knowledge  # noqa: E402

KINDS = {"CU": 2, "RM": 3, "D": 3}  # zero-padding width per kind
ADR_WIDTH = 3


def usage(msg=None):
    if msg:
        print(f"next-id: {msg}", file=sys.stderr)
    print("usage: cctoolkit next-id <Context|PREFIX> CU|RM|D [--count N]\n"
          "       cctoolkit next-id ADR [--count N]", file=sys.stderr)
    sys.exit(2)


def parse(argv):
    count, args = 1, []
    it = iter(argv)
    for a in it:
        if a == "--count":
            try:
                count = int(next(it))
            except (StopIteration, ValueError):
                usage("--count expects a number")
            if count < 1:
                usage("--count expects a number above 0")
        elif a.startswith("-"):
            usage(f"unknown option {a}")
        else:
            args.append(a)
    if args == ["ADR"]:
        return None, "ADR", count
    if len(args) != 2 or args[1] not in KINDS:
        usage()
    return args[0], args[1], count


def main(argv):
    name, kind, count = parse(argv)
    try:
        c = kit_config.load()
        raw = kit_config.raw_config(c.root).get("knowledge")
    except kit_config.KitConfigError as e:
        print(f"kit.config.json: {e} — cctoolkit doctor", file=sys.stderr)
        return 3
    fails = [f"{n}: {d}" for lvl, n, d in kit_config.validate_knowledge(c, raw) if lvl == "FAIL"]
    if fails:
        print("kit.config.json: " + "; ".join(fails) + " — cctoolkit doctor", file=sys.stderr)
        return 3
    if kind == "ADR":
        stem, width = "ADR", ADR_WIDTH
    else:
        prefix = c.prefix_of(name)
        if prefix is None:
            known = ", ".join(f"{k}={v}" for k, v in sorted(c.contexts.items()))
            known = known or 'empty, add {"<Context>": "<PREFIX>"} to .claude/kit.config.json'
            print(f"next-id: unknown context or prefix '{name}' — knowledge.contexts: {known}", file=sys.stderr)
            return 3
        stem, width = f"{prefix}-{kind}", KINDS[kind]
    top = knowledge.largest(c, stem)
    for n in range(top + 1, top + 1 + count):
        print(f"{stem}-{n:0{width}d}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
