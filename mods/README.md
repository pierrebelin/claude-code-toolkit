# Mods

Function-hook plugins drawn inside Claude Code (terminal or desktop Code tab). Each folder is one plugin; `.claude-plugin/marketplace.json` lists them all as the `pierrebelinmods` marketplace. Mods live here and nowhere else — never under `skills/`, even though the engine would adopt a plugin folder there.

| Mod | What it shows | Opens |
|-----|---------------|-------|
| `context-band` | band above the prompt: context tokens and trend, the 150k `/clear` step and the 250k ceiling, prompt-cache expiry, turns holding a single tool call, top context contributions over 5 turns (estimates fitted to the turn's measured growth), turns since `/clear`, session cost, graphify rebuild in progress | by itself, every turn |
| `tdd-batch` | pane following the `/implement-tdd` batch sheet (`todo/<code>/<CODE>-PLAN-FX.md`): each step with its `TDD:` line, `Correction Cn` under its step, current step, assumptions count, current wave, batch duration, each running RED/GREEN/audit agent with its elapsed time (yellow past twice the usual time), the pre-audit (GREEN, or RED with the failing check count), the audit pass and its verdict (VALID, or GAPS by severity), and `## BLOCKED` reports | `/tdd-batch [sheet]`, and by itself when the `implement-tdd` skill starts |

`tdd-batch` reads the sheet through the file system, not the transcript, so it survives `/clear`; it refreshes on every Write/Edit under `todo/`, and every 10 s when the sheet's `mtime` moved. French and English sheets parse alike (`Etape`/`Step`, `COUT`/`COST`, `BLOQUÉ`/`BLOCKED`, `Hypotheses`/`Assumptions`): the same file serves every repo. Wave and blocked state come from the `tdd-test-author` / `tdd-implementer` `Agent` calls of the session, not from the sheet; the pre-audit from the Bash output of `pre-audit.sh`; the audit from the `verify-ddd-tdd` skill's result. Usual times (RED 224 s, GREEN 187 s, audit 309 s): averages of 2026-09-12, `docs/CONTEXT-COST.md`.

A `tool.call` hook reads the tool's arguments flat on `e` (`e.skill`, `e.file_path`): there is no `e.input`.

## Install

1. Copy this folder to `<repo>/.claude/mods/`.
2. Add to `<repo>/.claude/settings.json` (write it yourself: the auto-mode classifier refuses an agent enabling plugins there):
   ```json
   "extraKnownMarketplaces": {
     "pierrebelinmods": { "source": { "source": "directory", "path": "./.claude/mods" } }
   },
   "enabledPlugins": {
     "context-band@pierrebelinmods": true,
     "tdd-batch@pierrebelinmods": true
   }
   ```
3. Restart Claude Code in the repo. The first launch registers the marketplace only; the mods load from the next one, straight from `.claude/mods/` (no cached copy).

Project-scoped on purpose: `CLAUDE_CODE_PLUGIN_DIRS` is read from the process or `~/.claude/settings.json` only, never from a project's settings, so it would load every repo's copy in every session.

Check it loaded:
```bash
claude -p "ok" --max-turns 1 --debug --debug-file /tmp/mods.log >/dev/null
grep 'hooks module' /tmp/mods.log   # one "loaded" line per mod
```

## Layout of a mod

```
<mod>/
  .claude-plugin/plugin.json   name, version, description, "types": "./types/index.d.ts"
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           export const register: Register = on => { ... }
  types/index.d.ts             the $.state contract (interface PluginState)
  tests/*.test.tsx             claude plugin test
  tsconfig.json                extends the engine-laid types
  .gitignore                   .claude-plugin/types/ (laid by the engine)
```

## Writing a new mod

1. Load the `plugin-authoring` skill: it names the session's dev-mods folder and turns hot reload on. Write and iterate there.
2. `claude plugin validate <mod>` and `claude plugin test <mod>` green.
3. Copy it here without the engine-laid types: `rsync -a --exclude .claude-plugin/types/ <dev-mods>/<mod>/ mods/<mod>/`, delete the dev-mods copy (two loaded copies of one name collide), add its row to `.claude-plugin/marketplace.json` and to `enabledPlugins`.
4. `claude plugin validate mods/` to check the marketplace.

Traps met with the API: in tests, call hooks (`fs.read`, `store.get`, `ui.open`…) answer `{ value: … }`; the fallback `ui.render` returns a tree (`<Box key="engine" />`), never `null`; `$` is only passed to functions declared at module level; when the state shape changes, merge with the empty value (`{ ...EMPTY, ...stored }`), since `$.state` survives reloads; no toast, no sound.
