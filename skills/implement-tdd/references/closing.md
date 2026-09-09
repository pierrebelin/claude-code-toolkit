# Closing a batch — plan, handler documentation, summary

Read this **after the `/verify-ddd-tdd` verdict**, not before. Nothing here is needed while the
RED → GREEN → REFACTOR → COST loop runs; loading it earlier makes every turn of the batch carry it.

## 1. Plan update

Whenever the implementation references a plan (`PLAN-*.md`, `SPEC-*-PLAN.md` under `todo/` or `docs/`) → **always** update it on completion:
- Batch/step → **✅ DONE** + date
- Short summary of files created/modified
- Deviations (extra files, different decisions) → document them
- Assumptions made mid-batch → the sheet's `## Assumptions` section: `Hn — [what you assume] — to be validated by [who]`. An assumption later confirmed becomes a decision: move it to `## Decisions`.
- **A correction that changes an RM/CU** → update the source spec too. Traceability runs both ways: the spec is the business source of truth.
- A correction coming from manual validation → add `Correction Cn` under the affected behaviour; keep the original TDD history and the correction evidence.
- For each finished behaviour: `TDD: RED ✅ · GREEN ✅ · COST ✅`.

## 2. Handler documentation update

Handler modified or created → **update the `CLAUDE.md` of the handler folder** (under `Application/`): three-column business-rules table, flow, emitted events. No test column to fill — the rule ↔ test link lives on the test, as `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]`, posed by `tdd-test-author` in the RED phase. If the handler is new: create the `CLAUDE.md`. **Format and example → `claude-md-handler.md`** (read it before writing).

**New handler or changed intent → also update the parent feature folder's index `CLAUDE.md`**: the use-case line in the Commands/Queries table (relative link `[Nom](Nom/CLAUDE.md)`, one-line intent, `N rules, M tested` — `python3 scripts/rules-coverage.py --fix-index` recomputes that column). A handler missing from the index is a handler nobody can find.

**"Flux" section: record the cost.** One line after the flow — "1 read + 1 write, whatever the number of candidates". It is the only durable trace of a decision no test locks down. If an unbounded read is loaded deliberately (`Include` of a collection that grows without limit), say so and say why.

## 3. Closing

Before summarising: re-read your own diff (`git diff`), **hunk by hunk**.

Local style, absence of comments, orphans and surgical change: rules in `common-rules.md` §1, applied by `tdd-implementer` on every behaviour. Here you check them **once, on the batch's complete diff** — the only vantage point that sees the whole batch:

- **Every hunk ties back to an RM/CU or to a step of the sheet.** Whatever ties to nothing gets reverted: refactor of code that already worked, renaming outside the batch, reformatting, import reorganisation, fixing an adjacent bug. A real adjacent bug is **reported in the summary**, not fixed in this batch.
- **Cross-behaviour orphans**: a `using`, an intermediate type or an overload one behaviour left behind and another made useless only shows up at this level. Delete them. Pre-existing dead code is reported in the summary, not deleted.

Summary: files created/modified, layers touched, **access cost per delivered behaviour**, **`Hn` assumptions made mid-batch**, **dead code or adjacent bug reported but deliberately untouched**, DDD/APP/PERF ids and `/verify-ddd-tdd`'s verdict. For validations, give command + exit + **scope** (filter applied, or "whole suite") and the number of tests; name the suites deliberately not run and why. On failure, attach at most six useful RTK lines. **No commit** — the user decides when to commit.

**Test recap table** — always end with a Markdown table listing every implemented test, assembled from the `## RED` tables relayed during the batch:

| Test | RM/CU | Use case verified |
|------|-------|-----------|
| `[Class]Tests.[Method]` | RM-XX | Short description of the use case / business rule verified |

One test per row, exact method name, the rule id it is tied to, concise description of the verified behaviour. Every row of every relayed `## RED` table appears here; a test deleted mid-batch does not. Assemble it from those rows — do not rebuild it from the diff.

**Cross-check the handler half** with `python3 scripts/rules-coverage.py --untested`. It reads the `## Règles métier` tables, confronts them with the `[Trait("RM", …)]` posed across **all** of `tests/`, and reports two things the recap cannot: a trait citing a rule absent from the tables (`DEAD REFERENCE` — a renamed or deleted rule), and a test with no trait in a class that carries some (`UNBOUND TEST`). That second signal is raised on `UnitTests` and `ContractTests` only: the other suites bind the tests that cover a documented rule, not all of theirs.

## 4. Batching

Steps 1 to 3 touch several files each. Group the independent operations into a single message:
the `git diff` and the `python3 scripts/rules-coverage.py --untested` go out together, and so do
the reads of the plan, the batch sheet and the handler `CLAUDE.md` files to update.
