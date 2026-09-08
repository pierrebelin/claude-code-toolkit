# Software quality report — [Month YYYY]

> Branch analysed: `<main branch>` — Date: [date]

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
| Test robustness (Stryker) | ✅/⚠️/🔴 | Detection **XX%** / Overall **XX%** (Domain + Application) |

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

## 6. Static quality — SonarQube

### Quality Gate: PASS / FAIL

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

---

## 7. Risk zones

| Zone | Risk | Indicator | Priority |
|---|---|---|---|
| [Layer/file] | [Risk description] | [Metric] | HIGH/MEDIUM/LOW |

---

## 8. Actions — next month

| Action | Priority | Context |
|---|---|---|
| [Concrete action] | HIGH/MEDIUM/LOW | [Why] |

---

## 9. Conclusion

### What works well
[Short — 2-3 points maximum, only what has no known problem]

### What must improve
[Long and precise — fragile zones, blind spots, insufficient scores with figures]

### Verdict
[1 direct sentence on the real state of the codebase — no reassuring phrasing]
