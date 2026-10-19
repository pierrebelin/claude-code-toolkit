# Context discipline

Behaviour rules, independent of the domain and of the stack. No `paths:`: loaded in every session. The measurements behind them, and the session hygiene left to the user (`/clear`, `/branch`, cache expiry): `docs/CONTEXT-COST.md`.

**Context** — every turn resends everything accumulated: the cost follows the number of turns and the size of what you leave in them.
- A file read whole is carried to the end of the session: locate (`graphify`, `grep -n`) then read the range. Past 120 lines or 8 kB (400 / 24 kB in a subagent) an unbounded read is denied; re-issuing the same command forces it — right when you are about to edit the file.
- 3 files or more to go through → subagent: its reads stay in its own context, only the conclusion comes back.

**Subagents**
- **Every `Agent` call names its model** unless the agent file pins one. Read-only exploration (`Explore`, `general-purpose` when searching) → `haiku` by default; `sonnet` when the search takes judgment — weighing a design, a convention spread over several contexts — and a haiku miss would cost a second spawn.
- Writing code, tests, multi-step → default model.
- **Correcting a returned agent: `SendMessage` under 3 turns, a fresh `Agent` beyond.** `SendMessage` resumes the agent with its whole transcript, re-sent on every further turn; a fresh agent restarts from its preamble alone.
- **Never delegate a mechanical file operation** (restore from HEAD, add an import to N files, rename, reformat): a Bash loop does it in one turn.

**Symbol or relation → graphify; text → grep.** `explain` (what a node is, what it uses, who uses it), `affected` (what breaks if you change it), `path` (how A reaches B), `query` (natural-language question). The graph only holds AST nodes: a literal, an error message, a configuration value, a `.md`/`.json`/`.csproj` are not in it — that is grep. Never chain `grep | grep | head`.
