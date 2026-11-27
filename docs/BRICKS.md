# Bricks — the failure each one prevents, and what was removed

Every brick of the kit costs something: a hook fires on every matching call, a skill sits in
every session's listing, an agent adds a spawn. A brick earns its place by preventing a failure
that was seen; a brick with no failure in front of it is a candidate for removal. The models get
better, so a brick needed yesterday may not be needed tomorrow.

This file answers two questions: which failure a brick prevents (§ Failure map), and what was
removed or relaxed and what came of it (§ Simplification log). It explains no brick: what each
does lives in its folder's README, the figures in the file the Evidence column points to.

**When to read it.**

- Before adding a brick, or retiring one: a removal already tried, or a failure already covered,
  is here.
- At a new model generation: every row whose Evidence predates it is a guess about the old
  model. Set its Re-test to the day the new model ships.
- When `dev/release-check.sh` prints `TODO  docs/BRICKS.md: re-test …`: a Re-test date is past.

**Re-test** — an ISO date (`YYYY-MM-DD`) when the row must be measured again, `—` when nothing is
due. A row gets a date when its Evidence reads `not measured` and the brick costs on a hot event
(every edit, every Bash call), or when a change set its own check-back.

**How to measure.** The protocol of the removals in 2.17.0: 60 days of transcripts on two
installed repos, counting what the brick did (denials, injections, invocations) and what followed
it. `dev/turn-batching-check.py` for calls, turns and denials, `dev/workflow-timing.py` for the
time of a workflow's phases and agents. An outcome is `unchanged` (keep removed), `degraded`
(restore) or `not measured`.

## Failure map

| Failure | What it looks like | Bricks | Evidence | Re-test |
|---------|--------------------|--------|----------|---------|
| Vague requirement coded as is | the agent invents a rule the business never set | `business-spec`, `adversarial-reviewer` (spec) | not measured | — |
| Scope sprawl | a change too big to review, several features half done | `plan-implementation` (batches, sheets), `adversarial-reviewer` (plan, sheet) | not measured | — |
| Small change dragged through the whole flow | a one-rule change paying a spec, a plan and their reviews | `run-change` (sized to one batch, `TOO_BIG` otherwise) | not measured | — |
| Multi-repo plan stopping halfway | a batch of another repository refused, or run in a repository not ready for it | `run-plan` preflight, `cctoolkit batch-repo` | not measured | — |
| Plan validated without being understood | the run takes choices the user cannot name | `quiz` | not measured (2.20.0) | — |
| Code before a failing test | a test written after the code, green at its first run, proving nothing | `tdd-scope-guard.sh` (RED checkpoint on the tree), `tdd-cycle` | not measured | — |
| Assertion weakened to get green | a test edited at GREEN until it passes | `tdd-scope-guard.sh` (`test-edit` lines), audit row `Tests changed after the RED checkpoint` | `CHANGELOG.md` 2.6.0 | — |
| Incomplete agent report | the orchestrator spends a turn and a `SendMessage` to get the missing lines | `subagent-report-shape.sh` | `hooks/README.md` | — |
| Done without proof | a batch called done with red suites or rules untouched | `run-lot` global green, `verify-ddd-tdd`, `cctoolkit closing-level` | not measured | — |
| Hung suite | the final check waits an hour on a test that never ends | `run-plan` final check through `cctoolkit bg`, 25-min ceiling | `CHANGELOG.md` 2.9.0 | — |
| Interrupted run loses its work | a relaunch starts every cycle over | cycle states of the run work file, `refs/cctoolkit/aside/…` | `CHANGELOG.md` 2.7.0 | — |
| Git mutated unattended | a commit or a push no one asked for | `lib/guard-git.sh` | by design, not measured | — |
| Whole files read into the context | a `Read` or a `cat` of 2 000 lines carried to the end of the session | `read-bounds.sh`, `lib/guard-cat-bounds.sh` | `docs/CONTEXT-COST.md` § Subagent bar | — |
| Whole patch read into the context | a bare `git diff` of the day | `lib/guard-diff-bounds.sh` | 0 denials, kept for its nil cost: `docs/CONTEXT-COST.md` § Subagent bar | — |
| Verbose tool output | build and test logs read raw | `lib/rewrite-rtk.sh` | `lib/README.md` § `guard-diff-bounds.sh` | — |
| One call per turn | independent reads in separate turns, each replaying the context | `lib/batching-nudge.sh` | `docs/CONTEXT-COST.md` § Batching | — |
| Costly delegation | a subagent inheriting the caller's model, a report of 200 lines re-injected | `explore-guard.sh` | not measured | — |
| Chained batch pays the previous one | a second batch in the same session | `implement-tdd-guard.sh` | `hooks/README.md` | — |
| Orchestrator at too high an effort | 100 to 180 slow turns | `implement-tdd-guard.sh` | `hooks/README.md` | — |
| `cat` waiting on stdin | a Bash call hanging to its timeout | `lib/guard-cat-stdin.sh` | `lib/README.md` | — |
| Slow suite run unfiltered | the integration suite in every cycle | `lib/guard-integration-filter.sh` | not measured | — |
| Instruction files bloating unseen | rules loaded on every turn, nobody knows their weight | `context-log.sh` | `docs/CONTEXT-COST.md` § Instruction loads | — |
| Behaviour rediscovered each session | the agent reads code to learn a rule the business already stated | knowledge base, `ask`, `knowledge-sync` (`run-sync`), `knowledge-merge` | not measured: `docs/CONTEXT-COST.md` § Knowledge base questions | — |
| Knowledge base drifting after a hotfix | the base says one thing, the code another | `knowledge-reminder.sh` | not measured | 2027-01-31 |
| Use case without its rule sheet | a handler whose rules are written nowhere | `handler-claude-md-check.sh` | not measured | 2027-01-31 |
| Quality drifting unseen | coverage, hotspots, suppressions that move with no one looking | `quality-report` | not measured | — |
| A run that cannot be corrected without stopping it | the user sees a wrong turn and can only kill the batch | `run-notes.sh`, `run-lot-pane` mod | not measured | — |
| Broken install disabling the kit silently | a plugin not enabled, a config key wrong, hooks that never fire | `tools/doctor` at `SessionStart` | not measured | — |

Plumbing, no failure of its own: `session-cleanup.sh`, `windows-env.sh`, `lib/platform.sh`,
`lib/project-root.sh`.

## Simplification log

One row per brick removed or relaxed. `Before` is what justified the change, `After` what was
measured once it was made.

| Date | Version | Brick | Change | Before | After | Decision | Re-test |
|------|---------|-------|--------|--------|-------|----------|---------|
| 2026-10-09 | — | `read-bounds.sh`, `lib/guard-cat-bounds.sh` | subagent bar raised from 120 lines / 8 kB to 400 / 24 kB | 90 % of denials in subagents, 60 % of forcings followed by an edit | not measured: subagent denials should fall by about ¾ | keep | 2026-11-09 |
| 2026-10-09 | — | `rules/context-discipline.md`, agents | generic batching line removed, nudge kept | the harness system prompt already asks for it | not measured: back near 1.2 calls per turn means the line returns | keep removed | 2026-11-09 |
| 2026-10-19 | 2.1.0 | `affected-blast-radius` hook | removed | 300 injections in 30 days, no measurable effect | not measured | keep removed | — |
| 2026-10-21 | 2.6.0 | `run-lot` questions, waits and arbiters | removed: the agent decides, its decision goes under `## To validate` | 45 of 68 min of a batch in control layers | not measured | keep removed | — |
| 2026-10-21 | 2.8.0 | next-batch sheet review (`adversarial-reviewer` and a rewriting agent) | removed: the next batch's design checks its sheet | 1 to 5 min and two agents per full batch | not measured | keep removed | — |
| 2026-10-21 | 2.8.0 | full audit at every closing | `light` unless a `closing.full` rule matches, full audit on `sonnet` | audit 30 of 69 min of a batch | not measured | keep | — |
| 2026-11-20 | 2.17.0 | `handler-claude-md-check.sh` rules ↔ tests report | moved from every edit to one `cctoolkit traceability` run in `pre-audit` | 540 injections in 60 days, effect not measured | not measured | keep removed | — |
| 2026-11-20 | 2.17.0 | Graphify | archived (`archives/graphify/`) | about 0.2 % of tool calls, a graph rebuilt on every `Stop` | not measured | keep removed | — |
| 2026-11-20 | 2.17.0 | `/learn` | archived (`archives/learn/`) | 0 invocations in 60 days | not measured | keep removed | — |
| 2026-11-20 | 2.17.0 | `run-replay` workflow | archived (`archives/run-replay/`) | 0 runs in 60 days | not measured | keep removed | — |
| 2026-11-20 | 2.17.0 | `clear-nudge.sh` | removed | 113 reminders in 60 days, no `/clear` in the two actions after | not measured | keep removed | — |
| 2026-11-20 | 2.17.0 | `lib/rewrite-rtk.sh` on `cat`, `head`, `tail` | removed | 0.5 % saved over 4 085 calls | not measured | keep removed | — |
| 2026-11-24 | 2.21.0 | user validation of `/knowledge-sync` | removed: the code is the truth, a conflict with a rule sheet is won by the code and reported | a question per conflict, per level | not measured: rules written from a bug in the code would show as base fixes reverted later | keep removed | 2027-02-28 |
