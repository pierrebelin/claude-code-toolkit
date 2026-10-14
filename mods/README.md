# Mods

Three optional panes drawn inside Claude Code (terminal or desktop Code tab), to see what the kit is doing without asking: where the batch stands, what the spec already holds, how full the context is. Each one is a small plugin served by the `cctoolkit` marketplace, installed on its own — the kit works without them.

## `run-lot-pane` — follow an autonomous batch

A `/cctoolkit:run-lot` batch runs for tens of minutes across a dozen agents. The pane shows it live: phases with their agents, time and cost, each agent's model and current tool, retries and stalls flagged as they happen, the batch sheet ticking RED → GREEN → COST (or its `## Cycles` block, each cycle done once its state file says so), an estimated end, then the outcome and the audit verdict. Opens by itself when a Workflow starts; `/run-lot-pane demo` shows an example. In Claude Desktop's Code tab, `t` (or the `◫ timeline` button) opens a timeline of the run, `b` comes back: each phase over its real steps (the sheet's cycles by name, the other steps by agent), a bar per agent on its step's row, `now` and `ETA` marks, dashed bars for what is still expected, retries, stalls and interruptions marked on the bars, the agent's model, duration, cost and current tool on hover.

![run-lot-pane during a run: phases, agents with model and effort, a retry, a stall warning, the batch sheet](run-lot-pane/screenshots/demo-running.png)

End of the same run: [`demo-end.png`](run-lot-pane/screenshots/demo-end.png).

A `/cctoolkit:run-plan` run opens on the plan: batches with their state, agents, time and cost, then the supervisor steps between them. `1`-`9` opens a batch in the view above, `p` returns to the plan; `/run-lot-pane demo plan` shows an example. On the desktop, `t` on the plan opens its timeline: one row per batch named after its sheet with its state (done, running, waiting on its dependencies), the batches to come placed after their dependencies up to the plan's `ETA`, and the supervisor steps.

![run-lot-pane on a run-plan: four batches, one done, one running, two waiting on their dependencies, supervisor steps](run-lot-pane/screenshots/demo-plan-running.png)

Batch F2 opened from the plan: [`demo-plan-lot.png`](run-lot-pane/screenshots/demo-plan-lot.png). End of the plan: [`demo-plan-end.png`](run-lot-pane/screenshots/demo-plan-end.png).

## `spec-pane` — see the spec take shape

During a `/cctoolkit:business-spec`, the pane keeps the decisions you answered, the open questions by severity, the use cases, business rules and sections in view, refreshed on every write. A click unfolds a row in place. Opens by itself when the skill starts; `/spec-pane <path>` follows an existing spec. In Claude Desktop's Code tab, the spec state heads the pane: side by side, a square per open question by severity and per decision kept, changed or pending, the question or the answer on hover; the sommaire gives each part its count.

![spec-pane: open questions by severity, use cases and business rules, one of each unfolded](spec-pane/screenshots/spec.png)

## `context-band` — know when to `/clear`

A line under the prompt: context meter, 5h limit, prompt-cache expiry, session time and cost. `[Show all]` adds the `/clear` step (150k, ceiling 250k) and what filled the context over the last turns. Always on.

![context-band under the prompt: context meter, 5h limit, cache, /clear step, top contributor](context-band/screenshots/band.png)

## Install

From the repo root, type it yourself — the auto-mode classifier refuses an agent enabling plugins. The marketplace is the kit's own: skip the first line if `cctoolkit` is already installed (`INSTALL.md`).

```bash
claude plugin marketplace add pierrebelin/claude-code-toolkit --scope project
claude plugin install context-band@cctoolkit --scope project
claude plugin install run-lot-pane@cctoolkit --scope project
claude plugin install spec-pane@cctoolkit --scope project
```

Take only the ones you want, then restart Claude Code in the repo. Inside a session, `/plugin install <mod>@cctoolkit` does the same.

A repo that installed them from `.claude/mods/` (the former `pierrebelinmods` marketplace): `/cctoolkit:kit-init` removes that marketplace and tells which mods to reinstall.

Check it loaded:
```bash
claude -p "ok" --max-turns 1 --debug --debug-file /tmp/mods.log >/dev/null
grep 'hooks module' /tmp/mods.log   # one "loaded" line per mod
```

## Reference

Each folder is one plugin, listed beside `cctoolkit` by the kit's marketplace (`.claude-plugin/marketplace.json` at the toolkit root). Mods live here and nowhere else — never under `skills/`, even though the engine would adopt a plugin folder there.

| Mod | What it shows | Opens |
|-----|---------------|-------|
| `context-band` | line under the prompt input, below Claude Code's hint line: context meter and tokens, prompt-cache expiry, single-call streak, graphify rebuild, 5h limit, session time, turns since `/clear` and session cost, top 2 context contributors over 5 turns; `[Show all]` unfolds the `/clear` step (150k, ceiling 250k), the batching advice and the full contributor list (estimates calibrated on the turn's real growth); after a restart, turns and contributors are replayed from the transcript | by itself, every turn |
| `run-lot-pane` | side pane following a `run-lot` Workflow run (English display, demo included; English statuses `DONE` / `BLOCKED` / `GAPS` and their French counterparts recognised, `?` for a batch with a pending question line in `run/.work.jsonl`): batch named from the sheet (F4 · CAT-LIFECYCLE), phases as columns (agents, duration, cost) with their detail, estimated end `ETA ~14m` in the header (mean durations of earlier runs, a parallel pair counted at its maximum), phases always unfolded with their agents, agents (model · effort, live activity `● thinking · 4.2k chars` / `● output · 12k chars` / `○ waiting model 40 s` / `tool Bash 2 min` read from the model stream, current tool and context, retries `↻ 2`, slowness in yellow past 2× the phase's usual time, stalls `⚠ 48 tools` / `⚠ ctx 160k` / `⚠ idle 1m` (no chunk for 60 s, no open tool, no model wait under 120 s), interruption `⊘` of an agent still running when the run stops), each agent's cost split pro rata of weighted tokens when agents run in parallel, batch sheet (steps, RED/GREEN/COST, corrections, assumptions) re-read when its file changes, or, when the sheet carries a `## Cycles` json block, one row per cycle with its RED/GREEN state read from `run/.work/FX/cycles/*.json`, or the packed `cycles.jsonl` of a done batch (`run/.travail/` of an older run too) and each unreachable method left unwritten flagged under its cycle, RED agents labelled `RED <id> w<wave> …` and GREEN agents `GREEN <id> …` with `wave n/N` on the RED phase header (highest wave launched, N from the sheet's cycle index), estimated end ignoring the samples of earlier runs for the phases the current labels reshaped, audit verdict by severity, run outcome as a coloured block with reason and report path, toast at the end of the run; `resumeFromRunId` resume followed without freezing the display (a stopped journal older than the relaunch is ignored); phase card and agent card (outcome read from the structured answer, verdict and every gap included; every tool call in order with its short argument, up to 300; errors with exit code and last output line, greyed once the agent recovered; prompt without the shared workflow frame); a `run-plan` run opens a plan view (batches from the plan's execution table, state from `run/batches/FX.md`, or `run/lots/FX.md` / `run/FX/FX-report.md` of an older run, supervisor agents; a batch done before this run keeps the agents, time and cost of the run that finished it, saved in the mod's `$.store` per project and batch sheet when its report reads `DONE`), `1`-`9` a batch, `p` back; `/run-lot-pane demo`, `demo end`, `demo plan` or `demo plan end` for an example; desktop Code tab only, `t` (`◫ timeline` button under the header) opens an interactive SVG timeline of the run, the plan or the batch in view, `b` back to the phases, which take a touch of colour there (accent headings, `RED` in red, `GREEN` in green) (axis from the run start to now or to the estimated end, `now` and `ETA` marks; each phase with its progress `n/N` over its steps, the sheet's cycles by behaviour and the other steps by agent label, a phase of one step on one row; a bar per agent on its step's row coloured by state, a pulsing edge while it runs, marks `↻ n`, `⚠ <stall>`, `⊘ interrupted`, `✗ error`, tooltip agent · model · effort · duration · cost · current tool; dashed expected bars for the rest of the running phase and the phases to come, from the past runs' durations, and a legend; on the plan view a row per batch named after its sheet, `✓ done` / `● running · <phase>` / `⧗ after <deps>`, the batches to come placed after their dependencies, and a supervisor row), the terminal keeps its text display | by itself, when a Workflow starts |
| `spec-pane` | side pane following a `/business-spec` of the current session (read-only): decisions asked through `AskUserQuestion` with their answer (`?` pending, `✓` recommended option kept, `≠` another choice, `–` closed without an answer), then, once `todo/<code>/SPEC-<code>.md` is written and on every change (mtime every 3 s), title, summary, §12 open questions in full, by severity, names of use cases, business rules and sections; a click unfolds the full content inline under its row (several at once, a second click folds it), `fold all` (`b`) folds them all back; collapsible groups; `/spec-pane todo/<code>/SPEC-<code>.md` follows an existing spec, `/spec-pane clear` forgets it; French and English specs both parsed; desktop Code tab only, an interactive SVG heads the pane once a decision is asked or the spec written (open questions and decisions side by side, a block alone on the whole width; a square per open question by severity, `✖ blocking` / `▲ major` / `● other`, the question and its impact on hover; a square per decision, `✓` recommended kept, `≠` other choice, `–` no answer, `?` pending, question, answer and recommendation on hover), and the sommaire gives each section its count of use cases, rules or open questions, the terminal keeps its text display | on its own, when `/business-spec` starts or a spec is written |

Screenshots taken from the real panes: `/run-lot-pane demo`, `demo end` (rendered from the pane's drawn tree), `demo plan` (then `ctrl+x tab`, `2`) and `demo plan end`, `/spec-pane` on a fictional spec, `context-band` after one turn.

A `tool.call` hook reads the tool's arguments flat on `e` (`e.skill`, `e.file_path`): there is no `e.input`.

## Layout of a mod

```
<mod>/
  .claude-plugin/plugin.json   name, version, description, "types": "./types/index.d.ts"
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           export const register: Register = on => { ... }
  types/index.d.ts             the $.state contract (interface PluginState)
  tests/*.test.tsx             claude plugin test
  tsconfig.json                extends the engine-laid types
  .gitignore                   .claude-plugin/types/ (laid by the engine)
```

## Writing a new mod

1. Load the `plugin-authoring` skill: it names the session's dev-mods folder and turns hot reload on. Write and iterate there.
2. `claude plugin validate <mod>` and `claude plugin test <mod>` green.
3. Copy it here without the engine-laid types: `rsync -a --exclude .claude-plugin/types/ <dev-mods>/<mod>/ mods/<mod>/`, delete the dev-mods copy (two loaded copies of one name collide), add its row to the toolkit root's `.claude-plugin/marketplace.json` and to `enabledPlugins`.
4. `claude plugin validate .` from the toolkit root to check the marketplace.

Traps met with the API: in tests, call hooks (`fs.read`, `store.get`, `ui.open`…) answer `{ value: … }`; the fallback `ui.render` returns a tree (`<Box key="engine" />`), never `null`; `$` is only passed to functions declared at module level; when the state shape changes, merge with the empty value (`{ ...EMPTY, ...stored }`), since `$.state` survives reloads; no toast, no sound.
