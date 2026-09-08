#!/usr/bin/env python3
"""Coherence checks for docs/metrics/quality-report-YYYY-MM-DD.json.

Runs the arithmetic and threshold checks of the quality-report skill (step 8).
The judgement checks — status icons, section wording — stay in the skill.

Usage:
    python3 scripts/quality-report-check.py [path/to/report.json]

Without an argument, the most recent docs/metrics/quality-report-*.json is used.
Exit code 0 when every check passes, 1 otherwise.
"""

import glob
import json
import os
import sys

DURATION_THRESHOLDS = {
    "dotnet": {"unit": 120, "contract": 180, "integration": 600, "total": 900},
    "js": {"unit": 60, "integration": 120, "total": 300},
}

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
    tests = report.get("tests") or {}
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

    stack = ((report.get("metadata") or {}).get("stack")) or "dotnet"
    thresholds = DURATION_THRESHOLDS.get(stack, {})
    for name, limit in thresholds.items():
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
        # global_pct is Stryker's own console score: its denominator excludes Ignored and
        # CompileError mutants, which the JSON does not store. Only its ordering is checked.
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
