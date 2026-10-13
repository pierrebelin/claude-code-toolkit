# cctoolkit — reading the kit's instructions

The kit's skills, agents and references ship in the `cctoolkit` plugin, outside this repo. Three conventions bind them to it:

- **`{{PRODUCT}}`** in a command, path or namespace of a skill, agent or reference = the `product` key of `.claude/kit.config.json`. Read it once; key unset = the single match of the glob (`src/*.Application`).
- **`cctoolkit <command>`** runs a kit script or tool (`cctoolkit pre-audit FX <sheet>`, `cctoolkit doctor`, `cctoolkit list`). It is on the Bash PATH while the plugin is enabled. Run it from the repo root.
- **A kit path** — `skills/…`, `agents/…`, `hooks/…`, `docs/…` cited without `.claude/` — lives under `cctoolkit root`: read `$(cctoolkit root)/skills/implement-tdd/references/test-scope.md`. Never edit there: the plugin cache is replaced on every update.

Skills and agents are namespaced: `/cctoolkit:implement-tdd`, `subagent_type: cctoolkit:tdd-implementer`. A bare name in prose (`/implement-tdd`, `tdd-implementer`) designates the namespaced one — except `tests-*`: the test-authoring skills are the repo's own, copied from the layout preset into `.claude/skills/` by `/cctoolkit:kit-init`, so `/tests-unit-tests`, or `tests-unit-tests` in a sheet's `skill` field, is invoked without prefix.

What belongs to the repo stays in `.claude/`: `kit.config.json`, `rules/`, the `skills/tests-*`, `settings.json`.
