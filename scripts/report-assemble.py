#!/usr/bin/env python3
"""Assembles `docs/metrics/quality-report-YYYY-MM-DD.json` from the fragments the audit wrote.

Each agent of the `run-audit` workflow writes its own block into a fragment file;
none copies another's figures. This merges them, so no number passes through a
model twice:

    cctoolkit report-assemble --out <report.json> <source>... [--last <file>]

- `<source>` = `<file>` (merged at the root) or `<key.path>=<file>` (placed at that key).
  Objects merge recursively, a later source wins; a `null` replaces a block.
- `--last <file>`: merged after every source — the workflow's metadata and the `null`
  of each block whose evidence is not `measured`, which win over any fragment.
- `tests.total` is recomputed from the per-type entries (passed, failed, skipped,
  duration_seconds): a sum is never copied.
- The first-level keys are frozen (`docs/FROZEN-LITERALS.md`): a
  fragment adding another one is refused, exit 1, nothing written.

Exit 0 written, 1 refused, 2 bad arguments or unreadable fragment.
"""
import json
import os
import sys

FIRST_LEVEL = ("schema_version", "metadata", "tests", "coverage", "api_endpoints", "pages", "stryker",
               "sonarqube", "lint", "build", "codebase", "activity")
SUMMED = ("passed", "failed", "skipped", "duration_seconds")


def merge(base, over):
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = merge(base.get(k), v) if k in base else v
        return out
    return over


def placed(key, value):
    for part in reversed(key.split(".")):
        value = {part: value}
    return value


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def totals(tests):
    types = [v for k, v in tests.items() if k != "total" and isinstance(v, dict)]
    total = {}
    for field in SUMMED:
        values = [t.get(field) for t in types if isinstance(t.get(field), (int, float))]
        total[field] = sum(values) if values else None
    tests["total"] = total


def main(argv):
    if "--out" not in argv or argv.index("--out") + 1 >= len(argv):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    i = argv.index("--out")
    out = argv[i + 1]
    rest = argv[:i] + argv[i + 2:]
    last = None
    if "--last" in rest:
        j = rest.index("--last")
        last = rest[j + 1] if j + 1 < len(rest) else None
        rest = rest[:j] + rest[j + 2:]
        if last is None:
            print("report-assemble: --last needs a file", file=sys.stderr)
            return 2
    report = {}
    for source in rest + ([last] if last else []):
        key, _, path = source.rpartition("=") if "=" in source else ("", "", source)
        try:
            fragment = load(path)
        except (OSError, ValueError) as e:
            print(f"report-assemble: {path}: {e}", file=sys.stderr)
            return 2
        report = merge(report, placed(key, fragment) if key else fragment)
    unknown = [k for k in report if k not in FIRST_LEVEL]
    if unknown:
        print(f"report-assemble: refused — first-level key(s) outside the schema: {', '.join(unknown)}", file=sys.stderr)
        return 1
    if isinstance(report.get("tests"), dict):
        totals(report["tests"])
    ordered = {k: report[k] for k in FIRST_LEVEL if k in report}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(ordered, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"written: {out} ({len(rest) + (1 if last else 0)} fragments)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
