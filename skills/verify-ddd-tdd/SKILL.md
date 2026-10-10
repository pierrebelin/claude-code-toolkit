---
name: verify-ddd-tdd
description: "Check, after /implement-tdd, that a .NET batch respects the coding rules — correctness, reuse, simplification, cost — then its conformance to the plan, its handler test policy and its TDD evidence. Use before moving to the next batch, in fast mode by default or full on explicit request."
context: fork
agent: cctoolkit:ddd-tdd-auditor
background: false
---

# DDD + TDD verification

Audit, never modify. Covers a batch implemented by `/implement-tdd`, never a feature without plan. `rtk dotnet` for validations.

One table (§2): code axes first — correctness, reuse, simplification, cost, placement, comments — judging delivered code as is; then the axes tying code to the sheet — test policy, plan traceability, scope. The plan is not the ultimate reference: it may change mid-batch, so a code/plan gap gets classified (§2).

$ARGUMENTS

## Modes

- **Fast**, default: global plan + batch sheet, DDD/APP/PERF coverage, applied ids, diff, modified files, targeted tests.
- **Full**, with `full` in argument: widens to touched boundaries, adds whole fast suites (§3.4). Never the whole `IntegrationTests` suite.
- **Resume**, with `resume`: re-audit after correction. Scope = previous verdict's deviation table + diff since, both supplied by the caller. Re-judge only the axes and suites those deviations reach; nothing already verdicted is re-established.

Coverage: read the compact indexes `ddd-rules.md` + `architecture-rules.md` (under 6 kB), then the lines of the ids the sheet applies. `ddd-examples.md` only if an id stays ambiguous.

## Workflow

### 1. Establish the scope

1. Require `batch FX`. The caller supplies the sheet's FX section and the capture of `scripts/audit-capture.sh`: status, `diff --check`, modified files, diff, `rules-coverage.py --untested` and `--ids <sheet>`, `access-cost.py --diff`, build / `ArchitectureTests` exit codes. Use it as is; read the plan or sheet yourself only if missing or contradicting the repo. No capture → produce status, check and diff yourself, one command.
2. No full coverage, or no **Design** section: still audit the code (§2), report the plan gap as **Major**, fix = update sheet. Every id is `applied` on a sheet `kit:applied-rules` row, or `N/A — reason` once on the global plan's `kit:na-rules` line. The capture's `not cited` line settles the mechanical half — an id listed there = **Blocking** unclassified id. Yours: whether a stated `N/A` reason holds. Never infer design from the implementation.
3. Walk the diff **hunk by hunk**, tie each to an RM/CU or sheet step; untied = **Scope** deviation. Read beyond a hunk only when the axis being judged needs it. Expected diff already committed → require an explicit base in argument.

### 2. Audit the delivered code

One table, one pass, over the batch diff. A green test proves nothing here. Ids cited = those of `ddd-rules.md` + `architecture-rules.md`: read the id line before invoking it.

| Axis | What counts as a deviation | Evidence required to report it |
|------|----------------------------|--------------------------------|
| Correctness | Untreated error path; absence or `null` unhandled; wrong comparison boundary; operation order leaving invalid intermediate state; swallowed exception; silent default masking failure; concurrent write on same aggregate, no concurrency handling. Command modifying or saving >1 aggregate outside DDD-08 exception stated with its consistency. Persistence-constraint violation not translated into domain exception (APP-03), or translated by generic filter (`Contains("duplicate")`) instead of one naming index — upstream uniqueness check = early failure, not deviation; missing translation = deviation. | Concrete breaking scenario, `inputs X → wrong behaviour Y`. No scenario → no report. |
| Reuse | Type, service, VO or method created while existing element covers need, or 80 % of it. Second type of existing shape: rename or extend existing, never duplicate. | Existing element as `path:line`. No named element → no report. |
| Simplification | Defensive branch on case an invariant of batch makes impossible — symmetrically, invariant announced in sheet removing no branch, loop, grouping or read is itself deviation. Indirection, wrapper or intermediate mapping with single caller. Dead code introduced or orphaned by batch; parameter never read; optional parameter or default no caller supplies; abstraction with no second implementer. Nullable collection in Domain/Application, or optional concept tested `is null` at every use instead of modelled (DDD-11). **Pre-existing** dead code = Minor: removing it lies outside batch scope, unless batch worsens it (§2 `Worsened`). | Line + concrete effect. No stylistic preference, no alternative-architecture suggestion, no proposed rewrite. |
| Cost | Capture's access-cost section lists the calls: judge from it, open a hunk only for an unclassified receiver or an `Include`. Flag on a line the batch added = deviation; on a pre-existing line = Minor, outside batch, unless batch worsens it (§2 `Worsened`). Repository call inside input-driven loop; unbounded read; `Include` of collection growing without limit; materialisation before filtering; one query per element (PERF-01). Bounded cost differing from sheet = `Plan` deviation, not code one. | idem |
| Placement | Business rule or validation carried by handler, repository, Infrastructure or WebAPI instead of aggregate concerned (DDD-02, APP-04) — handler orchestrates load, business call, save; never decides. Business operation in helper or static service receiving business object state; Domain Service neither stateless nor justified (DDD-09). Rule owned by external system (identity provider, external catalogue, organisation directory) replayed here, or share/transfer target validated by mere existence instead of the relationship authorising it. `Create()` and `Restore()` conflated, or repository not aggregate-centred (DDD-06, APP-03). Resource limit hand-rewritten in handler or carried by Domain instead of its owner (APP-05): WebAPI `RequestLimits`/rate limiting for transport, `PaginationBounds` at query creation, `QueryLimits` for read cap; unpaginated read with no cap. Exception: pre-check duplicating authority named elsewhere (persistence constraint, external system) is deviation only if **sole** owner of rule. | idem |
| Comments | Comment the code makes useless: paraphrase of the code, change narrative, ticket number, stale statement; XML `///` doc in a file that carries none. A comment giving a constraint, decision or workaround the code cannot carry is not a deviation. `pre-audit` lists added comments without failing: judge each from the capture's diff. | The line + what in the code already says it. |
| Test | Aggregate tested directly; query handler asserted on anything but returned result; command handler asserted on anything but type and content of `SavedEvents`; any interaction assertion in a handler/unit test (spy, counter, `CallCount`, `Called`, `Received`, mock `Verify`) — four rules of `test-scope.md` §5; Verify snapshot of a contract test is not an interaction. Wrong or missing level (§1 of same file): diff hunk touching `src/{{PRODUCT}}.Infrastructure/` with no integration test and no waiver in sheet; contract test with no route changed. | Test as `path:line`, or uncovered Infrastructure hunk. |
| Plan | RM/CU with no code owner. Test without its `[Trait("RM", "{HandlerFolder}/{RM\|RL-xx}")]`, or trait citing rule absent from handler table. Id missing from coverage; `N/A` without reason; id applied with no owner. TDD evidence (RED, GREEN, COST) ticked where nothing observed — **except** declarative artifacts listed in `common-rules.md` §4.5, written by orchestrator with no red before them: assumed, not deviation, as long as they carry no branch, validation or mapping decision. Non-obvious decision settled mid-batch, absent from sheet `## Assumptions` — what is assumed, who validates it. | RM/CU or id, and where evidence is missing. |
| Scope | Diff hunk with no RM/CU nor sheet step carrying it. Refactor, renaming, reformatting, reorganisation of working code batch had no reason to touch. Adjacent bug fixed outside batch RM/CU. Unrequested removal of pre-existing dead code or comment outside touched lines. Flexibility, configurability or abstraction with no expressed need. | Hunk as `path:line` + missing RM/CU or sheet step. Line required by delivered behaviour — propagated signature, DI registration, newly necessary `using` — is traced: not deviation. |

Locating the existing element behind a `Reuse` or `Placement` deviation: `graphify explain|affected "X"` first, `grep -rn` scoped to the layer folder otherwise.

**`Worsened`** — pre-existing defect the batch makes measurably worse, judged as if batch introduced it: severity of its axis, `Gap` cell prefixed `(worsened)`. Worse means one more of the same thing: one more repository call in an already looping path, one more branch in an already defensive chain, one more copy of an already duplicated block, one more caller of a pre-existing unbounded read. Evidence: pre-existing state (context line of hunk, or `path:line` at base) **and** batch line adding to it. Untouched pre-existing defect, or one batch merely sits next to, stays Minor. Fix expected: only what batch added, never pre-existing part — outside scope.

No evidence → finding not reported. Symmetrically, missing evidence never a favourable assumption: cite file and line where deviation observed, or say point could not be verified.

Don't propose adding a comment, XML doc, anticipatory abstraction or isolated aggregate test: they are deviations, not fixes.

Classify every code/plan divergence before reporting it, one explicit line:

- **Faulty code** — plan still right, implementation departs. Fix: code.
- **Stale plan** — implementation better, or decision settled mid-batch. Fix: sheet, plus source spec if RM/CU moves. Severity Major, never Blocking.
- **Unsettleable divergence** — both readings hold. Report both, arbitration to user. Never decide in plan's place.

RM/CU with no code owner stays blocking in all three cases: hole, not divergence. Traceability reads both ways: RM → code, code → RM.

### 3. Run the minimal validations

Runner, filters, suite scope, integration filter → `skills/implement-tdd/references/test-scope.md`. Test volume is an audit decision: never re-run what `/implement-tdd` or the capture already ran — read its exit code, run only what is missing or was scoped too narrowly.

1. Build + `ArchitectureTests`: exit codes from the capture. What `ArchitectureTests` locks is not re-argued; what it breaks is blocking.
2. Tests named in the sheet: targeted filter first.
3. Suites the diff makes mandatory, whole or filtered per §2 of that file.
4. `full`: adds `UnitTests` + `ContractTests` in full.

No green without exit code `0`. Distinguish not run, skipped, failed. The `Validations` line carries each command's **scope**: a filter without scope reads as a full suite.

## Severities

- **Blocking** — any of the four rules of `test-scope.md` §5, RM/CU with no code owner, unclassified id, rule applied with no owner, red `ArchitectureTests`, diff touching `src/{{PRODUCT}}.Infrastructure/` with no integration test and no written waiver, TDD evidence ticked without observation, any Correctness deviation carrying breaking scenario.
- **Major** — missed reuse of named existing element, unbounded cost, business rule outside its aggregate, resource limit outside its owner (APP-05: WebAPI `RequestLimits`, `PaginationBounds`, `QueryLimits`), comment in production, stale plan, hunk outside batch scope, assumption settled mid-batch with no trace in sheet.
- **Minor** — simplification with no functional consequence, pre-existing dead code or cost reported (observation, not request to fix). Pre-existing defect worsened by batch is never Minor by origin: severity of its axis.

Verdict `GAPS` as soon as Blocking or Major exists. Minors listed under `VALID` verdict without calling it into question.

## Verdict

Verdict block alone, no preamble, no recap of plan, files or logs; on failure ≤6 useful RTK lines. Ceiling **1.5 kB for `VALID`, 3 kB for `GAPS`** — the calling session carries it every later turn. Headings, severities and axis labels are frozen literals (`learn-candidates.py` parses them). End with one of these two formats, verbatim:

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
| Major | Cost | (worsened) Second repository call in a pre-existing loop | `path:line` | Remove the call the batch added |
| Major | Plan | Stale plan: decision settled mid-batch, missing from the sheet | `path:line` | Update the sheet, and the spec if an RM moves |
| Major | Scope | Hunk with no RM/CU nor owning step | `path:line` | Revert the hunk, or tie it to a step of the sheet |

Validations: `[command]` — exit N, scope `[filter or "whole suite"]` / not run
```

Fix nothing here; fixing belongs to `/implement-tdd`.
