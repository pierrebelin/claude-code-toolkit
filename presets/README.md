# Presets, `kit.config.json` and rules

Everything a repo has of its own lives in `<repo>/.claude/kit.config.json` or `<repo>/.claude/rules/`; the core files stay identical to the kit's. Both are written by `/cctoolkit:kit-init`.

## Presets

One folder per layout. `preset.json` pre-fills `layout`, `testTag` and `commands` of `kit.config.json`.

| Preset | Shape |
|--------|-------|
| `clean-architecture` | the default, the kit's original shape: projects per layer. Ships a layer pack in `rules/`: `domain`, `application-cqrs`, `infrastructure-ef`, `webapi-endpoints`, `tests` |
| `vertical-slices` | one folder per feature under `src/Features`, holding handler, sheet and unit tests; markers for C#, Python, Java/Kotlin, TypeScript |
| `hexagonal` | `src/domain`, `src/application`, `src/adapters`; same markers |

Only `clean-architecture` ships a layer pack today. A repo's own preset goes in `<repo>/.claude/presets/<name>/` and wins over a shipped one of the same name.

## Rules

| Source | Copied to | Content |
|--------|-----------|---------|
| `rules/` (kit root) | `.claude/rules/`, always | the 3 universal rules, whatever the stack: `cctoolkit` (how to read the kit's instructions: `{{PRODUCT}}`, `cctoolkit`, kit paths, namespacing), `markdown-output` (produced vs. instruction files, language, frozen literals) and `context-discipline` (turns, bounds, subagents, session hygiene — loaded in every session, no `paths:`) |
| `presets/<preset>/rules/` | `.claude/rules/`, when the preset has a pack | the layer conventions, each loaded when a file matching its `paths:` is opened |

A plugin cannot load rules: `/cctoolkit:kit-init` copies them with `{{PRODUCT}}` substituted, rewrites a `paths:` glob that matches nothing from `layout` — or, when no preset fits, drafts one `.claude/rules/<layer>.md` per code folder from what the files actually share, to review. Once copied, `.claude/rules/` is the repo's own: rewritten freely, never parsed by the core. They are the single source of the layer conventions — naming tables live in the rule of the layer that owns the artefact, nowhere else.

`rules/` holds no README: `/cctoolkit:kit-init` copies every `rules/*.md` into the repo.

## `kit.config.json`

One file, one user per repo — no `.local` variant. Missing file or key = the preset's value; missing `preset` = `clean-architecture`.

```json
{
  "language": { "docs": "fr", "code": "en" },
  "preset": "clean-architecture",
  "product": "MyProduct"
}
```

A repo of another shape names its preset and overrides only what differs — objects merge key by key, a list or a string replaces the preset's:

```json
{
  "preset": "vertical-slices",
  "testTag": { "framework": "pytest" },
  "layout": { "tests": { "bound": ["src/Features"] } },
  "commands": { "test": "pytest {suite}" }
}
```

| Key | Default | Governs | Never moves |
|---|---|---|---|
| `language.docs` | `en` | prose and headings of what the skills write for people: specs, plans, batch sheets, handler and feature `CLAUDE.md`, reports, summaries | the `<!-- kit:… -->` anchors, ids (`RM-xx`, `DDD-nn`…), status tokens, values quoted verbatim (`Blocking`) |
| `language.code` | `en` | test names, code comments, identifiers the model chooses | the keywords of a naming pattern (`Should…_When…`) and the layer conventions of `rules/` |
| `preset` | `clean-architecture` | which `presets/<name>/preset.json` pre-fills `layout`, `testTag`, `commands` | — |
| `product` | unset | `{product}` in every path and command below. Unset, it expands to `*`: `src/*.Application` finds the one Application project a repo usually has — set it as soon as there are two | — |
| `layout.sources` | `src`, `.cs`, `//` | `roots`, `extensions` and comment prefix (`comment`: a string, or one per extension) of production code — the scope of `pre-audit.sh`'s comment and scope checks | — |
| `layout.aggregate` | `*/*.Domain/*/Aggregates/*.cs`, `…/ValueObjects/*.cs` | where an aggregate and its value objects live — shell-`case` patterns on the full path, read by `affected-blast-radius.sh` | — |
| `layout.useCase` | `src/{product}.Application`, `*Handler.cs` holding a `class …Handler` | `roots` where use cases live, `marker` (`file` glob + `contains` regex) recognising a use-case folder at any depth, `label` naming them in the reports | — |
| `layout.ruleSheet` | `CLAUDE.md` | the rule sheet's file name, in the use-case folder | its `kit:rules` / `kit:flow` / `kit:events` anchors |
| `layout.tests` | `tests`; bound `tests/{product}.UnitTests`, `…ContractTests`; interaction `tests/*.UnitTests`, `tests/*.CoreTests` | `roots` scanned for tests, `bound` suites where every test cites a rule (`UNBOUND TEST`), `interaction` suites checked for spy assertions by `pre-audit.sh` | — |
| `layout.skipDirs` | `bin`, `obj`, `Properties`… | folders never walked | — |
| `testTag.framework` | `xunit` | the carrier of the rule tag: `xunit` `[Trait("RM", "F/RM-01")]`, `pytest` `@pytest.mark.rm("F/RM-01")`, `junit` `@Tag("RM:F/RM-01")`, `jest` `[RM F/RM-01]` in an `it`/`test`/`describe` title (a `describe` tag covers its tests) | the value `<SheetFolder>/<RM\|RL-xx>` |
| `testTag.regex`, `testTag.files` | the adapter's | carrier regex (one capture group: the value), test file globs | — |
| `commands.build`, `commands.architectureTest` | `rtk dotnet build {product}.sln --no-restore`; the `ArchitectureTests` run and its `when` path regex | what `audit-capture.sh` runs; empty = section reported "not run" | — |
| `commands.test` | `rtk dotnet test --project tests/{product}.{suite}/…` | the suite command template — validated by the doctor, not yet read by the skills (run 3) | — |

Path patterns are segment globs relative to the repo root (`*` stays inside one folder), `layout.aggregate` excepted. `cctoolkit doctor` validates the file; a hook never reports a broken config — it exits 0 in silence.

Any language code works: the model reads the value through `rules/markdown-output.md`, no list to maintain. The kit's own instructions (`skills/`, `agents/`, `rules/`) and the contracts between agents (`## RED`, `## Verdict — GAPS`…) stay English whatever the setting.

**Why anchors.** A parsed heading ends with an invisible HTML comment — `## Règles métier <!-- kit:rules -->` under `"docs": "fr"`, `## Business rules <!-- kit:rules -->` under `"en"`. Hooks and scripts match the anchor, never the title, so a translated document stays machine-readable. Parsed tables carry a schema anchor (`<!-- kit:cols id,rule,outcome -->`) and are read by position. The list of anchors and of their parsers: `rules/markdown-output.md` § Frozen literals.

## What the config cannot express yet

Paths, markers, the tag carrier and the build commands are `kit.config.json`; the layer conventions are the repo's `.claude/rules/`. Everything else ships in the plugin: changing it means changing the kit — in a fork of this repo, published as your own marketplace — never the plugin cache.

| File | What to change |
|------|----------------|
| `agents/tdd-test-author.md`, `agents/tdd-implementer.md` | the `dotnet test` command: test project path pattern |
| `skills/implement-tdd/references/test-scope.md` | test environment variable, namespace roots, filter examples: projects, suites actually present, integration test splitting |
| `skills/quality-report/commands-dotnet.md`, `commands-js.md` | suite list, SonarQube project key, Stryker config names; Jest config paths |
| `skills/*/SKILL.md`, `skills/*/references/*.md` | code examples: namespaces and aggregate names |
| `docs/TOOLING.md` | `## Bootstrap`: restore command, `--no-restore` policy, purge, per-OS SDK paths |
| `docs/CONTEXT-COST.md` | the measured figures — re-measure with `cctoolkit turn-batching-check`, then create `.claude/context-baseline.json` (`--until <date> --save-baseline`) |

Hooks, `lib/` and `scripts/` adaptation points: [`hooks/README.md`](../hooks/README.md), [`scripts/README.md`](../scripts/README.md).

## Anonymisation

The kit comes from a real repo. The product name has been replaced everywhere by the `{{PRODUCT}}` placeholder:

```
src/{{PRODUCT}}.Domain/          namespace {{PRODUCT}}.Application.Catalog.Products;
tests/{{PRODUCT}}.UnitTests/     dotnet test --project tests/{{PRODUCT}}.UnitTests/…
```

Hooks, `lib/` and `scripts/` read it from `kit.config.json` `product` and carry no placeholder. The skills, agents and references keep it — they live in the plugin cache, shared by every repo — and the universal rule `cctoolkit.md` tells the model to read `{{PRODUCT}}` as `product`. Only the rules copied into a repo by `/cctoolkit:kit-init` have it substituted.

`cctoolkit kit-diff` replays that substitution before comparing a manual copy, so it is not a drift. Before a change flows back from a repo into the kit, the same script flags any line naming the repo's product or vocabulary (use-case folders and their parents, aggregate and value-object names read through its `layout`).

The code examples rest on a neutral fictional domain — aggregates `Product` and `ModuleDiagram`, sub-entities `ProductItem` and `DiagramNode`, bounded contexts `Catalog` and `Studio`. Rewriting them with the target domain's vocabulary makes the examples more telling, but is not needed to make things work.
