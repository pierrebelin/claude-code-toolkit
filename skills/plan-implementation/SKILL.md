---
name: plan-implementation
description: "Use when a validated business spec must become a DDD technical plan split into batches before coding. Traces RM/CU, DDD decisions and targeted test scenarios."
argument-hint: "[path of the specification to turn into a plan]"
---

# Implementation plan from a spec

Spec → plan. Unambiguous for the `run-plan` / `run-lot` workflows; design doc, not code.

$ARGUMENTS

## Mission

Plan split by feature, not layer:

1. Trace every RM-XX + CU-XX to owning code elements.
2. Per element: name, role, public signature, pseudo-code bullets, exact path — existing or new.
3. Classify + trace DDD/Architecture rules: owning aggregate, invariants, consistency, events, boundaries, access cost.
4. Test scenarios + RM + level (unit: handlers; integration: repositories; contract: endpoints; E2E: lifecycle) + anchors: test class file, fixture, shared builders, doubles.
5. Respect the conventions of `run-lot` (`implement-tdd` `references/`) + the repo's `/tests-*` skills (`rules/cctoolkit.md`).

## Workflow

### 1. Understand

0. **Gate — open blocking questions.** Before any read:

   ```bash
   awk '/^## (.*<!-- *kit:open-questions *-->|12\. (Open questions|Questions ouvertes))/{p=1;next} /^## /{p=0} p && /\| *(Blocking|Bloquant) *\|/' <spec>
   ```

   The section is found by its anchor, or by the title of a spec written before the anchors (`## 12. Questions ouvertes`, severity `Bloquant`). Any line → **stop**: list them, end with `→ Open blocking questions: /business-spec to settle them.` No plan while a `Blocking` is open — same contract as `## BLOCKED` in a batch, moved before design.
1. Read spec fully. Its business decisions (`kit:decisions`) are inputs: a technical choice that would contradict one → AskUserQuestion. Its technical points (`kit:technical-points`) are the questions this plan answers, each in a sheet (step 3.4).
2. Read `references/ddd-rules.md` + `references/architecture-rules.md`. Each id → applied in the owning batch sheet (`## Design`), or listed once in global plan `1. Scope` as `N/A — reason`. `references/ddd-examples.md` only if id ambiguous.
3. Inventory the bounded context by delegation: a `Read` under `src/` or `tests/` attaches layer rules to every later turn. `graphify explain "<Aggregate>"` first, then one `Explore` subagent (`model: sonnet`, the inventory includes local conventions):

   ```text
   Bounded context: … — spec: [path] — need: [one sentence]
   Return `path:line` tables, 60 lines max, no code excerpt:
   1. Aggregates, value objects, entities, domain interfaces reusable for the need — exact names
   2. Repositories, handlers, endpoints owning the same business act or a similar one; per handler, the path of its folder CLAUDE.md
   3. Routes of the context in Endpoints/Endpoints.cs (collision risk)
   4. Test anchors: test class file and fixture per handler of item 2; contract fixture and .verified.txt per route of item 3; builders and doubles under tests/{{PRODUCT}}.CoreTests/ for the aggregates of item 1; the first-level folders of the integration test project
   5. Local conventions of the context — naming, folder layout — one line each
   ```

   You open only the folder `CLAUDE.md` of the handler owning the same business act, its `kit:rules` table — rewrite vs twin = your call. Inventory → "1. Scope > Reuse".

   With a knowledge base, the spec's `modified` use cases and the base ids it cites name their handlers: one `cctoolkit ask --id <id>,<id>…` before the `Explore`, its `handlers:` lines handed to it as item 2's starting point.
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

1. Copy `references/plan-template.md` into `todo/[code-kebab-case]/` — the folder `/business-spec` wrote `SPEC-[code-kebab-case].md` in: global plan `[CODE]-PLAN.md`, one sheet `[CODE]-PLAN-F1.md`, `-F2.md`… per batch. `run-lot` on a sheet loads the global plan by section + that sheet alone.
2. **Before naming any element**, load the naming and folder tables — bounded extract, never a full rule file, never a file under `src/` (step 1.3 forbids it):

   ```bash
   for f in .claude/rules/*.md; do
     awk '/^## (Naming|Folder layout)/{p=1} /^## /{ if(p && $0 !~ /^## (Naming|Folder layout|No nullable)/) p=0 } p' "$f"
   done
   ```

   A few dozen lines. `run-lot` hands the names and paths of `## Cycles` to its agents verbatim: a wrong name here becomes a wrong file there, caught only at GREEN.
3. Handler doc — per handler created/modified: its folder `CLAUDE.md` in the `production` of the cycle that changes its rules (business rules, flow + access cost, events), written by that cycle's GREEN. Parent feature index `CLAUDE.md` only when its two or three sentences on the bounded context no longer hold — no handler list, no link, no table. Format: `/implement-tdd` `references/claude-md-handler.md`.
4. **Decisions** — every technical point of the spec, and every choice a reader of the sheet would otherwise ask about, is one entry of `## Decisions` in the sheet of the batch it governs, in the four-line format of `references/plan-template.md`. A decision that outlives the plan — it shapes code beyond this feature: storage model, contract with another context, a pattern the next features will follow — is an ADR: heading `### ADR-nnn — …` and a `Consequences` line. Its id: one `cctoolkit next-id ADR --count <n>` once every ADR of the plan is known; the sheet under `todo/` keeps it taken until the merge. Any other decision: heading without id, it ends with the plan. `2. Traceability` maps each technical point to its decision and batch.
5. Self-validation: re-read plan vs checklist. Deviation → fix plan. Doubt on business intent → ask user.
6. **Adversarial review.** In one message, one `Agent` per batch sheet with `subagent_type: cctoolkit:adversarial-reviewer`, a `description`, prompt starting `mode: sheet todo/<code>/<CODE>-PLAN-FX.md`, plus one prompt starting `mode: plan todo/<code>/` for cross-batch issues. `Blocking` → fix plan per its `Settled by` source, else AskUserQuestion: the plan never closes with a Blocking unanswered; `Major` → fix, or keep with one line in the sheet's `## Decisions` saying why. Never re-run it on the corrected plan. Settle here everything `run-plan` would otherwise ask mid-run: the run asks only `humanOnly` questions, so a choice left open now is taken without the user and reviewed after the plan.
7. Summary: batch count, RM/CU traced, technical points settled and ADRs taken, files produced, folder path, review rows settled and how.

## Execution-plan rules (`0. Summary` > `### Batch FX`)

- Step = end-to-end business behaviour, not layer, not file
- One step = one production artifact: Command/Query+Handler, endpoint, repository. Two steps on same handler + same aggregate method = one step. Guard, refusal, uniqueness/visibility check on method already in a step = not a step — one more method of that step's cycle.
- Every step → ≥1 test named per target skill convention + RM + target test project: `Should{Result}_When{Condition}`, unless the `Naming` table of `.claude/rules/tests.md` sets another pattern for a level (loaded at step 3.2). Unnameable behaviour = internal mechanism ("scan", "detect", "map", "convert") → recast as behaviour. Test names and paths → the sheet's `## Cycles` block; assertions → `/tests-*` skills.
- One entry of a cycle's `methods` = one test method, full final `Class.Method` name: condition chosen here, never left to the RED. Never an exception, a class, "N files", an ellipsis (`…`), a placeholder or an open `_When`: `cctoolkit sheet-cycles --index` rejects such a name, and the RED cannot match it. Existing tests rewritten → one entry per method.
- 2-5 behaviour steps per batch. Past 6: split hit rule level → regroup by target method. Legitimately >8 → split batch in two. No documentation nor verification step: the GREEN updates the handler `CLAUDE.md`, the run's global green replays the scopes of `## Test policy and scopes`.
- Guard test green at once on the current code (architecture or convention guard, no production code drives it) = its own cycle with `"guard": true`: `run-lot` writes it and runs it green, no GREEN follows. Any other test expected green at once stops `run-lot` on "RED not observed".
- Every message, error code, route or response field the batch changes → `grep -rln` its current literal under the test roots. Each test file asserting it goes into `full` of the cycle that changes it, its methods into that cycle's `methods`: the RED rewrites them to the new value (never a negative assertion that passes whatever the code does), the GREEN may not touch a test.
- Registry oracle (derived, never a count), shaped form of a helper-normalized value, guard reachable from a handler → `.claude/rules/tests.md` and the `Unreachable guard` check of `adversarial-reviewer`: the sheet names the oracle and the shaped form in the cycle's `scenarios`, a guard only the aggregate reaches (no handler calls the guarded method in that state) stays out of the plan.
- `## Test policy and scopes` names the verification scope: whole suites, filtered project + filter root, suites skipped + why. Bare "`dotnet test`" = weak criterion

## Plan contents

Structure, section order and anchors: `references/plan-template.md`, verbatim. What it can't show:

- **Global plan** = WHAT + WHY + ORDER, under 2 min to read. Never in it — sheet only: per-batch element list, test names, batch decisions, applied rule ids, signatures, pseudo-code, file paths, fixture/mock/builder structure, anything derivable from `.claude/rules/*.md`. A step title states the business behaviour, nothing else.
- **Batch sheet** = enough for `run-lot`. Test level per element: unit per handler behaviour; integration as soon as it lives in `src/{{PRODUCT}}.Infrastructure/`; contract if a route changes; E2E only for a multi-operation lifecycle. Sole integration waiver: element with no persistence effect (DI registration, adapter of an already-doubled external service), written as the sheet line `Integration test waiver: <reason>` — the label stays English whatever `language.docs`, only the reason follows it —, the line `cctoolkit pre-audit` reads.
- **`## Cycles`**: the TDD contract of the batch, one ```json block, fields and caps per `/implement-tdd` `references/design.md` § "The `## Cycles` block" and `parallelism.md`. `steps` = exact titles of the global-plan steps, every step carried by at least one cycle. Existing path from the inventory (1.3); new file mirrors the sibling it imitates, marked `(to create)` or listed in `toCreate`. `cctoolkit sheet-cycles <sheet> --index` exit 0 before the review: a path not copyable is a plan hole.
- **Sheet size**: about 20 KB at most. No inventory table, no per-behaviour narrative: the block and `## Code elements` carry the contract, `## Decisions` the non-obvious choices.
- Never: C# method bodies, test assertions, SQL/DDL, LINQ, full DI configuration, fixture/mock/builder internals, long justifications.

## Conventions

Layer conventions → `.claude/rules/*.md`, never auto-loaded here (step 1.3 forbids a layer file read): load the `Naming` and `Folder layout` tables explicitly (step 3.2) before naming an element. Design rules → `references/ddd-rules.md`, `architecture-rules.md`. Cite ids in the sheet, never copy them.

## Maximum reuse

Before new class/service/VO: find mechanism already doing 80 %+. Extend, don't create.

- Business act already owned by handler → rewrite it, never second parallel use case. Same for endpoint: existing route evolves, no twin.
- Existing type of same shape → rename/extend, no second record.
- Existing method, similar pattern → optional parameter or overload, not new service
- Existing dictionary/lookup (a dependency map, a handler mapping) → reuse, no new mapping VO; existing filtering/exclusion (an excluded-ids parameter of a sibling handler) → extend; existing Application service → call directly, no wrapper

In plan: every "new" element justifies why existing insufficient. Weak justification = extension.

## Self-validation checklist

- DDD naming and folder layout conform (`Naming` / `Folder layout` tables loaded at step 3.2)
- Every DDD/APP/PERF id applied in a sheet `## Design` or listed `N/A — reason` in global plan `1. Scope`; every sheet cites its applied ids with aggregate, invariants, consistency, internal event, cost
- Every RM/CU → ≥1 named test; every step carried by a cycle of `## Cycles`, existing paths from inventory, never guessed; `cctoolkit sheet-cycles <sheet> --index` exit 0
- Every technical point of the spec (`kit:technical-points`) → one decision of a sheet, traced in `2. Traceability`; every ADR id from `cctoolkit next-id ADR`; no decision contradicts a business decision of the spec
- Element in `src/{{PRODUCT}}.Infrastructure/` → ≥1 integration scenario, or the `Integration test waiver: <reason>` sheet line
- Feasibility: dependencies resolved, no unflagged breaking change; no EF migration planned (other project — schema change flagged, not scheduled)
- `## Test policy and scopes` names test scope in Microsoft.Testing.Platform form (`--project` + `--filter-class`): VSTest `--filter "FullyQualifiedName~..."` doesn't exist here

## Next step

End with: `→ Manual plan validation required. Once validated: /cctoolkit:run-plan todo/[code-kebab-case]/[CODE]-PLAN.md (whole plan) or /cctoolkit:run-lot todo/[code-kebab-case]/[CODE]-PLAN-F1.md (one batch)`.
