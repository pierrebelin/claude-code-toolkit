# Closing a batch — plan, handler documentation, summary

Read **after the global green loop** (`/implement-tdd` §3), never before — nothing here serves the RED → GREEN → REFACTOR → COST loop, and loading it earlier makes every turn carry it. §1 and §2 are done **before** `scripts/pre-audit.sh` and the audit (§3): they are what it checks (trait ↔ table, closed sheet). §4 comes after the verdict.

## 1. Plan update

Implementation references a plan (`todo/<code>/[CODE]-PLAN.md` + its `[CODE]-PLAN-FX.md` sheet) → update it on completion:
- Batch/step → **✅ DONE** + date: sheet title gets ` — ✅ DONE (date)`; every step without a `TDD :` line (documentation, verification) gets a body line starting with `✅ DONE (date)` — the `run-lot-pane` pane closes a step only on that line, its heading or its ticks
- Short summary of files created/modified
- Deviations (extra files, different decisions) → document them
- Mid-batch `Hn` assumptions sit in the sheet's `## Assumptions`; one later confirmed becomes a decision: move it to `## Decisions`.
- A correction that changes an RM/CU → update the source spec too. Traceability runs both ways: the spec is the business source of truth.
- For each finished behaviour: its sheet step's `TDD:` line reads `TDD: RED ✅ · GREEN ✅ · COST ✅` — flipped per behaviour during the loop (`/implement-tdd` §3); no ⬜ left, `pre-audit.sh` fails on one.

## 2. Handler documentation update

Handler modified or created → **update the `CLAUDE.md` of the handler folder** (under `Application/`): three-column business-rules table, flow, emitted events. No test column — the rule ↔ test link lives on the test, as `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]`, posed by `tdd-test-author` in RED. New handler → create the `CLAUDE.md`. Format and example → `claude-md-handler.md` (read before writing).

**Rule added or changed → sweep its contradictions.** Grep its key term (exception, member, concept) in that `CLAUDE.md`, sibling handler `CLAUDE.md`s, `DESIGN.md` and the sheet, plus the lines the agents reported; rewrite every line it contradicts in the same step.

**`kit:flow` section: record the cost.** One line after the flow — "1 read + 1 write, whatever the number of candidates". Only durable trace of a decision no test locks down. Copy it from the `Cost` line of the behaviour's `## GREEN`, never re-derived from the code. Unbounded read loaded deliberately (`Include` of a collection growing without limit) → say so and why.

## 3. Gate and audit

**Documentation first, audit second** — audit judges exactly the §1-2 artefacts.

**Then gate, chained with capture in one call:**

```bash
cctoolkit pre-audit FX <sheet> && cctoolkit audit-capture FX <sheet> <scratchpad>/audit-FX.txt
```

`pre-audit.sh` fails on: unclassified DDD/APP/PERF ids, modified file outside batch the sheet doesn't name, trait or unbound test in touched test class, unclosed sheet, whitespace error. Comments added under `src/` listed, not failed: check each says what code cannot. **RED = no fork.** Fix what it lists, re-run; capture runs only once GREEN. Then `/verify-ddd-tdd batch FX`, argument = capture path + FX section of sheet you hold. Its `context: fork` runs isolated, fast mode, writes no file. Wait for verdict before concluding.

Capture carries status, diff, RM/CU + DDD/APP/PERF coverage, `build` / `ArchitectureTests` exit codes; omits targeted filters — scope stays audit decision.

- Verdict `VALID`: keep its evidence table + commands with exit codes in final summary. Lists **Minor** deviations → carry over as is, no fixing or hiding: user decides.
- Verdict `GAPS`: fix in main agent, re-run affected validations, re-delegate `/verify-ddd-tdd batch FX resume`, quoting previous verdict's deviation table. Audit then re-examines those deviations + diff since, not whole batch.
- Two correction/audit rounds still in deviation → stop, return blocking deviations; work around neither plan nor audit.

**Next-sheet review — after `VALID` only.** Next ⬜ batch FY in global plan → `Agent` with `subagent_type: cctoolkit:adversarial-reviewer`, a `description`, prompt starting `mode: next-batch <sheet FY> <sheet FX>`. Last batch → skip. Launch it before assembling the summary (§4), in the same message as the first independent call.

- `Major` (name, path, signature FX changed) → update FY sheet now, one `Edit`: you just delivered the value.
- `Blocking` (design FX contradicts) → never settle: table under `Next batch:` in summary, user decides before `/implement-tdd batch FY`.

## 4. Closing

Remaining after verdict: summary + test recap table.

No diff re-read here: the auditor has just walked the batch's diff hunk by hunk (`/verify-ddd-tdd` §1.3) with the same rules, from an isolated context. Fix what the verdict names. An adjacent bug or pre-existing dead code it reports goes into the summary, untouched.

Summary: files created/modified, layers touched, access cost per delivered behaviour, `Hn` assumptions made mid-batch, dead code or adjacent bug reported but deliberately untouched, DDD/APP/PERF ids and `/verify-ddd-tdd`'s verdict. For validations, give command + exit + scope (filter applied, or "whole suite") and the number of tests; name the suites deliberately not run and why. On failure, attach at most six useful RTK lines. **No commit** — the user decides when to commit.

**Test recap table** — a Markdown table listing every implemented test, assembled from the `## RED` tables relayed during the batch, never by re-reading the tests:

| Test | RM/CU | Use case verified |
|------|-------|-----------|
| `[Class]Tests.[Method]` | RM-XX | Short description of the use case / business rule verified |

One test per row, exact method name, the rule id it is tied to, concise description of the verified behaviour. Every row of every relayed `## RED` table appears here; a test deleted mid-batch does not. Assemble from those rows — don't rebuild from the diff.

**Width cap — the terminal turns a too-wide table into stacked `Test: / RM/CU: / Use case verified:` cards**. Keep each row under ~140 characters:
- One table per test class, preceded by a line `**[Class]Tests**`; the `Test` cell carries the method name alone, in backticks, never the class prefix, never shortened with `…`.
- `Use case verified` ≤ 50 characters; `RM/CU` ids only.
- Row still over the cap because the method name alone is too long → keep the name whole and cut `Use case verified` to ≤ 25 characters.

Same cap for every other table of the summary (files, cost, assumptions, validations): short cells, path relative to the layer prefix, never a sentence in a cell.

**`/learn` reminder** — after the table, run `cctoolkit learn-candidates --count`. Non-empty output → print it verbatim as the line before the end-of-batch line. Never launch `/learn` yourself: next session, after `/clear`.

**The handler half was cross-checked by `scripts/pre-audit.sh`** before the audit, through `cctoolkit rules-coverage --untested` — do not run it again here. It reads the `kit:rules` tables, confronts them with the `[Trait("RM", …)]` posed across **all** of `tests/`, and reports two things the recap cannot: a trait citing a rule absent from the tables (`DEAD REFERENCE` — a renamed or deleted rule), and a test with no trait in a class that carries some (`UNBOUND TEST`). That second signal is raised on `UnitTests` and `ContractTests` only: the other suites bind the tests that cover a documented rule, not all of theirs.

## 5. Batching

Steps 1 and 2 touch several files each. Group independent operations into a single message: the `grep -n` locating lines to tick in plan and sheet, and the bounded reads of the handler `CLAUDE.md` files to update, go out together, and so do their writes — one `Edit` per file, not per line. Neither plan nor sheet re-read whole here.
