---
name: verify-ddd-tdd
description: "Check, after /implement-tdd, that a .NET batch respects the coding rules — correctness, reuse, simplification, cost — then its conformance to the plan, its handler test policy and its TDD evidence. Use before moving to the next batch, in fast mode by default or full on explicit request."
context: fork
agent: ddd-tdd-auditor
background: false
---

# DDD + TDD verification

Audit without modifying code. The verdict covers a batch implemented by `/implement-tdd`, never a feature without a plan. Use `rtk dotnet` for validations and never return a raw log.

**One audit table** (§2): the code axes first — correctness, reuse, simplification, cost, placement, comments — which apply to the delivered code as it is, whatever the plan announces; then the axes tying that code back to the sheet — test policy, plan traceability, scope.

The plan is not the ultimate reference: it gets modified mid-batch when the implementation heads the wrong way. A gap between code and plan is **classified** (§2), it never mechanically translates into "the code is wrong".

The verdict is read by the user; its headings, severities and axis labels are a fixed format. Never reword them.

$ARGUMENTS

## Modes

- **Fast** by default: global plan + batch sheet, DDD/APP/PERF coverage, applied ids, diff, modified files and targeted tests.
- **Full** only with `full` in the argument: widens inspection to the touched boundaries and adds the whole fast suites (§3.4). **`full` does not authorise a whole `IntegrationTests` suite** — it stays filtered on the impacted context.
- **Resume** with `resume` in the argument, for a re-audit after correction: the scope is the deviation table of the previous verdict, supplied by the caller, plus the diff produced since. Skip §1.4's hunk-by-hunk walk and every §2 axis no deviation touches; in §3 re-run only the suites the corrections reach. What already carries a verdict is not re-established — a full re-audit of a batch that only lost two deviations costs as much as the first pass and proves nothing more. In `resume`, §1 shrinks too: no new capture — the caller supplies the deviation table and the diff since the previous verdict — and no id re-classification, coverage already carries a verdict. Of the compact indexes, read only the lines of the ids the deviations name. Measured on 2026-09-08: a resume that redid the whole §1 still cost 70 % of the first pass.

Read the compact indexes `ddd-rules.md` and `architecture-rules.md` to check full coverage — read the two files directly, they total under 6 kB; **never sweep them with a multi-alternation `grep`**, which returns more than the files themselves. Then read only the lines of the ids applied in the sheet. Open `ddd-examples.md` only if an id stays ambiguous.

## Workflow

**The steps are numbered, the calls are not.** Everything that does not depend on the previous result goes out in one message: §1's reading of the capture and of the sheet's FX section; §2's targeted greps around the hunks under judgement; §3's remaining suites. A turn is one billed round trip, not one call.

### 1. Establish the scope

1. Require `batch FX`. The caller supplies the FX section of the sheet and the path of a capture produced by `scripts/audit-capture.sh`: use that material as it is. Locate and read the global plan or the `*-PLAN-FX.md` sheet yourself **only** when it is missing or contradicts the repository — never re-read a whole sheet whose FX section was handed over.
2. **Open the capture once, bounded, and take the scope from it.** It carries `git status --short`, `git diff --check`, the modified files, the diff, `rules-coverage.py --untested`, `rules-coverage.py --ids <sheet>`, and the `build` / `ArchitectureTests` exit codes. Re-establishing any of that is a turn paid for nothing. From the sheet, collect what the capture does not carry: owning aggregate, consistency, cost, test levels and named scenarios.
3. Without full coverage or without a **Design** section: still conduct the §2 audit on the delivered code, and report the plan's gap as a **Major** deviation whose fix is updating the sheet. Every id must be `applied` or `N/A — reason`. **The `not cited` line of the capture settles the mechanical half** — an id it lists is a **Blocking** unclassified id, and counting them again yourself proves nothing. What stays yours is the judgement the script cannot make: whether the stated reason for an `N/A` actually holds. Do not reconstruct the design from the code and do not infer it from the implementation.
4. The status, the check and the diff come from the capture. Produce them yourself, in a single command, only when no capture was supplied. **Never re-read a file whole when the diff already carries its modified lines** — open it bounded, on a hunk's surrounding context, and only when the axis being judged needs that context. A batched `cat` of the files the diff has just shown is the single heaviest waste of this audit. If the expected diff is already committed, require an explicit base in the argument; do not guess the history. Walk the diff **hunk by hunk** and tie each one to an RM/CU or to a step of the sheet: whatever ties to nothing is a **Scope** deviation (§2).

### 2. Audit the delivered code

One table, one pass, over the batch's diff. **Axis labels below are written verbatim into the verdict.** A green test is evidence for nothing here.

`Correctness` → `Comments` judge the code as delivered, even when the plan is incomplete or was modified mid-batch. `Test`, `Plan` and `Scope` tie that code back to the sheet. DDD/APP/PERF ids cited below are the ones of `ddd-rules.md` and `architecture-rules.md`: read the line of an id before invoking it.

| Axis | What counts as a deviation | Evidence required to report it |
|------|----------------------------|--------------------------------|
| Correctness | Untreated error path, absence or `null` unhandled, wrong comparison boundary, operation order leaving an invalid intermediate state, swallowed exception, silent default value masking a failure, concurrent write on the same aggregate with no concurrency handling. A command modifying or saving more than one aggregate outside a DDD-08 exception stated with its consistency. A persistence-constraint violation not translated into a domain exception (APP-03), or translated through a generic filter such as `Contains("duplicate")` instead of a filter naming the index — an upstream uniqueness check is an early failure, not a deviation; the missing translation is. | A concrete breaking scenario, `inputs X → wrong behaviour Y`. Without a scenario, do not report the finding. |
| Reuse | A type, service, VO or method created while an existing element covers the need, or 80 % of it. A second type sharing the shape of an existing one: rename or extend the existing one, do not duplicate. | The existing element as `path:line`. Without a named element, do not report the finding. |
| Simplification | A defensive branch on a case made impossible by an invariant of the batch — symmetrically, an invariant announced in the sheet that removes no branch, loop, grouping or read is itself the deviation. Indirection, wrapper or intermediate mapping with a single caller. Dead code introduced or orphaned by the batch, a parameter never read, an optional parameter or default value no caller ever supplies, an abstraction with no second implementer. Nullable collection in Domain/Application, or an optional concept tested with `is null` at every use instead of being modelled (DDD-11). **Pre-existing** dead code is reported as Minor: demanding its removal is outside the batch's scope. | The line and the concrete effect. No stylistic preference, no alternative-architecture suggestion, no proposed rewrite. |
| Cost | Repository call inside an input-driven loop, unbounded read, `Include` of a collection growing without limit, materialisation before filtering, one query per element (PERF-01). A bounded cost that differs from the one announced in the sheet is a `Plan` deviation, not a code one. | idem |
| Placement | Business rule or validation carried by a handler, a repository, Infrastructure or WebAPI instead of the aggregate concerned (DDD-02, APP-04) — the handler orchestrates load, business call and save, it does not decide. Business operation carried by a helper or a static service receiving a business object's state; Domain Service neither stateless nor justified (DDD-09). A rule owned by an external system (products/keys, delegation, organisation catalogue) replayed here, or the target of a transfer validated by mere existence instead of delegation. `Create()` and `Restore()` conflated, or a repository that is not aggregate-centred (DDD-06, APP-03). A resource limit hand-rewritten in a handler or carried by the Domain instead of its owner (APP-05): WebAPI `RequestLimits`/rate limiting for transport, `PaginationBounds` when the query is created, `QueryLimits` for the read cap; an unpaginated read with no cap. Exception: a pre-check duplicating an authority named elsewhere (persistence constraint, external system) is a deviation only if it is the **sole** owner of the rule. | idem |
| Comments | A comment or XML `///` doc present in production code. Intent is carried by naming. | The line. |
| Test | Aggregate tested directly, query handler asserted on anything but its returned result, command handler asserted on anything but the type and content of `SavedEvents`, any interaction assertion (spy, counter, `CallCount`, `Called`, `Received`, `Verify`) — the four rules of `test-scope.md` §5. Wrong or missing level (§1 of the same file): a diff hunk touching `src/{{PRODUCT}}.Infrastructure/` with no integration test and no waiver written in the sheet, a contract test with no route changed. | The test as `path:line`, or the Infrastructure hunk left uncovered. |
| Plan | An RM/CU with no code owner. A test written without its `[Trait("RM", "{HandlerFolder}/{RM\|RL-xx}")]`, or a trait citing a rule absent from the handler's table. A DDD/APP/PERF id missing from the coverage, an `N/A` without a reason, or an id applied with no owner. TDD evidence (RED, GREEN, COST) ticked where nothing was observed — **except** the declarative artifacts of `common-rules.md` §4.5 (EF entity and configuration, `DbSet`, migration, `Abstractions.Models` DTO) written by the orchestrator with no red before them: assumed, not a deviation, as long as they carry no branch, validation or mapping decision. A non-obvious decision settled mid-batch and absent from the sheet's `## Assumptions` — what is assumed, and who validates it. | The RM/CU or the id, and the place where the evidence is missing. |
| Scope | A diff hunk with no RM/CU nor sheet step carrying it. Refactor, renaming, reformatting or reorganisation of code that worked and that the batch had no reason to modify. Fixing an adjacent bug outside the batch's RM/CU. Unrequested removal of pre-existing dead code or of a pre-existing comment outside the touched lines. Flexibility, configurability or abstraction added with no expressed need. | The hunk as `path:line` + the missing RM/CU or sheet step. A line required by the delivered behaviour — a propagated signature, a DI registration, a `using` that became necessary — is traced: that is not a deviation. |

**Search is scoped.** A repository-wide `grep -rn` is allowed for one purpose only: producing the `path:line` of the existing element that proves a `Reuse` or `Placement` deviation. Scope it to the layer folder concerned, never to the repository root, and prefer `graphify explain "X"` or `graphify affected "X"` — they return the relation, where a `grep` returns every matching line. Never grep for what the supplied diff or the sheet's FX section already carries.

**A finding without its evidence is not reported.** Symmetrically, missing evidence is never a favourable assumption: cite the file and the line where the deviation is observed, or say the point could not be verified.

Never propose adding a comment, an XML doc, an anticipatory abstraction or an aggregate test in isolation: those are deviations, not fixes.

**Classify every code/plan divergence before reporting it**, in one explicit line:

- **Faulty code** — the plan is still right, the implementation departs from it. Expected fix: the code.
- **Stale plan** — the implementation is better, or a decision was settled mid-batch. Expected fix: the sheet, plus the source spec if an RM/CU moves. Severity **Major**, never blocking.
- **Unsettleable divergence** — both readings hold. Report both and leave the arbitration to the user. Do not decide in the plan's place.

An RM/CU with no code owner stays blocking in all three cases: that is a hole, not a divergence. Traceability reads both ways: RM → code, and code → RM.

### 3. Run the minimal validations

Runner, filters, suite scope and integration-test filter construction → `.claude/skills/implement-tdd/references/test-scope.md`. Single source, shared with `/implement-tdd`: do not restate it, apply it.

**The volume of tests executed is an audit decision, not a reflex.** A suite run whole where a filter would have done proves nothing more and costs several minutes. Never re-run identically what `/implement-tdd` has just run: check the reported exit code, and run yourself only what is missing, or what was scoped too narrowly.

1. `rtk dotnet build --no-restore` and **`ArchitectureTests` in full**: the capture has already run both, under the conditions of §2 of that file. Read their exit codes, never re-run them. What `ArchitectureTests` locks (naming, CQRS, dependencies, encapsulation, registration) does not have to be re-argued in the verdict, what it breaks is blocking. Run them yourself only when no capture was supplied.
2. The tests and projects named in the sheet: targeted filter first; target project without a filter if the filter is not usable.
3. The suites the diff makes mandatory, whole or filtered per §2 of that file — this is the part the capture deliberately leaves to the audit. **`IntegrationTests` stays filtered**, `full` mode included.
4. `full` mode: adds `UnitTests` and `ContractTests` in full.

Never declare a test green without exit code `0`. Distinguish a test not run, skipped and failed. In the verdict, the `Validations` line carries each command's **scope**, not just its exit code: a filter presented without its scope reads as a full suite.

## Severities

These labels are written verbatim into the verdict.

- **Blocking** — direct aggregate test, interaction assertion, RM/CU with no code owner, unclassified id, rule applied with no owner, red `ArchitectureTests`, diff touching `src/{{PRODUCT}}.Infrastructure/` with no integration test and no written waiver, TDD evidence ticked without actual observation, and any **Correctness** deviation carrying a breaking scenario.
- **Major** — missed reuse of a named existing element, unbounded cost, business rule outside its aggregate, resource limit outside WebAPI, comment in production, stale plan, hunk outside the batch's scope, assumption settled mid-batch with no trace in the sheet.
- **Minor** — simplification with no functional consequence, pre-existing dead code reported (an observation, not a request to fix).

Verdict `GAPS` as soon as a Blocking or a Major exists. Minors are listed under a `VALID` verdict without calling it into question.

## Verdict

Do not recap the plan, the files or the logs. One line per RM/CU, command and exit code only; on failure, at most six useful RTK lines. Return the verdict block alone: no preamble, no restatement of what was run beyond the `Validations` line. Ceiling **1.5 kB for `VALID`, 3 kB for `GAPS`** — the calling session carries this text on every one of its later turns. End with one of these two formats, verbatim:

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
