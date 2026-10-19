---
name: knowledge-sync
description: "Use to build the business knowledge base, or align it with code changed outside the kit's flow (hotfix, refactor, another developer), or when reminded it may be behind. Run before committing."
argument-hint: "[Context[,Context]] [--since <commit>]"
---

# Knowledge sync

Aligns the knowledge base (`knowledge.root` of `.claude/kit.config.json`) with the code. Formats → `references/knowledge-format.md`.

- Nothing reaches the base without the user's confirmation, save the `sync` row of a context nothing touched (§6): it moves the mark, the summary names it. Drafts live in the staging folder `<root>/.sync/`, git-ignored; `cctoolkit knowledge-write` is the one writer of the base — never `Write` or `Edit` under it yourself, the staging excepted.
- No test tag rewritten, no rule sheet or `DESIGN.md` deleted: the base lives beside them until the switch.
- One context at a time, from extraction to `apply`: stopping halfway leaves the finished contexts in the base and nothing half-written.

$ARGUMENTS

Argument: contexts to sync (all when absent), and `--since <commit>`, passed to every scan.

## 1. Scan

`cctoolkit knowledge-scan [--context <C,…>] [--since <commit>]` — one block per context, its mode: `bootstrap` (not in the base), `incremental` (since its sync mark), `full` (in the base, no mark git still knows). Exit 3 → `cctoolkit doctor`, stop. `no context: N handler(s)` → `layout.useCase.contextDepth` or the use-case roots miss them: say so, ask whether to fix `kit.config.json` first or go on without them.

Drafts left by an interrupted sync: `cctoolkit knowledge-write status` prints something other than `nothing staged` → AskUserQuestion: resume them — §4 from its bulk step, the agent's report having gone with its session, then one §5 for every context staged — or discard them (`rm -rf <root>/.sync`, then go on).

Contexts in `bootstrap` mode → §2. The others → §3.

## 2. Framing — contexts new to the base

Show one table: context, handlers (commands, queries), rule sheets and their rules, handlers without a sheet, `DESIGN.md`, prefix (`proposed` when not in `knowledge.contexts`). One AskUserQuestion, two questions:

- **Contexts and prefixes** — "As proposed (Recommended)", "Change a prefix", "Leave contexts out". A change or an exclusion comes through the answer's text. A prefix: 2 to 6 capitals or digits, not `ADR`, unique.
- **Order** — "Smallest first (Recommended)": the first drafts come back fast and show whether the format suits before the large contexts run; "Most rule sheets first"; "Alphabetical".

Add the confirmed prefixes to `knowledge.contexts` in `.claude/kit.config.json`, the existing entries kept. `cctoolkit config validate .` — a `FAIL` on `knowledge` → fix it before going on. Then `cctoolkit knowledge-write init`: it prints the staging path.

## 3. Per context

In the order chosen, bootstrap contexts first, the others after. Each context runs §3 to §5 before the next starts.

**Mechanical first** (incremental): each `rename:` line → `cctoolkit knowledge-write rename <C> <Old> <New>`, each `retire:` line → `cctoolkit knowledge-write retire <C> <Handler>`. No agent for them.

**Nothing left** — no change beyond the mechanical ones (`no agent needed`): skip the agent, go to §5 when something was staged, else keep the context for the final `mark` (§6).

**Over budget** (`OVER BUDGET` in the scan) → AskUserQuestion: "Scan the whole context (Recommended)" — the agent runs on the inventory with the base beside it, mode `full`, scan option `--full`; or "Process the diff as is" — the packet in one agent, its cost above `knowledge.syncBudget`.

**Extraction** — `Agent`, `subagent_type: cctoolkit:knowledge-extractor`, a `description`, prompt:

```
context: <Context> · prefix: <PREFIX> · mode: <bootstrap|incremental|full> · staging: <path>
scan option: <--since <commit> | --full | none>
```

Nothing else: the agent runs the scan itself and reads the format. Sequential, never two at once: the ADR ids are shared and the user may stop between contexts.

Its report ends with `## EXTRACTED — <Context>`, or `## BLOCKED` → show the cause; AskUserQuestion: skip this context (`rm -rf <staging>/<Context>`: its ADRs go with it) or stop the sync.

## 4. Validation

Show one table from the report: `Status` (specified per kind, observed per level), conflicts, `Removed`, `Retire`, the overview's size. Then, in this order:

1. **Conflicts, one question each** — AskUserQuestion, up to four questions per call, one per conflict: the object, what the sheet states, what the code does at `path:line`. Options "The sheet is right" — the code may be a bug: note it for the summary; "The code is right". Either answer edits the staged draft: the observed line deleted, and for the code the rule's title and outcome rewritten to what the code does, its id kept. Left open (an "Other" answer, or no decision) → the object stays `observed`: it goes into `--keep` below.
2. **Removed** — the objects the agent took out of a staged file. One AskUserQuestion, multiSelect, the ones to keep (none selected = remove all): each one kept gets its base text back into the staged file, from the base file.
3. **Retire** — handlers in the base the code no longer has. Confirmed → `cctoolkit knowledge-write retire <C> <Handler>`.
4. **The rest, in bulk** — list the `medium` objects (id, title, source `path:line`), then one AskUserQuestion: "Accept high, keep medium observed, drop low (Recommended)", "Accept high and medium, drop low", "Accept all", "Keep everything observed". Run it as `cctoolkit knowledge-write validate --context <C> --accept <levels> --drop <levels> --keep <open conflicts>` (no `--accept` or `--drop` for "Keep everything observed": nothing to run). A `dangling:` line → remove the citation from the draft that holds it.

An object left `observed` does not block anything: it is in the base, marked, and comes back at the next sync of its context.

## 5. Apply

`cctoolkit knowledge-write status --context <C>`, then AskUserQuestion: "Write <C> to the base (Recommended)" / "Stop here — drafts kept for a later `/cctoolkit:knowledge-sync`". Confirmed → `cctoolkit knowledge-write apply --context <C>`: ids numbered, files written, the `HISTORY.md` row `sync <HEAD>` with its delta, `INDEX.md` rebuilt. `refused:` → fix the draft it names, apply again — a rule `belongs in <Context>/rules.md`: move it there, staged whole, and cite it on the opening line of each use case applying it. `WARN … OVERVIEW.md` → say it; the overview is condensed at the next run of this context or by hand.

Next context → §3.

## 6. Close

Contexts the scan listed and nothing touched → `cctoolkit knowledge-write mark --context <C,…>`: their mark moves on, delta `—`.

Summary: per context, the `HISTORY.md` row written, objects still `observed` per level, conflicts left open, sheets the user declared right against the code (possible bugs, with `path:line`), contexts skipped or stopped. Then the next step: review `git diff -- <root>`, and commit it with the code it describes — a sync committed apart from its code leaves the next sync a window to miss.
