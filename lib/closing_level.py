#!/usr/bin/env python3
"""The closing level of a batch, `full` or `light`, decided on its files and its `## Cycles` block.

`full` as soon as one of these holds, each giving one reason:
  - the block forces it (`"closing": "full"` beside `cycles`);
  - a file matches a rule of `closing.full` in kit.config.json (authorisation, migration, public
    contract…) for a change kind the rule names (`A` added, `M` modified, `D` deleted) — never lifted;
  - more production files than `closing.maxProductionFiles` (0 in every preset: no cap) — lifted when
    the block asks for `"closing": "light"`.
`light` otherwise, a signature ripple included. Read by `scripts/sheet-cycles.py --index` (the files the
block plans) and `scripts/closing-level.py` (the files the batch diff holds); run-lot reads the result.
"""
import os
import re

FORCED = "full"
# Asked by the sheet: lifts the production cap, never a rule of `closing.full`.
ASKED_LIGHT = "light"


def production(cfg, path):
    """A code file under the source roots, outside the test roots (they can nest: vertical slices)."""
    if not cfg.under(path, cfg.source_roots) or cfg.under(path, cfg.test_roots):
        return False
    return path.endswith(tuple(cfg.source_ext)) if cfg.source_ext else not path.endswith(".md")


def _shown(paths, n=3):
    return ", ".join(f"`{p}`" for p in paths[:n]) + (f" and {len(paths) - n} more" if len(paths) > n else "")


def decide(cfg, files, forced=""):
    """files = [(repo-relative path, change kind A|M|D)].
    -> {"level": "full"|"light", "reasons": [...], "production": n}."""
    rules = cfg.closing
    reasons = []
    if forced == FORCED:
        reasons.append("sheet: `closing` set to full")
    for rule in rules.get("full", []):
        rx = re.compile(rule["path"])
        scope_all = rule.get("scope") == "all"
        hit = sorted(p for p, change in files
                     if change in rule.get("changes", "AMD") and rx.search(p) and (scope_all or production(cfg, p)))
        if hit:
            reasons.append(f"{rule['name']}: {_shown(hit)}")
    prod = sorted({p for p, _ in files if production(cfg, p)})
    if forced == ASKED_LIGHT:
        if not reasons:
            return {"level": "light", "reasons": ["sheet: `closing` set to light (production cap lifted)"],
                    "production": len(prod)}
        reasons.append("sheet: `closing` set to light, refused — a rule above is never lifted")
        return {"level": "full", "reasons": reasons, "production": len(prod)}
    limit = rules.get("maxProductionFiles", 0)
    if limit and len(prod) > limit:
        reasons.append(f"{len(prod)} production files, more than {limit}")
    return {"level": "full" if reasons else "light", "reasons": reasons, "production": len(prod)}


def planned_files(cfg, cycles, path_of):
    """The files the block plans, each `A` when the cycle creates it or it is absent, `M` otherwise."""
    out = {}
    for c in cycles:
        if not isinstance(c, dict):
            continue
        created = {path_of(p) for p in c.get("toCreate", [])}
        for key in ("toCreate", "production", "ripple", "full"):
            for entry in c.get(key, []):
                p = path_of(entry)
                if not p or out.get(p) == "A":
                    continue
                absent = p in created or not os.path.exists(os.path.join(cfg.root, p))
                out[p] = "A" if absent else out.get(p, "M")
    return sorted(out.items())
