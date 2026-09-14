# Common rules — implementation skills (.NET)

Read by `tdd-test-author` and `tdd-implementer`. `/implement-tdd` doesn't open it: applies §4.5 + first-run-green rule, restated in its `SKILL.md`.
**Test** rules NOT here → `/tests-unit-tests`, `/tests-integration-tests`, `/tests-contract-tests`.
Per-layer DDD conventions (naming, base classes, structure, pitfalls) → `.claude/rules/*.md`, auto-loaded. Code examples → `examples-{domain,application,infrastructure,webapi}.md`, one per layer.

## 1. Coding rules

- **Never add a comment**, XML `///` doc included. Intent carried by naming.
- Delete comments you wrote + useless ones (restating code, stale, ownerless TODO) **within lines your change touches**. Useless comment elsewhere in file: report, don't delete. Keep pre-existing ones explaining a decision, constraint or exception not deducible from code.
- Naming must make flow and invariants readable without a comment. Durable business rule also documented in handler folder's `CLAUDE.md`.
- **Surgical change**: every modified line ties to the behaviour at hand. No improving adjacent working code, no renaming/reformatting outside scope, no flexibility or configurability nobody asked for. File's local style beats personal preference. Delete orphans (`using`, variable, method, type) **your** change created; pre-existing dead code reported, not deleted.
- **`var`** for local variables.
- **1 class = 1 file**, file name = class name.
- DDD naming (Command/Handler/Repository/Endpoint/DomainEvent/Exception/EntityId…) → `.claude/rules/*.md`, `Naming` table of the layer.

## 2. Test-first TDD — Iron Law

```
NO PRODUCTION CODE WITHOUT A RED TEST FIRST
```

Production code written before its test? Delete it. Start again. **Violating the letter is violating the spirit.**

No exceptions: don't keep it "for reference", don't "adapt" it while writing the test, don't look at it. Delete means delete.

**Cycle per behaviour** (Command/Query+Handler, endpoint, repository method; aggregate method only through its handler/service):
1. **RED** — 1 test of an **observable business behaviour** (final state verifiable through public API / output), tied to an RM/CU, which **fails**. **Never** a private helper or internal detail — sheet step is a mechanism ("scan", "detect", "map", "convert") → go up to the business behaviour it serves, test that. Filtered test → confirm expected failure (red assertion, not incidental compile error).
2. **GREEN** — minimal code to pass **this test alone**. Nothing more. Build + filtered test → green.
3. **REFACTOR — clean up, then delete.** Duplication and naming first, behaviour unchanged. Then what must **go**: defensive branch made impossible by a sheet invariant, wrapper/indirection/mapping with a single caller, parameter never read, abstraction with no second implementer, second type sharing an existing one's shape. GREEN's minimum ≠ batch's minimum: what remains after three behaviours is. Scope: delete what **your** code orphaned, not pre-existing dead code. Re-test → green.
4. **COST** — **state the behaviour's access cost** from `python3 scripts/access-cost.py <production files>`: "n reads, n writes" towards Infrastructure
   (repository, external service, file). Green ≠ done: no test observes the call count.
   - Cost **bounded and independent of input size**. N candidates → not N queries.
   - Infrastructure call **inside a loop** → back to **design**, not cosmetic refactoring.
   - Script's last line is the statement; a call it lists you can't explain → you don't know your code, re-read before going on.
   Access pitfalls → `conventions.md` § "Data access".

Behaviour already covered by a pre-existing test → skip RED, implement until green (don't modify the test).

### Red Flags — STOP, go back to RED
- Code before test
- "Already tested by hand"
- "Testing afterwards is the same"
- "It's the spirit, not the ritual"
- "This case is different because…"

### Scope Red Flags — STOP, revert the hunk
- "While I'm here, let me tidy this file"
- Renaming, reformatting or reorganising code the batch does not modify
- Deleting pre-existing dead code or a pre-existing comment, outside the touched lines
- An adjacent bug outside the batch's RM/CU fixed in passing → report it, do not fix it
- An abstraction, configuration parameter or extension point added "for later"

### Test green on its first run — two cases, never "let's keep it just in case"

Test meant to be RED passing immediately proved nothing. Decide between the two causes before going on:

| Cause | Diagnosis | Action |
|---|---|---|
| Behaviour **already covered** by an existing test | Find the test covering it (same handler, same RM) | **Delete the new test.** Proves nothing, doubles maintenance. Next behaviour |
| Behaviour **not covered**, assertion too weak | Assertion doesn't observe the RM (default state, `NotNull`, non-discriminating result) | **Fix the assertion** until red, then GREEN |

Never keep a green-from-the-start test hoping it "protects anyway": it locks what already existed, not what you're writing.

### Cost Red Flags — STOP, go back to design
- `await` on a repository/service **inside a `foreach`/`for`/`while`**
- One query per received identifier (N+1)
- `Save` / `SaveChanges` inside a loop
- In-memory filtering (`.Where(...)` on the result) of what SQL can filter
- Grouping (`GroupBy`, dictionary, loop over groups) when an **invariant of the sheet**
  guarantees a single group → the code defends an impossible case, delete it
- "It's only 3 or 4 calls" → the number depends on the input, so it is not 3 or 4

### Rationalisations
| Excuse | Reality |
|---|---|
| "Too simple to test" | Simple code breaks too. Test = 30s. |
| "I'll test afterwards" | Test passing straight away proves nothing. |
| "Testing after has the same purpose" | After = "what does it do?". Before = "what must it do?". |
| "Already tested by hand" | Ad-hoc ≠ systematic. Not replayable. |
| "Deleting X hours of work is waste" | Sunk cost. Unproven code is debt. |
| "I'll quickly improve the code next door" | Line not traced to an RM/CU → review impossible, regression invisible. |
| "I'll make it configurable just in case" | Not asked = no test, no need. Delete it. |

## 3. Git

- **Never commit.** User decides when.
- Never create or switch branches, never push, never rewrite history.

## 4. When a rule gives way

Rules above written for the common case. Five situations make them give way — no others. Exception not listed here = ambiguity: written as `Hn` in the sheet, never decided in silence.

1. **Signature stub to make RED observable.** Handler test won't compile while Command, return type or interface don't exist, and a compile failure isn't a RED (§2, step 1). Write strict minimum to compile: signature, empty type, `throw new NotImplementedException()`. No logic, no branch, no validation. Test must fail **on its assertion** — failing on `NotImplementedException` = stub still too thin or assertion too late. No breach of the Iron Law: no behaviour to prove.

2. **Batch explicitly asks for the deletion.** "Pre-existing dead code reported, not deleted" (§1) assumes deletion out of scope. When a sheet step *is* the deletion, it **is** the scope: hunk ties to that step like any other.

3. **Rule would destroy the answer.** User instruction reaffirmed after you stated the rule wins: state the rule once, one sentence, do what was asked, record as `Hn`. Same when a harness or system instruction contradicts this file — constraint wins, form stays.

4. **Data loss or security hole on the path the batch touches.** "Adjacent bug → report, don't fix" (§2, scope Red Flags) covers a functional defect. Data corruption or authorisation leak on the modified path **stops the batch**: escalate immediately, before going on. No silent fix, no line buried in the final summary.

5. **Declarative artifact written by the orchestrator.** EF entity + its `IEntityTypeConfiguration`, `DbSet` registration, migration, `Abstractions.Models` request/response DTO: pure declaration and mapping, no branch, no validation, no business decision. Orchestrator writes them directly, no delegation, no red before them — correctness observed by the integration or contract test of the behaviour they serve, which does go through RED. Such an artifact carrying a branch, validation or mapping decision stops being declarative and goes back through RED. Assumed for cost by an explicit project decision the sheet records: not reported as a deviation.

**Never an exception**: Rationalisations lines (§2). "Too simple", "I'll test afterwards", "while I'm here" don't become admissible because an exceptions section exists. An exception names the rule it bends **and** the structural reason bending it — never makes the work shorter.
