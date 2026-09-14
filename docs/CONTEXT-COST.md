# Context cost — measurements and protocol

Opened on demand. `CLAUDE.md` keeps only the standing rules; what follows is the evidence
behind them and the checks that keep them honest.

## Why it is quadratic

Every turn resends everything accumulated: the cost follows the number of turns and the size
of what you leave in them. An aggregate read whole is ~24k characters carried to the end of
the session. A 40k-token `Read` at turn 5 of a 100-turn session is re-read 95 times.

Measured on two .NET repos of this shape: `Read` is ~30 % of context fill, only a third of calls
bounded. Re-measure per repo with `turn-batching-check.py` before quoting those figures.

## Reading

- `offset`/`limit` **mandatory past 120 lines** — the `read-bounds.sh` hook (`PreToolUse:Read`)
  denies an unbounded `Read` and records it, **per agent** (`session_id` + `agent_id`). Re-issuing
  the **same** `Read` verbatim lets it through: that is how you force a full read when you
  genuinely want one. The pass belongs to the agent that asked for it — a subagent's forcing no
  longer exempts its siblings or the main chain.
- Locate first (`graphify`, `grep -n`), then read the range.
- 3 files or more to go through → haiku subagent: its reads stay in its own context, only the
  conclusion comes back.

## Batching

**Independent calls → a single message.** Two `Read`/`Bash`/`Grep` that do not wait on each
other, in two turns, pay the accumulation twice. A turn = one billed round trip, not one call.

## Weekly check

```bash
python3 scripts/turn-batching-check.py --compare .claude/context-baseline.json
```

Fill per tool, share of bounded `Read`s, `read-bounds` denials and **forcings**. A high forcing
rate means the threshold is mis-set, not that the rule is wrong. Since 2026-09-12 the script
also prints the **call that follows a refusal** on the main chain — bounded Read, forcing,
`bulk-read`, subagent, `cat`, other Bash — and the number of `bulk-read` calls with the bytes
they kept out of the context. That is the production form of Spotify's behavioural evals
(`plugins/shunt/evals/evals.json`: "blocked by the hook, then invokes bulk-read"): it measures
the path actually taken instead of asking a model whether it would take it. First reading over
7 days: 17 follow-ups, 10 of them "Bash autre" — refine the classifier as patterns appear. Lowered 300 to 120 on
2026-09-08: at 300 the hook only caught the giant aggregates, while 42 of 59 unbounded Reads
that day were on files of 23 to 303 lines. The cost was the count, not one huge read.

`.claude/context-baseline.json` does not ship with the toolkit: it holds the numbers of one repo.
Create it on installation, from the transcripts that predate the hook going live:

```bash
python3 scripts/turn-batching-check.py --until <YYYY-MM-DD> --save-baseline .claude/context-baseline.json
```

Re-freeze it with `--save-baseline` only after a deliberate change of method — never to erase a
regression.

## Session hygiene

- `/clear` on a phase change — the only mechanism that throws away the accumulated tail. Within
  the hour, the head (system prompt, tools, CLAUDE.md) is read back from cache instead of being
  rewritten.
- `/branch` before an uncertain exploration: a 30-turn dead end abandoned in a branch is never
  carried by the trunk.
- `/fork` reduces nothing — it copies the conversation into a background session. A throughput
  tool, not a cost tool.
- Never let `/compact` fire: it injects ~60k tokens carried to the end ($3.60 on average over 18
  sessions, $12.15 at worst). `/clear` with a ten-line brief costs less.
- The cache expires after an hour of inactivity. Resuming a large session after a long pause for
  a small question pays the full rewrite of the prefix — measured at $90 over 30 days.
- `/effort medium` for grep/read/refactor; `high` for complex architecture/debug.

## Auditing a session

The `token-usage` skill rebuilds cost and attribution from the transcripts:

```bash
python3 ~/.claude/skills/token-usage/src/cc-usage.py --session <id-prefix> --top 20
```

Subagents run their own context, outside the main chain — never conclude on a fan-out session
without reading their table.

## Where the bill goes (30 days to 2026-09-12)

`cc-usage.py --days 30 --project Configurator.Back --models`, list price, 157 sessions,
$1 333. Cache reads priced at 10 % of input, writes at 125 %.

| Term | Tokens | Share |
|---|---|---|
| Cache read — the context replayed on every turn | 1.7 G | ~60 % |
| Cache write | 39 M | ~15 % |
| Output | 9.4 M | ~15 % |
| Sonnet + Haiku, the subagents | — | ~5 % |

Opus 5 carries 94 % of it; the 1M-context variant alone 65 % ($865), and 18 % of requests went
past 200k tokens of prompt. The lever is the size of the replayed prefix times the number of
turns — what the bounds, the batching and `/clear` act on. Output is a second-order term here,
and the TDD agents already run on Sonnet: a code-generation shunt in Spotify's style would cap
out around 15 %.

## One-shot worker against a subagent

Spotify's shunt plugin routes I/O to a tool-less worker model and reports 82-94 % on single
reads of 1 281 to 7 408 lines. Its 350-line gate would have caught none of the 42 unbounded
Reads measured here on 2026-09-08 (23 to 303 lines), and 193 of the 3 463 `.cs` files past that
size are almost all EF `.Designer.cs` migrations. The idea transfers, the threshold does not.
`.claude/tools/bulk-read` is the local worker; measured 2026-09-12 → `TOOLING.md`. The saving
is not in dollars (Haiku was $5.60 of the 30 days) but in what never enters the main chain.

## Instruction loads

`context-log.tsv`, 2026-09-09 to 2026-09-12 (three days): ~573k tokens of instruction files
loaded — 276k by `nested_traversal`, 189k by `path_glob_match`, 108k at `session_start`.
`Configurations/CLAUDE.md` (17.7 kB, 4.4k tokens) loaded 33 times, 146k tokens, more than the
root `CLAUDE.md` (2.9k × 38 = 111k); `Keyrings/CLAUDE.md` (25.9 kB) 9 times, 59k. Before
cutting anything, `context-log.sh` logs `agent_id` since 2026-09-12 so `context-report.sh` can
split the main chain (Opus) from the subagents (30× cheaper per kB). Decide on the split, not
on the total.

## Wall-clock of a batch (2026-09-12)

Measured on 2026-09-12 from the transcripts' timestamps (the one-off `tdd-timing.py`
script that produced it was removed the same day: no hook or skill ever called it), 7 `/implement-tdd` sessions
(2026-09-09 to 09-11), 58 subagent runs, 30 audit verdicts. Tool time — builds, tests,
scripts — is **12 to 44 %** of a session's wall-clock; the rest is model latency in the
orchestrator (Opus, 100 to 300 round trips per batch) and in the subagents, plus the user's
answers to `AskUserQuestion` (1.5 to 13 min each). Builds are not the bottleneck: 3 to 12 s
incremental inside the agents.

| Agent | Runs | Wall avg | Round trips avg | Tool time | Model latency per round trip |
|---|---|---|---|---|---|
| `tdd-test-author` | 22 | 224 s | 13.1 | 16 s | 15.8 s |
| `tdd-implementer` | 19 | 187 s | 23.6 | 38 s | 6.3 s |
| `ddd-tdd-auditor` | 13 | 309 s | 10.3 | 46 s | 25.5 s |

Per batch: 2.2 audits (first pass + `reprise`), 10 to 28 min. Of 30 verdicts, 27 ECARTS, and
the recurring first-round causes were mechanical: "N identifiants jamais classés" (8, Bloquant),
`///` rewritten in production (5), `.claude/` hunks outside the batch (4), a trait citing a rule
absent from the handler table, an unclosed sheet, a stale feature index — every one of them
decidable by a script, and every one produced *after* the audit by `closing.md`, which then ran
after the verdict. Two sessions ran the whole `IntegrationTests` suite: 602 s each.

Changes made on 2026-09-12, to be measured against the table above after five batches:

1. `scripts/pre-audit.sh` gates the fork — ids, comments, scope, traits, closed sheet, whitespace.
2. `closing.md` §1-2 (sheet, handler `CLAUDE.md`, index) run before the gate, not after the verdict.
3. The orchestrator's hunk-by-hunk diff re-read at closing is removed; the auditor's walk stays.
4. `## RED` carries `Diff production`, `## GREEN` carries `Diff tests`: the orchestrator no
   longer opens the diff to check test-first integrity.
5. The RED contract names the test class, the fixture and the methods; `tdd-test-author` runs at
   `effort: low`. Watch its round trips and its share of `## BLOQUÉ`; back to `medium` if the
   RED-on-assertion rate drops.
6. RED(n+1) is launched in the same message as GREEN(n) when test files are disjoint and no stub
   is shared. Watch for `CS2012` / `file in use` build collisions in the agent reports.
7. `guard-integration-filter.sh` denies a whole `IntegrationTests` run.

8. Every feature index `CLAUDE.md` under `Application/` (33 files) reduced to its intro plus
   one pointer line to `DESIGN.md`; use-case tables, `N règles, M testées` counters, services
   and aggregate lists dropped — `ls` and `graphify explain` carry that. Chapters moved to
   `DESIGN.md` beside the index, never auto-loaded. `rules-coverage.py --fix-index`, the
   closing step and the checklist item that maintained the counters are gone with them (2
   "index périmé" deviations on 30 verdicts). Check after five batches: `context-report.sh`
   should show `DESIGN.md` as a few bounded `Read`s and the indexes' `nested_traversal` tokens
   divided by ~10; if the reads compensate the loads, move the chapters back — nothing left
   the folder.
9. `implement-tdd/SKILL.md` 26.7 kB → 21.2 kB (~1.4 k tokens less per turn of a batch): every
   measurement and reason moved to `references/rationale.md`, never loaded during a batch. The
   rest is contract templates and rules — cutting further cuts instructions.
10. Sheet ticks: one `Edit` per behaviour after COUT, one per file at closing.

Second round, same day, from the transcripts of sessions `7df05023` (lot F4, 2026-09-10, 138
turns, $26.8), `123817d9` and `eb3b18a4` (plans) and the subagent runs of 2026-09-10:

11. **`/implement-tdd` takes the plan path as text.** Launched as `lot4 de @todo/…-PLAN.md`, the
    harness attached the whole global plan (20 to 28 kB, 6 to 8 k tokens) at turn 0 of all eight
    batch sessions from 2026-09-07 to 09-10: the first request's `cache_creation` reads 31 to 37 k
    tokens against 16 to 17 k for a plain session, and the skill then read the same plan again by
    section. The argument form and the `@` warning are in `SKILL.md` §1; no `UserPromptSubmit`
    guard is written.
12. The orchestrator no longer reads `common-rules.md` (9.4 kB) at the start of a batch, and
    `conventions.md` (3.2 kB) only on a doubtful cost: ~3 k tokens per turn over 100 to 300 turns.
    §4.5 and the first-run-green rule are restated in `SKILL.md`.
13. **Batch sheets carry an `## Ancrages` table** — test class, fixture, `CoreTests` builders and
    doubles, production files, contract snapshot — written by `/plan-implementation` from a haiku
    inventory. Measured on `7df05023`: 19 `rtk proxy grep`, 16 `sed` and 7 `cat` over `tests/` in
    the Opus chain, 73 kB, ≈ 18 k tokens, ≈ $4, to rebuild those paths for the contracts.
14. `/plan-implementation` step 1.3 delegates the inventory to one haiku `Explore` under a
    60-line contract. Measured on plan sessions `123817d9` (grep 54 kB, cat 21 kB, sed 16 kB, no
    subagent, no graphify) and `eb3b18a4` (one `cat` loop over five handler `CLAUDE.md`, 7.4 k
    tokens in one turn).
15. `plan-implementation/SKILL.md` 13.8 → 13.6 kB: the Approach/Workflow duplicate and the
    Pitfalls/Self-validation duplicate merged (−1.7 kB) absorb the inventory contract and the
    anchors paragraph (+1.5 kB). `implement-tdd/SKILL.md` 21.1 → 22.8 kB for items 11 to 13,
    against the 12.6 kB of references it stops reading.
16. Agents: a new file is one `Write`, edits on distinct files share a message. Measured
    2026-09-10, one `tdd-implementer` run of 108 turns: 19 consecutive `Edit` turns and 14
    `rtk grep` (42 kB); one `tdd-test-author` run of 55 turns: 7 consecutive `Edit` turns.
17. **COUT read off the syntax tree.** `scripts/access-cost.py` (ast-grep rules under
    `scripts/access-cost/rules/`) lists the awaited Infrastructure calls of the files
    `tdd-implementer` touched, flags loop, lambda and in-memory filter, and prints the `Cost`
    line its `## GREEN` copies; `audit-capture.sh` runs it `--diff` for the `Cost` axis, added
    lines told from `(pre-existing)` ones. Measured on 12 batch sessions (2026-09-07 to 09-12):
    36 `## GREEN`, 34 orchestrator `Read` under `src/` right after them, 117 kB carried to the
    end of each batch plus the layer rules those reads attach — the orchestrator now validates
    one line and never opens the handler. Sweep of `src/` that day: 19 awaited member calls
    inside loops in Application, 6 handlers with a genuine N+1 (`TransferConfiguration` also
    saves inside its loop) — pre-existing debt the script labels, never a batch's deviation.
    Check after five batches: `Read` under `src/` between a `## GREEN` and the next `Agent`
    call should be zero, and the `Coût` axis should stop appearing in `reprise` verdicts.

Seen, not acted on: the `skill_listing` attachment is 12.3 kB per session (≈ 3 k tokens on every
turn of every session), every plugin skill description included; a plan and a batch run in one
session (`18756f1b`: 85 turns, `Read` 44.7 k tokens carried through the batch) — a guard was
proposed and not decided.

Not done: a lighter `reprise` auditor (Sonnet or `effort: medium`); `/effort medium` for the
orchestrator; a rewrite module forcing suite output to a file; the RED contract's test design
(method names, scenarios) produced by `/plan-implementation`. Declined on 2026-09-12. The
`## Ancrages` table of item 13 is not that: paths only, the design stays with the orchestrator.
