#!/usr/bin/env python3
"""Danger Zone × coverage × mutation survivors, per file — the head table of §7 Risk zones.

    cctoolkit risk-cross --hotspots <collect.json | hotspots.json>
                         [--coverage <file>] [--coverage-status missing|not_configured --coverage-reason <why>]
                         [--stryker <mutation-report.json>]... [--stryker-dir <dir>] [--stryker-status skipped|not_configured|missing --stryker-reason <why>]
                         [--commit <sha>]

`--coverage`: SonarQube generic XML, Cobertura XML or lcov, sniffed from the content.
`--stryker`: mutation-testing-elements reports, merged; `--stryker-dir`: every `*.json` in it.
Paths are matched on the repo-relative path, longest suffix first. A side not given stays
`null` with its status, never 0. Prints the `codebase.hotspot_risk` JSON object. Exit 0; 2 on bad input.
"""
import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

KILLED = {"Killed", "Timeout"}
SURVIVED = {"Survived"}
NO_COVERAGE = {"NoCoverage"}


def load_hotspots(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return (data.get("activity") or {}).get("hotspots") or data


def norm(path):
    return path.replace("\\", "/")


def matcher(paths):
    """repo-relative path → the key of `paths` whose end is `/<path>` (or equal), else None."""
    keys = [norm(p) for p in paths]

    def find(rel):
        hits = [k for k in keys if k == rel or k.endswith("/" + rel)]
        return min(hits, key=len) if hits else None
    return find


def coverage_of(path):
    """{path: {lines_covered, lines_total, branches_covered, branches_total}} and the format."""
    with open(path, encoding="utf-8", errors="replace") as f:
        head = f.read(4096)
    if head.lstrip().startswith("<"):
        root = ET.parse(path).getroot()
        if root.tag == "coverage" and root.find("file") is not None:
            return sonar_generic(root), "sonarqube-generic"
        return cobertura(root), "cobertura"
    return lcov(path), "lcov"


def blank():
    return {"lines_covered": 0, "lines_total": 0, "branches_covered": 0, "branches_total": 0}


def sonar_generic(root):
    out = {}
    for f in root.iter("file"):
        e = out.setdefault(norm(f.get("path")), blank())
        for line in f.iter("lineToCover"):
            e["lines_total"] += 1
            e["lines_covered"] += line.get("covered") == "true"
            if line.get("branchesToCover"):
                e["branches_total"] += int(line.get("branchesToCover"))
                e["branches_covered"] += int(line.get("coveredBranches") or 0)
    return out


def cobertura(root):
    out = {}
    for cls in root.iter("class"):
        e = out.setdefault(norm(cls.get("filename") or ""), {"_lines": {}, **blank()})
        for line in cls.iter("line"):
            n, hit = line.get("number"), int(line.get("hits") or 0) > 0
            e["_lines"][n] = e["_lines"].get(n, False) or hit
            m = re.search(r"\((\d+)/(\d+)\)", line.get("condition-coverage") or "")
            if line.get("branch") == "true" and m:
                e["branches_covered"] += int(m.group(1))
                e["branches_total"] += int(m.group(2))
    for e in out.values():
        lines = e.pop("_lines")
        e["lines_total"], e["lines_covered"] = len(lines), sum(lines.values())
    return out


def lcov(path):
    out, current = {}, None
    with open(path, encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.strip()
            if line.startswith("SF:"):
                current = out.setdefault(norm(line[3:]), blank())
            elif current is None:
                continue
            elif line.startswith("LF:"):
                current["lines_total"] += int(line[3:])
            elif line.startswith("LH:"):
                current["lines_covered"] += int(line[3:])
            elif line.startswith("BRF:"):
                current["branches_total"] += int(line[4:])
            elif line.startswith("BRH:"):
                current["branches_covered"] += int(line[4:])
            elif line == "end_of_record":
                current = None
    return out


def mutants_of(paths):
    out = {}
    for path in paths:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for name, entry in (data.get("files") or {}).items():
            e = out.setdefault(norm(name), {"mutants": 0, "killed": 0, "survived": 0, "no_coverage": 0})
            for m in entry.get("mutants", []):
                status = m.get("status")
                if status in ("Ignored", "CompileError", "RuntimeError", "Pending"):
                    continue
                e["mutants"] += 1
                e["killed"] += status in KILLED
                e["survived"] += status in SURVIVED
                e["no_coverage"] += status in NO_COVERAGE
    return out


def pct(part, whole):
    return round(part / whole * 100, 1) if whole else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--hotspots", required=True)
    ap.add_argument("--coverage")
    ap.add_argument("--coverage-status", choices=("missing", "not_configured"))
    ap.add_argument("--coverage-reason")
    ap.add_argument("--stryker", action="append", default=[])
    ap.add_argument("--stryker-dir")
    ap.add_argument("--stryker-status", choices=("skipped", "not_configured", "missing"))
    ap.add_argument("--stryker-reason")
    ap.add_argument("--commit")
    args = ap.parse_args()
    if args.stryker_dir:
        args.stryker += sorted(os.path.join(args.stryker_dir, f) for f in os.listdir(args.stryker_dir) if f.endswith(".json"))

    try:
        hot = load_hotspots(args.hotspots)
    except (OSError, ValueError) as e:
        print(f"risk-cross: --hotspots unreadable: {e}", file=sys.stderr)
        return 2
    commit = args.commit or hot.get("commit")
    if hot.get("status") != "measured":
        print(json.dumps({"status": "missing", "reason": f"hotspots {hot.get('status')}: {hot.get('reason')}",
                          "commit": None, "coverage": None, "stryker": None, "rows": None}, indent=2))
        return 0

    cov, cov_side = None, {"status": args.coverage_status or "missing", "reason": args.coverage_reason or "no coverage file given", "format": None}
    if args.coverage and not args.coverage_status:
        try:
            cov, fmt = coverage_of(args.coverage)
            cov_side = {"status": "measured", "reason": None, "format": fmt}
        except (OSError, ET.ParseError, ValueError) as e:
            cov_side = {"status": "missing", "reason": f"coverage file unreadable: {e}", "format": None}

    mut, mut_side = None, {"status": args.stryker_status or "missing", "reason": args.stryker_reason or "no mutation report given"}
    if args.stryker and not args.stryker_status:
        try:
            mut = mutants_of(args.stryker)
            mut_side = {"status": "measured", "reason": None}
        except (OSError, ValueError) as e:
            mut_side = {"status": "missing", "reason": f"mutation report unreadable: {e}"}

    find_cov = matcher(cov) if cov is not None else None
    find_mut = matcher(mut) if mut is not None else None
    rows = []
    for ranking in ("danger_zone_top", "worst_function_top"):
        for d in hot.get(ranking) or []:
            row = {"file": d["file"], "ranking": "total" if ranking == "danger_zone_top" else "worst_function",
                   "score": d["score"], "commits": d["commits"], "fixes": d["fixes"],
                   "complexity_total": d["complexity_total"], "complexity_worst": d["complexity_worst"],
                   "line_coverage_pct": None, "branch_coverage_pct": None,
                   "mutants": None, "survived": None, "no_coverage": None, "detection_pct": None}
            if cov is not None:
                key = find_cov(d["file"])
                c = cov.get(key) if key else None
                # a file the coverage report does not list was never loaded by a test: 0 %, measured
                c = c or blank()
                row["line_coverage_pct"] = pct(c["lines_covered"], c["lines_total"]) if key else 0.0
                row["branch_coverage_pct"] = pct(c["branches_covered"], c["branches_total"]) if key else None
            if mut is not None:
                key = find_mut(d["file"])
                m = mut.get(key) if key else None
                # a file outside the mutation scope (Infrastructure, WebAPI) stays null: unmeasured, not clean
                if m:
                    row.update(mutants=m["mutants"], survived=m["survived"], no_coverage=m["no_coverage"],
                               detection_pct=pct(m["killed"], m["killed"] + m["survived"]))
            rows.append(row)
    print(json.dumps({"status": "measured", "reason": None, "commit": commit,
                      "coverage": cov_side, "stryker": mut_side, "rows": rows}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
