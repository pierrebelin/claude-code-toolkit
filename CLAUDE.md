# CLAUDE.md

## What this repo is

A **Claude Code plugin**, `cctoolkit`, for a DDD/TDD clean-architecture repo — this checkout is both the plugin and its marketplace (`.claude-plugin/`). No application code: **nothing to build, nothing to test**. The work here is editing `.md`, `.sh` and JSON files.

Workflow and installation: **[README.md](README.md)**. What each brick does and how: the README of its folder (`skills/` — agents included —, `hooks/`, `lib/`, `scripts/`, `tools/`, `presets/` — `rules/` and `kit.config.json` included —, `templates/`, `evals/`, `mods/`). Do not duplicate those explanations here. `agents/` and `rules/` never get a README: the plugin loads every `agents/*.md` as an agent, `/cctoolkit:kit-init` copies every `rules/*.md` into the repo.

## Anonymisation — do not break it

The product name is the `{{PRODUCT}}` placeholder in the instruction files, rules and docs — never substituted in the kit: `rules/cctoolkit.md` tells the model to read it from `kit.config.json`, and `/cctoolkit:kit-init` substitutes it only in the rules it copies into a repo. Hooks, `lib/` and `scripts/` carry none — they read `product` from `kit.config.json`. Examples rest on a fictional domain: aggregates `Product` / `ModuleDiagram`, sub-entities `ProductItem` / `DiagramNode`, bounded contexts `Catalog` / `Studio`. Never introduce a real project, namespace or aggregate name. A change coming back from an installed repo goes through `bash scripts/kit-diff.sh <repo>` first: it flags the repo's product and vocabulary in what would flow back.

## Language

**English everywhere in the kit** — instruction files (`skills/`, `agents/`, `rules/`), documentation (`README.md`, `CLAUDE.md`, `RESOURCES.md`), hook comments and messages, script output, and the contracts between agents. Template blocks ship in English too. What the skills write into the target repo follows its `kit.config.json` `language` (`presets/README.md` § `kit.config.json`); a template change keeps every `<!-- kit:… -->` anchor.

## Frozen literals

Some emitted strings are parsed by exact match — anchors, verdict headings, agent report headings, script output labels. The list, each with its parser, lives once: `rules/markdown-output.md` § Frozen literals, shipped to the target repo and binding the kit alike. Reword a literal and you reword its parser in the same change.

A skill's template blocks (spec structure, plan structure, handler sheet) are produced text: their structure and anchors are copied verbatim, their prose follows `language.docs`.

## Where a change goes

| Change | File |
|--------|------|
| layer convention (naming, pattern, ban) | `presets/<preset>/rules/<layer>.md` — single source, never copied into a skill; the installed copy is the repo's own and no hook or script parses it |
| stack-neutral behaviour rule | `rules/` — only `markdown-output.md`, `context-discipline.md` and `cctoolkit.md` live there; a plugin cannot load rules, `/cctoolkit:kit-init` copies them into the repo |
| a path, glob, marker, tag carrier or command that differs between repos | a key of `kit.config.json`, its default in each `presets/<name>/preset.json`, read through `lib/kit_config.py` — never a constant in a hook or a script |
| procedure (TDD cycle, audit steps) | the relevant `SKILL.md` |
| wiring (event, matcher, hook order) | `hooks/hooks.json` — commands written `bash "${CLAUDE_PLUGIN_ROOT}/hooks/x.sh"` |
| what the repo's own settings carry (permissions, env, statusline, plugin enablement) | `templates/` — merged into the repo by `/cctoolkit:kit-init`, never read from here |
| a script or tool the skills call | `scripts/` or `tools/`, reached through `bin/cctoolkit <name>` — never a path in a skill, an agent or a reference |
| description of the kit's behaviour | `README.md` for the workflow and installation, the folder's `README.md` for a brick |
| measurement, protocol or procedure too long for `CLAUDE.md` | `docs/CONTEXT-COST.md`, `docs/TOOLING.md` — opened on demand, so the standing rule stays in `CLAUDE.md` and only points here |
| repo-wide scanner or one-shot migration | `scripts/` — never a hook: a hook fires per edit, a scan reads the whole repo |

Two sources that drift make the choice random: a fact lives in exactly one place.

## Editing a hook

- A hook or script needing a path, a marker or the test tag reads it through `lib/kit_config.py` / `lib/kit_testtag.py`. With the `clean-architecture` preset its output must stay byte-identical: replay the old and new copies on the same fixture repo and diff the outputs before calling the change done.

- Must exit 0 on empty JSON input and when its dependency is missing. Intended exceptions: `lib/guard-git.sh`, blocking by design; `explore-guard.sh`, which denies an `Agent` call with no `description` or no explicit model; and `read-bounds.sh`, which denies an unbounded `Read` on a large file once per agent and file.
- Test after editing: `echo '{}' | bash hooks/<name>.sh`. Recorded cases live in `evals/cases/*.json` and `bash evals/run.sh` replays them from this checkout (`{{KIT}}` in a case = the kit directory): a hook change without a case is not finished. A hook or script resolves the repo through `lib/project-root.sh` / `kit_config.project_root()`, never from its own location: installed, the kit sits in the plugin cache, outside the repo. A `lib/` module reads `HOOK_CMD` / `HOOK_INPUT` / `HOOK_SESSION_ID` / `HOOK_AGENT_ID` / `HOOK_TRANSCRIPT_PATH` from the environment instead of stdin: `HOOK_CMD='ls' bash lib/<name>.sh`. A module that decides prints hook JSON; `lib/batching-nudge.sh` prints plain text, which the dispatcher grafts onto the decision.
- Do not run `graphify-autosync.sh` idly: it rebuilds the graph and blocks for several minutes.
