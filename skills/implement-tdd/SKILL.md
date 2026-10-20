---
name: implement-tdd
description: "Use to implement a .NET/DDD batch or a whole plan under strict TDD: launches the run-lot workflow (run-plan for a plan) and answers its questions."
argument-hint: "[batch FX <global plan path> | <global plan path> | batch FX — correction: manual finding]"
---

# Strict TDD — launch the chain

The TDD chain is the `run-lot` workflow (`workflows/run-lot.js`, shipped by the plugin): cycles read from the sheet's `## Cycles` block (design only when absent), RED (`tdd-test-author`), GREEN + REFACTOR + COST + handler `CLAUDE.md` (`tdd-implementer`), global green beside the pre-audit gate (a haiku agent runs what `cctoolkit suites-plan` resolves, a repair agent opens only on a red suite), audit (`ddd-tdd-auditor`), next-sheet review (`adversarial-reviewer`) beside the audit. A batch whose files touch no authorisation, migration nor public contract, with few production files and no ripple, closes `light` (`cctoolkit closing-level`): one `tdd-cycle` agent per cycle for RED then GREEN, one review of the diff on Correctness and Scope, the next sheet reviewed only when it names a type the batch changed; the report's `Closing:` line says which and why. The script holds the sequence; agent definitions, `.claude/rules/*.md` and `references/` hold the method. Never run the chain by hand, never commit by hand: the workflow commits each `DONE` batch itself (`cctoolkit batch-baseline commit`).

$ARGUMENTS

## When

- Validated plan from `/plan-implementation`, batch sheet `todo/<code>/<CODE>-PLAN-FX.md` present → this skill.
- No plan → no code: route to `/plan-implementation`.
- `/effort medium` before launching (`hooks/implement-tdd-guard.sh` refuses `high`).

## Launch

- **`batch FX <global plan path>`** → sheet = `<plan without .md>-FX.md`; Skill `cctoolkit:run-lot`, argument = that sheet path as text (never an `@` mention).
- **`<global plan path>`** alone, or "the whole plan" → Skill `cctoolkit:run-plan`, argument = the plan path, optionally `--until FX` / `--only FX`.
- No path → `ls todo/*/*-PLAN.md`; several → ask.
- **`batch FX — correction: manual finding`** → one `Edit` of the sheet: a new cycle in its `## Cycles` block (`behaviour` = `Correction Cn — [finding]`, wave after the last, contract fields per `references/design.md`), then `cctoolkit sheet-cycles <sheet> --index` exit 0. Sheet without the block → sub-step `Correction Cn — [finding]` under the affected step, the run's design writes the block. Finding changing scope, an RM/CU or a design decision → stop, `/business-spec` or `/plan-implementation`. Then launch `run-lot` on the sheet.

Before launching: `cctoolkit plan-next-batch <plan> --outside FX` exit 0, `cctoolkit doctor` without FAIL, test containers reachable when the batch touches Infrastructure.

## Questions during the run

The run decides by itself and asks only when no decision is defensible; it waits for the answer and is never resumed (`resumeFromRunId`).

1. At launch, arm `cctoolkit run-question watch <plan folder>/run` with Bash `run_in_background`.
2. On `QUESTION <work> <id> since=<epoch> next=<epoch>`: read the question JSON on the next line, ask through AskUserQuestion (empty `options` → propose 2-3 from `context` and `evidence`, plus `STOP`), then `cctoolkit run-question answer <work> <id> '[{"id":"q1","text":"…"}]'`, re-arm with `--since <next>`.
3. Workflow completed → TaskStop the watcher.

## End

Relay the workflow result: status, reason, verdict, report path (`run/batches/FX.md`; for a plan, `run/<stamp>.md`, its `## To validate` first: the decisions taken without the user, to read after the plan). A plan result carrying `merge` → say its `state` and lines, then Skill `cctoolkit:knowledge-merge` with the plan path: it shows the diff and writes the base on the user's confirmation only. `BLOCKED` → fix the cause, record `Hn` marked `user decision` in the sheet, launch a new run.

Batch run `DONE` → end with `→ Batch FX complete — manual validation required. Run /clear before any other batch.`
