# Tooling details — RTK, graphify, worktrees, guards, workflows

Opened on demand. `CLAUDE.md` keeps the standing rules and the traps; the measurements and the
procedures live here.

## RTK

Token-optimized CLI proxy (`~/.local/bin/rtk`, see `~/.claude/RTK.md`). **Rewriting is
automatic**: the `PreToolUse:Bash` hook (`bash-dispatch.sh`, module `lib/rewrite-rtk.sh`) routes every Bash command through
`rtk hook claude`, which rewrites `find`, `ls`, `cat`, `grep`, `git diff` and more. Do not prefix
by hand.

Measured savings on a .NET repo of this shape (not the advertised 60-90 %): `find` 98.7 % ·
`ls` 69 % · `git diff` 25 % · `read` 15 % · **`grep` 0 %**. Re-measure per repo before quoting
them — `rtk gain [--history]`.

- The rewrite is skipped when the output is captured or reshaped — `cmd | wc -c`, `$(cmd)` — and
  on `sed -n 'X,Yp'`. Deliberate: rewriting would change what the caller parses.
- **`rtk grep` mangles its output** (`6 matches in 0 files`, no file names). When the actual match
  text is needed, use `rtk proxy grep ...` — `proxy` runs the raw command unfiltered.
- `rtk hook claude` leaves some `dotnet` verbs unrewritten although the `rtk dotnet` filter
  accepts them (current coverage: header of `lib/rewrite-rtk.sh`). `rewrite-rtk.sh` closes that gap itself, in command
  position only (start of line or after `; & | (`, behind any `VAR=value` prefixes), so
  `APP_TEST_MODE=true dotnet test ...` is covered. The expression is skipped entirely on a
  command carrying `<<`: sed matches `^` on every line, so a heredoc body was being rewritten
  until `evals/cases/rewrite-rtk.json` caught it on 2026-09-12. Since the rewrite is ours,
  `rtk hook claude` sees an already-prefixed command and answers nothing — the module emits the
  `updatedInput` decision itself. Do not prefix by hand.
- `rtk hook claude` emits its `updatedInput` **without** a `permissionDecision`; Claude Code
  applies it anyway. An eval on an rtk rewrite therefore checks the command, not the decision.
- **`git grep` output is grouped** by `rewrite-piped-filter.sh git-grep` → `git-grep-filter.sh`: the path becomes
  a per-file header instead of being repeated on every line. `rtk git grep` is a passthrough and
  `rtk grep` would mangle this, hence a local filter. The gain follows path length against content
  length, so it scales with how deep the tree is: measured 2026-09-10, -32 to -48 % on .NET repos
  with ~130-character paths, only -6 % on this one. **Lossless** — rebuilding `path:NN:content` from
  the grouped form diffs byte-identical against the raw output. The header path stays clickable, the
  individual matches do not. Escape hatch: `| cat`.
- `rtk discover` counts commands **as emitted**, before the hook rewrites them. Its "missed
  savings" figures are largely already captured — do not act on them without measuring.

## graphify

AST knowledge graph in `graphify-out/`, binary `~/.local/bin/graphify`.

- Architecture/codebase question → read `graphify-out/GRAPH_REPORT.md` (god nodes, communities).
- `graphify update .` (AST only, no API cost).

**`query` output is filtered automatically** (`rewrite-piped-filter.sh graphify-query` in the Bash dispatch chain pipes
it through `graphify-query-filter.sh`): sourceless nodes dropped, `community=NNN` dropped,
`[src=PATH loc=LNN]` collapsed to the clickable `PATH:NN`. Measured 2026-09-10 across two .NET
repos: -14 to -30 %, every source-carrying node preserved. Fires when the last segment of the
command is a bare `graphify query` — `cd x && graphify query "y"` counts. Escape hatch for the raw
output: append `| cat`.

**Do not lower `--budget`** (default 2000 tokens) to save context. Sourceless nodes are emitted
first, so the budget truncates the tail, which is where the answer is: budget 600 keeps 10 useful
nodes out of 25 where budget 2000 keeps 42 out of 61. Filter the output, do not shrink the traversal.

`explain` is left unfiltered on purpose — it emits 37-500 B and has nothing to trim.

**`affected` fires by itself on a Domain edit** (`affected-blast-radius.sh`, `PreToolUse:Edit|Write`; currently paused — [`hooks/README.md`](../hooks/README.md)): editing
an aggregate or a value object attaches the blast radius of the edited type, rolled up per project.
The raw output is never injected — 421 lines / 65 kB on a central id, against 8 rolled-up lines. Call
`graphify affected "<symbol>"` by hand for the file:line detail. Since 0.9.58 node ids are
path-qualified, so a bare label can answer `No unique node match`; the hook disambiguates through
`explain` with the edited file's path, and stays silent when that fails.

**`update` refuses to write when the graph shrinks.** Missing-chunks guard:
`WARNING: new graph has N nodes but existing graph.json has M. Refusing to overwrite`. A drop is
normal after a refactor that deletes code — rerun with `--force`. Trap: **`update` exits 0 even
when it writes nothing** (guard refusal, "Nothing to update"). Neither the exit code nor stdout
proves the write — only the mtime of `graph.json` does.

**Auto-sync** (`Stop` hook → `hooks/graphify-autosync.sh`): triggered by a working-tree
fingerprint (`lib/graphify-freshness.sh`, source mtimes vs `graph.json`), not by an Edit/Write flag —
so it also catches IDE edits, merges, pulls and branch switches. Lock against concurrent
rebuilds. Log: `/tmp/graphify-hook.log`.

## Project hooks inside a worktree

The hooks ship in the plugin (`hooks/hooks.json`); a worktree runs them when the plugin is enabled
there. Enabled in the committed `.claude/settings.json` (project scope, `INSTALL.md`), it is: the file is tracked, so every worktree carries it. Nothing to fix.

Enabled at local scope instead (`claude plugin install cctoolkit@cctoolkit --scope local`, written
to the gitignored `.claude/settings.local.json`), a worktree is a checkout that carries none of it,
and not one kit hook fires there — no git guard, no read bounds, no traceability check.

The link is made by `.git/hooks/post-checkout`: it lives in the common git dir, so every worktree
of the repo shares it, and it is never committed. Worktree creation runs it with the new worktree
as the working directory, before any Claude session can start there, and it symlinks
`.claude/settings.local.json` back to the main worktree. No-op on a plain `git checkout`, on the
main worktree, and when the file is already there.

Every hook command is written `bash "${CLAUDE_PLUGIN_ROOT}/hooks/x.sh"` and resolves the repo
through `$CLAUDE_PROJECT_DIR` (`lib/project-root.sh`): a worktree session serves the worktree, the
scripts are the plugin's version, the same for every checkout.

**A git hook cannot ship with a clone.** Install it per clone:

```bash
cctoolkit install-git-hooks
```

`cctoolkit install-git-hooks --pre-commit` adds, opt-in, a `pre-commit` reminder that the knowledge base may lag behind the staged handlers ([`scripts/README.md`](../scripts/README.md)).

## Bringing a worktree back onto the local branch

`ExitWorktree` transfers nothing (`keep` or `remove` only). The transfer creates no commit, and
asks for the user's approval at the apply step:

```bash
git -C <worktree> add -N .            # makes new files visible to the diff (asks for approval)
git -C <worktree> diff HEAD > /tmp/wt.patch
git apply /tmp/wt.patch               # applies to the working tree, no commit (asks for approval)
```

## Injection-channel probes

An eval proves the script emits the right bytes; it never proves the model reads them. The two
are independent: `handler-claude-md-check.sh` emitted its report on plain stdout at exit 0 — a
PostToolUse channel that reaches the transcript only, never the model (231 emissions, 0 read,
2026-09-13). Green evals throughout. Fixed on 2026-09-13 by switching to
`hookSpecificOutput.additionalContext`.

So every injecting mechanism carries a manual probe, to be replayed after each Claude Code
update:

| Mechanism | Probe | Expected |
|---|---|---|
| `handler-claude-md-check` (PostToolUse) | one `Write` on a file under `src/**.Application/**` | the traceability report appears in the session |
| `batching-nudge` via `bash-dispatch` (PreToolUse:Bash) | three tool-carrying turns holding a single call | the batching line appears |
| `clear-nudge` (UserPromptSubmit) | a session past 150 k tokens | the step line appears on the next prompt |
| `explore-guard` (PreToolUse:Agent) | one spawn, then read the subagent transcript | the 20-line report contract sits in the received prompt |
| `subagent-report-shape` (SubagentStop) | one `tdd-test-author` run whose `## RED` drops its table | the agent re-emits a complete report on its own |
| deny guards (`read-bounds`, `cat-bounds`, `guard-git`, `guard-integration`) | one refused call — a whole `Read` of a knowledge-base `rules.md` included | the reason appears |
| `knowledge-reminder` (PostToolUse) | with a knowledge base, one `Edit` on a handler file in the main session | the line naming its use case and `/cctoolkit:knowledge-sync <Context>` appears |
| orchestrator effort via the statusline (`implement-tdd-guard`) | `/effort high`, then launch a batch | the launch is refused and names `/effort medium` |

State channels count too. The effort one has no hook event of its own: the statusline is the only
place Claude Code hands over `.effort.level`, so `statusline-command.sh` drops it in
`$TMPDIR/claude-effort-<session>` (plus `claude-effort-last` as the fallback for a guard that runs
before the first render) and `implement-tdd-guard.sh` reads it back. Missing file = unknown effort
= the batch starts: a statusline that has not run yet must never block a launch.
`CLAUDE_EFFORT_LEVEL` forces the value for evals and troubleshooting. Measured on ten batches:
155 min of model latency out of 628, 8.6 s per turn over 1 087 turns, all at effort high.

## Hook evals

`cctoolkit evals [-v] [cases/x.json]` replays recorded payloads through the hooks and
checks the decision, the rewritten command, the appended prompt or the injected context. Cases
in `evals/cases/*.json`, fixtures generated in `evals/.fixtures/` (ignored) and
`/tmp` state keyed by a run id and removed. Each defect found in production before 2026-09-12 is
a case; the first run found two more — the heredoc rewrite above, and a byte-limit message in
`bulk-read` (removed 2026-10-10). Shape borrowed from `plugins/shunt/evals/run.sh`. A hook change without a case is
not finished.

## Mods — `context-band`, `knowledge-pane`, `run-lot-pane`, `spec-pane`

Optional in-terminal panes, each its own plugin of the marketplace: what each shows, where they live and how a new one is added — [`mods/README.md`](../mods/README.md).

## Workflow `run-lot` — autonomous batch as a script

`workflows/run-lot.js`, shipped by the plugin. The single TDD chain, with the sequence held by the script, not by prose: `/implement-tdd` only launches it (or `run-plan` for a whole plan) and answers its questions; the design agent reads `skills/implement-tdd/references/design.md`. A whole plan runs through the `run-plan` workflow below.

```text
/cctoolkit:run-lot todo/<code>/<CODE>-PLAN-F2.md
```

One argument, the batch sheet. The script derives the global plan (`…-PLAN.md`), the batch (`F2`), the batch report `<sheet folder>/run/batches/F2.md` and the run work file `<sheet folder>/run/.work.jsonl`, shared by every batch and run of the plan (see **Run files**). Kit files are reached through `cctoolkit root`, kit scripts through `cctoolkit <script>`.

**Run files** (2026-10-12, one file per run since 1.8.1, one work file since 1.9.0). Under `todo/<code>/run/`, the user reads only `<YYYY-MM-DD-HHMM>.md`: decisions taken without the user first (`## To validate`), then batches, minors, final check and run-plan's journal (`## Journal`); plus `<YYYY-MM-DD-HHMM>-aside-FX.patch` of a batch set aside, cited there. Runs before 1.8.1 wrote a `<stamp>/` folder holding `REPORT.md` and `TO-VALIDATE.md`. `batches/FX.md` is the batch report, read by `cctoolkit plan-next-batch --context`, the run-plan gate and `run-lot-pane`. Everything else is one hidden file, `.work.jsonl` (`lib/work_file.py`): one JSON line per event — `preexisting` (files already modified when a batch started: path and blob hash, no content), `cycle` (RED/GREEN state), `question`/`answer`, `journal` (run-plan) — appended under `flock` by `cctoolkit run-work`, `run-question`, `batch-baseline` and `plan-next-batch`. Logs, captures and suite outputs never land under `run/`: they go to the folder `cctoolkit run-work tmp <name>` prints in the system temp directory, removed by the step that read them with `cctoolkit run-work rm-tmp <name>…` (never `rm -rf "$(…)"`: Claude Code's guard holds an `rm` on a command substitution for confirmation, denied after two minutes in an unattended run). A `DONE` batch keeps only its `cycle` lines; a batch set aside loses every line (its patch is enough); a stopped batch keeps its `cycle` and `preexisting` lines for the resume. run-plan's preflight runs `cctoolkit run-work purge <run folder> <stamp>`, for every run of the plan: it drops the lines no run needs (other runs' journal, every question and answer) and keeps the 3 most recent runs (report, `<stamp>/`, patches). `cctoolkit run-question watch <plan folder>/run` reads the work file. Readers accept the French vocabulary of earlier reports (`STATUT — TERMINÉ`, `docs/FROZEN-LITERALS.md` § French aliases).

Phases: Design (one haiku agent: snapshot of the files already modified (`preexisting` line), saved cycle states, `cctoolkit sheet-cycles <sheet> --index`, next sheet; the Opus design runs only when the `## Cycles` block is absent or invalid and writes it into the sheet; a sonnet agent writes the §4.5 declaratives the block lists, then builds) → RED (`tdd-test-author`, a wave in parallel, contract read through `cctoolkit sheet-cycles <sheet> --cycle ID --red`; next wave's REDs start beside the first GREEN; a contract method whose throw site no caller reaches goes to `unreachable`, listed for the user, never retried) → GREEN (`tdd-implementer`, serial, contract through `--cycle ID --green`; writes the handler `CLAUDE.md` of the rule it adds and the cycle state with `green`) → global green beside the pre-audit gate (sonnet, effort low: `cctoolkit pre-audit` and what it lists, no build, no production code) → audit (`ddd-tdd-auditor` runs `cctoolkit audit-capture --base` first — code diff of the batch alone, source and test folders only, `.md` and `.verified.*` named, never inlined, plus the `TDD cycles` section read off the cycle states — and reads the global green's exit codes instead of rerunning those suites; it is handed the decisions the run took, never a `Plan` gap for being absent from the sheet) beside the next sheet's review (`adversarial-reviewer`, reading only; FX never designs FY, whose own Design phase writes its `## Cycles` when absent; `amendNext` then applies the review answers and FX's audit gaps to FY, block included, with one re-review after a Blocking) → report (composed by the script from `history` — `## STATUS`, `Verdict:`, `Reason:`, files per layer, cost, Hn, audit, validations, test recap per class, `## To validate`, `## Audit gaps` for the next batches' design; haiku only writes it verbatim; written on every stop; marks the plan heading `### Batch FX` and the sheet's `# ` line `✅ DONE (date)`, and on `DONE` commits the batch — `cctoolkit batch-baseline commit`, see **Batch commit**; under run-plan the gate commits instead — and drops its lines but the `cycle` ones). Each agent returns a `schema`-validated object; the script checks RED (exit ≠ 0, every contract method in the table or in `unreachable`, no stub on a guard or an `ALREADY_GREEN`) and GREEN (exit 0, `Cost` line clean), one retry with the reason (an agent ending without structured output counts as a failed try; its retry resumes from the files already on disk instead of rewriting), then the arbiter. **What the agents wrote is read off the tree, never off their report** (1.12.0, `hooks/tdd-scope-guard.sh`, `lib/tdd_scope.py`): a snapshot per agent at `SubagentStart`; the implementer's `Edit`/`Write` of a test file denied unless granted (`Test files you may modify, granted:` of its prompt) or `.verified.txt`; any write through Bash under the roots denied to both agents, so their `Edit`/`Write` log is complete; at their structured output, the tree since the snapshot minus what parallel agents logged — a test file changed at GREEN and not granted, a source file changed at RED and absent from `stubs` — and, for a RED, its test command rerun by the hook: a test failing on `tdd.stubFailure` (`NotImplementedException`) instead of its assertion is refused by name. The agent restores (`cctoolkit tdd-scope restore`), fixes, or returns `BLOCKED` with the hook's exact reason, which the script takes as the retry reason and the arbiter parses. `testsDiff` / `productionDiff` stay in the reports for display.

Returns `{ status, reason, verdict, gaps, hypotheses, minors, review, toReview, report, commit }` (plus `unanswered` when FY's questions got no answer: FX stays `DONE`, run-plan sets FY aside after its gate), `status` ∈ `DONE`, `BLOCKED`, `GAPS`.

**Questions inside the run** (2026-10-11). A run never stops to ask and is never resumed: `resumeFromRunId` replays agent calls by order, the concurrent REDs/GREENs reorder on replay, the cache breaks early and finished cycles rerun (an existing green test rerun as RED, rejected by `checkRed`, no decision can lift it). Instead, a stopped step (design, RED, GREEN, global green, closing; after its own retry and the arbiter) or an unsourced Blocking on FY that only a human can settle calls `ask()`: a haiku agent appends it through `cctoolkit run-question ask <work> FX` as the `question` line `FX-<n>` of `run/.work.jsonl` (payload `batch`, `sheet`, `kind` stop|review, `context`, `questions[{id, severity, question, evidence, options, recommendation}]`) and notifies (`osascript` when present), then haiku `wait` agents poll `cctoolkit run-question wait <work> FX-<n> --seconds 300` (2 rounds, 10 min in all) until its `answer` line appears. The answer reruns the step with it appended, listed under `## To validate` as `user decision` and carried by the cycle's `decisions` on resume (three decisions per step at most), or is applied to FY's sheet. No answer after 10 min: a question carrying a `recommendation` takes it as its answer, marked `user decision to validate`, listed as `decided without answer after 10 min`; one without stays unanswered. `STOP`, no answer nor recommendation, or a step still stopped after its decisions and its last attempt → `BLOCKED`, and run-plan sets the batch aside (see **Batch commit**). **Session side**: when launching `run-plan`/`run-lot`, arm `cctoolkit run-question watch <plan folder>/run` with Bash `run_in_background`; on its `QUESTION <work> <id> since=<epoch> next=<epoch>` read the question JSON printed on the next line, ask through AskUserQuestion (empty `options` → propose 2-3 from `context` and `evidence`, plus `STOP`), write the answer with `cctoolkit run-question answer <work> <id> '[{"id":"q1","text":"…"}]'`, re-arm with `--since <next>` (the `next=` it printed: the question being answered never fires twice); stop the watcher (TaskStop) when the workflow completes. `cctoolkit run-question pending <run folder>` lists the unanswered ids.

**Arbiter, then review after the plan** (2026-10-12). Goal: a whole plan runs without the user. `decide()` first calls an arbiter agent (phase `Arbiter`): it grants `allow-test: <path>` when the test itself is wrong (fixture, expectation against the raw value a shared helper normalizes, ripple of a signature the sheet changes), `accept-cost: <why>` for a loop the batch did not write, picks the favoured option of an ambiguity, or gives the retry instruction. It returns `defer` for a stop that holds back no later batch (guard red on older code, refactor with a red net, documentation or pre-audit failure): a guard or refactor cycle is left out, the run goes on, the stop is listed for validation; a closing or pre-audit failure never stops the batch, the audit judges it. It returns `ask` only when no decision is defensible (customer-visible behaviour with options of comparable weight, data loss, security, external contract, every option tried); only then `ask()` runs. Same for the design (`blocked` only when nothing is defensible; choices go to `review`) and the next-sheet review (`humanOnly` questions only; other answers applied, marked `user decision to validate`). Grants travel by value from the decision text to `checkGreen(r, grants)`, never through module state, and are rebuilt from the cycle's `decisions` on resume. A RED finding the behaviour already on disk returns `ALREADY_GREEN` (filtered run exit 0, no code written): GREEN observed, listed for validation. Audit: one fix round, a second one only when the gaps left include a Blocking on axis `Correctness` or the audit answered a contest Counter or Refute. A gap carries its `Closure`; the fix may contest one by naming a concrete harm, the resume audit answers Accept (gap closed, trade-off to validate), Counter, Refute or Escalate (to validate, holds nothing) — protocol in `verify-ddd-tdd` § Contested findings. Each round is bracketed by `cctoolkit audit-round open/close` (haiku relays): the resume audit reads the change set off the tree, a changed file no finding cites and no declared extension justifies is a Scope Major the script adds; findings that do not go down while the change set grows stop the rounds; every round is an `audit-round` line of the work file; an auditor without result gets one more attempt on the same capture, then `Verdict: to redo`; gaps left → `Verdict: GAPS carried`; only a Blocking on axis `Correctness` after the fixes stops (`GAPS`). Escalation: a RED or GREEN step whose decisions are exhausted, or that the arbiter and the question could not unblock (never on `defer` nor a `STOP` answer), gets one last fresh agent on `opus` (`withRetry` passes `{ model }` as the second argument of the launch function) with every earlier rejection reason and decision; still rejected → `BLOCKED`. The plan heading `### Batch FX` gets `✅ DONE` from the report step, after the audit, never from the closing. Every such decision lands in `## To validate` of `batches/FX.md`, and run-plan gathers them into `## To validate` of `run/<stamp>.md`, to read after the plan.

**Batch commit** (1.9.0). Every batch is committed when it ends, so `HEAD` is the end of the previous batch and the batch diff is the diff against `HEAD`. A run may start on a tree the user already modified: `run-lot` records those files at batch start (`cctoolkit batch-baseline snapshot <work> FX`, a `preexisting` line of path → `git hash-object` hash, no content stored; kept on resume). A file of the batch is then one modified or untracked now, outside the run folder, that was clean at start or changed since. `cctoolkit audit-capture … --base <work>` diffs the batch files alone and never truncates (past 1200 lines the diff stays in its own file of the temp folder, with a per-file line index), `cctoolkit access-cost --base <work> FX <files>` flags only lines added against `HEAD` (the others are marked `(pre-existing)`). `cctoolkit batch-baseline commit <work> FX --sheet <sheet>` stages the batch files only and commits them with `git commit --only` (an index the user staged before stays out), message `<type>(<plan folder>): batch FX — <sheet title>` (`refactor` when every cycle is a refactor, `fix` when the title starts with fix/corrig, else `feat`) closed by the trailer `Kit-Batch: <plan folder>/FX`, which `cctoolkit knowledge-scan` reads to skip the commit as covered by the plan's merge, never pushes; a preexisting file the batch also changed is committed whole and listed under `## To validate`. It is the kit's only commit: `lib/guard-git.sh` still denies a Git commit typed in a Bash command, the script runs git itself. `run-lot` alone commits at its `DONE` report; under run-plan (`workflow('cctoolkit:run-lot', { sheet, commit: false })`) the commit comes after the gate, so a gate repair lands in the same commit. Questions of an earlier run of the batch are dropped at start, and `cctoolkit run-question wait` ignores an answer older than its question. run-plan runs no test suite, neither at preflight nor at its gate: the build must be green, and the tests come from each batch's global green, scoped to its diff by `test-scope.md`; after the last batch, its `Final check` runs every suite whole once, `IntegrationTests` included (`KIT_FINAL_CHECK=1`, the only marker `guard-integration-filter` lets through), reported in `## Final check` and `## To validate` of the run report, never blocking nor attributed to a batch, skipped under `--only` or when no batch ended `DONE`; files modified outside the batch no longer stop it (listed for validation). **A blocked batch only stops its dependents**: a batch whose run-lot is not `DONE` or whose gate stays red is set aside: `cctoolkit batch-baseline restore <work> FX --save run/<stamp>-aside-FX.patch` writes the diff of the batch files, puts each one back to `HEAD` (through `git show`, never checkout/restore/stash) and deletes the ones it created; a preexisting file the batch also changed is left as is and listed for validation; run-plan then drops every line of the batch from the work file and its temp logs, keeping only the patch, and puts `⬜` back on a `✅ DONE` heading; `cctoolkit plan-next-batch --skip FX,…` reads them as not done and holds their transitive dependents (`held` in the `--next` JSON), `END FX:skipped FY:FX` when only those remain. Gate: a failure already present at start never fails it; a new failure or a red build → one repair agent (default model, source folders only, never a test, filtered reruns), then the gate again; still red → set aside. Checks without agents are evaluated by `evals/workflows/run-lot-checks.js` and `run-plan-checks.js`, the flow of a batch by `evals/workflows/run-lot-flow.js` (`node evals/workflows/<x>.js workflows/<y>.js [variant]`).

**Resuming a stopped batch** (2026-10-10, sheet-driven since 1.7.4). The RED agent appends its state as a `cycle` line of `run/.work.jsonl` before returning (`cctoolkit run-work append`, under `flock`: REDs of a wave run in parallel), the GREEN appends it again with `green`; the last line of a behaviour slug wins. On a rerun the workflow reads them through `cctoolkit sheet-cycles <sheet> --states <work>` and compares them with the block's cycles, without any model: a cycle with `green`, or with no GREEN to run (guard, `ALREADY_GREEN`, no test written), is done; a cycle with a RED only resumes at GREEN, its saved RED checked again by `checkRed`; the answer to a stop sits in the `decisions` field of the cycles it touches. The `cycle` lines survive `DONE`, so a later correction cycle reruns nothing; a batch set aside loses them with its tree. A stopped report ends with `## Resume`. `args.decision`/`args.decisions` and `resumeFromRunId` are gone: a restart is always a new run.

**Sheet-driven cycles** (1.7.4). Measured on two batches: 52 and 48+ min each, with an Opus design of 8-13 min, a sonnet closing of 9-11 min and 80 turns spent keeping an 87-126 KB sheet up to date, 11 haiku tick agents, and a RED rejected 4 to 5 times because its contract had no place for a method whose throw site is unreachable. Since then the sheet carries its TDD cycles as one ```json block under `## Cycles` (fields: `skills/implement-tdd/references/design.md`), written by `/plan-implementation`, or by the design fallback at the start of its batch. `cctoolkit sheet-cycles` validates it without a model: complete `Class.Method` names, paths under the source or test roots of `kit.config.json` that exist or are created, one test project, at most 4 test files and 8 production files per cycle (test files under the optional `layout.tests.shared` excepted), disjoint waves; exit 2 = no block, every caller falls back to the old sheet (`TDD:` ticks). No `TDD:` ticks, no haiku tick agents, no closing agent and no `Hn` from the run: the GREEN writes the cycle state and the handler `CLAUDE.md`; closing = the pre-audit gate alone; every decision the run takes (user answers, design choices, unreachable guards, settled review Blockings, arbiter grants) goes to `## To validate` of the batch report, gathered by run-plan into `## To validate` of the run report. `cctoolkit pre-audit` fails on a cycle without its final state and on a method of the block absent from the test roots; `/verify-ddd-tdd` reads TDD evidence from the capture's `TDD cycles` section, a stale plan is Minor unless an RM/CU moves.

**2026-10-11 changes.** Design (now only when the block is missing or invalid) starts with `cctoolkit plan-next-batch <plan> --context FX` (earlier `## Audit gaps`, `user decision`/GAPS lines, resume state, cited paths that do not exist) instead of reading reports and grepping sheets turn by turn. It puts every existing test asserting a literal or contract the batch changes into the RED `full`. A cycle with `"guard": true` (a step marked `TDD: GUARD ⬜` on an older sheet) is a guard cycle: RED exit 0 required, no stub nor production file, no GREEN. The audit fix reads the capture and runs filtered tests only; the retry audit reruns the suites the diff requires. agent() calls happen in a fixed order (no call issued from a RED's `.then`); not enough for a resume: the next wave's REDs still interleave with GREENs, see **Questions inside the run**.

Before launching: `cctoolkit plan-next-batch <plan> --outside FX` exit 0 (a file modified outside the batch is left out of its commit, but `cctoolkit pre-audit` lists it), `cctoolkit doctor` without FAIL, test containers reachable when the batch touches Infrastructure. Follow it in `/workflows` or the `run-lot-pane` mod. Flow check without agents: a Node harness feeding schema-shaped fakes to the body (strip `export`, wrap in an `AsyncFunction(args, agent, parallel, phase, log, …)`).

Requires the `Workflow` tool: `disableWorkflows` absent or `false` in `.claude/settings.local.json`, `Workflow` out of its `deny` (startup cost: `templates/README.md` § Startup trim). The startup-trim template leaves it in.

## Workflow `run-plan` — whole plan, one `run-lot` per batch

`workflows/run-plan.js`, shipped by the plugin since 2026-10-10. Runs `run-lot` inline by its registered name (`workflow('cctoolkit:run-lot')`): the harness resolves the plugin's own copy wherever it is installed (cache, `directory` marketplace), where a `scriptPath` from `cctoolkit root` falls outside the folders Workflow may read for every runnable batch, same session, agents fresh per step. `/cctoolkit:run-lot <sheet>` alone stays available.

```text
/cctoolkit:run-plan todo/<code>/<CODE>-PLAN.md [--until FX | --only FX]
```

Preflight (haiku: `cctoolkit plan-next-batch --check`, `cctoolkit doctor --quiet`, `docker info` when docker is installed — on macOS `open -a Docker` when down, checked again after the build —, `cctoolkit run-work purge` — lines no run needs dropped, 3 runs kept — and the `start` journal line) → loop: one haiku call to `cctoolkit plan-next-batch --next <work> --run <stamp>` (next batch, out-of-batch paths and the `FX launched` journal line as one JSON line; `END` ends, `WAITING`/error stops), `run-lot`, then a gate read from disk (first line of `batches/FX.md` = `## STATUS — DONE`, `Verdict` `VALID`/`GAPS carried`/`to redo`, `### Batch FX` `✅ DONE`, the build and the whole, always-run suites of `test-scope.md` compared with the start failures by the script), the batch commit (`cctoolkit batch-baseline commit`, see **Batch commit**), its lines but the `cycle` ones and its temp logs dropped, its journal line → `run/<stamp>.md` (`## To validate` first: stop, batches set aside, every decision taken without the user, Hn; then minors, final check, journal; the run's journal lines dropped afterwards) and an `osascript` notification; a run where no batch was launched drops its journal lines and writes no report. The gate reads `grep -m1 '^Verdict:'` of the batch report. A blocked batch or a gate still red after its repair sets the batch aside (see **Batch commit**): the plan goes on with the batches that do not depend on it, the run report lists it with its reason, patch and dependents, and the run ends `BLOCKED` naming them. From the second batch set aside, a sonnet arbiter compares the reasons and the `## To validate` of their reports: a cause shared with an earlier one (same spec ambiguity, wrong assumption, workaround) stops the plan under `## Plan stopped — common cause`; each decision is a `breaker` line. The `run-lot-pane` mod steers without a prompt, through `run/.pane.jsonl`: a pause (`plan-next-batch --next` answers `PAUSED` between two batches, `paused by user`), a note for a batch (`cctoolkit run-notes take`: every contract when the batch starts, the next retry or arbiter while it runs), an answer to a `## To validate` entry (`cctoolkit run-validate apply`, run by the preflight of both workflows: `decisions` of the cycles named and an `Hn` marked `user decision`; no automatic relaunch). Open questions on FY are asked inside run-lot and answered from the session while the run waits (the suspension of FY with `--exclude` and the `AWAITING-ANSWER` status are gone); FY's questions left unanswered set FY aside after FX's gate.

**Knowledge-base merge** (2.0.0). After the final check, a plan delivered whole — no stop, no batch set aside, no `--until`/`--only` — enters phase `Merge`: a haiku agent runs `cctoolkit knowledge-merge prepare <plan>`, then the `knowledge-merger` agent drafts the spec's delta and the sheets' ADRs and stages them under `<knowledge.root>/.merge/<CODE>/`, writing nothing in the base. The result carries `merge` (`state` `staged`, `nothing`, `refused`, `blocked` or `failed`, its `lines`, `warnings`, and `next`, the `/cctoolkit:knowledge-merge <plan>` to run), the run report gains `## Knowledge base`, and a merge not staged lands under `## To validate`. The base is written only by `/cctoolkit:knowledge-merge`, on the user's confirmation. A plan blocked or partial merges nothing: its spec stays under `todo/`.

`cctoolkit plan-next-batch` reads the `### Batch execution` table (`Batch`, `Depends on`, optional `Repo`), at most one batch per repo, and the French form of the table of a repo that started in French; `--outside` mirrors the scope check of `cctoolkit pre-audit` (source and test roots of `kit.config.json`, plan folder, basename named in the sheet; `.claude/` and `todo/` never count as outside).

Limits: batches of this repo only (a `Repo` elsewhere stops the run with its name). No USD cap per batch. Each batch is committed before the next one starts, so batch N+1's diff never holds batch N's code. The `run-lot-pane` mod opens a plan view on such a run: `p` back to the plan, `1`-`9` a batch, agents split by the `Workflow run-lot, batch FX` first line of their prompt.

## Workflow `run-audit` — the quality report

`workflows/run-audit.js`, shipped by the plugin since 1.11.0. Launched by `/quality-report` once the Stryker mode is chosen (off by default):

```text
/cctoolkit:run-audit --stryker off|full|since --date YYYY-MM-DD --checkout <main checkout>
```

It never asks: a tool that fails gives `missing` and the run goes on. Phases, each agent on the smallest model that does the job:

| Phase | Agents | Model / effort |
|-------|--------|----------------|
| Preflight | doctor, leftover `bg` jobs stopped, `cctoolkit audit-worktree create` (main branch, detached, system temp), stack, temp folders, Docker | haiku / low |
| Tests | restore, build, every suite with coverage (`commands-<stack>.md` § Step 1-2), alone | sonnet / low |
| Measures | SonarQube + coverage (reuses an analysis whose `revision` is the commit), `cctoolkit audit-collect`, inventory, git activity — in parallel | sonnet / low, collect haiku |
| Stryker | only when asked; starts once every measure reading the sources is done (Stryker rewrites them), `cctoolkit bg start audit-stryker`, then `bg wait --seconds 540` per haiku agent, stopped past 4 h (full) or 1 h 30 (since); reports cached per commit (`run-work tmp stryker-<sha>`) and reread on a rerun | sonnet / low, waits haiku |
| Assemble | `cctoolkit risk-cross`, `cctoolkit report-assemble` — fragments merged, the workflow's metadata and evidence last | haiku / low |
| Report | the Markdown, from the JSON, the template and `SKILL.md` § Report rules | opus / medium |
| Check | `quality-report-check`, two repairs at most, then the coherence checks and two hotspot files by hand | haiku, sonnet / medium |
| Cleanup | jobs stopped, worktree removed (`finally`: on failure too); the temp folder kept unless `DONE` | haiku / low |

No figure crosses two models: each agent writes its own fragment under the temp folder, `report-assemble` merges them and sums `tests.total`. The `run-lot-pane` mod follows it like any workflow (phases and agents, no batch sheet). Flow check without agents: `node evals/workflows/run-audit-flow.js workflows/run-audit.js off|full|timeout|nocollect|blocked`.
