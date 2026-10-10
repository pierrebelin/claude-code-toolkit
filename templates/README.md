# templates

What a plugin cannot set itself. `/cctoolkit:kit-init` merges these into the repo's `.claude/`; from then on they are the repo's own, never read from here.

| File | Role |
|------|------|
| `settings.json` | permissions, env, statusline — merged into the repo's. Its marketplace and plugin enablement are never merged: `claude plugin marketplace add … --scope project` and `claude plugin install … --scope project` write them (README § Installation) |
| `statusline-command.sh` | git branch, model, context %, effort, 5 h rate limit, caveman badge, graph lag; also drops the current effort in `$TMPDIR` for `implement-tdd-guard.sh` |
| `claude.gitignore` | the runtime files the hooks write inside `.claude/` |
| `settings.local.json` | startup trim, opt-in — see below |

`settings.json` is a shareable template: no one-off session grant, no machine path. Its `allow` list covers the strict minimum (`Edit`, `WebSearch`, `cctoolkit`, `dotnet`, `rtk`, `gh pr`, `xargs`, `python3`, `graphify query|explain|path`, `git check-ignore`). Broad grants — `Bash(rm *)`, `Bash(cd *)` — are deliberately excluded. Tools specific to a repo go into that repo's `permissions.allow`.

## Startup trim

Merge the four keys of `settings.local.json` into `<repo>/.claude/settings.local.json` (create it if missing; it is gitignored). Use the `Edit` tool, never a script: the auto-mode classifier refuses a script on that file. The `syncClaudeAi*` keys are never read from `.claude/settings.json`, only from `settings.local.json` or the user settings.

| Key | Drops | Keep it off when |
|---|---|---|
| `disableClaudeAiConnectors` | every claude.ai MCP connector — all or nothing | the repo relies on one of them |
| `syncClaudeAiSkills: false` | the synced `anthropic-skills:*` (docx, pdf, xlsx, pptx, browser…) — `skillOverrides` does not reach them | a skill or spec flow produces or reads those formats |
| `syncClaudeAiPlugins: false` | the synced plugins (`cowork-plugin-management`) | a workflow uses them |
| `disableWorkflows` | the `Workflow` tool (~5k tokens), and with it `/cctoolkit:run-lot` and the `ultracode` keyword | the repo uses any of them |

Check usage before cutting: a key whose feature the repo depends on stays out. Measure from the repo root before and after, then validate the file with `python3 -m json.tool .claude/settings.local.json`:

```bash
claude -p "ok" --output-format json --max-turns 1 </dev/null \
  | python3 -c "import json,sys;u=json.load(sys.stdin)['usage'];print(u.get('input_tokens',0)+u.get('cache_creation_input_tokens',0)+u.get('cache_read_input_tokens',0))"
```

Measured on a .NET repo of this shape: 35.4k → 22.6k tokens per `claude -p` startup (−36 %), reloaded on every `/clear`.
