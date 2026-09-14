---
name: plan-implementation
description: "Use when a validated business spec must become a DDD technical plan split into batches before coding. Traces RM/CU, DDD decisions and targeted test scenarios."
argument-hint: "[path of the specification to turn into a plan]"
---

# Implementation plan from a spec

Spec → plan. Unambiguous for `/implement-tdd`; design doc, not code.

$ARGUMENTS

## Mission

Plan split by feature, not layer:

1. Trace every RM-XX + CU-XX to owning code elements.
2. Per element: name, role, public signature, pseudo-code bullets, exact path — existing or new.
3. Classify + trace DDD/Architecture rules: owning aggregate, invariants, consistency, events, boundaries, access cost.
4. Test scenarios + RM + level (unit: handlers; integration: repositories; contract: endpoints; E2E: lifecycle) + anchors: test class file, fixture, shared builders, doubles.
5. Respect `/implement-tdd` conventions + `/tests-*` skills.

No final code: no method bodies, assertions, SQL. Plan = what, why, where, order.

## Workflow

### 1. Understand

1. Read spec fully.
2. Read `references/ddd-rules.md` + `references/architecture-rules.md`. Each id → `applied` or `N/A — reason` in global plan. Sheet cites applied ids only. `references/ddd-examples.md` only if id ambiguous.
3. Inventory bounded context: delegate, never walk here (`Read`/`cat`/`sed`/`grep` under `src/` or `tests/` attaches layer rules to every later turn). `graphify explain "<Aggregate>"` first, then one `Explore` subagent (`model: haiku`, a `description`, prompt naming `graphify explain|path|query` before grep), contract:

   ```text
   Bounded context: … — spec: [path] — need: [one sentence]
   Return `path:line` tables, 60 lines max, no code excerpt:
   1. Aggregates, value objects, entities, domain interfaces reusable for the need — exact names
   2. Repositories, handlers, endpoints owning the same business act or a similar one; per handler, the path of its folder CLAUDE.md
   3. Routes of the context in Endpoints/Endpoints.cs (collision risk)
   4. Test anchors: test class file and fixture per handler of item 2; contract fixture and .verified.txt per route of item 3; builders and doubles under tests/{{PRODUCT}}.CoreTests/ for the aggregates of item 1
   5. Local conventions of the context — naming, folder layout — one line each
   ```

   Only file you open: folder `CLAUDE.md` of handler owning same business act, bounded to `## Règles métier` table — rewrite vs twin = your call. Inventory → "1. Scope > Reuse".
4. Blast radius per existing type modified: one `graphify affected "<Type>"` per aggregate, VO, domain interface already in `src/`; new type: skip. Roll up per project (`grep -oE '(src|tests)/[^/]+' | sort | uniq -c | sort -rn`), never paste file:line. Rollup → "1. Scope" as measured cost; drives split (step 2) — radius over four test projects = own batch.
5. Blocking technical ambiguity → AskUserQuestion before planning (≤4 decisions/call, recommended answer first). No plan while blocking question open.
6. Technical challenge — ≤3 AskUserQuestion questions, only if answer removes work:
   - Ship without new type, service, endpoint, table?
   - Extending existing covers 80 % (see Maximum reuse)?
   - Which scope part waits for later batch without blocking value?

   Skip if obvious from inventory. Scope-reducing answer → section Scope.

### 2. Split

Cross-cutting functional batches (Domain + App + Infra + WebAPI + tests), each independently deliverable, build green.

Status per batch: `sequential` default, or `parallelisable with F?` (two worktrees). Parallelisable only if prerequisites done + nothing shared — functional dependency, file, fixture, configuration, migration, route. Same aggregate, handler, endpoint, `.csproj`, DI, EF migration, test fixture → sequential. Concrete reason in plan; doubt → sequential.

### 3. Write

1. Read `references/plan-template.md` first. Two levels, one folder:
   - `todo/[code-kebab-case]/` — where `/business-spec` wrote `SPEC-[code-kebab-case].md`. Reuse; create only if absent.
   - Global plan (`[CODE]-PLAN.md`): compact, tables, <2 min read per batch.
   - Batch sheets (`[CODE]-PLAN-F1.md`, `-F2.md`…): detail per batch. `/implement-tdd batch F1` loads global plan by section + F1 sheet alone.
2. Handler doc — per handler created/modified: sheet step updating handler folder `CLAUDE.md` (business rules, flow + access cost, events). New handler or changed intent → also parent feature index `CLAUDE.md` (link, intent). Format: `/implement-tdd` `references/claude-md-handler.md`.
3. Self-validation: re-read plan vs checklist. Deviation → fix plan. Doubt on business intent → ask user.
4. Summary: batch count, RM/CU traced, files produced, folder path.

## Execution-plan rules (3.FX.3)

- Step = end-to-end business behaviour, not layer, not file
- One step = one production artifact: Command/Query+Handler, endpoint, repository. Two steps on same handler + same aggregate method = one step. Guard, refusal, uniqueness/visibility check on method already in a step = not a step — extra scenario on its `Tests` line.
- Every step → ≥1 test named per target skill convention + RM + target test project: unit/integration/E2E `Should{result}_When{condition}`, contract `Should{Action}()`. Unnameable behaviour = internal mechanism ("scan", "detect", "map", "convert") → recast as behaviour. Paths → sheet `## Ancrages`; assertions → `/tests-*` skills.
- 2-5 behaviour steps per batch + documentation step + verification step. Past 6: split hit rule level → regroup by target method. Legitimately >8 → split batch in two.
- Last step = `dotnet build` + `dotnet test`, named scope: whole suites, filtered project + filter root, suites skipped + why. Bare "`dotnet test`" = weak criterion
- No meta-step, pure-layer step, file-only step

## Plan contents

### Global plan (`-PLAN.md`)

WHAT + WHY + ORDER. <2 min read per batch.

MUST: compact table per batch (Layer | Element | Action | Detail), RM/CU → code traceability, test scenario names + RM, non-obvious decisions, explicit reuse, link to sheet + execution status (dependencies, parallelisation).

FORBIDDEN: signatures, pseudo-code, file paths, fixture/mock/builder structure, anything derivable from `.claude/rules/*.md`.

### Batch sheets (`-PLAN-FX.md`)

Enough detail for `/implement-tdd`. 1 file = 1 batch.

MUST: exact element names (`/implement-tdd` conventions), public signatures, pseudo-code bullets. Design section: applied DDD/APP/PERF ids, owning aggregate, invariants + RM, consistency, internal events + payload, induced simplifications, access cost. Empty Assumptions section, filled by `/implement-tdd` mid-batch (`Hn — [assumption] — to be validated by [who]`). Test scenarios + RM + target project: unit test per handler behaviour; integration test as soon as element lives in `src/{{PRODUCT}}.Infrastructure/` (repository, EF mapper, entity configuration, persistence-exception translation); contract test if route changes; E2E only for multi-operation lifecycle. Sole integration waiver: element without persistence effect — DI registration, adapter of already-doubled external service — written in sheet with reason.

`## Ancrages` table, one row per step: exact path of test class + fixture, `tests/{{PRODUCT}}.CoreTests/` builders + doubles extended (member to add), production files filled/created; contract step: fixture + `.verified.txt`. Existing path from inventory (1.3); new file carries future path, mirrored on sibling it imitates. Path not copyable from sheet = plan hole.

FORBIDDEN: C# method bodies, test assertions, SQL/DDL, LINQ, full DI configuration, internal structure of fixture/mock/builder (test skills own it), long justifications.

## Conventions

DDD naming + layer conventions → `.claude/rules/*.md` (auto-loaded on layer file read, subagents included). Don't duplicate.

Design rules: `references/ddd-rules.md`, `architecture-rules.md`; counter-examples: `references/ddd-examples.md`. Don't copy into sheet: cite ids, apply.

## Maximum reuse

Before new class/service/VO: find mechanism already doing 80 %+. Extend, don't create.

- Business act already owned by handler → rewrite it, never second parallel use case. Same for endpoint: existing route evolves, no twin.
- Existing type of same shape → rename/extend, no second record.
- Existing method, similar pattern → optional parameter or overload, not new service
- Existing dictionary/lookup (`DiagramDependencies`, handler mapping) → reuse, no new mapping VO; existing filtering/exclusion (`excludedNodeIds` in `DuplicateInternal`) → extend; existing Application service (`PortBreakingDetection`) → call directly, no wrapper

In plan: every "new" element justifies why existing insufficient. Weak justification = extension.

## Self-validation checklist

- DDD naming conforms (`Naming` tables of `.claude/rules/*.md`)
- Business logic in Domain/Application, not WebAPI; Commands → ID; Queries → direct payload (`Paging<T>` / `IReadOnlyList<T>` / aggregate), never `Result<T>`
- Every DDD/APP/PERF id `applied` or `N/A — reason`; every batch cites applied ids with aggregate, invariants, consistency, internal event, cost
- Every RM/CU → ≥1 named test; every step has `## Ancrages` row, existing paths from inventory, never guessed
- Tests: query handler = mock fed + result; command handler = type + content of `SavedEvents`; never spy, counter, call assertion. E2E only when ≥2 chained business operations
- Element in `src/{{PRODUCT}}.Infrastructure/` → ≥1 integration scenario, or written waiver + reason
- No "new" where existing suffices; no second handler/endpoint for owned act; nothing for flexibility/extension spec doesn't express
- Feasibility: dependencies resolved, no unflagged breaking change; no EF migration planned (other project — schema change flagged, not scheduled)
- Last step names test scope in Microsoft.Testing.Platform form (`--project` + `--filter-class`): VSTest `--filter "FullyQualifiedName~..."` doesn't exist here
- Every sheet has `Assumptions` section, empty at writing
- Every batch `sequential` or parallelisable with single other batch, stating finished dependencies + no shared files, configurations, fixtures
- No unresolved ambiguity: blocking question asked, not assumed

## Next step

End with: `→ Manual plan validation required. Once validated: /implement-tdd batch F1`.
