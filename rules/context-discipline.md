# Context discipline

Behaviour rules, independent of the domain and of the stack. No `paths:`: loaded in every session. The measurements behind them, and the session hygiene left to the user (`/clear`, `/branch`, cache expiry): `docs/CONTEXT-COST.md`.

**Context** — every turn resends everything accumulated: the cost follows the number of turns and the size of what you leave in them.
- **Bounds past 120 lines or 8 kB** (400 lines / 24 kB in a subagent) — `read-bounds.sh` denies an unbounded `Read`, `lib/guard-cat-bounds.sh` an unbounded `cat`. Re-issue the **same** command verbatim to force the full read: right when you are about to edit the file.
- A file read whole is carried to the end of the session: locate (`graphify`, `grep -n`) then read the range.
- 3 files or more to go through → subagent: its reads stay in its own context, only the conclusion comes back.

**Subagents**
- **Every `Agent` call names its model** unless the agent file pins one: without the parameter the agent inherits the parent model. Read-only exploration (`Explore`, `general-purpose` when searching) → `haiku` by default; `sonnet` when the search takes judgment — weighing a design, a convention spread over several contexts — and a haiku miss would cost a second spawn.
- Writing code, tests, multi-step → default model.
- **Correcting a returned agent: `SendMessage` under 3 turns, a fresh `Agent` beyond.** `SendMessage` resumes the agent with its whole transcript, re-sent on every further turn; a fresh agent restarts from its preamble alone.
- **Never delegate a mechanical file operation** (restore from HEAD, add an import to N files, rename, reformat): a Bash loop does it in one turn.

**Symbol or relation → graphify; text → grep.** `explain` (what a node is, what it uses, who uses it), `affected` (what breaks if you change it), `path` (how A reaches B), `query` (natural-language question). The graph only holds AST nodes: a literal, an error message, a configuration value, a `.md`/`.json`/`.csproj` are not in it — that is grep. Never chain `grep | grep | head`.
