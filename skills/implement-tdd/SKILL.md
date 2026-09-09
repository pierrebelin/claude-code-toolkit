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

**On a given behaviour the phases are strictly sequential**: RED → GREEN → REFACTOR → COST, no overlap. Wait for the test subagent's result before touching any production file. Wait for global GREEN before launching the verifier.

**Across behaviours, the RED phase parallelises — the GREEN phase never does.** Two behaviours whose **target test files are disjoint** get their `tdd-test-author` launched in the same message. Check disjointness on the sheet before launching: a shared fixture, a shared builder in `CoreTests/` or a single test class carrying both scenarios forbids it — those go sequential. GREEN stays serialised whatever happens, it writes production code and two implementers on the same layer collide. Measured on 2026-09-08: 50 subagent runs over three batches, **zero overlap**, for about half the wall-clock time of each session.

If `tdd-test-author` or `tdd-implementer` is missing, stop before coding and name the missing file under `.claude/agents/`; do not silently take over its responsibility.

You stay responsible for **design**: splitting into behaviours, arbitrating an unbounded cost, settling an ambiguity, updating the plan and the documentation. Subagents produce and declare; you judge.

## Workspace projects

Production — `src/{{PRODUCT}}.{Abstractions.Models, Domain, Application, Infrastructure, WebAPI}/`.
Suites — `tests/{{PRODUCT}}.{UnitTests, IntegrationTests, ContractTests, E2ETests, ArchitectureTests, DslTests}/`.
`tests/{{PRODUCT}}.CoreTests/` is not a suite: shared test infrastructure (doubles, builders, assets), referenced by the others.

EF migrations live in another project: **never modify them from this workspace**.

## Build and tests

Runner, commands, which test level to write, suite scope and integration-test filtering → **`references/test-scope.md`**. Single source, shared with `/verify-ddd-tdd`: do not restate those rules here.

## Workflow

### 1. Analysis

**The reads of this phase go out in a single message.** Global plan (located sections), batch sheet, `references/test-scope.md`, `references/conventions.md`: one `Read` each, all in the same turn. Same rule for every diff or status capture, and for every group of independent `Bash` probes anywhere in the batch. Measured on 2026-09-08 over four batches: 611 tool turns, **not one carrying two calls**. A turn is one billed round trip that resends the whole accumulated context, not one call — sequencing independent reads pays that context once per read, and adds one latency per read.

- **Argument = `batch FX`** (e.g. `implement-tdd batch F1`):
  1. Read the global plan (`*-PLAN.md`) **by section, never whole**: its summary and its batch-execution index, then the `### Batch FX` section only — locate them with `grep -n "^## \|^### "` and `Read` the ranges. Measured: the plan read whole is 12k tokens carried by every later turn of the session, the second heaviest line after the startup.
  2. Read the batch sheet (`*-PLAN-FX.md`) — technical detail; it is scoped to the batch, read it whole
  3. **Steps already ticked ✅** in the global plan → skip, resume at the first ⬜ step
  4. Follow the sheet's remaining elements and steps
  5. Check the global plan's DDD/APP/PERF coverage, then collect the applied ids from the sheet. In `/plan-implementation`, read `references/ddd-rules.md` and `architecture-rules.md` **only** on the lines of those ids; open `ddd-examples.md` only if the pattern is still unknown.
- **Argument = `batch FX — correction: [manual finding]`** → read `references/correction-mode.md` and follow it. Do not open that file on a plain `batch FX`.
- **Otherwise**: do not code. DDD design must be explicit in a plan; route to `/plan-implementation`.

**Invariants → what they REMOVE.** A sheet states invariants ("a copy has a single owner", "every key comes from the same product"). Do not merely copy them into the docs: write **what they take out of the code** — a loop, a `GroupBy`, a dictionary, a defensive branch, a second read. A documented but unexploited invariant produces code that defends an impossible case.

**Ambiguity mid-batch → traced assumption, never a silent decision.** A question that changes the scope, an RM/CU or a design decision stops the batch (back to `/business-spec` or `/plan-implementation`). A question that changes none of those gets settled, but written down: add to the batch sheet, under `## Assumptions`, a line `Hn — [what you assume] — to be validated by [who]`, and carry it into the final summary. An unwritten assumption is a decision nobody can review.

**At the start (once)**: read `references/test-scope.md` (test level, suite scope) and `references/conventions.md` ("Data access"). Layer conventions — naming, base classes, folder structure, pitfalls — arrive on their own through `.claude/rules/*.md` as soon as you read a file of that layer: do not go looking for them, do not ask for them again. Full code examples are split by layer (`references/examples-domain.md`, `-application`, `-infrastructure`, `-webapi`): the layer rule gives you the exact path. Open one only if the pattern is unknown to you.

### 2. Red-Green-Refactor loop per behaviour

Split the batch into **end-to-end business behaviours** carried by a Command/Query+Handler, an endpoint or a repository — each tied to an RM/CU. An aggregate method stays an internal step of that behaviour, never a standalone test target. Apply the **RED → GREEN → REFACTOR → COST** cycle (`common-rules.md` §2) to each one, in dependency order **Domain → Application → Infrastructure → WebAPI**.

**Group the behaviours into waves before entering the loop.** Two behaviours share a wave when their tests touch neither the same test file nor the same production code — typically an Application behaviour and an Infrastructure or WebAPI one. A wave's REDs go out in a single message, one `Agent` call each; the GREENs stay sequential, they edit the same files. Measured on 2026-09-09: 4 REDs launched one by one where 2 waves covered the batch.

**COST is mandatory before moving to the next behaviour.** `tdd-implementer` states it in one line ("1 read + 1 write"); you **validate** it against the delivered code, you do not take it at face value. No test observes that number: green proves nothing here. An `await` on a repository inside a loop is a **design** defect, and design is where you go back to. Symptom/fix table → `references/conventions.md` § "Data access".

**RED = ALWAYS delegate writing the test** to the `tdd-test-author` subagent, telling it which skill to apply (+ scenario name + RM). Level choice, Infrastructure integration-test obligation and its only waiver → `references/test-scope.md` §1. Aggregate, query, command and interaction policy → the same file, §5. Both are absolute: a deviation is Blocking at audit.

Read the plans once, in the main agent. For each behaviour, delegate this compact contract, without attaching the plan or asking for it to be re-read:

```text
RM/CU: …
Behaviour: …
Level / skill: …
Target test file: exact path, existing or to create
Fixture to reuse: exact path
Handler / aggregate under test: exact path
Shared doubles and builders available: exact paths under tests/{{PRODUCT}}.CoreTests/
Scenarios: …
Expected observation: …
Forbidden: any file search. A missing path comes back as ## BLOCKED.
```

**The exact paths are not optional.** You have just read the sheet, you hold them; the subagent does not and pays a full exploration to rebuild them. Measured on 2026-09-08: 23 `tdd-test-author` runs for 445 turns, **19 turns to write one test**. A contract that names the four paths removes that exploration. If you cannot name one, it is missing from the sheet — that is a plan gap, settle it before delegating.

Behaviours cleared as disjoint go out **in the same message**, one `Agent` call each.

The agent modifies test files only, runs the filtered test and returns its compact `## RED` format. Do not ask it to re-explain the plan nor to copy its logs.

Once it returns: read its diff, confirm it contains no production code, then check the filtered test's expected failure. Never production code ahead of a red test.

**Relay its `## RED` table to the user immediately, before GREEN.** A subagent's report is never shown to the user: an unrelayed table is a table nobody reads. The subagent returns method names and cases; **you** add the `RM/CU` column from the contract you handed it — it is your id, not its output. Print, under the behaviour's name, with the observed exit code:

```markdown
### RED — [behaviour] (exit 1)

| Test | RM/CU | Case covered |
|---|---|---|
| `[Class]Tests.[Method]` | RM-XX | what the test observes |
```

Check the table against the diff before relaying: a test method present in the diff but absent from the table comes back to the subagent. Keep these rows for the batch — they are the material of the final recap (step 5, `references/closing.md`); do not rebuild them from the diff at the end.

**GREEN + REFACTOR = delegate to the `tdd-implementer` subagent.** It writes the production code, deletes what its code orphaned, runs the filtered test and states the cost. Test files are read-only to it: a test that cannot go green without being modified comes back as `## BLOCKED`, it does not get weakened. Delegate this compact contract, without attaching the plan or having it re-read:

```text
RM/CU: …
Behaviour: …
Red test: exact path + method name
Out of scope — next behaviour: [guard/branch not to write] — would turn the RED of [X] green
Already stubbed at RED (body to fill): exact paths
To create from scratch: exact paths
Elements: exact names + public signatures from the sheet — declaration only, never a body
Applied DDD/APP ids: …
Exploitable invariants — what they remove: …
Expected access cost: n reads + n writes to Infrastructure, independent of [input]
Snapshot (approval-testing suites only): approved-file path + literal seeded values expected
```

**The contract carries only what the agent cannot know.** Never restate what `.claude/agents/tdd-implementer.md` already binds it to: zero comments, test files read-only, validation commands, REFACTOR, orphan deletion, `## GREEN` / `## BLOCKED` format. Each restatement is paid on every delegation and becomes a second source that drifts from the charter.

**Signature means declaration** — name, parameters, return type. A dictated body makes your own mistake read as the spec, and no review catches it: the code matches the contract. If you need to dictate the body, you are doing the GREEN yourself — do it, do not delegate.

**The two stub lists are not optional.** `tdd-test-author` writes signature stubs to make the RED observable (`references/common-rules.md` §1). You have just read its diff: a file it already created, announced as "to create", sends the agent looking for work that is done.

**Expected access cost is Infrastructure calls**, not files to read. A contract stating "1 read" while prescribing six file reads sets a budget the agent must break to obey it.

Snapshot acceptance procedure and its single allowed write under `tests/` → `references/test-scope.md` §6.

**A GREEN contract carries the current behaviour only.** Never put in it a guard, a branch or a rule belonging to a behaviour whose test is not yet written: its RED then comes back green, and the only way out is to strip the code, observe the red and re-delegate. Measured on 2026-09-09: two guards written ahead in the GREEN of behaviour 1 cost the removal, the re-observation and the restoration of the same code, plus a user interruption.

Once it returns `## GREEN`: read its diff, check the announced cost against the code, and each hunk's attachment. A `## BLOCKED` on an unbounded cost or a design ambiguity is settled here — or escalated to `/plan-implementation` if it moves a decision of the plan. Never by re-running the agent with the same instruction.

**Correction of a returned agent: `SendMessage` under 3 turns, a fresh `Agent` beyond.** `SendMessage` resumes the agent with its whole transcript, which is re-sent on every further turn: an agent stopped at 49 turns carries ~80 k of context and every correction turn pays it. A fresh `Agent` restarts at ~17 k of preamble plus ~11 k of reloaded rules and files. Measured on 2026-09-09: a 10-turn correction costs ~850 k in continuation against ~350 k in a fresh agent. Beyond 3 turns, re-delegate — the returned `## RED` / `## GREEN` report already carries the handoff (test paths, command, exit code).

### 3. Global green loop

Fix until fully green (every behaviour of the batch). **Each suite's scope is decided, not endured** — which suites to run whole or filtered, how to build the integration-test filter, how to report the scope → `references/test-scope.md` §2-4.

**Every suite you run from here writes to a file, not to the context**: `> "$SCRATCH/test-<Suite>.txt" 2>&1; echo "exit=$?"; tail -15 …` — form and rationale in `references/test-scope.md`, "Runner". The suites whose scopes are independent go out in a **single message**.

In the batch sheet, tick RED only after the filtered test's expected failure, GREEN after success, COST after reviewing the cost. Never tick evidence you have not observed.

### 4. Delegated final audit

After the global green loop, produce the audit capture in **one call** — `bash scripts/audit-capture.sh FX <sheet> <scratchpad>/audit-FX.txt` — then invoke `/verify-ddd-tdd batch FX`, passing in the argument the path of that capture and the FX section of the sheet, which you already hold. Its `context: fork` runs it in an isolated subagent, in fast mode, writing no file. Wait for its verdict before concluding.

The capture carries the status, the diff, the RM/CU and DDD/APP/PERF coverage, and the `build` / `ArchitectureTests` exit codes. Handing that over is what keeps the audit from spending thirty turns collecting what a single script produces in five seconds — measured on 2026-09-08: five audits, 259 turns, not one of them carrying two tool calls. It deliberately leaves the targeted filters out: their scope stays an audit decision.

- Verdict `VALID`: keep its evidence table and its commands with exit codes in the final summary. If it lists **Minor** deviations, carry them over as they are, without fixing or hiding them: the user decides.
- Verdict `GAPS`: fix in the main agent, re-run the affected validations, then re-delegate with `/verify-ddd-tdd batch FX resume`, quoting the previous verdict's deviation table. The audit then re-examines those deviations and the diff produced since, not the whole batch.
- After two correction/audit rounds still in deviation, stop and return the blocking deviations; work around neither the plan nor the audit.

A `VALID` verdict closes **the current batch only**. Stop there: do not start, delegate or suggest any following batch. End with `→ Batch FX complete — manual validation required. Run /clear before any other batch.`

### 5. Closing the batch

Plan update, handler `CLAUDE.md`, diff re-read hunk by hunk, final summary and test recap table → **read `references/closing.md` and follow it**. Open it here, after the verdict, not at the start of the batch.


---

## Reference

Per-layer DDD conventions (naming, base classes, structure, pitfalls) → `.claude/rules/*.md`, loaded automatically. Full code examples → `references/examples-{domain,application,infrastructure,webapi}.md`, one per layer. Data-access cost → `references/conventions.md`.

## End of batch

After a `VALID` verdict, wait for the user's manual validation before any new `/implement-tdd` command.

**One batch, one session.** Never chain a second batch in the current session: the batch that follows pays the accumulated context of the one before, which contributes nothing to it. Measured on 2026-09-08 over three batches — at equal request count, the second half of a session costs **1.9×** the input of the first, and 55 % of its requests run past 200 k of prompt, where the API bills a premium rate. Chaining also drags the session into a `/compact`, whose summary is then carried to the end. What grouping saves is one `(startup)`, about $4.50; what it costs is its whole tail at 1.9×. `/clear` between batches.
