# Common rules — implementation skills (.NET)

Read by `tdd-test-author` and `tdd-implementer`. `/implement-tdd` opens §4.5 alone, bounded; first-run-green rule restated in its `SKILL.md`.
Test rules → `/tests-unit-tests`, `/tests-integration-tests`, `/tests-contract-tests`.
Per-layer DDD conventions (naming, base classes, structure, pitfalls) → `.claude/rules/*.md`, auto-loaded. Code pattern → an existing file of the same kind in the repo.

## 1. Coding rules

- **Comment only what the code cannot say** — a constraint, a decision, a workaround, an external reason. Never a paraphrase of the code, a change narrative or a ticket number. Match the file's comment density; XML `///` doc only where the file already documents its members that way.
- Delete useless comments (restating code, stale, ownerless TODO) **within lines your change touches**. Useless comment elsewhere in file: report, don't delete.
- Naming must make flow and invariants readable without a comment. Durable business rule also documented in handler folder's `CLAUDE.md`, kept by the orchestrator (`closing.md` §2), not by you: your change contradicts a line you read there or in the sheet → name it, `path:line`, in your report.
- **A predicate on Domain state is a business rule** — "does it change", "is it excluded", "is it eligible": call the aggregate or value object member that states it (add it there if missing), never re-code it in a handler `if` or an Infrastructure `Where`. A query filter needing it reads the boundary from the Domain (exposed set or constant), never a copied comparison.
- **Surgical change**: every modified line ties to the behaviour at hand. No improving adjacent working code, no renaming/reformatting outside scope, no flexibility or configurability nobody asked for. File's local style beats personal preference. Delete orphans (`using`, variable, method, type) **your** change created; pre-existing dead code reported, not deleted. Adjacent bug outside the batch's RM/CU: reported, not fixed.
- **Reuse before creation**: an existing element covering 80 % of the need is extended, not duplicated. A second type sharing an existing one's shape: rename or extend, never copy.
- **Placement**: a business rule lives in the aggregate, never in a handler, repository, Infrastructure or WebAPI. Resource limits (request size, rate, page bounds) belong to WebAPI or query creation, never to Domain.
- **`var`** for local variables.
- **1 class = 1 file**, file name = class name.
- DDD naming (Command/Handler/Repository/Endpoint/DomainEvent/Exception/EntityId…) → `.claude/rules/*.md`, `Naming` table of the layer.

## 2. Test-first TDD

Production code exists to turn a red test green. Code written before its test is deleted and rewritten after the red: kept or adapted, it carries assumptions no test ever challenged.

**Cycle per behaviour** (Command/Query+Handler, endpoint, repository method; aggregate method only through its handler/service):
1. **RED** — 1 test of an **observable business behaviour** (final state verifiable through public API / output), tied to an RM/CU, which **fails**. Not a private helper or internal detail — sheet step is a mechanism ("scan", "detect", "map", "convert") → go up to the business behaviour it serves, test that. Filtered test → confirm expected failure (red assertion, not incidental compile error).
2. **GREEN** — minimal code to pass **this test alone**. Nothing more. Build + filtered test → green.
3. **REFACTOR — clean up, then delete.** Duplication and naming first, behaviour unchanged. Then what must **go**: defensive branch made impossible by a sheet invariant, wrapper/indirection/mapping with a single caller, parameter never read, abstraction with no second implementer, second type sharing an existing one's shape. GREEN's minimum ≠ batch's minimum: what remains after three behaviours is. Scope: delete what **your** code orphaned, not pre-existing dead code. Rewriting a test keeps its discriminating assertion (targeted id, not a count); a test is deleted only when its rule is gone from the handler table. Re-test → green.
4. **COST** — **state the behaviour's access cost** from `cctoolkit access-cost <production files>`: "n reads, n writes" towards Infrastructure
   (repository, external service, file). Green ≠ done: no test observes the call count.
   - Cost **bounded and independent of input size**. N candidates → not N queries.
   - Infrastructure call **inside a loop** → back to **design**, not cosmetic refactoring.
   - Script's last line is the statement; a call it lists you can't explain → you don't know your code, re-read before going on.
   Access pitfalls → `conventions.md` § "Data access".

Behaviour already covered by a pre-existing test → skip RED, implement until green (don't modify the test).

A double mirrors its production adapter: it throws only what the adapter throws and copies every field the production path copies; an adapter change updates its double in the same batch.

### Test green on its first run — two cases, never "let's keep it just in case"

Test meant to be RED passing immediately proved nothing. Decide between the two causes before going on:

| Cause | Diagnosis | Action |
|---|---|---|
| Behaviour **already covered** by an existing test | Find the test covering it (same handler, same RM) | **Delete the new test.** Proves nothing, doubles maintenance. Next behaviour |
| Behaviour **not covered**, assertion too weak | Assertion doesn't observe the RM (default state, `NotNull`, non-discriminating result) | **Fix the assertion** until red, then GREEN |

### Cost defects — back to design
- `await` on a repository/service **inside a `foreach`/`for`/`while`**
- One query per received identifier (N+1)
- `Save` / `SaveChanges` inside a loop
- In-memory filtering (`.Where(...)` on the result) of what SQL can filter
- Grouping (`GroupBy`, dictionary, loop over groups) when an **invariant of the sheet**
  guarantees a single group → the code defends an impossible case, delete it

A call count that depends on the input is unbounded, however small the test's sample.

## 3. Git

- **Never commit.** User decides when.
- Never create or switch branches, never push, never rewrite history.

## 4. When a rule gives way

Rules above written for the common case. Five situations make them give way — no others. Exception not listed here = ambiguity: written as `Hn` in the sheet, never decided in silence.

1. **Signature stub to make RED observable.** Handler test won't compile while Command, return type or interface don't exist, and a compile failure isn't a RED (§2, step 1). `tdd-test-author` writes strict minimum to compile, listed on its `Stubs` line: signature, empty type, `throw new NotImplementedException()`. No logic, no branch, no validation. Test must fail **on its assertion** — failing on `NotImplementedException` = stub still too thin or assertion too late. No breach of test-first: no behaviour to prove.

2. **Batch explicitly asks for the deletion.** "Pre-existing dead code reported, not deleted" (§1) assumes deletion out of scope. When a sheet step *is* the deletion, it **is** the scope: hunk ties to that step like any other.

3. **Rule would destroy the answer.** User instruction reaffirmed after you stated the rule wins: state the rule once, one sentence, do what was asked, record as `Hn`. Same when a harness or system instruction contradicts this file — constraint wins, form stays.

4. **Data loss or security hole on the path the batch touches.** "Adjacent bug → report, don't fix" (§1, surgical change) covers a functional defect. Data corruption or authorisation leak on the modified path **stops the batch**: escalate immediately, before going on. No silent fix, no line buried in the final summary.

5. **Declarative artifact written by the orchestrator.** Single list — `/implement-tdd`, `/plan-implementation` and `/verify-ddd-tdd` point here: EF entity + its `IEntityTypeConfiguration`, `DbSet` registration, DI registration, `Abstractions.Models` request/response DTO. EF migrations never: another project, never modified here. These are pure declaration and mapping, no branch, no validation, no business decision. Orchestrator writes them directly, no delegation, no red before them — correctness observed by the integration or contract test of the behaviour they serve, which does go through RED. Such an artifact carrying a branch, validation or mapping decision stops being declarative and goes back through RED. Assumed for cost by an explicit project decision the sheet records: not reported as a deviation.

An exception names the rule it bends **and** the structural reason bending it. "Too simple to test", "I'll test afterwards", "while I'm here" are not structural reasons: they only make the work shorter.
