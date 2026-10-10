# Hooks

Wired in `hooks.json`, every command written `bash "${CLAUDE_PLUGIN_ROOT}/hooks/x.sh"`. The modules these hooks call live in [`lib/`](../lib/README.md).

| Hook | Event | Role | Blocking |
|------|-------|------|----------|
| `bash-dispatch.sh` | `PreToolUse:Bash` | single entry point: parses the payload once, then runs `lib/guard-git.sh`, `lib/guard-cat-bounds.sh`, `lib/guard-diff-bounds.sh`, `lib/guard-integration-filter.sh`, `lib/rewrite-piped-filter.sh` (twice: profiles `graphify-query` then `git-grep`) and `lib/rewrite-rtk.sh` in that order. First module that answers wins, so a rewrite is never rewrapped by the RTK rewrite; `lib/guard-graphify-grep.sh` sat in second position until 2026-09-13 — it ran `graphify explain` on every symbol-looking grep to decide, 2.25 s a call for one substitution over 60 sessions; the two output filters sit before it because `rtk hook claude` has no rewrite of its own for `graphify` or `git grep`. `lib/batching-nudge.sh` runs outside that chain: it decides nothing, and its advice is grafted onto whatever the chain answers | depends on the module |
| `explore-guard.sh` | `PreToolUse:Agent` | delegation guard, two checks in cost order: every `Agent` call carries a `description`; the model is chosen rather than inherited — explicit on `Explore` and `general-purpose`, `haiku` by default but never forced (required on `Explore` until 2026-10-09). Since 2026-09-17 the check reaches every spawn: a call with no `subagent_type` is read as `general-purpose` — it used to fall through the type filter and inherit Opus, which is where the mechanical refactors were billed — and a custom agent is asked for a model unless its own file pins `model:` in frontmatter. When both pass it appends the report contract to `tool_input.prompt` (caveman-ultra, 20-line cap, 40 for `Plan`; a prompt stating its own size — `60 lines max` — keeps it): `additionalContext` would land in the caller's context, only the prompt reaches the agent. Own hook: a spawn costs ~55k startup tokens, a grep ~300, and the agent's final report is re-injected whole into the caller | yes |
| `implement-tdd-guard.sh` | `UserPromptSubmit` + `PreToolUse:Skill` | denies a second `/implement-tdd` launch in a session that already closed a batch — it reads the transcript for the closing literal of the skill (French and English wordings both matched). Correction mode passes. Re-issuing the identical launch passes through; the chained batch would otherwise pay the whole accumulated context of the previous one, measured at 1.9x the input at equal request count. Also denies a launch at effort `high`, `xhigh` or `max`, reading the level the statusline dropped in `$TMPDIR`: the orchestrator runs 100 to 180 turns at 8.6 s each there, and only `/effort` can change it | yes, once per closed batch and once per launch at too high an effort |
| `read-bounds.sh` | `PreToolUse:Read` | denies a `Read` with no `offset`/`limit` on a file past 120 lines or 8 kB (`CLAUDE_READ_BOUNDS_THRESHOLD`, `CLAUDE_CAT_BOUNDS_BYTES`) — 400 lines or 24 kB in a subagent since 2026-10-09 (`CLAUDE_READ_BOUNDS_SUBAGENT_THRESHOLD`, `CLAUDE_READ_BOUNDS_SUBAGENT_BYTES`) — and records the denial per agent. Re-issuing the identical `Read` passes through — that is how a full read is forced; the pass applies to the agent that asked for it, not to its siblings or its parent. Skips images, PDFs and notebooks. | yes, once per file and agent |
| `affected-blast-radius.sh` | `PreToolUse:Edit\|Write` | **paused 2026-10-09 to 2026-10-23** for a comparison — 300 injections, 210 kB, no measurable effect; `CCTOOLKIT_BLAST_RADIUS=1` turns it back on. on a Domain aggregate or value object (`layout.aggregate`; clean-architecture: `*.Domain/*/Aggregates/*.cs`, `.../ValueObjects/*.cs`), runs `graphify affected` on the edited type and injects the per-project rollup as `additionalContext` — never the raw output, 421 lines / 65 kB on a central id against 8 rolled-up lines. Resolves the ambiguity graphify 0.9.58 introduced by path-qualifying node ids, using the edited file as its own disambiguator, and stays silent when the symbol still does not resolve. Once per (agent, symbol) | no |
| `handler-claude-md-check.sh` | `PostToolUse:Edit\|Write` | cross-checks the rules table (`kit:rules`) of the rule sheets (`layout.useCase`, `layout.ruleSheet`) against the tags the tests carry (`testTag` adapter); reports untested rules and orphan tests. Speaks through `hookSpecificOutput.additionalContext`: on `PostToolUse`, plain stdout at exit 0 reaches the transcript only, never the model — 231 reports went unread that way before 2026-09-13 | no, warning only |
| `graphify-autosync.sh` | `Stop` | rebuilds the graph if the working tree moved. `mkdir` lock, anti-shrink guard (auto `--force` if the drop is ≤ 2 %) | no |
| `subagent-report-shape.sh` | `SubagentStop` | checks the SHAPE of a `## RED` / `## GREEN` report — required lines, observed exit code on the `Command` line, `| Test | Case covered |` table — and blocks with a reason so the agent re-emits a complete report from the context it still holds, instead of costing the orchestrator a turn plus a `SendMessage` (1 to 4 per batch). Form only: a non-empty diff or an unexpected exit code is the orchestrator's call, never the agent's. `stop_hook_active` closes the loop; `## BLOCKED` and every other agent pass untouched | yes, once per malformed report |
| `worktree-graphify-link.sh` | `SessionStart` | symlinks the main working tree's `graphify-out/` into a linked worktree. graphify resolves its graph only at `<cwd>/graphify-out/graph.json` — no parent lookup, no env var — so `query`, `explain`, `path` and `affected` all fail in a worktree without it. No-op outside a linked worktree | no |
| `session-cleanup.sh` | `SessionStart` | drops this session's substitution and read-denial memories (glob, subagents included), purges what is older than two days; migration: gives a caveman flag the removed `caveman-skill-ultra.sh` left at `ultra` its saved mode back | no |
| `context-log.sh` | `InstructionsLoaded` | logs every instruction file entering the context (path, bytes, ~tokens, load reason) into `.claude/context-log.tsv` | no, observes only |
| `clear-nudge.sh` | `UserPromptSubmit` | reads the last assistant `usage` in the transcript and, at every 150k-token step of replayed context (`CLAUDE_CLEAR_NUDGE_STEP`), appends one line of `additionalContext` asking the model to tell the user that `/clear` is due if the phase is done | no |

`tools/doctor` also runs on `SessionStart` (`--quiet`): see [`tools/README.md`](../tools/README.md).

## Dependencies

| Tool | Hooks | If missing |
|------|-------|------------|
| `jq` | statusline, `bash-dispatch.sh`, `graphify-autosync.sh`, `session-cleanup.sh`, `clear-nudge.sh` | silent statusline, no grep substitution |
| `python3` | `lib/batching-nudge.sh`, `lib/kit_config.py` (hence `affected-blast-radius.sh`), `handler-claude-md-check.sh`, `subagent-report-shape.sh`, `context-log.sh`, `clear-nudge.sh` | inert hooks, exit 0 |
| `graphify` (`~/.local/bin/graphify`) | `affected-blast-radius.sh`, autosync, freshness | no blast radius on an aggregate edit (the hook exits 0 in silence); autosync logs "graphify not found, skip" and exits 0 |
| `rtk` | `lib/rewrite-rtk.sh` | no rewrite |
| `caveman` plugin (or its two node hooks kept outside it, see `docs/TOOLING.md`) | statusline badge | no badge |

Every hook exits 0 when its dependency is missing, except `lib/guard-git.sh`, `explore-guard.sh`, `read-bounds.sh` and `implement-tdd-guard.sh` which block by design. Removing the `graphify-*` scripts and `read-bounds.sh` from `hooks.json` (in a fork) leaves a coherent kit; `bash-dispatch.sh` keeps working with any subset of its modules present.

## Adapting

| File | What to change |
|------|----------------|
| `../lib/graphify-freshness.sh` | scanned dirs and extensions: indexed languages and folders |
| `../lib/guard-integration-filter.sh` | `dotnet test`, `IntegrationTests`: the slow suite and its filter flags — inert on another stack |

Every hook and script resolves the repo through `lib/project-root.sh` / `kit_config.project_root()` — `$CLAUDE_PROJECT_DIR`, else the git top level of the working directory — never from its own location. The `graphify-*` scripts accept `GRAPHIFY_REPO` to target another checkout.

A hook change comes with a case in [`evals/`](../evals/README.md).
