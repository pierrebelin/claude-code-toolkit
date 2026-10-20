# Closing a batch — sheet, handler documentation, gate, audit fixes

§2 is read by `tdd-implementer` at GREEN, in the cycle that adds or changes a rule; §3 by the `run-lot` pre-audit gate and by the audit fix.

## 1. Sheet and plan

The batch sheet is never updated at closing: the cycle states (`cycle` lines of `run/.work.jsonl`, kept once the batch is done) are the TDD evidence, the run's decisions go to `## To validate` of the reports, and the report marks the sheet title and the plan heading `✅ DONE`. A correction changing an RM/CU → update the source spec too: the spec is the business source of truth.

## 2. Handler documentation

Handler modified or created → **update the `CLAUDE.md` of the handler folder** (under `Application/`): three-column business-rules table, flow, emitted events. No test column — the rule ↔ test link lives on the test, as `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]`, posed by `tdd-test-author` in RED. New handler → create the `CLAUDE.md`. Format and example → `claude-md-handler.md` (read before writing).

**Rule added or changed → sweep its contradictions.** Grep its key term (exception, member, concept) in that `CLAUDE.md` and sibling handler `CLAUDE.md`s; rewrite every line it contradicts in the same message.

**`kit:flow` section: record the cost when there is one.** At least one Infrastructure call on the `Cost` line → one line after the flow, copied from it — "1 read + 1 write, whatever the number of candidates". Only durable trace of a decision no test locks down. Unbounded read loaded deliberately (`Include` of a collection growing without limit) → say so and why. `0 reads + 0 writes` → no line.

## 3. Gate and audit fixes

`cctoolkit pre-audit FX <sheet>` fails on: unclassified DDD/APP/PERF ids, modified file outside batch the sheet doesn't name, trait or unbound test the batch adds in a touched test class, cycle without final state, test named by the sheet absent, whitespace error, interaction assertion in a handler test, French literal added under the source roots (only when `layout.sources.languageGuard` is set in `kit.config.json`). Comments added under `src/` listed, not failed: check each says what code cannot. **RED** → fix what it lists (handler `CLAUDE.md` row, trait, sheet line naming a file), rerun. `DEAD REFERENCE` → add the row the pre-audit drafts to the handler table; never retarget, rename nor delete the trait: that turns the gate green and loses the rule. A rule sheet the repo git-ignores is never recreated: the gate lists its findings without failing.

Verdict `GAPS` → fix the Blocking and Major gaps until each `Closure` holds, rerun the affected validations. A gap whose closure would do concrete harm is contested, never skipped in silence: `verify-ddd-tdd` § Contested findings. **Minor** deviations carried over as is, neither fixed nor hidden: user decides. An adjacent bug or pre-existing dead code the verdict reports stays untouched. A fix never writes `Hn` into the sheet: the run lists it in `TO-VALIDATE.md`.

Edits touching several files go out together — one `Edit` per file, not per line.
