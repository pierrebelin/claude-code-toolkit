---
name: implement-tdd
description: "Use to implement a .NET/DDD batch or a whole plan under strict TDD: launches the run-lot workflow (run-plan for a plan) and relays its report; replays a delivered batch or plan read-only (run-replay)."
argument-hint: "[batch FX <global plan path> | <global plan path> | batch FX — correction: manual finding | replay [batch FX] <global plan path> [--red] [--no-audit]]"
---

# Strict TDD — launch the chain

The TDD chain is the `run-lot` workflow (`workflows/run-lot.js`, shipped by the plugin): cycles read from the sheet's `## Cycles` block (design only when absent), one `tdd-cycle` agent per cycle — RED, a checkpoint the TDD scope hook checks on the tree, then GREEN + REFACTOR + COST + handler `CLAUDE.md` —, global green beside the pre-audit gate (a haiku agent runs what `cctoolkit suites-plan` resolves, a repair agent opens only on a red suite), audit (`ddd-tdd-auditor`). A batch whose files touch no authorisation, migration nor public contract closes `light` (`cctoolkit closing-level`): one review of the diff on Correctness and Scope instead of the audit; the next sheet is never reviewed by the run, its own design checks it; the report's `Closing:` line says which and why. The script holds the sequence; agent definitions, `.claude/rules/*.md` and `references/` hold the method. Never run the chain by hand, never commit by hand: the workflow commits each `DONE` batch itself (`cctoolkit batch-baseline commit`).

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

- **`replay batch FX <global plan path>`**, or **`replay <global plan path>`** for every batch ✅ DONE → Skill `cctoolkit:run-replay`, argument = the sheet (or the plan) path, then the options given: `--red` (each cycle's tests rerun in a worktree without the batch's production code: they must fail), `--no-audit`, `--only FX` (plan), `--base <rev>` (a batch committed without its `Kit-Batch` trailer). Read-only: nothing fixed, committed nor ticked; no plan-next-batch check, the batch is delivered.

Before launching run-lot or run-plan: `cctoolkit plan-next-batch <plan> --outside FX` exit 0, `cctoolkit doctor` without FAIL, test containers reachable when the batch touches Infrastructure.

## During the run

The run never asks nor waits: an ambiguity is decided by the agent that meets it and listed under `## To validate`; what no retry settles ends the batch at once, `BLOCKED`. Never resume it (`resumeFromRunId`): launch a new run, the saved cycles are not redone.

## End

Relay the workflow result: status, reason, verdict, report path (`run/batches/FX.md`; for a plan, `run/<stamp>.md`, its `## To validate` first: the decisions taken without the user, to read after the plan). A plan result carrying `merge` → say its `state` and lines, then Skill `cctoolkit:knowledge-merge` with the plan path: it shows the diff and writes the base on the user's confirmation only. `BLOCKED` → fix the cause, record `Hn` marked `user decision` in the sheet, launch a new run.

A replay result: its `status` (`PASSED`, `FAILED`, `SKIPPED` with the reason — no commit carries the batch's trailer), the cycles red, the suites red, the audit gaps and `toCheck`, the report path (`run/batches/FX-replay.md`; for a plan, one row per batch). `FAILED` → the report's `## Next` holds one `batch FX — correction: …` per finding: propose them, apply one only on the user's word (the correction flow above, then `run-lot`).

Batch run `DONE` → end with `→ Batch FX complete — manual validation required. Run /clear before any other batch.`
