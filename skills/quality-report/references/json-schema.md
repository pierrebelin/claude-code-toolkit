# JSON schema — `docs/metrics/quality-report-YYYY-MM-DD.json`

Schema version `2.0`. **Never modify the first-level key structure** — cross-report comparison and any viewer built on the history depend on it. Missing data → `null`. `by_layer` = free-form object whose keys depend on the stack.

```json
{
  "schema_version": "2.0",
  "metadata": {
    "date": "YYYY-MM-DD",
    "updated_at": "YYYY-MM-DD",
    "branch": "main branch analysed",
    "stack": "dotnet | js",
    "project_name": "project name (package.json name or .sln name)",
    "commit": "sha of the main branch analysed",
    "evidence": {
      "tests":     { "status": "measured", "source": "local", "commit": "sha", "reason": null },
      "coverage":  { "status": "measured", "source": "local", "commit": "sha", "reason": null },
      "sonarqube": { "status": "measured", "source": "local", "commit": "sha", "reason": null },
      "stryker":   { "status": "missing",  "source": "local", "commit": null,  "reason": "run timed out" }
    }
  },
  "tests": {
    "unit":         { "files": 0, "methods": 0, "passed": 0, "failed": 0, "skipped": 0, "duration_seconds": 0 },
    "integration":  { "files": 0, "methods": 0, "passed": 0, "failed": 0, "skipped": 0, "duration_seconds": 0 },
    "contract":     { "files": 0, "methods": 0, "passed": 0, "failed": 0, "skipped": 0, "duration_seconds": 0 },
    "architecture": { "files": 0, "methods": 0, "passed": 0, "failed": 0, "skipped": 0, "duration_seconds": 0 },
    "e2e":          { "files": 0, "methods": 0, "passed": 0, "failed": 0, "skipped": 0, "duration_seconds": 0 },
    "total":        { "passed": 0, "failed": 0, "skipped": 0, "duration_seconds": 0 }
  },
  "coverage": {
    "lines":           { "pct": 0.0, "covered": 0, "total": 0 },
    "branches":        { "pct": 0.0, "covered": 0, "total": 0 },
    "statements":      { "pct": 0.0, "covered": 0, "total": 0 },
    "functions":       { "pct": 0.0, "covered": 0, "total": 0 },
    "methods_partial": { "pct": 0.0, "covered": 0, "total": 0 },
    "methods_full":    { "pct": 0.0, "covered": 0, "total": 0 },
    "sonarqube_coverage_pct": 0.0,
    "files_covered": 0,
    "files_total": 0,
    "files_coverage_pct": 0.0,
    "by_layer": {}
  },
  "api_endpoints": {
    "total": 0,
    "active": 0,
    "skipped": 0
  },
  "pages": {
    "total": 0,
    "tested": 0,
    "untested": 0
  },
  "stryker": {
    "date": "YYYY-MM-DD",
    "since_target": "commit-hash",
    "domain":      { "detection_pct": 0.0, "global_pct": 0.0, "killed": 0, "survived": 0, "no_coverage": 0 },
    "application": { "detection_pct": 0.0, "global_pct": 0.0, "killed": 0, "survived": 0, "no_coverage": 0 },
    "combined":    { "detection_pct": 0.0, "global_pct": 0.0, "killed": 0, "survived": 0, "no_coverage": 0 },
    "fragile_files": [
      { "file": "", "layer": "", "survived": 0, "detection_pct": 0.0 }
    ]
  },
  "sonarqube": {
    "date": "YYYY-MM-DD",
    "quality_gate": "PASS",
    "coverage_pct": 0.0,
    "lines_of_code": 0,
    "bugs": 0,
    "vulnerabilities": 0,
    "code_smells": 0,
    "duplication_pct": 0.0,
    "technical_debt_minutes": 0,
    "debt_ratio_pct": 0.0,
    "security_hotspots": 0,
    "cognitive_complexity": 0,
    "issues_resolution_filter": "resolved=false (open only)",
    "issues_open_total": 0,
    "issues_resolved_total": 0,
    "issues_by_severity": {
      "BLOCKER": 0, "CRITICAL": 0, "MAJOR": 0, "MINOR": 0, "INFO": 0
    },
    "issues_by_layer": {
      "Domain": { "bugs": 0, "code_smells": 0 }
    },
    "creedengo": null
  },
  "lint": {
    "errors": 0,
    "warnings": 0
  },
  "build": {
    "duration_seconds": 0
  },
  "codebase": {
    "source_files": 0,
    "total_files": 0,
    "todo_count": 0,
    "skipped_tests": 0,
    "size": {
      "scope": "*.cs excluding Migrations, .g.cs, .Designer.cs — physical lines",
      "src":   { "files": 0, "lines": 0 },
      "tests": { "files": 0, "lines": 0 },
      "src_by_layer":     { "Domain": { "files": 0, "lines": 0 } },
      "tests_by_project": { "UnitTests": { "files": 0, "lines": 0 } }
    }
  },
  "activity": {
    "period_days": 30,
    "commits": 0,
    "files_changed": 0,
    "lines_added": 0,
    "lines_deleted": 0,
    "net_delta": 0,
    "cs_files_changed": 0,
    "cs_lines_added": 0,
    "cs_lines_deleted": 0,
    "cs_net_delta": 0,
    "cs_scope": "src/**/*.cs excluding Migrations, .g.cs, .Designer.cs",
    "cs_files_total": 0,
    "cs_lines_total": 0,
    "hotspots": {
      "status": "measured", "reason": null, "commit": "sha", "commit_date": "ISO date", "shallow": false,
      "window_days": 365, "window_from": "ISO date", "history_from": "ISO date", "fix_convention": true,
      "tool": "lizard 1.x", "metric": "cyclomatic",
      "files_analysed": 0,
      "excluded": { "tests": 0, "skipped dirs": 0, "generated or vendored": 0, "--exclude": 0 },
      "ignore_revs_file": false, "ignored_commits": 0, "renames_followed": 0,
      "mass_commits": [ { "commit": "abbrev sha", "files": 0 } ],
      "thresholds": { "commits": 0, "complexity_total": 0, "complexity_worst": 0, "rule": "median of the analysed files" },
      "quadrants": { "danger_zone": 0, "cowboy_code": 0, "fertile_ground": 0, "healthy_closure": 0 },
      "parser_suspect": [],
      "danger_zone_top": [
        { "file": "", "commits": 0, "commits_all": 0, "lines_changed": 0, "fixes": 0,
          "complexity_total": 0, "complexity_worst": 0, "worst_function": "", "worst_line": 0,
          "authors": 0, "last_change": "YYYY-MM-DD", "score": 0.0 }
      ],
      "worst_function_top": []
    },
    "cs_periods": [
      { "days":  7, "commits": 0, "files_modified": 0, "files_added": 0, "files_deleted": 0, "lines_modified": 0, "lines_added": 0,
        "by_layer": { "Domain": { "files": 0, "lines": 0 } } },
      { "days": 14, "commits": 0, "files_modified": 0, "files_added": 0, "files_deleted": 0, "lines_modified": 0, "lines_added": 0 },
      { "days": 30, "commits": 0, "files_modified": 0, "files_added": 0, "files_deleted": 0, "lines_modified": 0, "lines_added": 0 },
      { "days": 90, "commits": 0, "files_modified": 0, "files_added": 0, "files_deleted": 0, "lines_modified": 0, "lines_added": 0 }
    ]
  }
}
```

**Schema v2.0 notes:**

- `metadata.commit` / `metadata.evidence` (optional, older reports lack them): one entry per measured block — hotspots carry their own in `activity.hotspots` —, `status` = `measured` | `not_configured` | `missing` (SKILL.md § Evidence status). `source` = `local` or the CI run ID; `commit` = the commit the result belongs to, equal to `metadata.commit` when measured. A block not `measured` has its own numbers at `null`, never `0`.
- `metadata.stack`: `"dotnet"` or `"js"` — tells any consumer which interpretation applies.
- 🔴 Every `duration_seconds` (tests and build) is an integer number of seconds, rounded at collection: a runner float (`465.89999999999998`) leaks into the Markdown tables as unreadable digits.
- `tests.contract`, `tests.architecture`: .NET-specific. `null` for JS/TS.
- `tests.e2e`: Cypress/Playwright (JS/TS) or .NET E2E tests. `null` if not run.
- A repo with an extra suite of its own (DSL compilation, load tests, …) adds one key of the same shape next to these; the coherence script sums whatever types it declares.
- **`coverage.lines`, `coverage.branches`**: **whole project** (all source files, not just the test-touched ones). Source: SonarQube (`lines_to_cover`, `uncovered_lines`, `conditions_to_cover`, `uncovered_conditions`). Not the Jest or ReportGenerator numbers: they count only test-imported files, giving misleading percentages.
- `coverage.sonarqube_coverage_pct`: the global SonarQube coverage (lines + branches combined). The reference number for the report.
- `coverage.files_covered` / `files_total` / `files_coverage_pct`: ratio of files touched by ≥1 test.
- `coverage.statements`, `coverage.functions`: JS/TS-specific (Istanbul). `null` for .NET. **Also whole-project** through SonarQube when available, else `null`.
- `coverage.methods_partial`, `coverage.methods_full`: .NET-specific (opencover). `null` for JS/TS.
- `coverage.by_layer`: free-form object, **values = number (percentage)**, no nested objects. Example: `{ "entities": 23.0, "shared": 11.0 }`. .NET keys: `Domain`, `Application`, `Infrastructure`, `WebAPI`. JS/TS keys: `app`, `entities`, `features`, `shared`, `pages`, `widgets` — or any first-level dir under `src/`. A viewer expects one number per layer.
- `api_endpoints`: .NET-specific. `null` for JS/TS.
- `pages`: JS/TS-specific. `null` for .NET.
- `lint`: ESLint errors/warnings (JS/TS) or Roslyn (.NET). `null` if not run.
- `sonarqube.issues_by_layer`: same keys as `coverage.by_layer`; **each value is an object `{ bugs, code_smells }`**, never a bare number — a comparison view reads `d.code_smells` / `d.bugs`, a flat integer renders as `undefined smells`. `{}` when the breakdown is unavailable.
- 🔴 **`sonarqube.issues_by_severity` and every issue count (per rule, green-coding, MAJOR/CRITICAL): query `api/issues/search` with `&resolved=false`.** Without it the API sums **open AND already-fixed (FIXED)** issues → inflated totals (e.g. 5,990 against ~1,850 really open). `issues_open_total` = total with `resolved=false`. `issues_resolved_total` = total with `resolved=true` (cumulative fixes, to show improvement). The *measures* (`code_smells`, `bugs` through `api/measures`) are already open-only — do not mix them with `issues/search` counts.
- `sonarqube.creedengo` (optional, .NET green-coding rules): `{ total_issues, effort_minutes, issues_by_severity{}, issues_by_rule[{key,name,severity,count,tags[]}], top_directories[{directory,count}] }` — **`resolved=false`** here too. `null` when the plugin is absent. `issues_by_rule[].key` may carry the engine prefix (`external_roslyn:GCI93`) when the Creedengo plugin is not installed and the rules come from the embedded Roslyn analysers; strip it before pairing rules across reports.
- `stryker.domain`, `stryker.application`: .NET-specific (two separate runs). JS/TS → only `stryker.combined`, set `domain`/`application` to `null`.
- `activity.cs_periods` (optional): src `.cs` change rate over 7 / 14 / 30 / 90 days. `lines_modified` = additions + deletions inside pre-existing files, `lines_added` = lines of newly added files. Numerator scope `src/**/*.cs` minus `Migrations/`, `*.g.cs`, `*.Designer.cs` — must match `cs_files_total` / `cs_lines_total`, stored alongside (physical lines, from `git grep -c ''` at the report commit). Do not divide by `sonarqube.lines_of_code`: different scope (`tests/` included, blank/comment lines dropped) → ratios above 100%. Absent → the change-rate card is not rendered.
- `codebase.size` (optional): code size snapshot at the report commit, `{ files, lines }` everywhere, physical lines. `src` / `tests` = totals; `src_by_layer` keys match `coverage.by_layer` (extra layers such as `SDK` allowed), `tests_by_project` keys = test project or first dir under `tests/`. Sums of `src_by_layer` and `tests_by_project` equal `src` and `tests` (checked by script). .NET: `size.src` equals `activity.cs_files_total` / `cs_lines_total` (same scope). Absent → the code size card is not rendered.
- `activity.cs_periods[].by_layer` (optional): churn per layer for that window, `{ files, lines }` where `lines` = additions + deletions over every touched file (A, M and D). Keys must match `coverage.by_layer` / `sonarqube.issues_by_layer`. Absent → the per-layer churn card is not rendered.
- `activity.hotspots` (optional): `cctoolkit hotspots --json` pasted as is — never edited by hand. `status: "missing"` (lizard absent) → `thresholds`, `quadrants`, `danger_zone_top`, `worst_function_top` are `null`. Quadrant counts sum to `files_analysed`. `commits` / `lines_changed` / `fixes` count the window (`window_days` before the commit date, `null` = whole history), `commits_all` the whole history. `fixes` is `null` when `fix_convention` is false — no `fix:` commit in the history, so zero would read as "no bug". `worst_function_top` = the Danger Zone recomputed on the worst function, files already in `danger_zone_top` left out. Absent → the hotspot card is not rendered.
