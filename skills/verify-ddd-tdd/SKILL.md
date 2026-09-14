---
name: verify-ddd-tdd
description: "Check, after /implement-tdd, that a .NET batch respects the coding rules — correctness, reuse, simplification, cost — then its conformance to the plan, its handler test policy and its TDD evidence. Use before moving to the next batch, in fast mode by default or full on explicit request."
context: fork
agent: ddd-tdd-auditor
background: false
---

# DDD + TDD verification

Audit, never modify. Verdict covers a batch implemented by `/implement-tdd`, never a feature without plan. `rtk dotnet` for validations; never return raw log.

**One audit table** (§2): code axes first — correctness, reuse, simplification, cost, placement, comments — judging delivered code as is, whatever plan announces; then axes tying code to sheet — test policy, plan traceability, scope.

Plan not ultimate reference: modified mid-batch when implementation heads wrong. Code/plan gap gets **classified** (§2), never mechanically "code wrong".

The verdict is read by the user; its headings, severities and axis labels are a fixed format. Never reword them.

$ARGUMENTS

## Modes

- **Fast**, default: global plan + batch sheet, DDD/APP/PERF coverage, applied ids, diff, modified files, targeted tests.
- **Full**, only with `full` in argument: widens to touched boundaries, adds whole fast suites (§3.4). **`full` never authorises whole `IntegrationTests` suite** — stays filtered on impacted context.
- **Resume**, with `resume` in argument, re-audit after correction: scope = previous verdict's deviation table, supplied by caller, + diff since. Skip §1.4 hunk-by-hunk walk and every §2 axis no deviation touches; §3 re-runs only suites corrections reach. Nothing already verdicted gets re-established. §1 shrinks too: no new capture (caller supplies deviation table + diff since previous verdict), no id re-classification — coverage already verdicted. Of compact indexes, read only lines of ids deviations name. (Resume redoing whole §1 still cost 70 % of first pass, 2026-09-08.)

Coverage check: read compact indexes `ddd-rules.md` + `architecture-rules.md` directly, under 6 kB total; **never sweep with multi-alternation `grep`** — returns more than files themselves. Then read only lines of ids applied in sheet. `ddd-examples.md` only if id stays ambiguous.

## Workflow

**Steps numbered, calls not.** All not depending on previous result goes in one message: §1 capture + sheet FX section; §2 targeted greps around judged hunks; §3 remaining suites. Turn = one billed round trip, not one call.

### 1. Establish the scope

1. Require `batch FX`. Caller supplies sheet FX section + path of capture from `scripts/audit-capture.sh`: use as is. Locate and read global plan or `*-PLAN-FX.md` sheet yourself **only** if missing or contradicting repo — never re-read whole sheet whose FX section was handed over.
2. **Open capture once, bounded; scope comes from it.** Carries `git status --short`, `git diff --check`, modified files, diff, `rules-coverage.py --untested`, `rules-coverage.py --ids <sheet>`, `access-cost.py --diff` (awaited Infrastructure calls per modified file, loop / lambda / in-memory filter flagged, pre-existing lines marked), `build` / `ArchitectureTests` exit codes. Never re-establish any of it — turn paid for nothing. From sheet take rest: owning aggregate, consistency, cost, test levels, named scenarios.
3. No full coverage, or no **Design** section: still audit delivered code (§2), report plan gap as **Major**, fix = update sheet. Every id `applied` or `N/A — reason`. **Capture `not cited` line settles mechanical half** — id it lists = **Blocking** unclassified id; recounting proves nothing. Yours: judge whether stated `N/A` reason holds. Never reconstruct design from code, never infer it from implementation.
4. Status, check, diff come from capture; produce them yourself, one command, only if no capture supplied. **Never re-read file whole when diff carries its modified lines** — bounded read of hunk context, only when judged axis needs it; no batched `cat` of files diff just showed. Expected diff already committed → require explicit base in argument, never guess history. Walk diff **hunk by hunk**, tie each to RM/CU or sheet step; what ties to nothing = **Scope** deviation (§2).

### 2. Audit the delivered code

One table, one pass, over batch diff. **Axis labels below written verbatim into verdict.** Green test proves nothing here.

`Correctness` → `Comments` judge code as delivered, even if plan incomplete or modified mid-batch. `Test`, `Plan`, `Scope` tie that code to sheet. Ids cited = those of `ddd-rules.md` + `architecture-rules.md`: read id line before invoking it.

| Axis | What counts as a deviation | Evidence required to report it |
|------|----------------------------|--------------------------------|
| Correctness | Untreated error path; absence or `null` unhandled; wrong comparison boundary; operation order leaving invalid intermediate state; swallowed exception; silent default masking failure; concurrent write on same aggregate, no concurrency handling. Command modifying or saving >1 aggregate outside DDD-08 exception stated with its consistency. Persistence-constraint violation not translated into domain exception (APP-03), or translated by generic filter (`Contains("duplicate")`) instead of one naming index — upstream uniqueness check = early failure, not deviation; missing translation = deviation. | Concrete breaking scenario, `inputs X → wrong behaviour Y`. No scenario → no report. |
| Reuse | Type, service, VO or method created while existing element covers need, or 80 % of it. Second type of existing shape: rename or extend existing, never duplicate. | Existing element as `path:line`. No named element → no report. |
| Simplification | Defensive branch on case an invariant of batch makes impossible — symmetrically, invariant announced in sheet removing no branch, loop, grouping or read is itself deviation. Indirection, wrapper or intermediate mapping with single caller. Dead code introduced or orphaned by batch; parameter never read; optional parameter or default no caller supplies; abstraction with no second implementer. Nullable collection in Domain/Application, or optional concept tested `is null` at every use instead of modelled (DDD-11). **Pre-existing** dead code = Minor: removing it lies outside batch scope. | Line + concrete effect. No stylistic preference, no alternative-architecture suggestion, no proposed rewrite. |
| Cost | Capture's access-cost section lists the calls: judge from it, open a hunk only for an unclassified receiver or an `Include`. Flag on a line the batch added = deviation; on a pre-existing line = Minor, outside batch. Repository call inside input-driven loop; unbounded read; `Include` of collection growing without limit; materialisation before filtering; one query per element (PERF-01). Bounded cost differing from sheet = `Plan` deviation, not code one. | idem |
| Placement | Business rule or validation carried by handler, repository, Infrastructure or WebAPI instead of aggregate concerned (DDD-02, APP-04) — handler orchestrates load, business call, save; never decides. Business operation in helper or static service receiving business object state; Domain Service neither stateless nor justified (DDD-09). Rule owned by external system (products/keys, delegation, organisation catalogue) replayed here, or transfer target validated by mere existence instead of delegation. `Create()` and `Restore()` conflated, or repository not aggregate-centred (DDD-06, APP-03). Resource limit hand-rewritten in handler or carried by Domain instead of its owner (APP-05): WebAPI `RequestLimits`/rate limiting for transport, `PaginationBounds` at query creation, `QueryLimits` for read cap; unpaginated read with no cap. Exception: pre-check duplicating authority named elsewhere (persistence constraint, external system) is deviation only if **sole** owner of rule. | idem |
| Comments | Comment or XML `///` doc in production code. Naming carries intent. | The line. |
| Test | Aggregate tested directly; query handler asserted on anything but returned result; command handler asserted on anything but type and content of `SavedEvents`; any interaction assertion (spy, counter, `CallCount`, `Called`, `Received`, `Verify`) — four rules of `test-scope.md` §5. Wrong or missing level (§1 of same file): diff hunk touching `src/{{PRODUCT}}.Infrastructure/` with no integration test and no waiver in sheet; contract test with no route changed. | Test as `path:line`, or uncovered Infrastructure hunk. |
| Plan | RM/CU with no code owner. Test without its `[Trait("RM", "{HandlerFolder}/{RM\|RL-xx}")]`, or trait citing rule absent from handler table. Id missing from coverage; `N/A` without reason; id applied with no owner. TDD evidence (RED, GREEN, COST) ticked where nothing observed — **except** declarative artifacts of `common-rules.md` §4.5 (EF entity and configuration, `DbSet`, migration, `Abstractions.Models` DTO) written by orchestrator with no red before them: assumed, not deviation, as long as they carry no branch, validation or mapping decision. Non-obvious decision settled mid-batch, absent from sheet `## Assumptions` — what is assumed, who validates it. | RM/CU or id, and where evidence is missing. |
| Scope | Diff hunk with no RM/CU nor sheet step carrying it. Refactor, renaming, reformatting, reorganisation of working code batch had no reason to touch. Adjacent bug fixed outside batch RM/CU. Unrequested removal of pre-existing dead code or comment outside touched lines. Flexibility, configurability or abstraction with no expressed need. | Hunk as `path:line` + missing RM/CU or sheet step. Line required by delivered behaviour — propagated signature, DI registration, newly necessary `using` — is traced: not deviation. |

**Search is scoped.** Repo-wide `grep -rn` allowed for one purpose: `path:line` proving `Reuse` or `Placement` deviation. Scope to layer folder concerned, never repo root; prefer `graphify explain "X"` or `graphify affected "X"` — they return relation, `grep` returns every matching line. Never grep what supplied diff or sheet FX section already carries.

**No evidence → finding not reported.** Symmetrically, missing evidence never a favourable assumption: cite file and line where deviation observed, or say point could not be verified.

Never propose adding comment, XML doc, anticipatory abstraction or isolated aggregate test: deviations, not fixes.

**Classify every code/plan divergence before reporting it**, one explicit line:

- **Faulty code** — plan still right, implementation departs. Fix: code.
- **Stale plan** — implementation better, or decision settled mid-batch. Fix: sheet, plus source spec if RM/CU moves. Severity **Major**, never blocking.
- **Unsettleable divergence** — both readings hold. Report both, arbitration to user. Never decide in plan's place.

RM/CU with no code owner stays blocking in all three cases: hole, not divergence. Traceability reads both ways: RM → code, code → RM.

### 3. Run the minimal validations

Runner, filters, suite scope, integration filter construction → `.claude/skills/implement-tdd/references/test-scope.md`. Single source, shared with `/implement-tdd`: apply it, never restate it.

**Test volume = audit decision, not reflex.** Whole suite where filter would do proves nothing more, costs minutes. Never re-run identically what `/implement-tdd` just ran: read its exit code, run only what is missing or was scoped too narrowly.

1. `rtk dotnet build --no-restore` + **`ArchitectureTests` in full**: capture already ran both, under §2 of that file. Read exit codes, never re-run. What `ArchitectureTests` locks (naming, CQRS, dependencies, encapsulation, registration) is not re-argued in verdict; what it breaks is blocking. Run yourself only if no capture supplied.
2. Tests and projects named in sheet: targeted filter first; target project without filter if filter unusable.
3. Suites diff makes mandatory, whole or filtered per §2 of that file — part capture leaves to audit. **`IntegrationTests` stays filtered**, `full` included.
4. `full`: adds `UnitTests` + `ContractTests` in full.

Never green without exit code `0`. Distinguish not run, skipped, failed. `Validations` line carries each command **scope**, not just exit code: filter without scope reads as full suite.

## Severities

Labels written verbatim into verdict.

- **Blocking** — direct aggregate test, interaction assertion, RM/CU with no code owner, unclassified id, rule applied with no owner, red `ArchitectureTests`, diff touching `src/{{PRODUCT}}.Infrastructure/` with no integration test and no written waiver, TDD evidence ticked without observation, any **Correctness** deviation carrying breaking scenario.
- **Major** — missed reuse of named existing element, unbounded cost, business rule outside its aggregate, resource limit outside WebAPI, comment in production, stale plan, hunk outside batch scope, assumption settled mid-batch with no trace in sheet.
- **Minor** — simplification with no functional consequence, pre-existing dead code reported (observation, not request to fix).

Verdict `GAPS` as soon as Blocking or Major exists. Minors listed under `VALID` verdict without calling it into question.

## Verdict

No recap of plan, files or logs. One line per RM/CU, command + exit code only; on failure, ≤6 useful RTK lines. Return verdict block alone: no preamble, no restatement beyond `Validations` line. Ceiling **1.5 kB for `VALID`, 3 kB for `GAPS`** — calling session carries this text every later turn. End with one of these two formats, verbatim:

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

Fix nothing here; fixing belongs to `/implement-tdd`. No write tool in this agent: deviation reported, never repaired.
