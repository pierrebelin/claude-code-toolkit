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
| `## Règles métier`, `## Flux`, `## Événements émis` and the columns `ID` / `Règle` / `Exception / Résultat` | `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`, `scripts/migrate-rm-traits.py` |
| `[Trait("RM", "{HandlerFolder}/{RM\|RL-xx}")]` — the attribute name `RM` and the `folder/id` shape of its value | idem, plus `scripts/untagged-tests.py` and `scripts/migrate-rm-traits.py` |
| `## Verdict — VALID`, `## Verdict — GAPS`, severities `Blocking`/`Major`/`Minor`, axes `Correctness`/`Reuse`/`Simplification`/`Cost`/`Placement`/`Comments`/`Test`/`Plan`/`Scope` | `/verify-ddd-tdd` verdict format |
| `## RED`, `## GREEN`, `## BLOCKED` and their fields | `/implement-tdd` orchestrator |
| `TDD: RED ✅ · GREEN ✅ · COST ✅`, `✅ DONE`, `## Assumptions`, `Correction Cn` | batch sheets |
| `N rules, M tested` — the coverage column of a feature index `CLAUDE.md` | written by `scripts/rules-coverage.py --fix-index`, templated in `skills/implement-tdd/references/claude-md-handler.md` |
| `docs/metrics/quality-report-YYYY-MM-DD.{md,json}` file names and the JSON's first-level keys | `scripts/quality-report-check.py`, the whole report history and any viewer built on it |
| `DEAD REFERENCE`, `UNBOUND TEST` — report labels | emitted by `scripts/rules-coverage.py`, cited by `scripts/untagged-tests.py`, `scripts/migrate-rm-traits.py` and `skills/implement-tdd/SKILL.md` |

Identifier prefixes are language-neutral and stay as they are: `RM-xx` (business rule), `RL-xx` (rule local to a handler), `CU-xx` (use case), `DDD-nn`, `APP-nn`, `PERF-nn`.

A skill's template blocks (spec structure, plan structure, handler sheet) are produced text: they are copied verbatim.

## Where a change goes

| Change | File |
|--------|------|
| layer convention (naming, pattern, ban) | `rules/<layer>.md` — single source, never copied into a skill |
| procedure (TDD cycle, audit steps) | the relevant `SKILL.md` |
| wiring (event, matcher, hook order) | `settings.json` |
| description of the kit's behaviour | `README.md` |
| repo-wide scanner or one-shot migration | `scripts/` — never a hook: a hook fires per edit, a scan reads the whole repo |

Two sources that drift make the choice random: a fact lives in exactly one place.

## Editing a hook

- Must exit 0 on empty JSON input and when its dependency is missing. Intended exceptions: `git-guard.sh`, blocking by design, and `graphify-enforce.sh`, which denies an `Explore` subagent with no graphify in its prompt and rewrites a symbol-discovery `grep` into `graphify explain` (a rewrite, not a denial).
- Test after editing: `echo '{}' | bash hooks/<name>.sh`.
- Do not run `graphify-autosync.sh` idly: it rebuilds the graph and blocks for several minutes.
