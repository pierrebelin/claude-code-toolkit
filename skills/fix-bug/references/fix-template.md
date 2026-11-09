# Fix plan — the three files

A fix is a one-batch plan: `run-lot` runs its sheet, `knowledge-merge` merges its spec. Structure and anchors verbatim, prose in `language.docs`. `<…>` = to fill. Every parser these files feed: `scripts/sheet-cycles.py` (the `## Cycles` block), `scripts/plan-next-batch.py` (`### Batch execution`, the `### Batch F1` heading), `scripts/knowledge-merge.py` (one `SPEC-*.md`, delta anchors), `scripts/rules-coverage.py` (the `kit:na-rules` line).

## `todo/<code>/SPEC-<code>.md`

```markdown
# <CODE> — Fix: <title>

> <the ticket in one sentence: what goes wrong, for whom>

## 1. Cause <!-- kit:context -->

<root cause, two sentences, `path:line`> · Reproduction: <input and state> → <observed>, expected <expected>.
Verdict: <Bug | Rule to correct> — <the user's answers of the decision, one line each>.

## 2. Business rules <!-- kit:business-rules -->

<verdict Bug: this line only — "No rule changes: <ID> already states the expected behaviour.">
<verdict Rule to correct: one block per rule rewritten>

### <PFX>-RM-<nnn> — <title as corrected> <!-- kit:modified -->
- **Statement**: <the rule, whole, as it must read in the base> · **Origin**: fix <CODE> · **Severity**: blocking
- **Applies to**: <PFX>-CU-<nn>

<a decision the answers overturned, under its own heading>

## 3. Decisions <!-- kit:decisions -->

### <PFX>-D-<nnn> — <decision title> <!-- kit:modified -->
Choice: <the new decision>.
Why: <the ticket's case>.
Rejected: <the previous decision> (overturned by fix <CODE>).
Links: <PFX>-RM-<nnn>
```

## `todo/<code>/<CODE>-PLAN.md`

```markdown
# <CODE>-PLAN — Fix: <title>

> Plan derived from `todo/<code>/SPEC-<code>.md`.
> Batch sheet: `<CODE>-PLAN-F1.md`.

## 0. Summary <!-- kit:summary -->

### Batch execution

| Batch | Intent | RM/CU | Depends on | Execution | Reason |
|-------|--------|-------|------------|-----------|--------|
| F1 | Fix: <title> | <ids> | — | sequential | bug fix |

### Batch F1 — Fix: <title> — ⬜
- [ ] 1. <the behaviour once fixed>

## 1. Scope <!-- kit:scope -->

- **Spec**: `todo/<code>/SPEC-<code>.md`
- **Bounded context**: <context>
- **Non-applicable rules** <!-- kit:na-rules -->: DDD-01 → DDD-11, APP-01 → APP-05, PERF-01: N/A — bug fix inside an existing design, no design decision taken

## 2. Traceability <!-- kit:traceability -->

<!-- kit:cols item,owner,batch -->
| RM/CU | Code owner(s) | Batch |
|-------|---------------|-------|
| <ID> — <rule> | `<path:line of the fix>` | F1 |
```

## `todo/<code>/<CODE>-PLAN-F1.md`

````markdown
# <CODE>-PLAN-F1 — Fix: <title>

> Batch F1 of plan `<CODE>-PLAN.md`. Spec: `todo/<code>/SPEC-<code>.md`.

## Intent <!-- kit:intent -->

<the behaviour once fixed> (<CU id>). **RM**: <ids> | **CU**: <id>

## Cycles

```json
{
 "closing": "light",
 "cycles": [
  {
   "id": "C1", "wave": 1,
   "behaviour": "<the behaviour once fixed>",
   "rmcu": "<RM id> / <CU id>", "steps": ["1. <the behaviour once fixed>"],
   "level": "UT", "skill": "tests-unit-tests",
   "testClass": "<Handler>Tests", "fixture": "<Handler>Fixture",
   "methods": ["<Handler>Tests.Should<Result>_When<Condition>"],
   "full": ["<test class path>", "<fixture path>"],
   "bounded": ["<builder or double path> — <what to add>"],
   "observation": "<what the test observes once fixed: result, SavedEvents, exception>",
   "outOfScope": "",
   "toCreate": [],
   "production": ["<file at the cause's path:line>"],
   "ripple": [], "boundedGreen": []
  }
 ]
}
```
````

- Several cycles: one per behaviour the fix changes, at most three, `wave` 1 when their files are disjoint.
- `full` / `production` paths must exist, or end in ` (to create)` and appear in `toCreate`.
