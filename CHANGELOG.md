# Changelog

One section per release, newest first, headed `## <version> — <date>`: `cctoolkit` and its mods share one version since 1.6.0, each entry names the plugin it changes. Older sections, headed `## <plugin> <version>`, date from per-plugin versions.

A release that changes a file under `rules/` or `presets/*/rules/` lists it under **Rules changed**, one under `presets/*/skills/` under **Skills changed**: those files are copied into your repo, so you pull them by re-running `/cctoolkit:kit-init`, which shows each difference and asks.

## 1.9.1 — 2026-10-13

- `cctoolkit` `implement-tdd` `references/test-scope.md`: the runner illustration no longer repeats the preset's `rtk dotnet` commands; it shows the filters appended to the resolved `commands.test`.
- `cctoolkit`: the test skills `tests-unit-tests`, `tests-integration-tests`, `tests-contract-tests`, `tests-e2e-tests` leave the plugin for the `clean-architecture` preset (`presets/clean-architecture/skills/`). A repo holding its own copy had two skills of the same name, the plugin's under `cctoolkit:` and its own; there is now one, the repo's. `/cctoolkit:kit-init` copies them into `.claude/skills/` (new step §5b, `{{PRODUCT}}` substituted, a differing local copy shown file by file and kept by default); `detect-stack` reports `skillPack` per preset and no longer takes a `.claude/skills/` folder for a manual copy of the kit unless it holds a skill the plugin ships. `rules/cctoolkit.md`, `tdd-test-author`, `implement-tdd` references and `plan-implementation` name them bare, as the repo's.
- `cctoolkit` `run-lot` / `run-plan`: the temp folders are removed by `cctoolkit run-work rm-tmp <name>…` instead of `rm -rf "$(cctoolkit run-work tmp <name>)"`. Claude Code's guard held that `rm` for confirmation (target unresolvable statically) and denied it after two minutes in an unattended session, taking down the whole call — `run-work drop` included — at the end of every batch. `rm-tmp` refuses an empty name, a `/` or `..`.
- `cctoolkit` `run-lot`: no more pre-design of the next sheet beside the audit. It only saved the Opus design time, and cost a batch held open until it ended (report and commit included), two agents writing the next sheet and a design made on code the audit fixes still changed. The next batch designs its `## Cycles` block at its own start when absent; the next-sheet review still runs beside the audit. `docs/TOOLING.md`, `implement-tdd`, `references/design.md`, `adversarial-reviewer` and `sheet-cycles` follow.
- `run-lot-pane`: pre-design display removed (◐ `pre-design (by FX)` row, `waiting pre-design FY`, `next batch` tag); `pre-design` samples of earlier runs no longer weigh in the estimated end.
- `cctoolkit` `quality-report`: headings lose their `Absolute rule` label (`docs/` is out of scope, No trending in the report, Writing tone); content unchanged.

**Rules changed**

- `rules/cctoolkit.md`: a bare `tests-*` name designates the repo's skill, invoked without prefix; `skills/tests-*` listed among what belongs to the repo.
- `presets/clean-architecture/rules/tests.md`: contract tests, one happy path per route, are named `Should{Action}()`.

**Skills changed**

- `presets/clean-architecture/skills/tests-*`: new location, content realigned on the reference repo's copy — unit tests foldered per handler (`[Handler]Tests`); integration builders under the suite's `Core/DataBuilder/`; contract snapshot through the base class `VerifyResponse(response)` (method, path, request body, `Location`, status, body), its shape in `references/examples.md`; statuses per verb quoted from `webapi-endpoints.md`. Kit paths written `skills/implement-tdd/…`. `## Non-negotiable rules` headings become `## Rules`.

## 1.9.0 — 2026-10-13

- `cctoolkit` `run-lot` / `run-plan`: one work file per plan folder, `run/.work.jsonl`, instead of the `run/.work/` tree (a folder per run, a folder per batch with a copy of every file being modified, one file per cycle, question and log). One JSON line per event — `preexisting`, `cycle`, `question`, `answer`, `journal` — appended under `flock` (`lib/work_file.py`, new `cctoolkit run-work`). No file content is ever stored: build, test and audit outputs go to the folder `cctoolkit run-work tmp <name>` prints in the system temp directory, removed by the step that read them.
- `cctoolkit` `run-lot` / `run-plan`: every `DONE` batch is committed. `cctoolkit batch-baseline commit <work> FX --sheet <sheet>` stages the batch files only and commits them with `git commit --only`, message `<type>(<plan folder>): lot FX — <sheet title>`, never pushes. `run-lot` alone commits at its report; under run-plan the commit follows the gate, so a gate repair lands in it. `lib/guard-git.sh` is unchanged: a Git commit typed in a Bash command is still denied.
- `cctoolkit` `batch-baseline`: the snapshot no longer copies files. It records the files already modified at batch start as path → `git hash-object` hash; `diff`, `base` and `restore` work against `HEAD`, leave those files out, and `restore` leaves a preexisting file the batch also changed as is and lists it. Every command takes `<work> FX` instead of a folder; `audit-capture --base <work>` and `access-cost --base <work> FX` follow.
- `cctoolkit` `run-plan`: the preflight runs `cctoolkit run-work purge <run folder> <stamp>` for every run of the plan. The previous purge kept the scratch folder of every run that had a report (inverted condition) and never touched a batch set aside nor the older `.travail/` and `lots/` folders. It now migrates those layouts once (cycle states and the snapshot of a still-open batch become lines, `lots/FX.md` moves to `batches/FX.md` without overwriting), drops the lines no run needs, keeps the `cycle` lines of a `DONE` batch and every line of a stopped batch, and keeps the 3 most recent runs.
- `cctoolkit` `run-question`: questions and answers are lines of the work file. `ask <work> FX` (workflow side, JSON on stdin), `wait <work> <id>`, `watch <run folder>` prints `QUESTION <work> <id> since= next=` then the question JSON, `answer <work> <id> '<json>'`.
- `cctoolkit` `sheet-cycles`: `--states`, `--done`, `--methods` and `--summary` read the `cycle` lines of the work file (`--batch FX`, else the `FX` of the sheet name); `--pack` is gone. `plan-next-batch --next <work> --run <stamp>` journals there, `--context` reads `batches/FX.md` and the work file only.
- `run-lot-pane`: cycle progress and pending questions read from `run/.work.jsonl`.
- `context-band`: the context meter no longer shows the `(+N this turn)` delta.
- `cctoolkit` `RM` trait policy, one statement everywhere: handler unit tests carry it, integration tests carry it when they prove a documented rule, contract and E2E tests carry none. `tests-contract-tests` template and examples lose the trait they contradicted; `tests-e2e-tests` drops the trait rule and the end-of-journey cleanup step (a journey leaves what it generated; its own `delete` operation stays); `tests-integration-tests`, `tdd-test-author`, `verify-ddd-tdd` (a contract or E2E test carrying a trait is a `Plan` deviation) and `skills/README.md` follow.
- `cctoolkit` `adversarial-reviewer`: the `Bash` allowance lists what the `sheet` mode runs (`cctoolkit sheet-cycles <sheet> --index`, `ls`, `grep`) beside `git diff`, `git status` and `graphify`.
- `cctoolkit` `verify-ddd-tdd`, `tdd-implementer`, `tdd-test-author`: validations run the repo's `commands.build` / `commands.test` instead of a hard-coded `rtk dotnet`; the blocker diagnostics are "useful lines of the command output". `tests-unit-tests` cites `cctoolkit rules-coverage` instead of a script path; `learn`, `verify-ddd-tdd`, `ddd-tdd-auditor`, `tdd-implementer` and `implement-tdd/references/claude-md-handler.md` likewise name `cctoolkit pre-audit`, `audit-capture`, `rules-coverage`, `access-cost` instead of `scripts/*` paths.
- `cctoolkit` `plan-implementation` (context inventory) and `kit-init` (layer convention draft): the `Explore` agents run on `sonnet`, not `haiku`, as `context-discipline.md` asks when the search takes judgment.

**Rules changed**: `rules/markdown-output.md` (run files: `run/.work.jsonl` replaces the `run/.work/` folder); `presets/clean-architecture/rules/application-cqrs.md` (the `Result<T>` ban is a convention on handler payloads, not a claim about the codebase; `RM` trait scope), `tests.md` (`RM` trait: contract and E2E tests carry none), `webapi-endpoints.md` (400 row lists the exceptions the preset defines: no `ArgumentException`, no FluentValidation).

## 1.8.1 — 2026-10-13

- `cctoolkit` `run-lot`: a question left unanswered applies its recommendation after 10 min instead of 30 (`cctoolkit run-question wait --seconds 300`, 2 rounds); the `## To validate` line reads `decided without answer after 10 min`.
- `cctoolkit` `run-plan`: no test suite runs outside a batch. The preflight no longer runs the fast suites on the starting tree (`start-failures.txt` is gone) and the gate checks the report, the plan heading and the solution build only; the tests are those of each batch's global green, scoped to its diff by `test-scope.md`. The gate repair fixes a red build.
- `cctoolkit` `run-plan`: new `Final check` phase after the last batch: every suite runs whole once, `IntegrationTests` included, detached and in parallel (40 min at most). Red suites are listed in `## Final check` of the run file and in the closing notification, never blocking the run nor attributed to a batch; skipped under `--only` or when no batch ended `DONE`. `guard-integration-filter` lets a whole `IntegrationTests` run through only under the `KIT_FINAL_CHECK=1` marker.
- `cctoolkit` `run-plan`: `run-lot` is called by its registered name (`workflow('cctoolkit:run-lot')`) instead of `scriptPath` under `cctoolkit root`. With a `directory` marketplace the kit root is the checkout, outside the folders Workflow may read: every batch blocked before any code with an empty patch.
- `run-lot-pane`: a blocked reason written as prose is no longer cut into bullets at each comma. A list is recognised only when its items are short; commas inside parentheses or quotes never split an item; a long item wraps under its bullet instead of being cut; prose wraps sentence by sentence, 8 lines at most.
- `run-lot-pane`: under run-plan, the child `run-lot` script is read from the plugin install folder (`installed_plugins.json`, entry of the repo) before `.claude/workflows/`. Since the kit ships as a plugin the repo copy is gone: the batch view lost its phases (`0/1 phases`, agents grouped under `▸ cctoolkit:run-lot`).
- `run-lot-pane`: a batch row of the plan view wraps instead of overflowing onto the next row.
- `run-lot-pane`: the pane asks for 100 columns when docked beside the fullscreen transcript; a width the person drags still wins.
- `run-lot-pane`: in a batch view under run-plan, the batch bar sits under the status and progress lines, as in the plan view.
- `cctoolkit` `run-plan`: one file per run. `run/<stamp>/REPORT.md` and `TO-VALIDATE.md` become `run/<stamp>.md`, the decisions to validate first under `## To validate` (`### Stop`, `### Batches set aside`, …, `### Assumptions`), then `## Minor`, `## Final check`, `## Journal`; the stop, the batches set aside and the assumptions are no longer written twice. A batch set aside leaves `run/<stamp>-aside-FX.patch`. The preflight keeps the 3 most recent runs, old `<stamp>/` folders included, and removes the `.work/<stamp>/` of a run that never wrote its report (killed run).
- `cctoolkit` `run-lot`: a done batch keeps its cycle states as one `run/.work/FX/cycles.jsonl` instead of one JSON per cycle (`cctoolkit sheet-cycles <sheet> --pack`). The resume reads them through the new `--states`; `--methods`, `--done`, `--summary`, `pre-audit`, `audit-capture`, `plan-next-batch --context` and the pane read the packed lines, a state file of the same behaviour taking over its line.
- `run-lot-pane`: a batch done before this run shows the agents, time and cost of the run that finished it. The figures are saved in the mod's `$.store` when a batch report reads `DONE` (under run-plan or alone), keyed by project and batch sheet.
- `cctoolkit` `pre-audit`: the checks that the methods named by `## Cycles` or the TDD sequence exist run one `grep` restricted to the source extensions instead of one `grep -r` per method over the whole test roots. The old way read the build output (1 GB) and took 16 s per method: 8 min for 31 methods on a real batch, paid again on every re-run.
- `cctoolkit` `pre-audit`: a `DEAD REFERENCE` comes with a draft row for the handler table (id, test name, exception found in the test, `file:line`).
- `cctoolkit` `run-lot`: the pre-audit step fixes a `DEAD REFERENCE` in the handler table only, never by retargeting or deleting an `RM` trait. It runs the script in the foreground. GREEN (`tdd-implementer`, `closing.md` §2-3) adds a table row for every trait id cited by the cycle's tests, so the gap no longer reaches the gate.

**Rules changed**: `rules/markdown-output.md` (run files: one `run/<stamp>.md` per run, `cycles.jsonl`; `REPORT.md` and `TO-VALIDATE.md` kept as names of older runs).

## 1.8.0 — 2026-10-12

- `cctoolkit` `run-lot` / `run-plan`: a plan runs without the user. A stopped step goes to an arbiter agent first (phase `Arbiter`, `decide()`): `allow-test: <path>` when the test itself is wrong, `accept-cost: <why>` for a loop the batch did not write, a favoured option for an ambiguity, `defer` when the stop holds back no later batch (a guard or refactor cycle is left out, a closing or pre-audit failure goes to the audit), `ask` only when no decision is defensible; a question left unanswered for 30 min applies its recommendation. Everything decided without the user is marked `user decision to validate` (`user decision` once the user answers) and listed in `## To validate` of the batch report (renamed from `## To review`), gathered by run-plan into `TO-VALIDATE.md`, to read after the plan. A batch that cannot pass is set aside: its work goes to `aside-FX.patch`, its files return to their state at batch start, the plan goes on without its dependents and the run ends `BLOCKED` with the cause to fix.
- `cctoolkit` `run-lot` / `run-plan`: run files. Under `todo/<code>/run/`, only `<YYYY-MM-DD-HHMM>/REPORT.md` and `TO-VALIDATE.md` (plus `aside-FX.patch`) are meant to be read; batch reports move from `run/FX/FX-report.md` to `run/batches/FX.md`, everything else to `run/.work/`, purged when the batch ends `DONE` or is set aside; the 3 latest runs are kept. `plan-next-batch --context`, the run-plan gate and `cctoolkit run-question watch` follow the new layout and still read `RAPPORT.md`, `A-VALIDER.md`, `.travail/` and `lots/FX.md`. New harness `evals/workflows/run-plan-checks.js`.
- `cctoolkit` scripts: new `batch-baseline` (`snapshot`, `diff`, `base`, `restore`): the files modified under the source and test roots when a batch starts, so the batch diff excludes the earlier uncommitted batches; `audit-capture --base <dir>` diffs the batch alone and never truncates it (past 1200 lines the diff stays in `.work/FX/audit-FX.diff` with a per-file index), `access-cost --base <dir>` flags only the lines added since (the others read `(pre-existing)`; `tdd-implementer` lists them under `Reported without fixing`). `plan-next-batch --skip FX,FY` reads the batches set aside as not done and never launches them nor their dependents; `--next` returns them as `held`.
- `cctoolkit` `implement-tdd`: launcher only. It starts `run-lot` on a batch sheet (`run-plan` on a plan), answers the run's questions from the session and turns a correction into one new cycle of the sheet's `## Cycles` block; `references/correction-mode.md` and `references/rationale.md` are deleted. The `Workflow` tool is now required (INSTALL.md, `docs/TOOLING.md`): there is no manual implementation path left.
- `cctoolkit` parsers read French beside English, through alias tables, and write the repo's vocabulary: run files and `## STATUT — TERMINÉ|BLOQUÉ|ECARTS`, `Verdict :`, `Raison :`, `## À valider`, the two decision markers; `plan-next-batch` (`### Execution des lots`, `Lot` / `Depend de` / `Dépôt`, `### Lot FX — … — ✅ DONE`); `pre-audit` and `rules-coverage` (`| Règles appliquées |`, `**Regles non applicables**`, `non cités : `, `références inconnues : `, `RÉFÉRENCE MORTE`, `TEST NON RATTACHÉ`, `TDD :`, `Correction Cn`, a `## Cycles` / `## Hypotheses` / `## Decisions` sheet); `learn-candidates` (`## Verdict — VALIDE|ECARTS`, `Bloquant` / `Majeur`, French axes, `Aggravé`, a `learn-state.json` with French keys is loaded and saved back in English); `subagent-report-shape` (`## RED` / `## GREEN` fields, `## BLOQUÉ`); `implement-tdd-guard` (`→ Lot FX terminé — validation manuelle requise`, `lot F2`); the `/plan-implementation` spec gate (`## 12. Questions ouvertes`, `Sévérité`, `Bloquant`). The table: `rules/markdown-output.md` § French aliases.
- `cctoolkit` `handler-claude-md-check.sh`: a rule sheet without anchors is read by its exact title, English or French, accents and case folded (`Business rules` / `Règles métier`, `Flow` / `Flux`, `Emitted events` / `Événements émis`), its table by the header row (`ID`, `Rule` / `Règle`, `Exception / Outcome` | `Result` / `Résultat`) when no `kit:cols` anchor is there, an empty section by `None` / `Aucun`. A sheet with none of these still gets the `migrate-anchors` advice.
- `cctoolkit` `pre-audit`: new opt-in gate 8, no French sentence added to a production literal. `layout.sources.languageGuard` (`{"file": "<architecture test>", "skip": ["<glob>"]}` in `kit.config.json`) names the architecture test that fails an accented literal; the production files it quotes and the `skip` globs are left alone; absent, the gate does not run (`presets/README.md`).
- `cctoolkit` agents and tools: `adversarial-reviewer` marks a Blocking only a human can settle `humanOnly` (an autonomous caller applies the recommendation and lists it for validation); `ddd-tdd-auditor` goes from 30 to 45 turns; `tools/doctor` reads `CLAUDE_DOCTOR_BUDGET_LINES`, an opt-in NOTE when the repo's `.claude/` tooling folders exceed that many lines. `examples/`: the batch report moves to `run/batches/F1.md` in the report's current shape.
- `cctoolkit` `plan-implementation`: the plan is written for the `run-plan` / `run-lot` workflows and ends on `/cctoolkit:run-plan <plan>` (whole plan) or `/cctoolkit:run-lot <sheet>` (one batch), no longer `/implement-tdd`.
- `cctoolkit` `run-question`: `wait` and `watch` ignore an answer file older than its question (a leftover of an earlier run); `watch` prints `next=<epoch>`, re-armed with `--since <next>` so the question being answered never fires twice; `answer` also takes `{"answers": [...]}`, the shape `wait` prints. `evals/run.sh` unsets `CLAUDE_EFFORT`, which a session exports to Bash and which decided the effort cases of `implement-tdd-guard`.
- `cctoolkit` agents and test skills: no stack command written in the kit's instructions. `tdd-test-author`, `tdd-implementer`, `ddd-tdd-auditor`, `/tests-unit-tests`, `/tests-contract-tests`, `/tests-e2e-tests`, `/tests-integration-tests` and `implement-tdd/references/test-scope.md` run the repo's `commands.build` / `commands.test`, resolved by the new `kit_config.py command <name> [<suite>]` (`{product}` and `{suite}` expanded, nothing printed when unset) and run literally; the `dotnet` lines stay in `test-scope.md` as the `clean-architecture` preset's illustration. The `Command` line of the RED / GREEN reports quotes the command run.
- `run-lot-pane`: RED agents are labelled `RED <id> w<wave> …` and GREEN agents `GREEN <id> …` (the cycle id of the sheet, not the position in the wave), the RED phase header shows `wave n/N` and its detail reads `waves in sequence, cycles of a wave in parallel`. A `pre-design FY` that the batch FX awaits shows under `Review` in FX's view, FX reads `waiting pre-design FY` instead of its last finished agent, and FY's row in the plan view reads ◐ `pre-design (by FX)` while it runs, `pre-designed (by FX)` after. Reads `run/batches/FX.md` and `run/.work/` beside `run/lots/FX.md` and `run/.travail/`, `## STATUS` beside `## STATUT`. An agent whose phase is not resolved sits in the phase of the previous agent; RED and GREEN alternating no longer count as a new pass. The demo follows.

**Rules changed**: `rules/markdown-output.md` (French aliases table, run files, `## To validate`, decision markers, handler-sheet titles read without anchors), `presets/clean-architecture/rules/tests.md` (assertions on shared conventions: the normalised value, derived registry counts, fixture ids fixed once).

## 1.7.4 — 2026-10-11

- `run-lot-pane`: a sheet with a `## Cycles` json block shows one row per cycle (`x/y cycles`), its RED/GREEN state read from `run/.travail/FX/cycles/<slug>.json` (done on GREEN exit 0, or when no GREEN is due: `ALREADY_GREEN`, guard cycle, empty RED table), each `red.unreachable` method flagged under its cycle; a sheet without the block keeps its steps. `pre-design FY` is tagged `next batch` and counted under FY in a plan, never in the current batch state. The estimated end drops the samples of earlier runs for the phases the current labels reshaped (`tick …` and `closing + pre-audit` retired; `index …`, `declaratives`, `pre-audit`, `pre-design …` new) once a run with the new labels exists. A label whose phase is a ternary or a helper parameter (`phase: ahead ? 'Review' : 'Design'`, `phase: phaseName`) is placed in its phase instead of the nested `▸ run-lot` row. Arbiter and Question rows sit right after the phase they interrupted. The batch report is also read from `run/lots/FX.md` and questions from `run/.travail/FX/questions`; the earlier layout is still read. The demo follows the new run-lot.
- `cctoolkit` `run-lot` / `run-plan`: sheet-driven cycles. A batch sheet carries its TDD cycles as one ```json block under `## Cycles` (`cycles[]`: id, wave, behaviour, rmcu, steps, methods, RED and GREEN contract fields; `skills/implement-tdd/references/design.md`), validated by the new `cctoolkit sheet-cycles` (`--index`, `--cycle ID --red|--green`, `--methods`, `--done`, `--summary`; exit 2 = no block, every caller falls back to the old sheet). The design agent runs only when the block is missing or invalid; `pre-design FY` writes the next sheet's block during FX's audit; new `index <sheet>` (haiku) and `declaratives` (sonnet) agents. The haiku `tick …` agents and the `closing + pre-audit` agent are gone: the GREEN writes the cycle state (`run/FX/cycles/<slug>.json`, kept after a finished batch) and the handler `CLAUDE.md`, closing is the `pre-audit` agent alone, the report marks the plan heading and the sheet's `# ` line `✅ DONE (date)`. No `Hn` written by the run: its decisions (user answers, design and pre-design choices, unreachable guards, settled review Blockings) go to a new `## To review` section of the batch report, which run-plan gathers into `REPORT.md`; the audit is handed them. RED gains an `unreachable` field (methods whose throw site no caller reaches: listed for review, never written, never retried). The next sheet also receives FX's audit gaps.
- `cctoolkit` `pre-audit`: on a `## Cycles` sheet, fails on a cycle without its final state and on a method of the block absent from the test roots; `audit-capture` adds a `TDD cycles` section. `verify-ddd-tdd`: TDD evidence read from that section, a stale plan is Minor unless an RM/CU moves. Agents: `tdd-test-author` reads its contract through `sheet-cycles --cycle` and reports `Unreachable`; `tdd-implementer` may write the handler `CLAUDE.md`; `adversarial-reviewer` checks `## Cycles` through `sheet-cycles --index` and flags guards only the aggregate reaches. `plan-implementation`: the sheet template replaces `## TDD sequence` and `## Ancrages` with `## Cycles`, no documentation nor verification step. `parallelism.md`: one cycle = one homogeneous pattern, one test project, 4 test files and 8 production files at most. Preset `clean-architecture`: new optional `layout.tests.shared` (`tests/*.CoreTests`), test infrastructure the per-cycle caps never count.

**Rules changed**: `rules/markdown-output.md` (`## Cycles` block, `TDD:` ticks limited to older sheets, `## To review` of the batch report).

## 1.7.3 — 2026-10-11

- `cctoolkit` `run-lot` / `run-plan`: questions are asked inside the run, which waits for the answer. A stopped step (design, RED, GREEN, global green, closing) or a next-batch Blocking without source writes `run/FX/questions/FX-<n>.json`; haiku agents poll `cctoolkit run-question wait` until the session writes the answer (`cctoolkit run-question watch <plan folder>/run` in the background, AskUserQuestion, `cctoolkit run-question answer`). The answer reruns the step (three decisions per step at most) or is applied to the next sheet as a `user decision`; `STOP` or no answer stops as before. `args.decision` / `args.decisions`, `resumeFromRunId` resume, the `AWAITING-ANSWER` status and the suspension of the next batch with `--exclude` are gone; a run-lot whose next-batch questions got no answer returns `unanswered` and run-plan stops after its gate. The second next-sheet review now applies its sourced Blockings too.
- `cctoolkit` `run-lot`: test method names are checked after the design (`…`, `...`, a placeholder or an open `When` reruns the design once, then asks, then `BLOCKED` before any RED). A GREEN stopped on a test file asks with the option `allow-test: <path>`, which puts the file on `checkGreen`'s allowlist. `tdd-test-author` goes from 20 to 32 turns and returns a partial report past about 26. `plan-implementation`: one row of a step table = one test method with its full final name.
- `run-lot-pane`: `?` / `waiting for user` now shows a batch with a pending question file (`run/FX/questions/*.json` without its `.answer.json`); the `AWAITING-ANSWER` / `ATTENTE-RÉPONSE` labels are no longer read.

**Rules changed**: `rules/markdown-output.md` (`AWAITING-ANSWER` removed from the batch report statuses).

## 1.7.2 — 2026-10-11

- `cctoolkit` `run-lot`: a cycle holds one test project and six test methods at most (`skills/implement-tdd/references/parallelism.md`); the Design splits a larger step into cycles sharing its title, ticked once all are done. A retry after an agent ended without structured output resumes from the files already on disk instead of rewriting them. `tdd-test-author` goes from 12 to 20 turns.

## 1.7.1 — 2026-10-11

- `run-lot-pane`: the agent card shows the outcome read from the agent's structured answer (verdict and every gap), every tool call in order with its short argument (up to 300), and errors with exit code and last output line, greyed once the agent recovered; the prompt is shown without the shared workflow frame.

## 1.7.0 — 2026-10-11

- `cctoolkit`: `scripts/migrate-rm-traits.py` removed (the four-column rule sheet it migrated is no longer produced); the test-tag adapters lose their `apply()` writers.
- `cctoolkit`: `session-cleanup.sh` no longer restores the caveman flag of the hook removed in 1.0.0, nor sweeps the `graphify-seen` / `delegation` state nothing writes any more.
- `cctoolkit`: `tools/doctor` no longer aborts in a linked worktree (undefined `$SETTINGS`); `batch-wallclock` and `learn-candidates` recognise `cctoolkit:`-namespaced skills and agents.
- `cctoolkit`: `explore-guard` no longer appends "CLAUDE.md: English everywhere" to subagent prompts; `turn-batching-check` prints English labels.
- `cctoolkit`: `templates/settings.local.json` (startup trim, opt-in) now ships — it was documented but ignored by git.
- `run-lot-pane`: English display (`thinking`, `output`, `tool`, `waiting model`, decimal point); the pre-split `PLAN.md` / `## Lot FX` layout is no longer read.
- Stale comments, dead references and duplicated docs cleaned across the kit.

**Rules changed**: `rules/markdown-output.md` (frozen-literal rows no longer cite `scripts/migrate-rm-traits.py`).

## 1.6.0 — 2026-10-11

- One version for the whole marketplace: `cctoolkit`, `context-band`, `run-lot-pane` and `spec-pane` all move to 1.6.0 and are released together from now on. No behaviour change: updating any of them pulls the same release.

## cctoolkit 1.3.1 — 2026-10-11

- `cctoolkit plan-next-batch --outside` and `cctoolkit pre-audit` no longer count `.claude/` and `todo/` as outside the batch: every run-plan stop this check caused on a real plan was the user's own harness edits. Trade-off: a batch agent editing `.claude/` is no longer flagged by this check.
- `/cctoolkit:run-lot`: the batch report is composed by the script from the run history (fixed English headings, a `Verdict:` line, files grouped by project, cost, assumptions, audit rounds, validations, test recap per class); the haiku agent only writes it verbatim. `## Resume` names both ways: same run resumed with `resumeFromRunId` and `args.decisions` in the session, relaunch out of it. Closing agent on sonnet.
- `/cctoolkit:run-plan`: preflight starts Docker Desktop on macOS when it is down and checks it again after the build; a run where no batch was launched deletes its run folder; the gate reads `grep -m1 '^Verdict:'` of the batch report.

## spec-pane 1.0.1 — 2026-10-11

- Tests named in English. No behaviour change.

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
