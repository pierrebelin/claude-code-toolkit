# Software quality report — [Month YYYY]

> Branch analysed: `<main branch>` at `<commit>` — Date: [date]

---

## 1. Executive summary

| Dimension | Status | Value |
|---|---|---|
| Unit tests | ✅/⚠️/🔴 | X pass — Y failures — Z skipped |
| API contract tests | ✅/⚠️/🔴 | X pass — Y failures — Z skipped |
| Architecture tests | ✅/⚠️/🔴 | X / X pass |
| Integration tests | ✅/⚠️/🔴 | X pass — Y failures (Xm Ys, SQL Server through Testcontainers) |
| API endpoint coverage | ✅/⚠️/🔴 | X endpoints — Y active + Z [Skip] |
| Code coverage (lines) | ✅/⚠️/🔴 | **XX%** lines — **XX%** branches — XX% methods |
| Static quality (SonarQube) | ✅/⚠️/🔴 | Quality Gate **PASS/FAIL** — new-code coverage XX% — duplication XX% |
| Test robustness (Stryker) | ✅/⚠️/🔴/— | Detection **XX%** / Overall **XX%** (Domain + Application) — or `Skipped (off for this run)` |
| Hotspots | ⚠️/🔴 | X files in the Danger Zone — X of them under XX% line coverage |
| Rule traceability | ✅/⚠️/🔴/— | X rules — Y without a test — Z unbound tests |
| Suppressions | ⚠️/🔴 | X suppressions in X files (pragma X, NOSONAR X, …) |
| Dependency vulnerabilities | ✅/⚠️/🔴 | X critical — X high — X moderate — X low |
| Infrastructure calls in loops | ✅/⚠️/🔴/— | X in a loop — X in a lambda — X in-memory filters |

Status `—` = not configured, or skipped by this run; 🔴 `Missing` = configured but no usable result for this commit — never ✅.

**At a glance:** [1 sentence summarising the overall state — non-complacent, factual]

---

## 2. Activity over the last 30 days

### Volume

| Metric | Value |
|---|---|
| Commits | **X** |
| Files changed (unique) | **X** |
| Lines added | **+X** |
| Lines deleted | **−X** |
| Net delta | **+/−X** |

### Themes of the changes

[2-3 lines describing the month's main axes]

### Code size (snapshot)

`.cs` files excluding `Migrations/`, `*.g.cs`, `*.Designer.cs` — physical lines (blank and comment lines included).

| Scope | Files | Lines | Share of lines |
|---|---|---|---|
| src | X | X | XX% |
| tests | X | X | XX% |
| **Total** | **X** | **X** | 100% |

Tests / src line ratio: **X.X**.

| Layer (src) | Files | Lines | Share of src |
|---|---|---|---|
| Domain | X | X | XX% |
| Application | X | X | XX% |
| Infrastructure | X | X | XX% |
| WebAPI | X | X | XX% |
| Abstractions.Models | X | X | XX% |
| [other src projects, sorted by lines] | X | X | XX% |

| Test project | Files | Lines | Share of tests |
|---|---|---|---|
| UnitTests | X | X | XX% |
| IntegrationTests | X | X | XX% |
| [other test projects, sorted by lines] | X | X | XX% |

[1-2 lines of interpretation: layer whose weight departs from its coverage or churn weight, test project oversized or nearly empty against the layer it protects]

### Hotspots — churn × complexity

[Output of `cctoolkit hotspots`, as is: commit, window, files analysed and excluded, thresholds, quadrant counts, the two tables (total complexity, worst function), renames, ignored and mass commits]

[1 sentence per listed file: why it changes so often, why it is complex, whether its fixes make it a bug nest]

---

## 3. Tests — results and coverage

### Test inventory

| Type | Test files | Test methods | Framework |
|---|---|---|---|
| Unit | X | **X** | xUnit + Verify |
| Integration | X | **X** | xUnit + Testcontainers (real SQL Server) |
| API contract | X | **X** (including parameterised tests) | xUnit + Verify + WebApplicationFactory |
| Architecture | X | **X** | xUnit + ArchUnitNET |
| **Total** | **X** | **X** | |

### Execution results

| Project | Passed | Failed | Skipped | Duration | Status |
|---|---|---|---|---|---|
| UnitTests | X | X | X | Xm Xs | ✅/⚠️/🔴 |
| ContractTests | X | X | X | Xm Xs | ✅/⚠️/🔴 |
| ArchitectureTests | X | X | X | Xm Xs | ✅/⚠️/🔴 |
| IntegrationTests | X | X | X | Xm Xs | ✅/⚠️/🔴 |
| **Total** | **X** | **X** | **X** | **Xm Xs (cumulative)** / **Xm Xs (wall clock)** | |

### Combined coverage (UnitTests + ContractTests + IntegrationTests)

> **Line coverage**: proportion of lines executed at least once.
> **Branch coverage**: proportion of conditional paths taken (`if`/`else`, `switch`, `&&`, `||`). Always lower than lines.
> **Methods (partially)**: methods called at least once, even if not all of their lines are covered.
> **Methods (fully)**: methods whose every line was executed.

| Metric | Value | Covered | Total |
|---|---|---|---|
| Lines | XX% | X | X |
| Branches | XX% | X | X |
| Methods (partially) | XX% | X | X |
| Methods (fully) | XX% | X | X |

### Coverage per layer

| Layer | Line coverage |
|---|---|
| Application | XX% |
| Domain | XX% |
| Infrastructure | XX% |
| WebAPI | XX% |

### Rule traceability

| Measure | Value |
|---|---|
| Business rules | X |
| With at least one test | X |
| Without a test | X |
| Dead references (tag citing no rule) | X |
| Unbound tests (no tag, in a class carrying some) | X |
| Tests in classes carrying no tag | X |

| Handler | Rules | Without a test |
|---|---|---|
| `Feature/Handler` | X | `RM-02`, `RM-05` |

[1-2 lines: which handlers carry the untested rules, whether the unbound tests point at a rule missing from a table]

---

## 4. API endpoint coverage

| Metric | Value |
|---|---|
| Total endpoints | X |
| Active tests | X |
| Disabled tests [Skip] | X |

> ⚠️ The [Skip] endpoints have a test written but temporarily disabled — they are not without coverage.

| Endpoint | Contract test | Status |
|---|---|---|
| `GetXxx` | `ShouldGetXxx` | ✅ Active / ⚠️ [Skip] / 🔴 Missing |

[List the endpoints with no test or with a [Skip] test, grouped by domain]

---

## 5. Test robustness — Stryker

### Overall scores

| Layer | Detection | Overall | Killed | Survived | NoCoverage |
|---|---|---|---|---|---|
| Domain | XX% | XX% | X | X | X |
| Application | XX% | XX% | X | X | X |
| **Combined** | **XX%** | **XX%** | **X** | **X** | **X** |

### Fragile zones (top files)

| File | Layer | Survivors | Detection |
|---|---|---|---|
| `Xxx.cs` | Domain/Application | X | XX% |

### Resistant mutation types

[Top 3-5 mutation types that survive most often]

---

## 6. Static quality

### SonarQube — Quality Gate: PASS / FAIL

| Metric | Value | Threshold |
|---|---|---|
| Lines of code | X | — |
| Bugs | X | — |
| Vulnerabilities | X | 0 |
| Code smells | X | — |
| Duplication | XX% | < 3% |
| New-code coverage | XX% | > 80% |
| Technical debt | Xh | — |

### Issues by severity

| Severity | Count |
|---|---|
| BLOCKER | X |
| CRITICAL | X |
| MAJOR | X |
| MINOR | X |

### Issues by layer

| Layer | Bugs | Code smells |
|---|---|---|
| Domain | X | X |
| Application | X | X |
| Infrastructure | X | X |
| WebAPI | X | X |

### Suppressions

| Kind | Count |
|---|---|
| `#pragma warning disable` | X |
| `SuppressMessage` | X |
| `NOSONAR` | X |
| `eslint-disable` | X |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | X |
| `ReSharper disable` | X |
| **Total** | **X** (in X files) |

| Layer | Suppressions |
|---|---|
| Domain | X |

Top files: `Xxx.cs` (X), …

### Dependency vulnerabilities

| Severity | Packages |
|---|---|
| Critical | X |
| High | X |
| Moderate | X |
| Low | X |

| Package | Version | Severity | Direct | Advisory |
|---|---|---|---|---|
| `Xxx` | X.Y.Z | high | yes/no | [link] |

### Infrastructure calls in loops

| Measure | Count |
|---|---|
| Infrastructure awaited in a loop | X |
| Infrastructure awaited in a lambda | X |
| In-memory filter on an awaited result | X |

| File | Loop | Lambda | Filter |
|---|---|---|---|
| `Xxx.cs` | X | X | X |

---

## 7. Risk zones

### Danger Zone × coverage × survivors

| File | Ranking | Score | Commits | Fixes | Complexity (total / worst) | Lines covered | Branches covered | Survivors / mutants |
|---|---|---|---|---|---|---|---|---|
| `Xxx.cs` | total / worst function | X.XX | X | X | X / X | XX% | XX% | X / X — or `—` (Stryker skipped) |

[1 line per file: what guards it and what does not]

| Zone | Risk | Indicator | Priority |
|---|---|---|---|
| [Layer/file] | [Risk description] | [Metric] | HIGH/MEDIUM/LOW |

---

## 8. Actions — next period

| Action | Priority | Context | Carried by |
|---|---|---|---|
| [Concrete action on a named file or block] | HIGH/MEDIUM/LOW | [Why — the figure it moves] | [`/plan-implementation`, `/business-spec`, or —] |

---

## 9. Conclusion

### What works well
[Short — 2-3 points maximum, only what has no known problem]

### What must improve
[Long and precise — fragile zones, blind spots, insufficient scores with figures]

### What the measures cannot see
[Concrete blind spots of this run — missing or skipped evidence, `since`-mode Stryker, suppressed issues, migration churn, moved code, type-level logic]

### Verdict
[1 direct sentence on the real state of the codebase — no reassuring phrasing]
