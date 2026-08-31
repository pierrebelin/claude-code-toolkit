# CLAUDE.md

## What this repo is

A **portable `.claude` kit** for a .NET/DDD clean-architecture repo. No application code: **nothing to build, nothing to test**. The work here is editing `.md`, `.sh` and JSON files.

What each brick does, how to install it, what the kit imposes on the target repo: **[README.md](README.md)**. Do not duplicate those explanations here.

## Anonymisation — do not break it

The product name is the `{{PRODUCT}}` placeholder everywhere. Examples rest on a fictional domain: aggregates `Product` / `ModuleDiagram`, sub-entities `ProductItem` / `DiagramNode`, bounded contexts `Catalog` / `Studio`. Never introduce a real project, namespace or aggregate name.

## Language

**English everywhere** — instruction files (`skills/`, `agents/`, `rules/`), documentation (`README.md`, `CLAUDE.md`, `RESOURCES.md`), hook comments and messages, and every artefact the skills write into the target repo: `todo/` specs and plans, handler and feature `CLAUDE.md` files, reports, verdicts, summaries returned to the user.

## Frozen literals

Some emitted strings are parsed by exact match. Reword one and you must reword its parser in the same change.

| Frozen literal | Parsed by |
|---|---|
| `## Business rules`, `## Flow`, `## Emitted events` and the columns `ID` / `Rule` / `Exception / Result` / `Tests` | `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py` in the target repo |
| `## Verdict — VALID`, `## Verdict — GAPS`, severities `Blocking`/`Major`/`Minor`, axes `Correctness`/`Reuse`/`Simplification`/`Cost`/`Placement`/`Scope`/`Comments` | `/verify-ddd-tdd` verdict format |
| `## RED`, `## GREEN`, `## BLOCKED` and their fields | `/implement-tdd` orchestrator |
| `TDD: RED ✅ · GREEN ✅ · COST ✅`, `✅ DONE`, `## Assumptions`, `Correction Cn` | batch sheets |

Identifier prefixes are language-neutral and stay as they are: `RM-xx` (business rule), `RL-xx` (rule local to a handler), `CU-xx` (use case), `DDD-nn`, `APP-nn`, `PERF-nn`.

A skill's template blocks (spec structure, plan structure, handler sheet) are produced text: they are copied verbatim.

## Where a change goes

| Change | File |
|--------|------|
| layer convention (naming, pattern, ban) | `rules/<layer>.md` — single source, never copied into a skill |
| procedure (TDD cycle, audit steps) | the relevant `SKILL.md` |
| wiring (event, matcher, hook order) | `settings.json` |
| description of the kit's behaviour | `README.md` |

Two sources that drift make the choice random: a fact lives in exactly one place.

## Editing a hook

- Must exit 0 on empty JSON input and when its dependency is missing. The only intended exceptions: `git-guard.sh` and `graphify-enforce.sh`, blocking by design.
- Test after editing: `echo '{}' | bash hooks/<name>.sh`.
- Do not run `graphify-autosync.sh` idly: it rebuilds the graph and blocks for several minutes.
