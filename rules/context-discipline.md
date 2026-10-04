# Context discipline

Behaviour rules, independent of the domain and of the stack. No `paths:`: loaded in every session.

**Context** — every turn resends everything accumulated: the cost follows the number of turns and the size of what you leave in them.
- **Independent calls → a single message.** Two `Read`/`Bash`/`Grep` that do not wait on each other, in two turns, pay the accumulation twice. A turn = one billed round trip, not one call. `lib/batching-nudge.sh` says so out loud after 6 mono-call turns in a row — measured on one .NET batch: 110 of 124 tool-carrying turns held a single call, and the three heaviest cost lines of that session all scale with the turn count.
- **Bounds mandatory past 120 lines or 8 kB** — `read-bounds.sh` (`PreToolUse:Read`) denies an unbounded `Read`, `lib/guard-cat-bounds.sh` an unbounded `cat`, `lib/guard-diff-bounds.sh` an unbounded `git diff`, `git show` or `git log -p` past 400 changed lines. Re-issue the **same** command verbatim to force the full read.
- An aggregate read whole is ~24k characters carried to the end of the session: locate (`graphify`, `grep -n`) then read the range. Measured on a .NET repo of this shape: `Read` is 30 % of context fill, and only a third of the calls are bounded.
- 3 files or more to go through → haiku subagent: its reads stay in its own context, only the conclusion comes back.

**Subagents**
- Read-only exploration (`Explore`, `general-purpose` when searching) → **always `model: haiku`** in the `Agent` call. Without that parameter the agent inherits the parent model: measured at 11× the cost per turn for the same locating work.
- Writing code, tests, multi-step → default model.
- **Bound the report in the delegation prompt**: format and max size. An agent's final report is re-injected whole into the main conversation — measured at 27k characters per unbounded `Explore` launch, against 3k for an agent with an imposed format.
- **Correcting a returned agent: `SendMessage` under 3 turns, a fresh `Agent` beyond.** `SendMessage` resumes the agent with its whole transcript, re-sent on every further turn; an agent stopped at 49 turns carries ~80k of context and every correction turn pays it. A fresh agent restarts at ~17k of preamble plus ~11k of reloaded rules. Measured: a 10-turn correction costs ~850k in continuation against ~350k restarted.
- **Never delegate a mechanical file operation** (restore from HEAD, add an import to N files, rename, reformat): a Bash loop does it in one turn. Measured on two sessions: a `restore 19 files from HEAD` agent cost 11 turns, an `add an import to 11 files` agent 4 more.
- **Every `Agent` call carries a `description`.** Anonymous launches were 42 % of the subagent bill over those two sessions — no name is the symptom of a delegation that was never scoped.

**Symbol or relation → graphify; text → grep.** `explain` (what a node is, what it uses, who uses it), `affected` (what breaks if you change it), `path` (how A reaches B), `query` (natural-language question). The graph only holds AST nodes: a literal, an error message, a configuration value, a `.md`/`.json`/`.csproj` are not in it — that is grep. Never chain `grep | grep | head`.

**Session hygiene** — context cost is quadratic in the number of turns: every answer is re-billed as input on every later turn.
- Hard cap of 250k context tokens: `/clear` with a resume note even mid-phase. A `/clear` costs ~51k of startup plus ~40k of re-reading, written to cache at 2×; dropping from ~250k to ~100k saves 150k re-read at 0.1× on every turn — paid back in about ten turns, against 70 to 160 for a long session.
- `/clear` on a phase change — the only mechanism that throws away the accumulated tail. Within the hour, the head (system prompt, tools, `CLAUDE.md`) is read back from cache instead of being rewritten.
- `/branch` before an uncertain exploration: a 30-turn dead end abandoned in a branch is never carried by the trunk.
- `/fork` reduces nothing — it copies the conversation into a background session. A throughput tool, not a cost tool.
- Never let `/compact` fire: it injects ~60k tokens carried to the end ($3.60 on average over 18 sessions, $12.15 at worst). `/clear` with a ten-line brief costs less.
- The cache expires after an hour of inactivity. Resuming a large session after a long pause for a small question pays the full rewrite of the prefix — measured at $90 over 30 days.
