# Common rules — implementation skills (.NET)

Shared by `/implement-tdd`.
**Test** rules are NOT here → skills `/tests-unit-tests`, `/tests-integration-tests`, `/tests-contract-tests`.
Per-layer DDD conventions (naming, base classes, structure, pitfalls) → `.claude/rules/*.md`, loaded automatically. Code examples → `examples-{domain,application,infrastructure,webapi}.md` (same folder), one per layer.

## 1. Coding rules

- **Never add a comment**, XML `///` doc included. Intent is carried by naming.
- Delete the comments you wrote, and the ones that serve nothing — restating the code, stale comment, ownerless TODO — **within the lines your change touches**. A useless comment elsewhere in the file is reported, not deleted. Keep only the pre-existing ones that explain a decision, a constraint or an exception not deducible from the code.
- Naming must make the flow and the invariants readable without a comment. A durable business rule is also documented in the handler folder's `CLAUDE.md`.
- **Surgical change**: every modified line ties back to the behaviour at hand. No improvement of adjacent code that already worked, no renaming or reformatting outside scope, no flexibility or configurability nobody asked for. The file's local style beats personal preference. Delete the orphans (`using`, variable, method, type) **your** change created; pre-existing dead code is reported, not deleted.
- **`var`** for local variables.
- **1 class = 1 file**, file name = class name.
- DDD naming (Command/Handler/Repository/Endpoint/DomainEvent/Exception/EntityId…) → `.claude/rules/*.md`, `Naming` table of the layer concerned.

## 2. Test-first TDD — Iron Law

```
NO PRODUCTION CODE WITHOUT A RED TEST FIRST
```

Production code written before its test? Delete it. Start again. **Violating the letter is violating the spirit.**

No exceptions: do not keep it "for reference", do not "adapt" it while writing the test, do not look at it. Delete means delete.

**Cycle per behaviour** (Command/Query+Handler, endpoint, repository method; an aggregate method only through its handler/service):
1. **RED** — 1 test of an **observable business behaviour** (final state verifiable through the public API / output), tied to an RM/CU, which **fails**. **Never** test a private helper or an internal detail — if the sheet's step is a mechanism ("scan", "detect", "map", "convert"), go back up to the business behaviour it serves and test that one. Filtered test → confirm the expected failure (red assertion, not an incidental compile error).
2. **GREEN** — minimal code to pass **this test alone**. Nothing more. Build + filtered test → green.
3. **REFACTOR — clean up, then delete.** Duplication and naming first, without changing behaviour. Then go through the list of what must **go**: a defensive branch made impossible by an invariant of the sheet, a wrapper / indirection / mapping with a single caller, a parameter never read, an abstraction with no second implementer, a second type sharing the shape of an existing one. GREEN's minimum is not the batch's minimum: what remains after three behaviours is. Scope: delete what **your** code orphaned, not pre-existing dead code. Re-test → green.
4. **COST** — **state the behaviour's access cost**: "n reads, n writes" towards Infrastructure
   (repository, external service, file). Green ≠ done: no test observes the call count, the pressure
   will never come from the suite.
   - The cost must be **bounded and independent of input size**. N candidates → not N queries.
   - An Infrastructure call **inside a loop** → go back to **design**, not to cosmetic refactoring.
   - You cannot state the cost → you do not know your code, re-read it before going on.
   Detailed access pitfalls → `conventions.md` § "Data access".

Behaviour already covered by a pre-existing test → skip RED, implement until green (do not modify the test).

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

A test meant to be RED that passes immediately has proved nothing. Decide between the two causes before going on:

| Cause | Diagnosis | Action |
|---|---|---|
| Behaviour **already covered** by an existing test | Find the test covering it (same handler, same RM) | **Delete the new test.** It proves nothing and doubles maintenance cost. Move to the next behaviour |
| Behaviour **not covered**, assertion too weak | The assertion does not observe the RM (default state, `NotNull`, non-discriminating result) | **Fix the assertion** until it turns red, then GREEN |

Never keep a green-from-the-start test hoping it "protects anyway": it locks down what already existed, not what you are writing.

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
| "I'll test afterwards" | A test that passes straight away proves nothing. |
| "Testing after has the same purpose" | After = "what does it do?". Before = "what must it do?". |
| "Already tested by hand" | Ad-hoc ≠ systematic. Not replayable. |
| "Deleting X hours of work is waste" | Sunk cost. Unproven code is debt. |
| "I'll quickly improve the code next door" | A line not traced to an RM/CU means review is impossible, regression invisible. |
| "I'll make it configurable just in case" | Not asked for = no test, no need. Delete it. |

## 3. Git

- **Never commit.** The user decides when to commit.
- Never create or switch branches, never push, never rewrite history.

## 4. When a rule gives way

The rules above are written for the common case. Four situations make them give way — no others. An exception not listed here is treated as an ambiguity: it is written as `Hn` in the sheet, it is not decided in silence.

1. **Signature stub to make RED observable.** A handler test will not compile as long as the Command, the return type or the interface do not exist, and a compilation failure is not a RED (§2, cycle step 1). Write then the strict minimum to compile: signature, empty type, `throw new NotImplementedException()`. No logic, no branch, no validation. The test must fail **on its assertion** — if it fails on `NotImplementedException`, the stub is still too thin or the assertion comes too late. This stub does not breach the Iron Law: it contains no behaviour to prove.

2. **The batch explicitly asks for the deletion.** "Pre-existing dead code is reported, not deleted" (§1) assumes deletion is out of scope. When a step of the sheet *is* the deletion, it **is** the scope: the hunk ties to that step like any other.

3. **The rule would destroy the answer.** A user instruction reaffirmed after you stated the rule wins: state the rule once, in one sentence, do what was asked, record it as `Hn`. Same when a harness or system instruction contradicts this file — the constraint wins, the form stays.

4. **Data loss or a security hole on the path the batch touches.** "Adjacent bug → report, do not fix" (§2, scope Red Flags) applies to a functional defect. Data corruption or an authorisation leak on the modified path **stops the batch**: escalate it immediately, before going on. No silent fix, no line buried in the final summary.

**What is never an exception**: the lines of the Rationalisations table (§2). "Too simple", "I'll test afterwards", "while I'm here" do not become admissible because an exceptions section exists. An exception is recognised by naming the rule it bends **and** the structural reason bending it — never by making the work shorter.
