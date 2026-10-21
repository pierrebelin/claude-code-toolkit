# CLAUDE.md

## What this repo is

A **Claude Code plugin**, `cctoolkit`, for a DDD/TDD clean-architecture repo — this checkout is both the plugin and its marketplace (`.claude-plugin/`). No application code: **nothing to build, nothing to test**. The work here is editing `.md`, `.sh` and JSON files.

Workflow and installation: **[README.md](README.md)** — the pitch, short and written for a newcomer — and **[INSTALL.md](INSTALL.md)** — everything installation requires. Nothing about the kit's internals goes in either. What each brick does and how: the README of its folder (`skills/` — agents included —, `hooks/`, `lib/`, `scripts/`, `tools/`, `presets/` — `rules/` and `kit.config.json` included —, `templates/`, `evals/`, `mods/`, `examples/`). Do not duplicate those explanations here. `agents/` and `rules/` never get a README: the plugin loads every `agents/*.md` as an agent, `/cctoolkit:kit-init` copies every `rules/*.md` into the repo.

| Folder | What |
|--------|------|
| `skills/`, `agents/` | the skills and the subagents they delegate to |
| `hooks/` | guards, bounds, traceability, context nudges, wired in `hooks.json` |
| `lib/` | modules the hooks call, config and test-tag readers, the knowledge base's parser and index |
| `scripts/`, `bin/` | repo-wide scanners and one-shots, run as `cctoolkit <name>` |
| `tools/` | `doctor` |
| `presets/`, `rules/` | layouts, `kit.config.json`, layer and universal rules, the preset's test skills |
| `templates/` | settings, statusline, `.gitignore` merged into the repo |
| `evals/` | recorded hook cases |
| `workflows/` | `run-lot` (one batch), `run-plan` (whole plan) and `run-audit` (the quality report), as Workflow scripts |
| `mods/` | optional in-terminal panes, each its own plugin in the marketplace |
| `examples/` | one fictional feature as the skills write it — a template, anchor or report format change updates it in the same change |
| `docs/` | context cost, the frozen literals registry, the README screenshots |
| `dev/` | maintainer tools: `bump.sh`, `release-check.sh`, `turn-batching-check.py` (batching and context fill measured from the transcripts), `workflow-timing.py` (duration per phase and per agent of a workflow run, reads and greps per agent), `hook-timing.sh` (median wall time of the hot hooks on the payloads of `dev/hook-timing/*.json`, two kit copies compared), `knowledge-pane-demo.sh` (the mod's demo copy of `examples/docs/business/`) |

## Anonymisation — do not break it

The product name is the `{{PRODUCT}}` placeholder, never substituted in the kit (mechanism: `presets/README.md` § Anonymisation); hooks, `lib/` and `scripts/` carry none. Examples rest on a fictional domain: aggregates `Product` / `ModuleDiagram`, sub-entities `ProductItem` / `DiagramNode`, bounded contexts `Catalog` / `Studio`. Never introduce a real project, namespace or aggregate name. A change coming back from an installed repo goes through `bash scripts/kit-diff.sh <repo>` first: it flags the repo's product and vocabulary in what would flow back.

## Language

**English everywhere in the kit** — instruction files (`skills/`, `agents/`, `rules/`), documentation (`README.md`, `CLAUDE.md`, `docs/`), hook comments and messages, script output, and the contracts between agents. Template blocks ship in English too. What the skills write into the target repo follows its `kit.config.json` `language` (`presets/README.md` § `kit.config.json`); a template change keeps every `<!-- kit:… -->` anchor.

## Frozen literals

Some emitted strings are parsed by exact match — anchors, verdict headings, agent report headings, script output labels. The list, each with its parser, lives once: `docs/FROZEN-LITERALS.md`, binding the kit; the target repo receives the bare list (`rules/markdown-output.md` § Frozen literals). Reword a literal and you reword its parser, and both lists, in the same change.

A skill's template blocks (spec structure, plan structure, handler sheet) are produced text: their structure and anchors are copied verbatim, their prose follows `language.docs`.

## Where a change goes

| Change | File |
|--------|------|
| layer convention (naming, pattern, ban) | `presets/<preset>/rules/<layer>.md` — single source, never copied into a skill; the installed copy is the repo's own and no hook or script parses it |
| stack-neutral behaviour rule | `rules/` — only `markdown-output.md`, `context-discipline.md` and `cctoolkit.md` live there; a plugin cannot load rules, `/cctoolkit:kit-init` copies them into the repo |
| a path, glob, marker, tag carrier or command that differs between repos | a key of `kit.config.json`, its default in each `presets/<name>/preset.json` — or in `lib/kit_config.py` for a stack-neutral key (`knowledge.*`) —, read through `lib/kit_config.py` — never a constant in a hook or a script |
| procedure (TDD cycle, audit steps) | the relevant `SKILL.md` |
| how to write tests of one level (bound to a layout and a test stack) | `presets/<preset>/skills/tests-*/` — copied into the repo by `/cctoolkit:kit-init`, never under `skills/` |
| wiring (event, matcher, hook order) | `hooks/hooks.json` — commands written `bash "${CLAUDE_PLUGIN_ROOT}/hooks/x.sh"` |
| what the repo's own settings carry (permissions, env, statusline, plugin enablement) | `templates/` — merged into the repo by `/cctoolkit:kit-init`, never read from here |
| a script or tool the skills call | `scripts/` or `tools/`, reached through `bin/cctoolkit <name>` — never a path in a skill, an agent or a reference |
| description of the kit's behaviour | `README.md` for the workflow, `INSTALL.md` for installation and update, the folder's `README.md` for a brick |
| measurement, protocol or procedure too long for `CLAUDE.md` | `docs/CONTEXT-COST.md` — opened on demand, so the standing rule stays in `CLAUDE.md` and only points here |
| repo-wide scanner or one-shot migration | `scripts/` — never a hook: a hook fires per edit, a scan reads the whole repo |
| a maintainer tool for this checkout only (version bump, release check) | `dev/` — never shipped as a `cctoolkit` command |

Two sources that drift make the choice random: a fact lives in exactly one place.

## Editing a hook

- A hook or script needing a path, a marker or the test tag reads it through `lib/kit_config.py` / `lib/kit_testtag.py`. With the `clean-architecture` preset its output must stay byte-identical: replay the old and new copies on the same fixture repo and diff the outputs before calling the change done.

- A new hook, tool or shell script sources `lib/platform.sh` first (`. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"`), and runs any path from a payload through `kit_path`. A hook wired in `hooks.json` opens, before that and before reading stdin, with the line rerunning it from a `/` path (copy it from any hook; `evals/cases/platform.json` checks it). Python prints and writes paths with `/` (`Config.rel`, `.as_posix()`), and a mod or workflow parses paths with `[\\/]`: on Windows the kit runs under Git Bash with native tools (`INSTALL.md` § Windows).
- Must exit 0 on empty JSON input and when its dependency is missing, save the guards that block by design (`hooks/README.md` § Dependencies).
- Test after editing: `echo '{}' | bash hooks/<name>.sh`. Recorded cases live in `evals/cases/*.json` and `bash evals/run.sh` replays them from this checkout (`{{KIT}}` in a case = the kit directory): a hook change without a case is not finished. A hook or script resolves the repo through `lib/project-root.sh` / `kit_config.project_root()`, never from its own location: installed, the kit sits in the plugin cache, outside the repo. A `lib/` module reads `HOOK_CMD` / `HOOK_INPUT` / `HOOK_SESSION_ID` / `HOOK_AGENT_ID` / `HOOK_AGENT_TYPE` / `HOOK_BACKGROUND` / `HOOK_TRANSCRIPT_PATH` from the environment instead of stdin: `HOOK_CMD='ls' bash lib/<name>.sh`. A module that decides prints hook JSON; `lib/batching-nudge.sh` prints plain text, which the dispatcher grafts onto the decision.
- Do not run `graphify-autosync.sh` idly: it rebuilds the graph and blocks for several minutes.

## Releasing

Claude Code pins an installed plugin to the `version` of its `plugin.json`: a push changing shipped files under the same version never reaches the users who installed it. `cctoolkit` and its mods share **one version**, the same in every `plugin.json`.

1. A change to shipped files of any plugin → `bash dev/bump.sh <version>` sets it in every `plugin.json` (patch: fix; minor: behaviour or rule change; major: a change that breaks an installed repo), and add its `## <version> — <date>` section to `CHANGELOG.md`, user-facing, each entry naming the plugin it changes. A change under `rules/` or `presets/*/rules/` is listed under **Rules changed**, one under `presets/*/skills/` under **Skills changed**: the user pulls either by re-running `/cctoolkit:kit-init`.
2. Before pushing: `bash dev/release-check.sh` — `FAIL` blocks the push (shipped change without bump, versions that differ), `TODO` names a release still to tag.
3. After the commit: `claude plugin tag --push <plugin dir>` for every plugin, each creating `<name>--v<version>`.
4. Once CI is green on the tag (`.github/workflows/ci.yml`: the hook evals and every mod's `validate` and `test`, on each push, pull request and tag), one GitHub release for the version, the mods included: `gh release create cctoolkit--v<version> --verify-tag --title "cctoolkit <version>"`, its notes the version's `CHANGELOG.md` section. `release-check` says `TODO` until it exists, `FAIL` when the tag's commit is red in CI: that version is never released, fix and bump.
