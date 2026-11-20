# Graphify — archived in 2.17.0

The kit no longer ships Graphify. These files are kept for the record only: nothing wires,
calls or tests them, and they are not maintained.

## Why

Measured on two installed .NET repos over 60 days of transcripts (2026-11-20):

| | repo A | repo B |
|---|---|---|
| `graphify explain` / `query` / `affected` / `path` | 39 / 13 / 13 / 0 | 4 / 1 / 4 / 0 |
| `Grep` tool calls | 859 | 298 |
| `graphify-out/graph.json` | 116 MB | 35 MB |

About 0.2 % of tool calls, against a graph to rebuild on every `Stop`, a binary to install,
a worktree link and a doctor check. The agents locate symbols with a scoped `grep` instead.

## What was here

| File | Was |
|------|-----|
| `hooks/graphify-autosync.sh` | `Stop` hook: rebuilt the graph when the tree moved (`mkdir` lock `/tmp/graphify-autosync.lock`, anti-shrink guard, log `/tmp/graphify-hook.log`) |
| `hooks/worktree-graphify-link.sh` | `SessionStart` hook: linked the main tree's `graphify-out/` into a linked worktree |
| `lib/graphify-bin.sh` | resolved the binary: `GRAPHIFY_BIN`, else the PATH, else `~/.local/bin/graphify` |
| `lib/graphify-freshness.sh` | counted the sources newer than `graph.json` (statusline badge, doctor) |
| `lib/graphify-query-filter.sh` | `graphify query` profile of `lib/rewrite-piped-filter.sh` |
| `evals/graphify-autosync.json` | the autosync's recorded cases |

Also removed in the same change: the doctor's `binary graphify` and `graphify graph` checks, the
statusline's `[graph +N]` badge, the `context-band` mod's `graph rebuilding` indicator, the
`graphify query|explain|path` permissions of `templates/settings.json`, and every instruction
pointing agents and skills at the graph. The history is in `CHANGELOG.md` § 2.17.0 and in git.
