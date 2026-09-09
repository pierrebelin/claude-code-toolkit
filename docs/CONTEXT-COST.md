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
rate means the threshold is mis-set, not that the rule is wrong. Lowered 300 to 120 on
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
