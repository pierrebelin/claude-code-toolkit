---
name: plan-implementation
description: "Use when a validated business spec must become a DDD technical plan split into batches before coding. Traces RM/CU, DDD decisions and targeted test scenarios."
argument-hint: "[path of the specification to turn into a plan]"
---

# Implementation plan from a spec

**Implementation plan** from a business spec. Detailed enough for `/implement-tdd` to work without ambiguity, while staying a design document (not final code).

$ARGUMENTS

## Mission

Spec → a plan **split by feature** (not by layer):

1. Trace every **RM-XX** + **CU-XX** to the code elements that own it.
2. Describe every element: **name**, **role**, **public signature**, **pseudo-code bullets**.
3. Classify and trace the **DDD and Architecture rules**: owning aggregate, invariants, consistency, events, boundaries and access cost.
4. List the **test scenarios** + their RM + the right level: unit test for handlers, integration test for repositories, contract test for endpoints, E2E for a lifecycle.
5. Respect the `/implement-tdd` conventions and the `/tests-*` skills.

**No final code**: no method bodies, no assertions, no SQL. A plan is **what**, **why**, **in which order**.

## Approach

### Phase 1 — Understand

1. Read the spec in full.
2. Read `references/ddd-rules.md` and `references/architecture-rules.md`. Classify each id as `applied` or `N/A — reason` in the global plan. A batch sheet then references only the applied ids. Read `references/ddd-examples.md` only if a retained id stays ambiguous.
3. Explore `src/`: aggregates, repositories, handlers, endpoints, existing VOs, naming conventions, test builders and doubles (`tests/{{PRODUCT}}.CoreTests/`).
4. **Analyse the target codebase** — scan the bounded context, brief:
   - Reusable VOs/entities/aggregates (exact names)
   - Similar or conflicting repositories/handlers/endpoints
   - **A handler that already owns the same business act**: read its folder `CLAUDE.md` before concluding
   - Routes in `Endpoints/Endpoints.cs` (collision risk)
   - Local patterns of the bounded context (naming, conventions)
   - Document it in section "1. Scope > Reuse".
5. Blocking technical ambiguities → **ask the user before planning** through **AskUserQuestion** (≤4 decisions per call, recommended answer as the first option). No plan while a blocking question is open.
6. **Technical challenge** — at most 3 questions through **AskUserQuestion**, only if an answer can **remove work**:
   - Can this need ship without a new type, service, endpoint or table?
   - Does extending an existing element cover 80 % of the need (see Maximum reuse)?
   - Which part of the scope can wait for a later batch without blocking the value?
   Skip it when the answers are obvious from the exploration. An answer that reduces scope is carried into the plan, section Scope.

### Phase 2 — Split

Cross-cutting functional batches (Domain + App + Infra + WebAPI + tests). Each batch independently deliverable, build green.

For each batch, also establish its **execution status**: `sequential` by default, or `parallelisable with F?` in two worktrees. Declare two batches parallelisable only if their prerequisites are already finished and they share no functional dependency, no file, fixture, configuration, migration or route. Work on the same aggregate, handler, endpoint, `.csproj` project, DI, EF migration or test fixture is sequential. State the concrete reason in the plan; at the slightest doubt, sequential.

### Phase 3 — Write

**Read the `references/plan-template.md` template first.** Two levels:

1. **Folder** `todo/[code-kebab-case]/` — the one where `/business-spec` wrote `SPEC-[code-kebab-case].md`. Reuse it; create it only if it does not exist.
2. **Global plan** (`[CODE]-PLAN.md`): compact view, tables, readable in under 2 minutes per batch. In that folder.
3. **Batch sheets** (`[CODE]-PLAN-F1.md`, `-F2.md`…): technical detail per batch. `/implement-tdd batch F1` loads the global plan + the F1 sheet alone. Same folder.

## Execution-plan rules (3.FX.3)

- A step is an **end-to-end business behaviour**, not a layer, not a file
- **One step = one production artifact**: a Command/Query+Handler, an endpoint, a repository. Two steps whose target production code is the same handler and the same aggregate method are **one step**. A guard, a refusal, a uniqueness check or a visibility check on a method already carried by a step is **not a step** — it is one more scenario of that step, listed on its `Tests` line. Splitting them buys a separate TDD cycle (a subagent launch, a report, a re-read of the same two files) for code that ships as one method.
- Every step → **≥1 test named after the target skill's convention** + its RM + the target test project: unit/integration/E2E `Should{result}_When{condition}`, contract `Should{Action}()`. A step with no nameable business behaviour is an internal mechanism ("scan", "detect", "map", "convert") → **recast it as a behaviour**. No file paths and no assertions (→ the `/tests-*` skills).
- **2-5 behaviour steps per batch**, plus the documentation step and the verification step. Past 6, the split went down to the rule instead of the artifact: regroup by target method before writing the sheet. A batch legitimately needing more than 8 is a batch to split in two.
- The last step is `dotnet build` + `dotnet test` with its **named scope**: suites run whole, filtered project and filter root, suites deliberately not run and why. A bare "`dotnet test`" is a weak success criterion
- No meta-step, no pure-layer step, no file-only step

## Plan contents

### Global plan (`-PLAN.md`)

**Principle**: WHAT + WHY + ORDER. Readable in under 2 minutes per batch.

**MUST**: a compact table per batch (Layer | Element | Action | Detail), RM/CU → code traceability, test scenario names + RM, non-obvious decisions, explicit reuse, link to the batch sheet and its execution status (dependencies + possible parallelisation).

**FORBIDDEN**: signatures, pseudo-code, fixture/mock/builder structure, any detail derivable from the layer rules (`.claude/rules/*.md`).

### Batch sheets (`-PLAN-FX.md`)

**Principle**: enough technical detail for `/implement-tdd`. 1 file = 1 batch.

**MUST**: exact element names (`/implement-tdd` conventions), public signatures, pseudo-code bullets, a **Design** section with the applied DDD/APP/PERF ids, owning aggregate, invariants + RM, consistency, internal events + payload, induced simplifications and access cost. Provide an empty **Assumptions** section, which `/implement-tdd` fills in during the batch (`Hn — [assumption] — to be validated by [who]`). List the test scenarios + RM + target project: a handler unit test is mandatory for a business behaviour, **an integration test is mandatory as soon as an element of the batch lives in `src/{{PRODUCT}}.Infrastructure/`** (repository, EF mapper, entity configuration, persistence-exception translation), a contract test if a route changes, E2E only for a multi-operation lifecycle. A waiver on the integration test only for an element with no effect on persistence — DI registration, adapter of an already-doubled external service — written in the sheet with its reason. No file paths and no assertions → the `/tests-*` skills.

**FORBIDDEN**: C# method bodies, test assertions, SQL/DDL, LINQ, full DI configuration, fixture/mock/builder structure (delegated to the test skills), long justifications.

## Conventions

DDD naming and per-layer conventions → **`.claude/rules/*.md`** (loaded automatically as soon as a file of the layer is read, subagents included). Do not duplicate them here.

Design rules live in `references/ddd-rules.md` and `architecture-rules.md`, DDD counter-examples in `references/ddd-examples.md`. Do not duplicate them into a sheet: cite the ids, then apply them to the context.

## Workflow

1. **Read the spec** in full.
2. **Explore the bounded context's code** — what is reusable, what the conventions are.
3. **Blocking questions** through **AskUserQuestion** (recommended answer first). **No plan while answers are missing.** Then the **technical challenge** (Phase 1 §6) if an answer can remove work.
4. **Folder** `todo/[code-kebab-case]/` (the spec's).
5. **Write the global plan** (`-PLAN.md`) + the **batch sheets** (`-PLAN-F1.md`…) in that folder.
6. **Handler documentation** — for every handler created or modified by the plan, provide for updating the handler folder's `CLAUDE.md` (business rules, flow + access cost, events). New handler or changed intent → also provide for updating the parent feature folder's index `CLAUDE.md` (link, intent, rule count). Format: `/implement-tdd` `references/claude-md-handler.md`. Add it as a step in the batch sheet.
7. **Self-validation** — re-read the produced plan and check:
   - DDD naming conforms (the `Naming` tables of `.claude/rules/*.md`) for every proposed element
   - Architecture: business logic in Domain/Application (not WebAPI), Commands → ID, Queries → direct payload (`Paging<T>` / `IReadOnlyList<T>` / aggregate), never `Result<T>`
   - Every DDD/APP/PERF id is classified `applied` or `N/A — reason` in the global plan; no silent omission
   - Every batch references its applied ids; aggregate, invariants, consistency, internal event and cost are explicit
   - Every RM/CU → at least one test named after the target skill's convention
   - Tests: query handler = mock fed with data + result; command handler = type + content of `SavedEvents`; never a spy, a counter or a call assertion
   - Every batch with an element living in `src/{{PRODUCT}}.Infrastructure/` carries at least one integration-test scenario, or a written waiver with its reason
   - E2E chosen only when a scenario covers at least two chained business operations
   - No "new" element where the existing one suffices (see Maximum reuse)
   - Feasibility: dependencies resolved, no unflagged breaking change
   - Each batch's last step names the expected test scope, not a bare `dotnet test`
   - Every batch sheet carries an `Assumptions` section, empty at writing time
   - No element planned for flexibility, configurability or an extension not expressed in the spec
   - Every batch is `sequential` or explicitly declared parallelisable with a single other batch; a parallelisation states finished dependencies and the absence of shared files, configurations and fixtures
   Deviation → fix the plan directly. Doubt about business intent → ask the user.
8. **Summary**: number of batches, RM/CU traced, files produced, folder path.

## Maximum reuse

**Before a new class/service/VO**: look in the existing code for a mechanism already doing 80 %+. Enrich and extend it, do not create something new.

- **The same business act already owned by a handler** → **rewrite that handler**, never a second parallel use case. Two handlers for one act means two business rules drifting apart. The same holds for the endpoint and the contract: the existing route evolves, a twin is not opened.
- **An existing type of the same shape** → rename/extend the existing type, do not create a second identical record.
- **An existing method with a similar pattern** → an optional parameter or an overload, not a new service
- **A dictionary/lookup already in place** (e.g. `DiagramDependencies`, handler mapping) → reuse it, not a new mapping VO
- **Existing filtering/exclusion** (e.g. `excludedNodeIds` in `DuplicateInternal`) → extend it, do not duplicate
- **An existing Application service** (e.g. `PortBreakingDetection`) → call it directly, no wrapper

**In the plan**: every "new" element → justify why the existing one does not suffice. A weak justification means it is an extension, not a new element.

## Pitfalls

- Splitting by layer instead of by feature
- Full C# code instead of pseudo-code
- An RM/CU with no code owner = a hole
- A DDD/APP/PERF id missing from the coverage, or an `N/A` without a reason = a hole
- A rule applied with no owning aggregate, or with no concrete effect on the code = a hole
- Test scenarios with no associated RM
- **A second handler/endpoint for a business act already owned**, instead of rewriting the existing one
- A test filter in VSTest syntax (`--filter "FullyQualifiedName~..."`): the runner is Microsoft.Testing.Platform (`--project` + `--filter-class`)
- Planning an EF migration: they live in another project, outside scope, never modified here
- An element planned in `src/{{PRODUCT}}.Infrastructure/` with no integration-test scenario and no written waiver
- E2E chosen for a single endpoint
- A spy, counter or call-count assertion in a handler scenario
- Names not conforming to `/implement-tdd`
- A plan with unresolved ambiguities
- Non-existent elements referenced without Grep/Read
- **Creating classes/services where enriching the existing one suffices**
- An element planned "for later": flexibility, configurability or an extension point with no need expressed in the spec
- A last "build + test" step with no named scope

## Next step

End with: `→ Manual plan validation required. Once validated: /implement-tdd batch F1`.
