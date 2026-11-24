---
name: knowledge-sync
description: "Use to build the business knowledge base, or align it with code changed outside the kit's flow (hotfix, refactor, another developer), or when reminded it may be behind. Run before committing."
argument-hint: "[Context[,Context]] [--since <commit> | --full]"
---

# Knowledge sync

Aligns the knowledge base (`knowledge.root` of `.claude/kit.config.json`) with the code. Formats → `references/knowledge-format.md`.

- **The code is the truth.** Rules added, changed or gone in the code are written to the base without a question: a rule sheet the code contradicts loses (the report names it, a possible bug), a rule whose behaviour is gone leaves the base, a handler gone is retired. The review is the report and `git diff -- <root>`, before the commit.
- The one question: the prefix of a context new to the base (§2) — its ids keep it for good.
- The work is the `run-sync` workflow (`workflows/run-sync.js`): only the contexts changed since their sync mark get an agent, one per part under `knowledge.syncBudget`, one context after the other; validated by level (high accepted, medium kept `observed`, low dropped), written by `cctoolkit knowledge-write`, the one writer of the base — never `Write` or `Edit` under it yourself.
- No test tag rewritten, no rule sheet or `DESIGN.md` deleted: the base lives beside them until the switch.

$ARGUMENTS

Argument: contexts to sync (all when absent), and `--since <commit>` or `--full`, passed to the workflow.

## 1. Scan

`cctoolkit knowledge-scan [--context <C,…>] [--since <commit>]` — one block per context, its mode: `bootstrap` (not in the base), `incremental` (since its sync mark), `full` (in the base, no mark git still knows). Exit 3 → `cctoolkit doctor`, stop. `no context: N handler(s)` → `layout.useCase.contextDepth` or the use-case roots miss them: say it in one line and go on — the report repeats it.

No `bootstrap` context without a prefix in `knowledge.contexts` → §3.

## 2. Framing — contexts new to the base

Show one table: context, handlers (commands, queries), rule sheets and their rules, handlers without a sheet, `DESIGN.md`, proposed prefix. One AskUserQuestion: "As proposed (Recommended)", "Change a prefix", "Leave contexts out" — a change or an exclusion comes through the answer's text. A prefix: 2 to 6 capitals or digits, not `ADR`, unique.

Add the confirmed prefixes to `knowledge.contexts` in `.claude/kit.config.json`, the existing entries kept. `cctoolkit config validate .` — a `FAIL` on `knowledge` → fix it before going on. A context left out has no prefix: the workflow skips it.

## 3. Run

Skill `cctoolkit:run-sync`, argument as text: the contexts named and `--since` / `--full` as the user gave them. Say in one line that it runs in the background and that `/run-lot-pane` follows it, `/knowledge-pane` shows the drafts. Then wait for its result: never run a scan, an agent or a `knowledge-write` of your own beside it.

## 4. Report

From the workflow's result, in `language.docs`, per context whose `state` is not `marked`:

- **Rules changed** — its `objects` lines verbatim (`+id — title` new, `~id — title` changed, `-id — title` gone), under the `row`.
- **Code against the sheet** — each of `conflicts`: the object, what the sheet states, what the code does, `evidence`. The base now says what the code does; a sheet that was right means a bug in the code.
- **Removed** — each of `removed` with its reason and evidence; **Retired** — `retired`.
- **Left observed** — the `status` lines (`kit:observed medium` stays in the base, marked, and comes back at the next sync); **Not covered** — `notCovered`; `warnings`.
- `blocked`, `refused`, `skipped` → its `reason`: the drafts stay in the staging, the next `/cctoolkit:knowledge-sync` takes them up.

Then one line for the contexts `marked` (nothing changed, their mark moved), `unassigned` handlers when not 0, and the result's `next`: review `git diff -- <root>` and commit it with the code it describes — a sync committed apart from its code leaves the next sync a window to miss.
