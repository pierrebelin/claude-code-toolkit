---
name: knowledge-merge
description: "Use when a delivered feature must enter the business knowledge base: after run-plan staged its merge, after a plan run batch by batch, or to merge what a plan abandoned for good delivered (--partial). Shows the diff and writes the base only on the user's confirmation."
argument-hint: "<todo/<code>/<CODE>-PLAN.md> [--partial]"
---

# Knowledge merge

Brings a feature into the knowledge base (`knowledge.root` of `.claude/kit.config.json`): the delta of its spec (`kit:new`, `kit:modified`, `kit:retired`) and the ADRs of its sheets. Formats → `../knowledge-sync/references/knowledge-format.md`.

- The base changes here only, once the plan is delivered. Nothing reaches it without the user's confirmation; `cctoolkit knowledge-write` is its one writer — never `Write` or `Edit` under it yourself.
- `run-plan` stages the merge at the end of a plan with every batch ✅ DONE and writes nothing: this skill shows it and writes it. A plan blocked or partial: its spec stays under `todo/`, its ids stay taken, the run that finishes it stages the merge.
- `--partial` is for a plan abandoned for good: only the objects whose batches are all ✅ DONE enter; the others stay in the spec, their ids taken while `todo/<code>/` stays.

$ARGUMENTS

Argument: the global plan. No path → `ls todo/*/*-PLAN.md`; several → ask. `<CODE>` = the plan's file name without `-PLAN.md`.

## 1. Staged already

`cctoolkit knowledge-write status --merge <CODE>` prints a context line → the merge is staged (by `run-plan`, or a stop after §3): §4. Otherwise §2.

## 2. Prepare

`cctoolkit knowledge-merge prepare <plan> [--partial]`:

- `nothing to merge: ` → say it, stop.
- `refused: batches not ✅ DONE` → say which; the plan finishes with `/cctoolkit:run-plan <plan>`, or the user asks for `--partial`. Stop.
- `collision: ` lines — an id the spec took as new, given meanwhile to another object (two branches each took the next id) → AskUserQuestion, up to four questions per call, one per collision: the id, the base's title, the spec's. Options "Renumber to <next free> (Recommended)" — the command the line gives rewrites the id in the plan folder and under the source and test roots; "Stop". Renumbered → say `git diff` shows the rewrite, then §2 again.
- any other `refused: ` → show it, stop.

## 3. Draft

`Agent`, `subagent_type: cctoolkit:knowledge-merger`, a `description`, prompt:

```
plan: <plan> · partial: <yes|no>
```

Nothing else: the agent prepares again and reads the format. Its report ends with `## MERGE STAGED — <CODE>`, or `## BLOCKED` → show the cause and its lines; the drafts stay under `<root>/.merge/<CODE>/.drafts/`: stop.

## 4. Review

Show the `+n −n <file>` lines — from the report, or from `cctoolkit knowledge-merge stage <plan>` when §1 sent here — and every `WARN` line: a rule rewritten without a line removed may keep what the feature made false. Then AskUserQuestion:

- "Write to the base (Recommended)";
- "Show the full diff first" → `diff -u <base file> <staged file>` per file (`/dev/null` for a new one), the staged files under `<root>/.merge/<CODE>/<Context>/`, an ADR under `<Context>/adr/`; then the same question without this option;
- "Stop — drafts kept" — a later `/cctoolkit:knowledge-merge <plan>` resumes at §1.

## 5. Apply

`cctoolkit knowledge-write apply --merge <CODE>`: files written, one `HISTORY.md` row per context touched — `Feature` the spec's code, `<CODE> partial` for a partial merge —, `INDEX.md` rebuilt, the staging cleared. `refused: ` → show it; a misplaced rule or a draft to fix → §3 again.

Summary: the rows written, the `WARN` lines kept. Next step: review `git diff -- <root>` and commit it with the feature. After a full merge every id of the spec lives in the base: `todo/<code>/` can go.
