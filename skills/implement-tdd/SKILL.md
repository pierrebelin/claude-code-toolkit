---
name: implement-tdd
description: "Use when implementing a .NET/DDD feature or batch across every layer under strict TDD: orchestrates the red-test, implementation and final-audit chain with subagents."
argument-hint: "[batch FX | batch FX — correction: manual finding]"
---

# Implementation orchestrator — strict TDD (Red-Green-Refactor)

Drives the whole **test-first** chain: test subagent → implementation → verification subagent. Explicit RED-GREEN-REFACTOR loop per behaviour. Stops once everything is verified, or blocks on a business ambiguity.

$ARGUMENTS

## Common rules

Code and test-first TDD (Iron Law, cycle, Red Flags, rationalisations) → **read `references/common-rules.md`**. **Never commit.** Test rules → the `/tests-*` skills. Use `rtk dotnet` for build/test; RTK compacts logs but never replaces an exit code.

## Mandatory orchestration

This skill stays in the main agent: do **not** give it `context: fork`. A subagent cannot delegate in turn.

Use these project agents:

| Phase | Agent | Authorisation |
|---|---|---|
| RED | `tdd-test-author` | Write only the requested test |
| GREEN + REFACTOR | `tdd-implementer` | Write production code; test files read-only |
| Final verification | forked `/verify-ddd-tdd` | Read and run validations, without modifying |

Phases are **sequential**, never parallel on the same batch. Wait for the test subagent's result before touching any production file. Wait for global GREEN before launching the verifier.

If `tdd-test-author` or `tdd-implementer` is missing, stop before coding and name the missing file under `.claude/agents/`; do not silently take over its responsibility.

You stay responsible for **design**: splitting into behaviours, arbitrating an unbounded cost, settling an ambiguity, updating the plan and the documentation. Subagents produce and declare; you judge.

## Workspace projects

| Layer | Project | Path |
|--------|--------|--------|
| Abstractions.Models | `{{PRODUCT}}.Abstractions.Models` | `src/{{PRODUCT}}.Abstractions.Models/` |
| Domain | `{{PRODUCT}}.Domain` | `src/{{PRODUCT}}.Domain/` |
| Application | `{{PRODUCT}}.Application` | `src/{{PRODUCT}}.Application/` |
| Infrastructure | `{{PRODUCT}}.Infrastructure` | `src/{{PRODUCT}}.Infrastructure/` |
| WebAPI | `{{PRODUCT}}.WebAPI` | `src/{{PRODUCT}}.WebAPI/` |
| Unit Tests | `{{PRODUCT}}.UnitTests` | `tests/{{PRODUCT}}.UnitTests/` |
| Integration Tests | `{{PRODUCT}}.IntegrationTests` | `tests/{{PRODUCT}}.IntegrationTests/` |
| Contract Tests | `{{PRODUCT}}.ContractTests` | `tests/{{PRODUCT}}.ContractTests/` |
| E2E Tests | `{{PRODUCT}}.E2ETests` | `tests/{{PRODUCT}}.E2ETests/` |
| Architecture Tests | `{{PRODUCT}}.ArchitectureTests` | `tests/{{PRODUCT}}.ArchitectureTests/` |
| DSL Tests | `{{PRODUCT}}.DslTests` | `tests/{{PRODUCT}}.DslTests/` |
| Shared test infrastructure (doubles, builders, assets) — not a suite | `{{PRODUCT}}.CoreTests` | `tests/{{PRODUCT}}.CoreTests/` |

EF migrations live in another project: **never modify them from this workspace**.

## Build and tests

Runner, commands, which test level to write, suite scope and integration-test filtering → **`references/test-scope.md`**. Single source, shared with `/verify-ddd-tdd`: do not restate those rules here.

## Workflow

### 1. Analysis

- **Argument = `batch FX`** (e.g. `implement-tdd batch F1`):
  1. Read the global plan (`*-PLAN.md`) — context + scope
  2. Read the batch sheet (`*-PLAN-FX.md`) — technical detail
  3. **Steps already ticked ✅** in the global plan → skip, resume at the first ⬜ step
  4. Follow the sheet's remaining elements and steps
  5. Check the global plan's DDD/APP/PERF coverage, then collect the applied ids from the sheet. In `/plan-implementation`, read `references/ddd-rules.md` and `architecture-rules.md` **only** on the lines of those ids; open `ddd-examples.md` only if the pattern is still unknown.
- **Argument = `batch FX — correction: [manual finding]`**:
  1. Read the global plan, the batch sheet and the finding. Locate the behaviour, the RM/CU and the scenario it concerns.
  2. If the finding changes the scope, an RM/CU or a design decision absent from the plan, stop and route to `/business-spec` or `/plan-implementation` before coding.
  3. Otherwise, add under the affected behaviour a sub-step `Correction Cn — [finding]` with `TDD: RED ⬜ · GREEN ⬜ · COST ⬜`. Keep the previous ✅ evidence: do not erase it and do not skip this correction.
  4. Resume the RED → GREEN → REFACTOR → COST loop for that correction, then the batch's final audit.
- **Otherwise**: do not code. DDD design must be explicit in a plan; route to `/plan-implementation`.

**Invariants → what they REMOVE.** A sheet states invariants ("a copy has a single owner", "every key comes from the same product"). Do not merely copy them into the docs: write **what they take out of the code** — a loop, a `GroupBy`, a dictionary, a defensive branch, a second read. A documented but unexploited invariant produces code that defends an impossible case.

**Ambiguity mid-batch → traced assumption, never a silent decision.** A question that changes the scope, an RM/CU or a design decision stops the batch (back to `/business-spec` or `/plan-implementation`). A question that changes none of those gets settled, but written down: add to the batch sheet, under `## Assumptions`, a line `Hn — [what you assume] — to be validated by [who]`, and carry it into the final summary. An unwritten assumption is a decision nobody can review.

**At the start (once)**: read `references/test-scope.md` (test level, suite scope) and `references/conventions.md` ("Data access"). Layer conventions — naming, base classes, folder structure, pitfalls — arrive on their own through `.claude/rules/*.md` as soon as you read a file of that layer: do not go looking for them, do not ask for them again. Full code examples are split by layer (`references/examples-domain.md`, `-application`, `-infrastructure`, `-webapi`): the layer rule gives you the exact path. Open one only if the pattern is unknown to you.

### 2. Red-Green-Refactor loop per behaviour

Split the batch into **end-to-end business behaviours** carried by a Command/Query+Handler, an endpoint or a repository — each tied to an RM/CU. An aggregate method stays an internal step of that behaviour, never a standalone test target. Apply the **RED → GREEN → REFACTOR → COST** cycle (`common-rules.md` §2) to each one, in dependency order **Domain → Application → Infrastructure → WebAPI**.

**COST is mandatory before moving to the next behaviour.** `tdd-implementer` states it in one line ("1 read + 1 write"); you **validate** it against the delivered code, you do not take it at face value. No test observes that number: green proves nothing here. An `await` on a repository inside a loop is a **design** defect, and design is where you go back to. Symptom/fix table → `references/conventions.md` § "Data access".

**RED = ALWAYS delegate writing the test** to the `tdd-test-author` subagent, telling it which skill to apply (+ scenario name + RM). Level choice → `references/test-scope.md` §1.

**A hunk in `src/{{PRODUCT}}.Infrastructure/` mandates an integration test**, on top of the handler test: the unit test's double proves neither the SQL, nor the join, nor the filter pushed to the database, nor the index violation translated into a domain exception. Only waiver: an Infrastructure hunk with no effect on persistence (DI registration, adapter of an already-doubled external service) — to be written out explicitly in the sheet and the summary, with its reason.

**Absolute rule: never test an aggregate method directly.** A Domain behaviour (factory `Create()`, method `SetDefault()`, …) is always tested **through the handler/service that calls it**. Domain events are side effects verified at handler level, not on the aggregate in isolation. If no handler exists yet for that behaviour, **do not write the test** — it will be written when the handler exists. No orphan test on an aggregate.

**Absolute handler policy**: for a query, the mock supplies the data and the test asserts on the returned result. For a command, the test asserts the type and payload of `SavedEvents`. **Never** a spy, a counter, `Called`, `Received`, `Verify` or an assertion on call count — not even for cost.

Read the plans once, in the main agent. For each behaviour, delegate this compact contract, without attaching the plan or asking for it to be re-read:

```text
RM/CU: …
Behaviour: …
Level / skill: …
Project and existing fixture: …
Scenarios: …
Expected observation: …
```

The agent modifies test files only, runs the filtered test and returns its compact `## RED` format. Do not ask it to re-explain the plan nor to copy its logs.

Once it returns: read its diff, confirm it contains no production code, then check the filtered test's expected failure. Never production code ahead of a red test.

**GREEN + REFACTOR = delegate to the `tdd-implementer` subagent.** It writes the production code, deletes what its code orphaned, runs the filtered test and states the cost. Test files are read-only to it: a test that cannot go green without being modified comes back as `## BLOCKED`, it does not get weakened. Delegate this compact contract, without attaching the plan or having it re-read:

```text
RM/CU: …
Behaviour: …
Red test: path + method name
Elements to create or modify: exact names + public signatures from the sheet
Applied DDD/APP ids: …
Exploitable invariants — what they remove: …
Expected cost: n reads + n writes
```

Once it returns `## GREEN`: read its diff, check the announced cost against the code, and each hunk's attachment. A `## BLOCKED` on an unbounded cost or a design ambiguity is settled here — or escalated to `/plan-implementation` if it moves a decision of the plan. Never by re-running the agent with the same instruction.

### 3. Global green loop

Fix until fully green (every behaviour of the batch). **Each suite's scope is decided, not endured** — see `references/test-scope.md` §2. In the batch sheet, tick RED only after the filtered test's expected failure, GREEN after success, COST after reviewing the cost. Never tick evidence you have not observed.

#### Scope

Which suites to run, whole or filtered, how to build the integration-test filter and how to report → `references/test-scope.md` §2-4.

### 4. Delegated final audit

After the global green loop, invoke `/verify-ddd-tdd batch FX`. Its `context: fork` runs it in an isolated subagent, in fast mode, writing no file. Wait for its verdict before concluding.

- Verdict `VALID`: keep its evidence table and its commands with exit codes in the final summary. If it lists **Minor** deviations, carry them over as they are, without fixing or hiding them: the user decides.
- Verdict `GAPS`: fix in the main agent, re-run the affected validations, then delegate the same audit again.
- After two correction/audit rounds still in deviation, stop and return the blocking deviations; work around neither the plan nor the audit.

A `VALID` verdict closes **the current batch only**. Stop there: do not start, delegate or suggest any following batch. End with `→ Batch FX complete — manual validation required before any other batch.`

### 5. Plan update

Whenever the implementation references a plan (`PLAN-*.md`, `SPEC-*-PLAN.md` under `todo/` or `docs/`) → **always** update it on completion:
- Batch/step → **✅ DONE** + date
- Short summary of files created/modified
- Deviations (extra files, different decisions) → document them
- Assumptions made mid-batch → the sheet's `## Assumptions` section: `Hn — [assumption] — to be validated by [who]`. An assumption later confirmed becomes a decision: move it to `## Decisions`.
- **A correction that changes an RM/CU** → update the source spec too. Traceability runs both ways: the spec is the business source of truth.
- A correction coming from manual validation → add `Correction Cn` under the affected behaviour; keep the original TDD history and the correction evidence.
- For each finished behaviour: `TDD: RED ✅ · GREEN ✅ · COST ✅` only if all three pieces of evidence were observed.

### 6. Handler documentation update

Handler modified or created → **update the `CLAUDE.md` of the handler folder** (under `Application/`). Business-rules table **including the `Tests` column** (every red test written in the batch is tied there to its rule), flow, emitted events. If the handler is new: create the `CLAUDE.md`. **Format and example → `references/claude-md-handler.md`** (read it before writing).

**New handler or changed intent → also update the parent feature folder's index `CLAUDE.md`**: the use-case line in the Commands/Queries table (relative link `[Name](Name/CLAUDE.md)`, one-line intent, `N rules, M tested` — `python3 scripts/rules-coverage.py --fix-index` recomputes that column). A handler missing from the index is a handler nobody can find.

**"Flow" section: record the cost.** One line after the flow — "1 read + 1 write, whatever the number of candidates". It is the only durable trace of a decision no test locks down. If an unbounded read is loaded deliberately (`Include` of a collection that grows without limit), say so and say why.

### 7. Closing

Before summarising: re-read your own diff (`git diff`), **hunk by hunk**.

Local style, absence of comments, orphans and surgical change: rules in `references/common-rules.md` §1, applied by `tdd-implementer` on every behaviour. Here you check them **once, on the batch's complete diff** — the only vantage point that sees the whole batch:

- **Every hunk ties back to an RM/CU or to a step of the sheet.** Whatever ties to nothing gets reverted: refactor of code that already worked, renaming outside the batch, reformatting, import reorganisation, fixing an adjacent bug. A real adjacent bug is **reported in the summary**, not fixed in this batch.
- **Cross-behaviour orphans**: a `using`, an intermediate type or an overload one behaviour left behind and another made useless only shows up at this level. Delete them. Pre-existing dead code is reported in the summary, not deleted.

Summary: files created/modified, layers touched, **access cost per delivered behaviour**, **`Hn` assumptions made mid-batch**, **dead code or adjacent bug reported but deliberately untouched**, DDD/APP/PERF ids and `/verify-ddd-tdd`'s verdict. For validations, give command + exit + **scope** (filter applied, or "whole suite") and the number of tests; name the suites deliberately not run and why. On failure, attach at most six useful RTK lines. **No commit** — the user decides when to commit.

**Test recap table** — always end with a Markdown table listing every implemented test:

| Test | Validated UC |
|------|--------------|
| `TestName` | Short description of the use case / business rule validated |

One test per row, exact method name, concise description of the verified behaviour.

---

## Reference

Per-layer DDD conventions (naming, base classes, structure, pitfalls) → `.claude/rules/*.md`, loaded automatically. Full code examples → `references/examples-{domain,application,infrastructure,webapi}.md`, one per layer. Data-access cost → `references/conventions.md`.

## End of batch

After a `VALID` verdict, wait for the user's manual validation before any new `/implement-tdd` command.
