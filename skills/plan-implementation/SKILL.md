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

## Workflow

### 1. Understand

0. **Gate — open blocking questions.** Before any read:

   ```bash
   awk '/^## .*<!-- *kit:open-questions *-->/{p=1;next} /^## /{p=0} p && /\| *Blocking *\|/' <spec>
   ```

   Any line → **stop**: list them, end with `→ Open blocking questions: /business-spec to settle them.` No plan while a `Blocking` is open — same contract as `## BLOCKED` in a batch, moved before design.
1. Read spec fully.
2. Read `references/ddd-rules.md` + `references/architecture-rules.md`. Each id → applied in the owning batch sheet (`## Design`), or listed once in global plan `1. Scope` as `N/A — reason`. `references/ddd-examples.md` only if id ambiguous.
3. Inventory the bounded context by delegation: a `Read` under `src/` or `tests/` attaches layer rules to every later turn. `graphify explain "<Aggregate>"` first, then one `Explore` subagent (`model: haiku`):

   ```text
   Bounded context: … — spec: [path] — need: [one sentence]
   Return `path:line` tables, 60 lines max, no code excerpt:
   1. Aggregates, value objects, entities, domain interfaces reusable for the need — exact names
   2. Repositories, handlers, endpoints owning the same business act or a similar one; per handler, the path of its folder CLAUDE.md
   3. Routes of the context in Endpoints/Endpoints.cs (collision risk)
   4. Test anchors: test class file and fixture per handler of item 2; contract fixture and .verified.txt per route of item 3; builders and doubles under tests/{{PRODUCT}}.CoreTests/ for the aggregates of item 1
   5. Local conventions of the context — naming, folder layout — one line each
   ```

   You open only the folder `CLAUDE.md` of the handler owning the same business act, its `kit:rules` table — rewrite vs twin = your call. Inventory → "1. Scope > Reuse".
4. Blast radius per existing type modified: one `graphify affected "<Type>"` per aggregate, VO, domain interface already in `src/`; new type: skip. Roll up per project (`grep -oE '(src|tests)/[^/]+' | sort | uniq -c | sort -rn`), never paste file:line. Rollup → "1. Scope" as measured cost; drives split (step 2) — radius over four test projects = own batch.
5. Blocking technical ambiguity → AskUserQuestion before planning (≤4 decisions/call, recommended answer first).
6. Technical challenge — ≤3 AskUserQuestion questions, only if answer removes work:
   - Ship without new type, service, endpoint, table?
   - Extending existing covers 80 % (see Maximum reuse)?
   - Which scope part waits for later batch without blocking value?

   Skip if obvious from inventory. Scope-reducing answer → section Scope.

### 2. Split

Cross-cutting functional batches (Domain + App + Infra + WebAPI + tests), each independently deliverable, build green.

Status per batch: `sequential` default, or `parallelisable with F?` (two worktrees). Parallelisable only if prerequisites done + nothing shared — functional dependency, file, fixture, configuration, migration, route. Same aggregate, handler, endpoint, `.csproj`, DI, EF migration, test fixture → sequential. Concrete reason in plan; doubt → sequential.

### 3. Write

1. Copy `references/plan-template.md` into `todo/[code-kebab-case]/` — the folder `/business-spec` wrote `SPEC-[code-kebab-case].md` in: global plan `[CODE]-PLAN.md`, one sheet `[CODE]-PLAN-F1.md`, `-F2.md`… per batch. `/implement-tdd batch F1` loads the global plan by section + the F1 sheet alone.
2. Handler doc — per handler created/modified: sheet step updating handler folder `CLAUDE.md` (business rules, flow + access cost, events). Parent feature index `CLAUDE.md` only when its two or three sentences on the bounded context no longer hold — no handler list, no link, no table. Format: `/implement-tdd` `references/claude-md-handler.md`.
3. Self-validation: re-read plan vs checklist. Deviation → fix plan. Doubt on business intent → ask user.
4. **Adversarial review.** `Agent` with `subagent_type: cctoolkit:adversarial-reviewer`, a `description`, prompt starting `mode: plan todo/<code>/`. `Blocking` → fix plan, or AskUserQuestion when the answer is the user's; `Major` → fix, or keep with one line in the sheet's `## Decisions` saying why. Never re-run it on the corrected plan.
5. Summary: batch count, RM/CU traced, files produced, folder path, review rows settled and how.

## Execution-plan rules (`0. Summary` > `### Batch FX`)

- Step = end-to-end business behaviour, not layer, not file
- One step = one production artifact: Command/Query+Handler, endpoint, repository. Two steps on same handler + same aggregate method = one step. Guard, refusal, uniqueness/visibility check on method already in a step = not a step — one more row in that step's table under `## TDD sequence`.
- Every step → ≥1 test named per target skill convention + RM + target test project: `Should{Result}_When{Condition}` at every level (`.claude/rules/tests.md`). Unnameable behaviour = internal mechanism ("scan", "detect", "map", "convert") → recast as behaviour. Test names → sheet `## TDD sequence`; paths → sheet `## Ancrages`; assertions → `/tests-*` skills.
- 2-5 behaviour steps per batch + documentation step + verification step. Past 6: split hit rule level → regroup by target method. Legitimately >8 → split batch in two.
- Last step = `dotnet build` + `dotnet test`, named scope: whole suites, filtered project + filter root, suites skipped + why. Bare "`dotnet test`" = weak criterion

## Plan contents

Structure, section order and anchors: `references/plan-template.md`, verbatim. What it can't show:

- **Global plan** = WHAT + WHY + ORDER, under 2 min to read. Never in it — sheet only: per-batch element list, test names, batch decisions, applied rule ids, signatures, pseudo-code, file paths, fixture/mock/builder structure, anything derivable from `.claude/rules/*.md`. A step title states the business behaviour, nothing else.
- **Batch sheet** = enough for `/implement-tdd`. Test level per element: unit per handler behaviour; integration as soon as it lives in `src/{{PRODUCT}}.Infrastructure/`; contract if a route changes; E2E only for a multi-operation lifecycle. Sole integration waiver: element with no persistence effect (DI registration, adapter of an already-doubled external service), written with its reason.
- **`## TDD sequence`**: one `### Step N` per global-plan step, same titles and order, documentation and verification steps included ("no test" and why).
- **`## Ancrages`**: a step whose levels land in different files splits into `N — [title] (IT)`, `(contract)`, `(E2E)`; never a row spanning several steps — `/implement-tdd` needs one row to copy per step. Existing path from the inventory (1.3); new file mirrors the sibling it imitates. Path not copyable = plan hole.
- Never: C# method bodies, test assertions, SQL/DDL, LINQ, full DI configuration, fixture/mock/builder internals, long justifications.

## Conventions

Layer conventions → `.claude/rules/*.md`; design rules → `references/ddd-rules.md`, `architecture-rules.md`. Cite ids in the sheet, never copy them.

## Maximum reuse

Before new class/service/VO: find mechanism already doing 80 %+. Extend, don't create.

- Business act already owned by handler → rewrite it, never second parallel use case. Same for endpoint: existing route evolves, no twin.
- Existing type of same shape → rename/extend, no second record.
- Existing method, similar pattern → optional parameter or overload, not new service
- Existing dictionary/lookup (`DiagramDependencies`, handler mapping) → reuse, no new mapping VO; existing filtering/exclusion (`excludedNodeIds` in `DuplicateInternal`) → extend; existing Application service (`PortBreakingDetection`) → call directly, no wrapper

In plan: every "new" element justifies why existing insufficient. Weak justification = extension.

## Self-validation checklist

- DDD naming conforms (`Naming` tables of `.claude/rules/*.md`)
- Every DDD/APP/PERF id applied in a sheet `## Design` or listed `N/A — reason` in global plan `1. Scope`; every sheet cites its applied ids with aggregate, invariants, consistency, internal event, cost
- Every RM/CU → ≥1 named test; every step has a `### Step N` table in `## TDD sequence` and an `## Ancrages` row, existing paths from inventory, never guessed
- Element in `src/{{PRODUCT}}.Infrastructure/` → ≥1 integration scenario, or written waiver + reason
- Feasibility: dependencies resolved, no unflagged breaking change; no EF migration planned (other project — schema change flagged, not scheduled)
- Last step names test scope in Microsoft.Testing.Platform form (`--project` + `--filter-class`): VSTest `--filter "FullyQualifiedName~..."` doesn't exist here

## Next step

End with: `→ Manual plan validation required. Once validated: /implement-tdd batch F1`.
