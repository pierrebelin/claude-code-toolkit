# Changelog

One section per release, newest first, headed `## <plugin> <version> — <date>`: `cctoolkit` and each mod are versioned on their own.

A release that changes a file under `rules/` or `presets/*/rules/` lists it under **Rules changed**: those files are copied into your repo, so you pull them by re-running `/cctoolkit:kit-init`, which shows each difference and asks.

## cctoolkit 1.3.1 — 2026-10-11

- `cctoolkit plan-next-batch --outside` and `cctoolkit pre-audit` no longer count `.claude/` and `todo/` as outside the batch: every run-plan stop this check caused on a real plan was the user's own harness edits. Trade-off: a batch agent editing `.claude/` is no longer flagged by this check.
- `/cctoolkit:run-lot`: the batch report is composed by the script from the run history (fixed English headings, a `Verdict:` line, files grouped by project, cost, assumptions, audit rounds, validations, test recap per class); the haiku agent only writes it verbatim. `## Resume` names both ways: same run resumed with `resumeFromRunId` and `args.decisions` in the session, relaunch out of it. Closing agent on sonnet.
- `/cctoolkit:run-plan`: preflight starts Docker Desktop on macOS when it is down and checks it again after the build; a run where no batch was launched deletes its run folder; the gate reads `grep -m1 '^Verdict:'` of the batch report.

## cctoolkit 1.3.0 — 2026-10-10

- `adversarial-reviewer` adds `Settled by` and `Answer` columns: a Blocking already answered by a rule, a `CLAUDE.md`, the spec or an earlier `user decision` cites it and dictates the answer; without source it gives options and a recommendation. Output cap 2 kB.
- `/cctoolkit:run-lot`: a next-batch Blocking settled by a source is applied to the next sheet (`Hn` to be validated by the user), then one re-review. A Blocking without source no longer stops the batch: FX ends `DONE`, `run/FY/FY-report.md` gets `## STATUS — AWAITING-ANSWER` (questions, options, recommendation), the result carries `nextBatch`, `openQuestions`, `waiting`. Status `REVIEW-BLOCKING` removed.
- `/cctoolkit:run-plan`: such a FY is suspended with its transitive dependents, a notification is sent at once, independent batches go on; the run then ends `AWAITING-ANSWER` with `suspended` and `next` (ask through AskUserQuestion, fix the sheet, relaunch). `REPORT.md` gains `## Open questions`.
- `cctoolkit plan-next-batch --exclude FX,FY`: never launches those batches nor their dependents; `WAITING` shows them as `FX:excluded`.
- `/cctoolkit:implement-tdd` closing and `/cctoolkit:plan-implementation` review apply the same split: Blocking with source settled, without source asked, a plan never closes on an unanswered Blocking.
- `/cctoolkit:run-lot` resumes a stopped batch: every accepted RED, then every GREEN, is saved to `run/FX/cycles/<behaviour>.json` (the sheet step goes `RED ✅ · GREEN ⬜` then all ✅). On relaunch the design skips cycles carrying `green`, returns RED-only ones with `resume: true` (RED reused, only GREEN runs) and copies an `Hn` marked `user decision` into the contracts; nothing left → straight to global green. A stopped report ends with `## Resume`.
- `/cctoolkit:run-plan` answers a stop inside the same run: resume it with `resumeFromRunId` and `args: { plan, decisions: [{ batch, text }] }`; the batch's `run-lot` relaunches the stopped step once with the decision (recorded as `Hn` `user decision`), every earlier agent comes back from the cache. The result carries `blockedBatch` and a `next` that forbids a fresh relaunch unless the user cuts the run.
- Mod tests (`run-lot-pane`, `spec-pane`) named in English.

**Rules changed**: `rules/markdown-output.md` (`AWAITING-ANSWER` status), `presets/clean-architecture/rules/domain.md` (DDD-09: no invariant, check or throw in a `static class`).

## run-lot-pane 1.5.0 — 2026-10-10

- A batch whose `run/FX/FX-report.md` starts with `## STATUS — ATTENTE-RÉPONSE` or `AWAITING-ANSWER` shows cyan `?` in the plan view.
- A stopped batch waiting on the user (`BLOCKED`, `AWAITING-ANSWER`, `REVIEW-BLOCKING`, French labels too) reads `? waiting for user` in the header and `?` in the batch bar, no longer `✗ failed`.
- After a resume, a Report phase written before it turns pending again (grey, 0) until the new report.
- A nested agent whose label is a function parameter (`reviewNext('next batch review')`) is placed in its child phase, no longer in `▸ run-lot #2`.

## cctoolkit 1.2.1 — 2026-10-10

- `/cctoolkit:run-plan` preflight runs the build set by kit-init (`commands.build`) before the first batch: a working tree that does not compile stops the run in seconds, with the first error line, instead of blocking the first batch. Empty `commands.build` (stack without a build) skips the check.
- `/cctoolkit:run-lot` GREEN accepts several `.verified.txt` snapshots: a change shared by many routes (an error handler) no longer blocks the batch after one.

**Rules changed** since 1.1.0: `rules/markdown-output.md` (see 1.2.0).

## run-lot-pane 1.4.0 — 2026-10-10

- Follows a `run-plan` run: plan view (batches, state from `run/FX/FX-report.md`, supervisor agents), `p` back to the plan, `1`-`9` open a batch in the run-lot view. French and English plan vocabularies both read.
- `/run-lot-pane demo plan` and `demo plan end`: a sample `run-plan` run.

## cctoolkit 1.2.0 — 2026-10-10

- `/cctoolkit:run-plan <plan>`: every runnable batch of a plan through `run-lot`, gate read from disk after each, run report.
- `cctoolkit plan-next-batch`: next runnable batches of a plan, plan check, outside-batch check.

**Rules changed**: `rules/markdown-output.md` (rows for the plan table and the run-lot report read by `run-plan`).

## cctoolkit 1.1.0 — 2026-10-10

- `examples/`: one fictional feature from spec to batch report, with a glossary.
- `INSTALL.md` holds the installation; the README is a short introduction.
- `/cctoolkit:run-lot` is the default path for a batch; `cctoolkit audit-capture` trims its capture.
- Releases are versioned and listed here; `INSTALL.md` explains how to turn on auto-update for this marketplace.

## cctoolkit 1.0.0 — 2026-10-10

- `/cctoolkit:run-lot`: a batch runs end to end as a Workflow script — design, RED/GREEN, audit, report.
- The `tdd-batch` mod is replaced by two mods: `run-lot-pane` and `spec-pane`.
- `/cctoolkit:quality-report` adds a code size snapshot.
- `/cctoolkit:kit-init` removes a manual copy of the kit (`cctoolkit remove-copy`); new `doctor` checks.
- The `bulk-read` skill and the `delegation-nudge` / `caveman-skill-ultra` hooks are removed.

**Rules changed** — re-run `/cctoolkit:kit-init`:
`rules/context-discipline.md`, `rules/markdown-output.md`, `presets/clean-architecture/rules/` — `application-cqrs.md`, `domain.md`, `infrastructure-ef.md`, `tests.md`, `webapi-endpoints.md`.

## context-band 1.0.0, run-lot-pane 1.0.0, spec-pane 1.0.0 — 2026-10-10

First releases from the `cctoolkit` marketplace.
