# Closing a batch — plan, handler documentation, summary

Read **after the global green loop** (`/implement-tdd` §3), never before — nothing here serves the RED → GREEN → REFACTOR → COST loop, and loading it earlier makes every turn carry it. §1 and §2 are done **before** `scripts/pre-audit.sh` and the audit (§3): they are what it checks (trait ↔ table, closed sheet). §4 comes after the verdict.

## 1. Plan update

Implementation references a plan (`PLAN-*.md`, `SPEC-*-PLAN.md` under `todo/` or `docs/`) → **always** update it on completion:
- Batch/step → **✅ DONE** + date
- Short summary of files created/modified
- Deviations (extra files, different decisions) → document them
- Assumptions made mid-batch → the sheet's `## Assumptions` section: `Hn — [what you assume] — to be validated by [who]`. An assumption later confirmed becomes a decision: move it to `## Decisions`.
- **A correction that changes an RM/CU** → update the source spec too. Traceability runs both ways: the spec is the business source of truth.
- A correction coming from manual validation → add `Correction Cn` under the affected behaviour; keep the original TDD history and the correction evidence.
- For each finished behaviour: `TDD: RED ✅ · GREEN ✅ · COST ✅`.

## 2. Handler documentation update

Handler modified or created → **update the `CLAUDE.md` of the handler folder** (under `Application/`): three-column business-rules table, flow, emitted events. No test column — the rule ↔ test link lives on the test, as `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]`, posed by `tdd-test-author` in RED. New handler → create the `CLAUDE.md`. **Format and example → `claude-md-handler.md`** (read before writing).

**"Flux" section: record the cost.** One line after the flow — "1 read + 1 write, whatever the number of candidates". Only durable trace of a decision no test locks down. Copy it from the `Cost` line of the behaviour's `## GREEN`, never re-derived from the code. Unbounded read loaded deliberately (`Include` of a collection growing without limit) → say so and why.

## 3. Gate and audit

**Documentation first, audit second** — audit judges exactly those artefacts. §1-2 done first: tick sheet (`✅ DONE` + date), write `## Assumptions`, update handler `CLAUDE.md` — one `Edit` per file, not per line, lines located with `grep -n`, neither plan nor sheet re-read whole.

**Then gate, chained with capture in one call:**

```bash
bash scripts/pre-audit.sh FX <sheet> && bash scripts/audit-capture.sh FX <sheet> <scratchpad>/audit-FX.txt
```

`pre-audit.sh` fails on: unclassified DDD/APP/PERF ids, comment added under `src/`, modified file outside batch the sheet doesn't name, trait or unbound test in touched test class, unclosed sheet, whitespace error. **RED = no fork.** Fix what it lists, re-run; capture runs only once GREEN. Then `/verify-ddd-tdd batch FX`, argument = capture path + FX section of sheet you hold. Its `context: fork` runs isolated, fast mode, writes no file. Wait for verdict before concluding.

Capture carries status, diff, RM/CU + DDD/APP/PERF coverage, `build` / `ArchitectureTests` exit codes; omits targeted filters — scope stays audit decision.

- Verdict `VALID`: keep its evidence table + commands with exit codes in final summary. Lists **Minor** deviations → carry over as is, no fixing or hiding: user decides.
- Verdict `GAPS`: fix in main agent, re-run affected validations, re-delegate `/verify-ddd-tdd batch FX resume`, quoting previous verdict's deviation table. Audit then re-examines those deviations + diff since, not whole batch.
- Two correction/audit rounds still in deviation → stop, return blocking deviations; work around neither plan nor audit.

## 4. Closing

Sheet + handler docs already done (§1-2). Remaining after verdict: summary + test recap table, assembled from `## RED` rows relayed during batch. No diff re-read; fix what verdict names, nothing else.

No diff re-read here: the auditor has just walked the batch's diff hunk by hunk (`/verify-ddd-tdd` §1.4) with the same rules, from an isolated context. Fix what the verdict names. An adjacent bug or pre-existing dead code it reports goes into the summary, untouched.

Summary: files created/modified, layers touched, **access cost per delivered behaviour**, **`Hn` assumptions made mid-batch**, **dead code or adjacent bug reported but deliberately untouched**, DDD/APP/PERF ids and `/verify-ddd-tdd`'s verdict. For validations, give command + exit + **scope** (filter applied, or "whole suite") and the number of tests; name the suites deliberately not run and why. On failure, attach at most six useful RTK lines. **No commit** — the user decides when to commit.

**Test recap table** — always end with a Markdown table listing every implemented test, assembled from the `## RED` tables relayed during the batch:

| Test | RM/CU | Use case verified |
|------|-------|-----------|
| `[Class]Tests.[Method]` | RM-XX | Short description of the use case / business rule verified |

One test per row, exact method name, the rule id it is tied to, concise description of the verified behaviour. Every row of every relayed `## RED` table appears here; a test deleted mid-batch does not. Assemble from those rows — don't rebuild from the diff.

**The handler half was cross-checked by `scripts/pre-audit.sh`** before the audit, through `python3 scripts/rules-coverage.py --untested` — do not run it again here. It reads the `## Règles métier` tables, confronts them with the `[Trait("RM", …)]` posed across **all** of `tests/`, and reports two things the recap cannot: a trait citing a rule absent from the tables (`DEAD REFERENCE` — a renamed or deleted rule), and a test with no trait in a class that carries some (`UNBOUND TEST`). That second signal is raised on `UnitTests` and `ContractTests` only: the other suites bind the tests that cover a documented rule, not all of theirs.

## 5. Batching

Steps 1 and 2 touch several files each. Group independent operations into a single message: the `grep -n` locating lines to tick in plan and sheet, and the bounded reads of the handler `CLAUDE.md` files to update, go out together, and so do their writes. Neither plan nor sheet re-read whole here. The `rules-coverage.py --untested` cross-check is run by `scripts/pre-audit.sh` right after — don't run it separately.
