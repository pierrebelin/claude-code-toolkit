#!/usr/bin/env python3
"""Arithmetic and threshold checks of docs/metrics/quality-report-YYYY-MM-DD.json, `codebase.*` blocks included.

Usage:
    cctoolkit quality-report-check [path/to/report.json]

Without an argument, the most recent docs/metrics/quality-report-*.json is used.
Exit code 0 when every check passes, 1 otherwise.
"""

import glob
import json
import os
import sys

DURATION_THRESHOLDS = {"unit": 120, "contract": 180, "integration": 600, "total": 900}

problems = []
warnings = []


def fail(message):
    problems.append(message)


def warn(message):
    warnings.append(message)


def number(value):
    return value if isinstance(value, (int, float)) else None


def test_types(tests):
    return [name for name, entry in tests.items() if name != "total" and isinstance(entry, dict)]


def check_tests(report):
    tests = report.get("tests")
    if not isinstance(tests, dict):
        return
    total = tests.get("total") or {}
    types = test_types(tests)
    for field in ("passed", "failed", "skipped"):
        expected = sum(tests[t].get(field) or 0 for t in types)
        got = number(total.get(field))
        if got is None:
            fail(f"tests.total.{field} missing")
        elif got != expected:
            fail(f"tests.total.{field} = {got}, sum per type = {expected}")

    durations = {t: number(tests[t].get("duration_seconds")) for t in types}
    for name, value in durations.items():
        if value is None:
            warn(f"tests.{name}.duration_seconds missing")
    expected_total = sum(v for v in durations.values() if v is not None)
    got_total = number(total.get("duration_seconds"))
    if got_total is not None and expected_total and abs(got_total - expected_total) > 1:
        fail(f"tests.total.duration_seconds = {got_total}, sum per type = {expected_total}")

    for name, limit in DURATION_THRESHOLDS.items():
        value = got_total if name == "total" else durations.get(name)
        if value is not None and value > limit:
            warn(f"tests.{name}: {value}s > threshold {limit}s — flag it as ⚠️ in the report")


def check_counts(report):
    endpoints = report.get("api_endpoints")
    if isinstance(endpoints, dict):
        total, active, skipped = (
            number(endpoints.get("total")),
            number(endpoints.get("active")),
            number(endpoints.get("skipped")),
        )
        if None not in (total, active, skipped) and active + skipped != total:
            fail(f"api_endpoints: {active} active + {skipped} skipped != {total} total")

    pages = report.get("pages")
    if isinstance(pages, dict):
        total, tested, untested = (
            number(pages.get("total")),
            number(pages.get("tested")),
            number(pages.get("untested")),
        )
        if None not in (total, tested, untested) and tested + untested != total:
            fail(f"pages: {tested} tested + {untested} untested != {total} total")


def check_coverage(report):
    coverage = report.get("coverage") or {}
    for name, entry in coverage.items():
        if not isinstance(entry, dict):
            continue
        pct, covered, total = (
            number(entry.get("pct")),
            number(entry.get("covered")),
            number(entry.get("total")),
        )
        if pct is not None and not 0 <= pct <= 100:
            fail(f"coverage.{name}.pct = {pct} outside [0, 100]")
        if None not in (covered, total):
            if covered > total:
                fail(f"coverage.{name}: {covered} covered > {total} total")
            elif total and pct is not None and abs(pct - covered / total * 100) > 0.6:
                fail(
                    f"coverage.{name}.pct = {pct}, recomputed {covered}/{total} = "
                    f"{covered / total * 100:.1f}"
                )
    layers = coverage.get("by_layer")
    if isinstance(layers, dict):
        for layer, value in layers.items():
            if not isinstance(value, (int, float)):
                fail(f"coverage.by_layer.{layer} must be a number, not {type(value).__name__}")


def check_stryker(report):
    stryker = report.get("stryker") or {}
    for scope in ("domain", "application", "combined"):
        entry = stryker.get(scope)
        if not isinstance(entry, dict):
            continue
        killed, survived, no_cov = (
            number(entry.get("killed")),
            number(entry.get("survived")),
            number(entry.get("no_coverage")),
        )
        if None in (killed, survived, no_cov):
            continue
        covered = killed + survived
        detection = number(entry.get("detection_pct"))
        if detection is not None and covered:
            expected = killed / covered * 100
            if abs(detection - expected) > 0.6:
                fail(f"stryker.{scope}.detection_pct = {detection}, recomputed = {expected:.1f}")
        # global_pct's denominator is not in the JSON: only its ordering is checked.
        global_pct = number(entry.get("global_pct"))
        if None not in (detection, global_pct) and global_pct > detection + 0.6:
            fail(
                f"stryker.{scope}: global {global_pct} > detection {detection} — "
                "the global score includes the NoCoverage mutants, it cannot exceed the detection"
            )
        if no_cov and global_pct is not None and detection is not None:
            if abs(detection - global_pct) > 15:
                warn(
                    f"stryker.{scope}: detection-global gap of "
                    f"{detection - global_pct:.1f} points — {no_cov} mutants without coverage"
                )


def check_sonarqube(report):
    sonar = report.get("sonarqube") or {}
    severities = sonar.get("issues_by_severity")
    open_total = number(sonar.get("issues_open_total"))
    if isinstance(severities, dict) and open_total is not None:
        expected = sum(v for v in severities.values() if isinstance(v, (int, float)))
        if expected != open_total:
            fail(
                f"sonarqube.issues_open_total = {open_total}, sum per severity = {expected} "
                "— check the resolved=false filter"
            )


def check_size(report):
    size = (report.get("codebase") or {}).get("size")
    if not isinstance(size, dict):
        return
    for root, breakdown in (("src", "src_by_layer"), ("tests", "tests_by_project")):
        total = size.get(root) or {}
        parts = size.get(breakdown)
        if not isinstance(parts, dict):
            warn(f"codebase.size.{breakdown} missing")
            continue
        for field in ("files", "lines"):
            got = number(total.get(field))
            expected = sum(number((v or {}).get(field)) or 0 for v in parts.values())
            if got is None:
                fail(f"codebase.size.{root}.{field} missing")
            elif got != expected:
                fail(f"codebase.size.{root}.{field} = {got}, sum of {breakdown} = {expected}")

    activity = report.get("activity") or {}
    src = size.get("src") or {}
    for field, key in (("files", "cs_files_total"), ("lines", "cs_lines_total")):
        got, expected = number(src.get(field)), number(activity.get(key))
        if got is not None and expected is not None and got != expected:
            fail(f"codebase.size.src.{field} = {got}, activity.{key} = {expected} — same scope expected")


EVIDENCE_STATUSES = ("measured", "not_configured", "missing", "skipped")
WITH_REASON = ("missing", "skipped")
BLOCK_META = ("status", "reason", "commit")
QUADRANTS = ("danger_zone", "cowboy_code", "fertile_ground", "healthy_closure")


def numbers_in(entry):
    """Every number in a block, nested ones included."""
    if isinstance(entry, bool):
        return []
    if isinstance(entry, (int, float)):
        return [entry]
    if isinstance(entry, dict):
        return [n for v in entry.values() for n in numbers_in(v)]
    if isinstance(entry, list):
        return [n for v in entry for n in numbers_in(v)]
    return []


def check_evidence(report):
    metadata = report.get("metadata") or {}
    evidence = metadata.get("evidence")
    if evidence is None:
        warn("metadata.evidence missing — a missing block cannot be told from a clean one")
        return
    commit = metadata.get("commit")
    for block, entry in evidence.items():
        status = (entry or {}).get("status")
        if status not in EVIDENCE_STATUSES:
            fail(f"metadata.evidence.{block}.status = {status!r}, expected one of {', '.join(EVIDENCE_STATUSES)}")
        elif status == "measured":
            if commit and entry.get("commit") != commit:
                fail(
                    f"metadata.evidence.{block}: measured at {entry.get('commit')}, report commit {commit} "
                    "— results from another commit are missing, not measured"
                )
        else:
            if numbers_in(report.get(block)):
                fail(f"{block}: status {status} but the block holds numbers — null them, never 0 or an older figure")
            if status in WITH_REASON and not entry.get("reason"):
                fail(f"metadata.evidence.{block}: {status} without a reason")


def check_hotspots(report):
    hot = (report.get("activity") or {}).get("hotspots")
    if not isinstance(hot, dict):
        return
    if hot.get("status") != "measured":
        if hot.get("danger_zone_top") or hot.get("worst_function_top") or hot.get("quadrants"):
            fail("activity.hotspots: status missing but quadrants or a ranking present")
        return
    quadrants = hot.get("quadrants") or {}
    analysed = number(hot.get("files_analysed"))
    total = sum(number(quadrants.get(q)) or 0 for q in QUADRANTS)
    if analysed is not None and total != analysed:
        fail(f"activity.hotspots: quadrants sum to {total}, files_analysed = {analysed}")
    top = hot.get("danger_zone_top") or []
    if len(top) > (number(quadrants.get("danger_zone")) or 0):
        fail(f"activity.hotspots: {len(top)} ranked files, {quadrants.get('danger_zone')} in the Danger Zone")
    for name in ("danger_zone_top", "worst_function_top"):
        rows = hot.get(name) or []
        scores = [number(d.get("score")) or 0 for d in rows]
        if scores != sorted(scores, reverse=True):
            fail(f"activity.hotspots.{name} not sorted by score")
        for d in rows:
            if not hot.get("fix_convention") and d.get("fixes") is not None:
                fail(f"activity.hotspots.{name}: {d.get('file')} counts fixes without the fix: convention")
            if (number(d.get("commits")) or 0) > (number(d.get("commits_all")) or 0):
                fail(f"activity.hotspots.{name}: {d.get('file')} has more window commits than in the whole history")
    listed = {d.get("file") for d in top}
    if any(d.get("file") in listed for d in hot.get("worst_function_top") or []):
        fail("activity.hotspots.worst_function_top repeats a file of danger_zone_top")
    commit = (report.get("metadata") or {}).get("commit")
    if commit and hot.get("commit") != commit:
        fail(f"activity.hotspots.commit = {hot.get('commit')}, report commit {commit}")


def sums_to(label, total, parts):
    total = number(total)
    if total is None or not isinstance(parts, dict):
        return
    got = sum(number(v) or 0 for v in parts.values())
    if got != total:
        fail(f"{label}: parts sum to {got}, total {total}")


def check_codebase_blocks(report):
    """The `{status, reason, commit, …}` blocks under `codebase` (cctoolkit audit-collect, risk-cross)."""
    codebase = report.get("codebase") or {}
    commit = (report.get("metadata") or {}).get("commit")
    for name, entry in codebase.items():
        if not isinstance(entry, dict) or "status" not in entry:
            continue
        status = entry.get("status")
        where = f"codebase.{name}"
        if status not in EVIDENCE_STATUSES:
            fail(f"{where}.status = {status!r}, expected one of {', '.join(EVIDENCE_STATUSES)}")
            continue
        if status != "measured":
            if numbers_in({k: v for k, v in entry.items() if k not in BLOCK_META}):
                fail(f"{where}: status {status} but the block holds numbers — null them, never 0")
            if status in WITH_REASON and not entry.get("reason"):
                fail(f"{where}: {status} without a reason")
            continue
        if commit and entry.get("commit") != commit:
            fail(f"{where}: measured at {entry.get('commit')}, report commit {commit}")
        if name == "rules_coverage":
            rules, with_test, without = (number(entry.get(k)) for k in ("rules", "with_test", "without_test"))
            if None not in (rules, with_test, without) and with_test + without != rules:
                fail(f"{where}: {with_test} with test + {without} without != {rules} rules")
            untagged = entry.get("untagged") or {}
            t, tagged, un = (number(untagged.get(k)) for k in ("tests", "tagged", "untagged"))
            if None not in (t, tagged, un) and tagged + un != t:
                fail(f"{where}.untagged: {tagged} tagged + {un} untagged != {t} tests")
            strict, loose = number(untagged.get("in_tagged_class")), number(untagged.get("in_untagged_class"))
            if None not in (un, strict, loose) and strict + loose != un:
                fail(f"{where}.untagged: {strict} + {loose} by class != {un} untagged")
        elif name == "suppressions":
            sums_to(f"{where}.by_kind", entry.get("total"), entry.get("by_kind"))
            sums_to(f"{where}.by_layer", entry.get("total"), entry.get("by_layer"))
        elif name == "vulnerabilities":
            sums_to(f"{where}.by_severity", entry.get("total"), entry.get("by_severity"))
        elif name == "loop_calls" and isinstance(entry.get("files"), list):
            for key in ("in_loop", "in_lambda", "memory_filter"):
                listed = sum(number(f.get(key)) or 0 for f in entry["files"])
                if number(entry.get(key)) is not None and listed > entry[key]:
                    fail(f"{where}: files list {listed} {key}, total {entry[key]}")
        elif name == "hotspot_risk":
            hot = (report.get("activity") or {}).get("hotspots") or {}
            ranked = {d.get("file") for k in ("danger_zone_top", "worst_function_top") for d in hot.get(k) or []}
            crossed = {r.get("file") for r in entry.get("rows") or []}
            if ranked != crossed:
                fail(f"{where}: rows {len(crossed)} files, hotspots rank {len(ranked)} — the cross must hold every Danger Zone file")
            stryker = (report.get("metadata") or {}).get("evidence", {}).get("stryker", {}).get("status")
            side = (entry.get("stryker") or {}).get("status")
            if stryker and side and stryker != side:
                fail(f"{where}.stryker.status = {side}, metadata.evidence.stryker = {stryker}")
            coverage = (entry.get("coverage") or {}).get("status")
            for r in entry.get("rows") or []:
                if coverage != "measured" and any(r.get(k) is not None for k in ("line_coverage_pct", "branch_coverage_pct")):
                    fail(f"{where}: {r.get('file')} holds coverage figures, coverage {coverage}")
                if side != "measured" and any(r.get(k) is not None for k in ("mutants", "survived", "detection_pct")):
                    fail(f"{where}: {r.get('file')} holds mutant figures, Stryker {side}")


def main():
    if len(sys.argv) > 1:
        path = sys.argv[1]
    else:
        candidates = sorted(glob.glob("docs/metrics/quality-report-*.json"))
        if not candidates:
            print("No docs/metrics/quality-report-*.json found.")
            return 1
        path = candidates[-1]

    if not os.path.isfile(path):
        print(f"File not found: {path}")
        return 1

    with open(path, encoding="utf-8") as handle:
        report = json.load(handle)

    check_tests(report)
    check_counts(report)
    check_coverage(report)
    check_stryker(report)
    check_sonarqube(report)
    check_size(report)
    check_evidence(report)
    check_hotspots(report)
    check_codebase_blocks(report)

    print(f"Report: {path}")
    for message in warnings:
        print(f"  ⚠️  {message}")
    for message in problems:
        print(f"  🔴 {message}")
    if not problems and not warnings:
        print("  ✅ Every arithmetic check passes.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
