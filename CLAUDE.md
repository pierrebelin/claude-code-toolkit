# CLAUDE.md

## What this repo is

A **Claude Code plugin**, `cctoolkit`, for a DDD/TDD clean-architecture repo — this checkout is both the plugin and its marketplace (`.claude-plugin/`). No application code: **nothing to build, nothing to test**. The work here is editing `.md`, `.sh` and JSON files.

What each brick does, how to install it, what the kit imposes on the target repo: **[README.md](README.md)**. Do not duplicate those explanations here.

## Anonymisation — do not break it

The product name is the `{{PRODUCT}}` placeholder in the instruction files, rules and docs — never substituted in the kit: `rules/cctoolkit.md` tells the model to read it from `kit.config.json`, and `/cctoolkit:kit-init` substitutes it only in the rules it copies into a repo. Hooks, `lib/` and `scripts/` carry none — they read `product` from `kit.config.json`. Examples rest on a fictional domain: aggregates `Product` / `ModuleDiagram`, sub-entities `ProductItem` / `DiagramNode`, bounded contexts `Catalog` / `Studio`. Never introduce a real project, namespace or aggregate name. A change coming back from an installed repo goes through `bash scripts/kit-diff.sh <repo>` first: it flags the repo's product and vocabulary in what would flow back.

## Language

**English everywhere in the kit** — instruction files (`skills/`, `agents/`, `rules/`), documentation (`README.md`, `CLAUDE.md`, `RESOURCES.md`), hook comments and messages, script output, and the contracts between agents. Template blocks ship in English too. What the skills write into the target repo follows its `kit.config.json` `language` (README § `kit.config.json`); a template change keeps every `<!-- kit:… -->` anchor.

## Frozen literals

Some emitted strings are parsed by exact match. Reword one and you must reword its parser in the same change.

### Anchors — documents for humans

The title is prose in `language.docs`; the anchor is the literal. A parser matches the anchor, never the title.

| Anchor | Where | Parsed by |
|---|---|---|
| `<!-- kit:rules -->`, `<!-- kit:flow -->`, `<!-- kit:events -->` ending the three `##` headings; `<!-- kit:cols id,rule,outcome -->` above the rules table (columns read by position); `<!-- kit:none -->` on an explicitly empty rules section | handler `CLAUDE.md` | `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`, `scripts/migrate-rm-traits.py` |
| `<!-- kit:applied-rules -->` in the first cell of the `Design` row listing the applied ids; `<!-- kit:na-rules -->` after the global plan's non-applicable label | batch sheet, global plan | `scripts/rules-coverage.py --ids`, then `scripts/pre-audit.sh` |
| `<!-- kit:open-questions -->` heading, `<!-- kit:cols n,severity,question,impact,options -->` above its table; severity values `Blocking`/`Major` stay verbatim | spec | `/plan-implementation` gate (awk on the section) |
| Every other heading anchor of the templates — spec `kit:context` … `kit:assumptions`, global plan `kit:summary` … `kit:cross-cutting`, sheet `kit:intent` … `kit:assumptions` | spec, global plan, batch sheet | the skills and agents locating a section in any language; `scripts/migrate-anchors.py` writes them into older documents |
| Status tokens `TDD: RED ✅ · GREEN ✅ · COST ✅`, `✅ DONE`, `Correction Cn` — never translated | batch sheet | the first one by `scripts/pre-audit.sh` |

An instruction naming a section by its English template title (`## TDD sequence`, `## Assumptions`) designates the section carrying that template heading's anchor, whatever its title.

### Contracts — between agents, hooks and scripts

English, verbatim, whatever `language`.

| Frozen literal | Parsed by |
|---|---|
| The rule tag's value `{HandlerFolder}/{RM\|RL-xx}`, and each carrier of `lib/kit_testtag.py`: xUnit `[Trait("RM", "…")]`, pytest `@pytest.mark.rm("…")`, JUnit `@Tag("RM:…")`, Jest `[RM …]` in a title | `lib/kit_testtag.py`, read by `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`, `scripts/untagged-tests.py`, `scripts/migrate-rm-traits.py`, `scripts/pre-audit.sh` |
| `## Verdict — VALID`, `## Verdict — GAPS`, severities `Blocking`/`Major`/`Minor`, axes `Correctness`/`Reuse`/`Simplification`/`Cost`/`Placement`/`Comments`/`Test`/`Plan`/`Scope` | `/verify-ddd-tdd` verdict format, `scripts/learn-candidates.py` |
| `## RED`, `## GREEN`, `## BLOCKED` and their fields | `/implement-tdd` orchestrator |
| `→ Batch FX complete — manual validation required` — the closing line | `hooks/implement-tdd-guard.sh` |
| Output lines `not cited : `, `unknown references : `, `(none)` | `scripts/rules-coverage.py --ids`, then `scripts/pre-audit.sh` |
| `## Review — GAPS`, `## Review — CLEAR` | `adversarial-reviewer` output, read by the three callers |
| `docs/metrics/quality-report-YYYY-MM-DD.{md,json}` file names and the JSON's first-level keys | `scripts/quality-report-check.py`, the whole report history and any viewer built on it |
| `DEAD REFERENCE`, `UNBOUND TEST` — report labels | emitted by `scripts/rules-coverage.py`, cited by `scripts/untagged-tests.py`, `scripts/migrate-rm-traits.py`, `scripts/pre-audit.sh` and `skills/implement-tdd/references/closing.md` |

Identifier prefixes are language-neutral and stay as they are: `RM-xx` (business rule), `RL-xx` (rule local to a handler), `CU-xx` (use case), `DDD-nn`, `APP-nn`, `PERF-nn`.

The same tables ship to the target repo in `rules/markdown-output.md` — these govern the kit, those govern the repo that installs it. Change a literal and you change both, plus its parser, in the same edit.

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
| description of the kit's behaviour | `README.md` |
| measurement, protocol or procedure too long for `CLAUDE.md` | `docs/CONTEXT-COST.md`, `docs/TOOLING.md` — opened on demand, so the standing rule stays in `CLAUDE.md` and only points here |
| repo-wide scanner or one-shot migration | `scripts/` — never a hook: a hook fires per edit, a scan reads the whole repo |

Two sources that drift make the choice random: a fact lives in exactly one place.

## Editing a hook

- A hook or script needing a path, a marker or the test tag reads it through `lib/kit_config.py` / `lib/kit_testtag.py`. With the `clean-architecture` preset its output must stay byte-identical: replay the old and new copies on the same fixture repo and diff the outputs before calling the change done.

- Must exit 0 on empty JSON input and when its dependency is missing. Intended exceptions: `lib/guard-git.sh`, blocking by design; `explore-guard.sh`, which denies an `Agent` call with no `description` or no explicit model; and `read-bounds.sh`, which denies an unbounded `Read` on a large file once per agent and file.
- Test after editing: `echo '{}' | bash hooks/<name>.sh`. Recorded cases live in `evals/cases/*.json` and `bash evals/run.sh` replays them from this checkout (`{{KIT}}` in a case = the kit directory): a hook change without a case is not finished. A hook or script resolves the repo through `lib/project-root.sh` / `kit_config.project_root()`, never from its own location: installed, the kit sits in the plugin cache, outside the repo. A `lib/` module reads `HOOK_CMD` / `HOOK_INPUT` / `HOOK_SESSION_ID` / `HOOK_AGENT_ID` / `HOOK_TRANSCRIPT_PATH` from the environment instead of stdin: `HOOK_CMD='ls' bash lib/<name>.sh`. A module that decides prints hook JSON; `lib/batching-nudge.sh` prints plain text, which the dispatcher grafts onto the decision.
- Do not run `graphify-autosync.sh` idly: it rebuilds the graph and blocks for several minutes.
