---
name: implement-tdd
description: "Use when implementing a .NET/DDD feature or batch across every layer under strict TDD: orchestrates the red-test, implementation and final-audit chain with subagents."
argument-hint: "[batch FX <global plan path> | batch FX — correction: manual finding]"
---

# Implementation orchestrator — strict TDD (Red-Green-Refactor)

Drives whole **test-first** chain: test subagent → implementation → verification subagent. Explicit RED-GREEN-REFACTOR loop per behaviour. Stop when all verified; block on business ambiguity.

$ARGUMENTS

Measurements + reasons: `references/rationale.md`, same headings. **Never open during batch.**

## Common rules

`references/common-rules.md` (Iron Law, cycle, Red Flags, exceptions) binds the two coding agents, which read it. **You don't code → don't open it.** Your own two rules:

- **Declarative artefacts yours, no red before them** (§4.5): EF entity + its `IEntityTypeConfiguration`, `DbSet` registration, `Abstractions.Models` request/response DTO — pure declaration/mapping, covered by integration or contract test of behaviour they serve. One carrying branch, validation or mapping decision → back through RED.
- **Test green on first run never kept**: covered elsewhere → delete; assertion too weak → strengthen until red. `tdd-test-author` decides, says which in its `## RED`.

**Never commit.** Test rules → `/tests-*` skills. `rtk dotnet` for build/test; RTK compacts logs, never replaces exit code.

## Mandatory orchestration

Skill stays in main agent: **no** `context: fork`. Subagent can't delegate in turn.

Project agents:

| Phase | Agent | Authorisation |
|---|---|---|
| RED | `tdd-test-author` | Write only requested test |
| GREEN + REFACTOR | `tdd-implementer` | Write production code; test files read-only |
| Final verification | forked `/verify-ddd-tdd` | Read + run validations, no modification |

**One behaviour → phases strictly sequential**: RED → GREEN → REFACTOR → COST, no overlap. Test subagent result before touching any production file; global GREEN before launching verifier.

**Across behaviours RED parallelises — GREEN never.** Two behaviours, **disjoint target test files** → both `tdd-test-author` in one message. Check disjointness on sheet first: shared fixture, shared `CoreTests/` builder, or one test class carrying both scenarios → sequential. GREEN serialised whatever happens.

`tdd-test-author` or `tdd-implementer` missing → stop before coding, name missing file under `.claude/agents/`; never take its role.

You own **design**: split into behaviours, arbitrate unbounded cost, settle ambiguity, update plan + docs. Subagents produce and declare; you judge.

## Workspace projects

Production — `src/{{PRODUCT}}.{Abstractions.Models, Domain, Application, Infrastructure, WebAPI}/`.
Suites — `tests/{{PRODUCT}}.{UnitTests, IntegrationTests, ContractTests, E2ETests, ArchitectureTests, DslTests}/`.
`tests/{{PRODUCT}}.CoreTests/` not a suite: shared test infra (doubles, builders, assets).

EF migrations sit in another project: **never modify from this workspace**.

## Build and tests

Runner, commands, test level, suite scope, integration-test filtering → **`references/test-scope.md`**, single source shared with `/verify-ddd-tdd`. Not restated here.

## Workflow

### 1. Analysis

**Entry guard — one batch, one session. Check before any read.** Batch already closed this session (`/verify-ddd-tdd` verdict relayed, or `→ Batch FX complete` printed) → **stop**, read/delegate/write nothing; print `→ Batch FZ already closed in this session. Run /clear, then relaunch /implement-tdd batch FX.`, end turn. Relaunch without clear ≠ authorisation: say it, stop. `.claude/hooks/implement-tdd-guard.sh` enforces outside model; identical relaunch forces through — false positive only, never chaining.


**Phase reads in one message**: global plan (located sections), batch sheet, `references/test-scope.md`, one `Read` each. Same for every diff/status capture and every group of independent `Bash` probes anywhere in batch.

- **Argument = `batch FX <global plan path>`** (e.g. `implement-tdd batch F1 todo/<feature>/<CODE>-PLAN.md`) — **path as text, never an `@` mention**, which attaches the whole plan to every turn. Attached anyway → don't re-read, use the located sections from the attachment. No path → `ls todo/*/*-PLAN.md`; several candidates → ask.
  1. Global plan (`*-PLAN.md`) **by section, never whole**: summary + batch-execution index, then `### Batch FX` only — locate with `grep -n "^## \|^### "`, `Read` those ranges.
  2. Batch sheet (`*-PLAN-FX.md`) — technical detail, batch-scoped, read whole
  3. **Steps already ticked ✅** in global plan → skip, resume at first ⬜ step
  4. Follow sheet's remaining elements + steps
  5. Check global plan's DDD/APP/PERF coverage, collect applied ids from sheet. In `/plan-implementation`, read `references/ddd-rules.md` + `architecture-rules.md` **only** on those ids' lines; open `ddd-examples.md` only if pattern still unknown.
- **Argument = `batch FX — correction: [manual finding]`** → read `references/correction-mode.md`, follow it. Never open on plain `batch FX`.
- **Otherwise**: don't code. DDD design must be explicit in plan → route to `/plan-implementation`.

**Invariants → what they REMOVE.** Sheet states invariants ("a copy has a single referent", "every key comes from the same keyring"). Write **what they take out of code** — loop, `GroupBy`, dictionary, defensive branch, second read.

**Mid-batch ambiguity → traced assumption, never silent decision.** Question changing scope, RM/CU or design decision stops batch (back to `/business-spec` or `/plan-implementation`). Question changing none: settle, but write down — batch sheet, under `## Assumptions`, line `Hn — [what you assume] — to be validated by [who]`; carry into final summary.

**At start (once)**: read `references/test-scope.md` (test level, suite scope). `references/conventions.md` § "Data access" **on demand only** — stated cost you can't validate against code, or `## BLOCKED` on cost — never at start. Layer conventions (naming, base classes, folder structure, pitfalls) arrive alone via `.claude/rules/*.md` on reading a file of that layer: don't hunt them. Layer examples (`references/examples-domain.md`, `-application`, `-infrastructure`, `-webapi`): layer rule gives exact path; open one only if pattern unknown.

**Never open source file outside target handler folder — delegate that look.** Every `Read` under `src/` or `tests/` attaches that folder's `CLAUDE.md` + layer rules for rest of batch. `graphify explain|path|query` first — symbol relation answered there, no attachment. Files still needed → `Explore` subagent (`model: haiku`, prompt naming `graphify`; bounded report: `file:line` table, 20 lines max). Feature cross-cutting design = `DESIGN.md` beside index `CLAUDE.md`, never auto-loaded: behaviour needs a chapter → name that section on agent's `Read bounded` line, never open it yourself. Same for `grep`/`sed`/`cat` over `tests/` hunting builder method, fixture or snapshot: paths sit in sheet's `## Ancrages` table.

### 2. Red-Green-Refactor loop per behaviour

Split batch into **end-to-end business behaviours** carried by Command/Query+Handler, endpoint or repository, each tied to RM/CU. Aggregate method = internal step, never standalone test target. Apply **RED → GREEN → REFACTOR → COST** (`common-rules.md` §2) to each, order **Domain → Application → Infrastructure → WebAPI**.

**Sheet steps = evidence checklist, not cycle unit — regroup first.** **Several steps on same handler + same aggregate method = one cycle.** Guard, refusal, visibility or uniqueness check = extra scenario of that behaviour, not own cycle: its RED = one more `Scenarios` line in same `tdd-test-author` contract, its GREEN in same `tdd-implementer` contract. Tick **every** merged step once cycle closes, each keeping own RM + cost annotation. Announce mapping to user before first RED — steps 1-2-3 → behaviour A, steps 4-5 → behaviour B.

Regrouping doesn't relax `references/common-rules.md` §2: inside merged cycle all scenarios red before any production code, and GREEN contract's "out of scope — next behaviour" line still names guards of a **later** behaviour. Cycle merges, test-first order never.

**Group behaviours into waves before entering loop.** Wave = behaviours whose tests touch neither same test file nor same production code — typically one Application + one Infrastructure or WebAPI. Wave's REDs in one message, one `Agent` call each; GREENs sequential.

**Next wave's REDs go in same message as current wave's first GREEN.** Safe while wave n+1 test files stay disjoint from wave n's and no signature stub RED(n+1) needs lands in a file GREEN(n) fills — check both on sheet; shared stub → that RED back to sequential. `CS2012` / `file in use` in an agent = build collision, not design fault → have it re-issue its filtered command, don't re-delegate.

**COST mandatory before next behaviour.** `tdd-implementer`'s `Cost` line = last line of `scripts/access-cost.py` over its files — awaited Infrastructure calls read off the syntax tree, loop, lambda and in-memory filter flagged — plus its input-independence clause. You **validate the line, never the file**: no Infrastructure call in a loop and no in-memory filter, counts consistent with the sheet's access cost, clause naming the input. Line without the script's form → `SendMessage` to the agent; never open the handler to rebuild it. Any flag delivered as `## GREEN` = **design** defect → back to design. Symptom/fix table → `references/conventions.md` § "Data access".

**RED = ALWAYS delegate test writing** to `tdd-test-author`, naming skill to apply + scenario name + RM. Level choice, Infrastructure integration-test obligation + its only waiver → `references/test-scope.md` §1; aggregate/query/command/interaction policy → same file §5. Both absolute: deviation = Blocking at audit.

Read plans once, in main agent. Per behaviour delegate this compact contract, no plan attached, no re-read asked:

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

**Exact paths, class, fixture, method names not optional — copied, not searched.** Sheet's `## Ancrages` table carries test class, fixture, `CoreTests` builders + doubles, production files, contract snapshot of every step; test names, levels and RM from the step's table under `## TDD sequence`. Missing row = plan gap: one `ls` to confirm path, one `Edit` adding the row to the sheet, then delegate — never `grep` hunt across `tests/` here.

**Sort paths into the two lines, don't merge.** `read in full` = file agent rewrites, `read bounded (context only)` = file only consulted — two literals both agents key on, keep verbatim.

Agent writes test files only, runs filtered test, returns compact `## RED`. Don't ask it to re-explain plan or copy logs.

Its `## RED` carries `Production diff` — `git diff --stat -- src/`, expected empty — plus filtered command + exit code. Empty line + red assertion = enough, don't open diff. Non-empty → back to agent: production code ahead of red test deleted, never kept.

**Relay its `## RED` table to user immediately, before GREEN.** Subagent returns method names + cases; **you** add `RM/CU` from the contract you handed it. Print under behaviour name, with observed exit code:

```markdown
### RED — [behaviour] (exit 1)

| Test | RM/CU | Case covered |
|---|---|---|
| `[Class]Tests.[Method]` | RM-XX | what the test observes |
```

Check table against diff before relaying: test method in diff but absent from table → back to subagent. Keep rows — material of final recap (`references/closing.md` §4).

**Relay cap — one RED table, one `## GREEN` line, nothing else.** Never reprint the batch state, the remaining cycles, the plan mapping or a table already relayed: measured 2026-09-17, your own replies resent as input are 16 % of the bill, and they grow with the number of turns, not with their length. A recap belongs to the end of the batch (`references/closing.md`), never to a cycle boundary. Progress between cycles = one line, `→ Cycle n/N clos — [comportement]`.

**GREEN + REFACTOR = delegate to `tdd-implementer`.** It writes production code, deletes what its code orphaned, runs filtered test, states cost. Test files read-only to it: test that can't go green without modification comes back `## BLOCKED`, never weakened. Contract, no plan attached, no re-read asked:

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

**Contract carries only what agent can't know.** Never restate what `.claude/agents/tdd-implementer.md` binds: zero comments, test files read-only, validation commands, REFACTOR, orphan deletion, `## GREEN` / `## BLOCKED` format.

**Signature = declaration** — name, parameters, return type. Dictating a body → you're doing GREEN yourself: do it, don't delegate.

**Name the ripple.** Signature moved (parameter dropped from aggregate method, member leaving repository interface) → changes land in files neither stubbed nor created: mappers, repository implementations, hand-written doubles, integration fixtures. One clause per file — "loses the `hasBeenTransferred` parameter", "stops hydrating from the repository".

**Two stub lists not optional.** `tdd-test-author` writes signature stubs to make RED observable (`references/common-rules.md` §1); read its diff → file it created never announced "to create".

**Expected access cost = Infrastructure calls**, not files to read.

Snapshot acceptance + its single allowed write under `tests/` → `references/test-scope.md` §6.

**GREEN contract carries current behaviour only.** Never a guard, branch or rule of a behaviour whose test isn't written yet: its RED comes back green, only exit = strip code, observe red, re-delegate.

On `## GREEN`: its `Tests diff` line — `git diff --stat -- tests/` since RED, expected empty or accepted `.verified.txt` alone — settles test integrity, no diff opened; its `Cost` line settles COST the same way (§2), no handler opened. Hunk-by-hunk walk of batch = auditor's (`/verify-ddd-tdd` §1.4), not yours. `## BLOCKED` on unbounded cost or design ambiguity settled here — escalate to `/plan-implementation` if it moves a plan decision. Never re-run agent with same instruction.

**Correcting a returned agent: `SendMessage` under 3 turns, fresh `Agent` beyond.** Returned `## RED` / `## GREEN` already carries handoff (test paths, command, exit code).

### 3. Global green loop

**Whole suites run here, once per batch — never inside loop.** In the cycle subagents run only their behaviour's `--filter-class`; their `rtk dotnet build --no-restore` = loop's only batch-wide command, one per cycle.

Fix until fully green (every behaviour). **Each suite's scope decided, not endured** — whole or filtered, integration-test filter, scope reporting → `references/test-scope.md` §2-4.

**Every suite run from here writes to file, not context**: `> "$SCRATCH/test-<Suite>.txt" 2>&1; echo "exit=$?"; tail -15 …` — form in `references/test-scope.md`, "Runner". Independent suites in **one message**.

**Tick sheet once per behaviour, after COST**: one `Edit` sets `RED ✅ · GREEN ✅ · COST ✅` together, each observed first — RED on filtered test's expected failure, GREEN on its success, COST on its `Cost` line checked against the sheet. Locate step line with `grep -n`, edit that line; sheet read once in §1, never re-read whole for a tick. Never tick unobserved evidence.

### 4. Close the batch

Read `references/closing.md` whole, follow §1 → §5 in order: sheet + handler docs (§1-2), gate + delegated audit (§3), summary (§4), batching (§5). `VALID` verdict closes **current batch only**. Stop: don't start, delegate or suggest following batch. End with `→ Batch FX complete — manual validation required. Run /clear before any other batch.`

---

## Reference

Layer DDD conventions → `.claude/rules/*.md`, auto-loaded. Code examples → `references/examples-{domain,application,infrastructure,webapi}.md`. Data-access cost → `references/conventions.md`. Measurements + reasons → `references/rationale.md`, outside batch only.

## End of batch

After `VALID` verdict, wait for user's manual validation before any new `/implement-tdd`. **One batch, one session**: never chain a second in current session — `/clear` between batches.
