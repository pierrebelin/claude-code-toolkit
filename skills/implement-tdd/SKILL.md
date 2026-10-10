---
name: implement-tdd
description: "Use when implementing a .NET/DDD feature or batch across every layer under strict TDD: orchestrates the red-test, implementation and final-audit chain with subagents."
argument-hint: "[batch FX <global plan path> | batch FX — correction: manual finding]"
---

# Implementation orchestrator — strict TDD (Red-Green-Refactor)

Drives the **test-first** chain: test subagent → implementation subagent → verification. One RED → GREEN → REFACTOR → COST loop per behaviour. Stop when all verified; block on business ambiguity.

$ARGUMENTS

You own **design**: split into behaviours, arbitrate cost, settle ambiguity, update plan + docs. Subagents produce and declare; you judge. Never commit. `rtk dotnet` for build/test.

| Phase | Agent | Authorisation |
|---|---|---|
| RED | `cctoolkit:tdd-test-author` | Write only requested test |
| GREEN + REFACTOR | `cctoolkit:tdd-implementer` | Write production code; test files read-only |
| Final verification | forked `/verify-ddd-tdd` | Read + run validations, no modification |

Either agent unknown to the `Agent` tool → stop, name it (plugin disabled or outdated: `cctoolkit doctor`); never take its role.

Coding rules (`references/common-rules.md`) bind the two agents, which read it — not you. Yours:

- **Declarative artefacts are yours, with no RED before them** — list in `common-rules.md` §4.5, the only part you read. One carrying a branch, validation or mapping decision → back through RED.
- **A test green on first run is never kept**: covered elsewhere → delete; assertion too weak → strengthen until red. `tdd-test-author` decides and says which in its `## RED`.

## Workspace

Production `src/{{PRODUCT}}.{Abstractions.Models, Domain, Application, Infrastructure, WebAPI}/`; suites `tests/{{PRODUCT}}.{UnitTests, IntegrationTests, ContractTests, E2ETests, ArchitectureTests, DslTests}/`; `tests/{{PRODUCT}}.CoreTests/` = shared test infra (doubles, builders, assets). EF migrations live in another project: never modify them here. Runner, commands, levels, suite scope → `references/test-scope.md`, shared with `/verify-ddd-tdd`.

## 1. Analysis

Reads in one message: global plan (located sections), batch sheet, `references/test-scope.md`.

- **`batch FX <global plan path>`** — path as text, not an `@` mention (that attaches the whole plan to every turn). No path → `ls todo/*/*-PLAN.md`; several → ask.
  1. Global plan **by section**: summary + batch index, then `### Batch FX` — `grep -n "^## \|^### "`, `Read` those ranges.
  2. Batch sheet (`*-PLAN-FX.md`), whole.
  3. Step whose `TDD:` line reads `RED ✅ · GREEN ✅ · COST ✅` → skip; resume at the first carrying a ⬜. Sheet from an older plan with no `TDD:` lines → add `TDD: RED ⬜ · GREEN ⬜ · COST ⬜` to every step in one `Edit` first: the `run-lot-pane` pane reads progress from them.
  4. Applied DDD/APP/PERF ids from the sheet: read their lines only in `/plan-implementation`'s `references/ddd-rules.md` + `architecture-rules.md`.
- **`batch FX — correction: [manual finding]`** → follow `references/correction-mode.md`.
- **Otherwise** → no code; route to `/plan-implementation`.

**Invariants → what they remove.** For each invariant of the sheet, write what it takes out of the code: loop, `GroupBy`, dictionary, defensive branch, second read.

**Mid-batch ambiguity.** Changes scope, RM/CU or a design decision → stop, back to `/business-spec` or `/plan-implementation`. Changes none → settle it, and trace it under the sheet's `## Assumptions`: `Hn — [what you assume] — to be validated by [who]`; carry it into the final summary.

**Stay in the target handler folder.** Every `Read` under `src/` or `tests/` attaches that folder's `CLAUDE.md` + layer rules for the rest of the batch. A relation → `graphify explain|path|query`; files beyond → `Explore` subagent. `DESIGN.md` beside the feature index is never auto-loaded: a behaviour needing a chapter → name that section on the agent's `Read bounded` line. Layer conventions load alone via `.claude/rules/*.md`. `references/conventions.md` § "Data access" only on a cost you can't validate or a `## BLOCKED` on cost.

## 2. Red-Green-Refactor loop per behaviour

Split the batch into **end-to-end business behaviours** (Command/Query+Handler, endpoint, repository), each tied to RM/CU, order Domain → Application → Infrastructure → WebAPI. Sheet steps are an evidence checklist, not the cycle unit: several steps on the same handler + aggregate method = one cycle; a guard, refusal, visibility or uniqueness check = one more scenario of its behaviour. Announce the mapping before the first RED (steps 1-2-3 → behaviour A, 4-5 → B). Merging never relaxes test-first: all scenarios of a cycle red before any production code.

Two behaviours or more → `references/parallelism.md` once: RED parallelises across behaviours, GREEN never.

### RED — delegate to `tdd-test-author`

Level, integration-test obligation and waiver → `test-scope.md` §1; handler test policy → §5. Contract, no plan attached:

```text
RM/CU: …
Behaviour: …
Level / skill: …
Test class / fixture: `XTests` / `YFixture` — existing or to create
Methods: `Should…_When…` — one per scenario, in the order of the Scenarios line, with its RM when the behaviour carries several
Rewritten by you (read in full): test file, fixture — exact paths, existing or to create
Read bounded (context only): handler / aggregate under test, shared doubles and builders under tests/{{PRODUCT}}.CoreTests/ — exact paths
Scenarios: …
Expected observation: …
Forbidden: any file search. A missing path comes back as ## BLOCKED.
```

Paths, class, fixture and method names are copied from the sheet (`## Ancrages`, `## TDD sequence`), never searched. Missing row = plan gap: one `ls`, one `Edit` adding the row, then delegate. `read in full` and `read bounded (context only)` are literals both agents key on: keep them, keep the paths sorted between them.

Its `## RED` carries `Production diff` (`git diff --stat -- src/`, expected empty or the stubs on its `Stubs` line, `common-rules.md` §4.1) + filtered command + exit code. Anything beyond stubs → back to the agent; production code ahead of a red test is deleted. Test method in the diff but absent from its table → back to the agent.

Relay to the user before GREEN, adding the `RM/CU` from your contract:

```markdown
### RED — [behaviour] (exit 1)

| Test | RM/CU | Case covered |
|---|---|---|
| `[Class]Tests.[Method]` | RM-XX | what the test observes |
```

Between cycles, one line: `→ Cycle n/N closed — [behaviour]`. Recaps belong to the close (`references/closing.md`): every reply you print is resent on every later turn.

### GREEN + REFACTOR — delegate to `tdd-implementer`

Contract, no plan attached:

```text
RM/CU: …
Behaviour: …
Red test: exact path + method name
Out of scope — next behaviour: [guard/branch not to write] — would turn the RED of [X] green
Already stubbed at RED (body to fill, read in full): exact paths
To create from scratch: exact paths
Signature ripple — also touched (read in full): exact path — what changes there, one clause each
Read bounded (context only): exact paths
Elements: exact names + public signatures from the sheet — declaration only, never a body
Applied DDD/APP ids: …
Exploitable invariants — what they remove: …
Expected access cost: n reads + n writes to Infrastructure, independent of [input]
Snapshot (approval-testing suites only): approved-file path + literal seeded values expected
```

The contract carries only what the agent can't know — never what `agents/tdd-implementer.md` already binds. Stubs listed on the RED `Stubs` line go under "Already stubbed". Signature ripple = files neither stubbed nor created that a moved signature lands in (mappers, repository implementations, hand-written doubles, integration fixtures). Dictating a body → do GREEN yourself instead. Never a guard or rule of a behaviour whose test isn't written yet: its RED would come back green. Snapshot acceptance → `test-scope.md` §6.

On `## GREEN`: `Tests diff` (empty, or the accepted `.verified.txt`) settles test integrity; `Cost` — last line of `scripts/access-cost.py` + its input-independence clause — settles COST. Validate the lines, not the files: no Infrastructure call in a loop, no in-memory filter, counts consistent with the sheet. Line not in the script's form → `SendMessage` to the agent. A flag delivered as `## GREEN` = design defect → back to design. `## BLOCKED` on cost or design → settle here, or `/plan-implementation` if it moves a plan decision.

**Tick once per behaviour, after COST**: one `Edit` flips the step's line to `TDD: RED ✅ · GREEN ✅ · COST ✅`, each observed — RED on the filtered test's expected failure, GREEN on its success, COST on the checked `Cost` line.

## 3. Global green loop

Whole suites run here, once per batch — inside the loop agents run only their behaviour's `--filter-class`. Fix until fully green. Suite scope, integration filter → `test-scope.md` §2-4. Every suite run writes to file, not context (`> "$SCRATCH/test-<Suite>.txt" 2>&1; echo "exit=$?"; tail -15 …`, form in `test-scope.md` "Runner"); independent suites in one message.

## 4. Close the batch

Read `references/closing.md` whole, follow §1 → §5 in order. `VALID` closes the current batch only: don't start, delegate or suggest the next one — the user validates by hand first. End with `→ Batch FX complete — manual validation required. Run /clear before any other batch.`
