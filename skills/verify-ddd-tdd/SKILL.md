---
name: verify-ddd-tdd
description: "Check, after /implement-tdd, that a .NET batch respects the coding rules — correctness, reuse, simplification, cost — then its conformance to the plan, its handler test policy and its TDD evidence. Use before moving to the next batch, in fast mode by default or full on explicit request."
context: fork
agent: ddd-tdd-auditor
background: false
---

# DDD + TDD verification

Audit without modifying code. The verdict covers a batch implemented by `/implement-tdd`, never a feature without a plan. Use `rtk dotnet` for validations and never return a raw log.

**Two axes, in this order.**

1. **Coding rules** (§2) — correctness, reuse, simplification, cost, placement of logic. The primary axis. It applies to the delivered code as it is, independently of what the plan announces.
2. **Conformance to plan and tests** (§3) — RM/CU traceability, DDD/APP/PERF ids, test policy, TDD evidence.

The plan is not the ultimate reference: it gets modified mid-batch when the implementation heads the wrong way. A gap between code and plan is **classified** (§3), it never mechanically translates into "the code is wrong".

The verdict is read by the user; its headings, severities and axis labels are a fixed format. Never reword them.

$ARGUMENTS

## Modes

- **Fast** by default: global plan + batch sheet, DDD/APP/PERF coverage, applied ids, diff, modified files and targeted tests.
- **Full** only with `full` in the argument: widens inspection to the touched boundaries and adds the whole fast suites (§4.6). **`full` does not authorise a whole `IntegrationTests` suite** — it stays filtered on the impacted context.

Read the compact indexes `ddd-rules.md` and `architecture-rules.md` to check full coverage. Then read only the lines of the ids applied in the sheet. Open `ddd-examples.md` only if an id stays ambiguous.

## Workflow

### 1. Establish the scope

1. Require `batch FX` and locate the global plan + the `*-PLAN-FX.md` sheet.
2. Collect RM/CU, DDD/APP/PERF coverage, applied ids, owning aggregate, consistency, cost, test levels and named scenarios.
3. Without full coverage or without a **Design** section: still conduct the §2 audit on the delivered code, and report the plan's gap as a **Major** deviation whose fix is updating the sheet. Every id must be `applied` or `N/A — reason`. Do not reconstruct the design from the code and do not infer it from the implementation.
4. Read `git status --short`, `git diff --check`, then the diff of the files concerned. If the expected diff is already committed, require an explicit base in the argument; do not guess the history. Walk the diff **hunk by hunk** and tie each one to an RM/CU or to a step of the sheet: whatever ties to nothing is a **Scope** deviation (§2).

### 2. Check the coding rules

The primary axis, always executed, including when the plan is incomplete or was modified mid-batch. It covers the batch's diff. A green test is no evidence here.

Axis labels below are the ones written into the verdict — keep them verbatim.

| Axis | What counts as a deviation |
|------|---------------------|
| Correctness | Untreated error path, absence or `null` unhandled, wrong comparison boundary, operation order leaving an invalid intermediate state, swallowed exception, silent default value masking a failure, concurrent write on the same aggregate with no concurrency handling. |
| Reuse | A type, service, VO or method created while an existing element covers the need, or 80 % of it. A second type sharing the shape of an existing one: rename or extend the existing one, do not duplicate. |
| Simplification | A defensive branch on a case made impossible by an invariant of the batch. Indirection, wrapper or intermediate mapping with a single caller. Dead code introduced or orphaned by the batch, a parameter never read, an abstraction with no second implementer. **Pre-existing** dead code is reported as Minor: demanding its removal is outside the batch's scope. |
| Cost | Repository call inside an input-driven loop, unbounded read, `Include` of a collection growing without limit, materialisation before filtering, one query per element. A bounded cost that differs from the one announced in the sheet is a plan deviation (§3), not a code one. |
| Placement | Business rule or validation carried by a handler, a repository, Infrastructure or WebAPI instead of the aggregate concerned. Exception: a pre-check duplicating an authority named elsewhere (persistence constraint, external system) is not a placement deviation — it is one only if it is the **sole** owner of the rule. Conversely, a resource limit hand-rewritten in a handler or carried by the Domain, instead of its dedicated owner: WebAPI `RequestLimits`/rate limiting for transport, `PaginationBounds` for pagination, `QueryLimits` for the read cap. |
| Scope | A diff hunk with no RM/CU nor sheet step carrying it. Refactor, renaming, reformatting or reorganisation of code that worked and that the batch had no reason to modify. Fixing an adjacent bug outside the batch's RM/CU. Unrequested removal of pre-existing dead code or a pre-existing comment outside the touched lines. Flexibility, configurability or abstraction added with no expressed need. |
| Comments | A comment or XML `///` doc present in production code. Intent is carried by naming. |

**Mandatory filter — a finding without evidence is not reported.**

- Correctness: name a concrete breaking scenario, `inputs X → wrong behaviour Y`. Without a scenario, do not report the finding.
- Reuse: name the existing element as `path:line`. Without a named element, do not report the finding.
- Simplification, Cost, Placement: cite the line and the concrete effect. No stylistic preference, no alternative-architecture suggestion, no proposed rewrite.
- Scope: cite the hunk as `path:line` and name the missing RM/CU or sheet step. A line required by the delivered behaviour — a propagated signature, a DI registration, a `using` that became necessary — is traced: that is not a deviation.

Never propose adding a comment, an XML doc, an anticipatory abstraction or an aggregate test in isolation: those are deviations, not fixes.

### 3. Check conformance to plan and tests

For every RM/CU and every applied DDD/APP/PERF id, find evidence in the code and a planned scenario. Reject an id missing from the coverage, or an `N/A` without a reason.

**Classify every code/plan divergence before reporting it**, in one explicit line:

- **Faulty code** — the plan is still right, the implementation departs from it. Expected fix: the code.
- **Stale plan** — the implementation is better, or a decision was settled mid-batch. Expected fix: the sheet, plus the source spec if an RM/CU moves. Severity **Major**, never blocking.
- **Unsettleable divergence** — both readings hold. Report both and leave the arbitration to the user. Do not decide in the plan's place.

An RM/CU with no code owner stays blocking in all three cases: that is a hole, not a divergence.

| Point | Expected |
|-------|----------|
| Aggregate | It carries the announced invariants; the handler orchestrates load, business call and save. |
| A command | It modifies and saves a single aggregate; any exception is documented. |
| Invariant | It genuinely removes a branch, loop, grouping or read identified in the plan. |
| Boundaries | Several aggregates: DDD-08 exception and consistency made explicit; no implicit integration event. Infrastructure/WebAPI does not decide an RM. |
| Bounds (APP-05) | Transport (size, rate) in WebAPI; pagination normalised through `PaginationBounds` when the query is created; read cap through `QueryLimits`. Deviation = a bound hand-rewritten in a handler, a technical bound in the Domain, or an unpaginated read with no cap. |
| External authority | No rule owned by an external system (products/keys, delegation, organisation catalogue) replayed in the code; the target of a transfer validated by delegation, not by mere existence. |
| Creation/persistence | `Create()` and `Restore()` stay distinct; aggregate-centred repository, saves events. |
| Uniqueness (APP-03) | The persistence constraint is the authority and the repository translates its violation into a domain exception, with a filter naming the precise index. An upstream uniqueness check is an early failure, not a deviation; the deviation is the missing translation (race surfacing as 500) or a generic filter such as `Contains("duplicate")`. |
| Owner of the logic (DDD-09) | No business operation carried by a helper or static service receiving a business object's state; Domain Service stateless and justified. |
| Absence (DDD-11) | No nullable collection in Domain/Application; transport nullable converted at the boundary; an optional concept modelled, not tested with `is null` at every use. |
| Cost | Reads/writes bounded, independent of input size; no repository read inside an input-driven loop. |
| Aggregate test | No test calls an aggregate factory or method directly to verify behaviour. |
| Query handler test | Mock fed with data; assertion on the returned result. |
| Command handler test | `SavedEvents` verified by type and content. |
| Interactions | No spy, counter, `CallCount`, `Called`, `Received` or assertion on call count. |
| Test level | **Integration test mandatory as soon as a hunk touches `src/{{PRODUCT}}.Infrastructure/`** — repository, EF mapper, entity configuration, query, persistence-exception translation. A waiver is admissible only for a hunk with no effect on persistence (DI registration, adapter of an already-doubled external service), written in the sheet with its reason. Contract tests only when a nominal route changed; E2E only for a lifecycle of at least two operations. |
| Scope | Every diff hunk ties back to an RM/CU or to a step of the sheet. Traceability reads both ways: RM → code, and code → RM. A hunk with no owner is a deviation, even if it improves the code. |
| Assumptions (Hn) | Every non-obvious decision settled mid-batch for lack of an answer appears as `Assumption Hn` in the sheet: what is assumed, and who validates it. Deviation = a silent decision. |
| TDD | Every delivered behaviour carries RED, GREEN and COST ticked only where actually observed. |

Missing evidence is not a favourable assumption. Cite the file and line where the deviation is observed.

### 4. Run the minimal validations

Runner, filters, suite scope and integration-test filter construction → `.claude/skills/implement-tdd/references/test-scope.md`. Single source, shared with `/implement-tdd`: do not restate it, apply it.

**The volume of tests executed is an audit decision, not a reflex.** A suite run whole where a filter would have done proves nothing more and costs several minutes. Never re-run identically what `/implement-tdd` has just run: check the reported exit code, and run yourself only what is missing, or what was scoped too narrowly.

1. `rtk dotnet build --no-restore` if the diff contains source code.
2. The tests and projects named in the sheet: targeted filter first; target project without a filter if the filter is not usable.
3. **`ArchitectureTests` in full** as soon as the diff touches a handler, an endpoint, a repository, a layer boundary or a DI registration. It mechanically locks naming, CQRS, dependencies, encapsulation and registration: what it proves does not have to be re-argued in the verdict, what it breaks is blocking.
4. **`IntegrationTests` as soon as the diff touches `src/{{PRODUCT}}.Infrastructure/`**, always **filtered** — `full` mode included. No integration test on an Infrastructure diff with no written waiver in the sheet: a **Blocking** deviation, even if the filtered suite passes green on the existing tests.
5. Contract and E2E only if the batch selects them. E2E not selected = do not start Aspire.
6. `full` mode: adds `UnitTests` and `ContractTests` in full, plus `DslTests` **only** if the diff touches `dsl/**`, the parser or the templates/presets.

Never declare a test green without exit code `0`. Distinguish a test not run, skipped and failed. In the verdict, the `Validations` line carries each command's **scope**, not just its exit code: a filter presented without its scope reads as a full suite.

## Severities

These labels are written verbatim into the verdict.

- **Blocking** — direct aggregate test, interaction assertion, RM/CU with no code owner, unclassified id, rule applied with no owner, red `ArchitectureTests`, diff touching `src/{{PRODUCT}}.Infrastructure/` with no integration test and no written waiver, TDD evidence ticked without actual observation, and any **Correctness** deviation carrying a breaking scenario.
- **Major** — missed reuse of a named existing element, unbounded cost, business rule outside its aggregate, resource limit outside WebAPI, comment in production, stale plan, hunk outside the batch's scope, assumption settled mid-batch with no trace in the sheet.
- **Minor** — simplification with no functional consequence, pre-existing dead code reported (an observation, not a request to fix).

Verdict `GAPS` as soon as a Blocking or a Major exists. Minors are listed under a `VALID` verdict without calling it into question.

## Verdict

Do not recap the plan, the files or the logs. One line per RM/CU, command and exit code only; on failure, at most six useful RTK lines. End with one of these two formats, verbatim:

```markdown
## Verdict — VALID

| RM/CU or rule | Code evidence | Test evidence |
|---------------|---------------|---------------|
| RM-01 / DDD-02 / APP-01 | `path:line` | `Should...` |

Code — minors (do not block the next batch):
| Axis | Finding | Evidence |
|------|---------|----------|
| Simplification | Defensive branch on a case excluded by the invariant | `path:line` |

Scope: `[n]` hunks, all traced to an RM/CU or step — otherwise list the untraced hunks
Assumptions: `Hn` — `[assumption]`, to be validated by `[who]` — or "none"
Reported without fixing: `[pre-existing dead code or adjacent bug]` — `path:line`

Validations: `[command]` — exit 0, scope `[filter or "whole suite"]`, `[n]` tests
Not run: `[suite]` — `[reason]`
```

```markdown
## Verdict — GAPS

| Severity | Axis | Gap | Evidence | Expected fix |
|----------|------|-----|----------|--------------|
| Blocking | Correctness | Unhandled absence: `inputs X → wrong behaviour Y` | `path:line` | Handle the missing case in the aggregate |
| Blocking | Test | Spy in a handler test | `path:line` | Assert the result or SavedEvents depending on the handler type |
| Major | Reuse | Second type of the same shape as the existing one | `path:line` | Rename and extend `path:line` |
| Major | Stale plan | Decision settled mid-batch, missing from the sheet | `path:line` | Update the sheet, and the spec if an RM moves |
| Major | Scope | Hunk with no RM/CU nor owning step | `path:line` | Revert the hunk, or tie it to a step of the sheet |

Validations: `[command]` — exit N, scope `[filter or "whole suite"]` / not run
```

Fix nothing during this audit; fixing belongs to `/implement-tdd`. No write tool is available in this agent: a deviation is reported, it is not repaired.
