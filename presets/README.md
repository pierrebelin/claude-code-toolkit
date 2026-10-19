# Presets, `kit.config.json`, rules and test skills

Everything a repo has of its own lives in `<repo>/.claude/kit.config.json`, `<repo>/.claude/rules/` or the preset's skills in `<repo>/.claude/skills/`; the core files stay identical to the kit's. All are written by `/cctoolkit:kit-init`.

## Presets

One folder per layout. `preset.json` pre-fills `layout`, `testTag`, `commands` and `tdd` of `kit.config.json`.

| Preset | Shape |
|--------|-------|
| `clean-architecture` | the default, the kit's original shape: projects per layer. Ships a layer pack in `rules/`: `domain`, `application-cqrs`, `infrastructure-ef`, `webapi-endpoints`, `tests`, `csharp` (language conventions), and the test skills in `skills/`: `tests-unit-tests`, `tests-integration-tests`, `tests-contract-tests`, `tests-e2e-tests` |
| `vertical-slices` | one folder per feature under `src/Features`, holding handler, sheet and unit tests; markers for C#, Python, Java/Kotlin, TypeScript |
| `hexagonal` | `src/domain`, `src/application`, `src/adapters`; same markers |

Only `clean-architecture` ships a layer pack and test skills today. A repo's own preset goes in `<repo>/.claude/presets/<name>/` and wins over a shipped one of the same name.

## Rules

| Source | Copied to | Content |
|--------|-----------|---------|
| `rules/` (kit root) | `.claude/rules/`, always | the 3 universal rules, whatever the stack: `cctoolkit` (how to read the kit's instructions: `{{PRODUCT}}`, `cctoolkit`, kit paths, namespacing), `markdown-output` (produced vs. instruction files, language, the bare list of frozen literals) and `context-discipline` (bounds, subagents, graphify against grep — loaded in every session, no `paths:`) |
| `presets/<preset>/rules/` | `.claude/rules/`, when the preset has a pack | the layer conventions, each loaded when a file matching its `paths:` is opened |

A plugin cannot load rules: `/cctoolkit:kit-init` copies them with `{{PRODUCT}}` substituted, rewrites a `paths:` glob that matches nothing from `layout` — or, when no preset fits, drafts one `.claude/rules/<layer>.md` per code folder from what the files actually share, to review. Once copied, `.claude/rules/` is the repo's own: rewritten freely, never parsed by the core. They are the single source of the layer conventions — naming tables live in the rule of the layer that owns the artefact, nowhere else.

`rules/` holds no README: `/cctoolkit:kit-init` copies every `rules/*.md` into the repo.

## Test skills

`presets/<preset>/skills/<name>/` holds the skills that write tests (xUnit, Verify, Testcontainers, Aspire for `clean-architecture`): bound to a layout and a test stack, they cannot ship in the plugin, which every repo shares. `/cctoolkit:kit-init` copies each folder into `.claude/skills/<name>/`, `{{PRODUCT}}` substituted; a local copy that differs is shown file by file and kept unless the user picks replace or merge. Once copied they are the repo's own, invoked without prefix (`rules/cctoolkit.md`): the sheets' `skill` field and `tdd-test-author` name them bare. Their examples use neutral names (`ApiApplicationFixture`, `DatabaseContainerPool`); the runner goes through `commands.test`.

## `kit.config.json`

One file, one user per repo — no `.local` variant. Missing file or key = the preset's value — `knowledge.*` excepted, the same in every preset, whose defaults live in `lib/kit_config.py`; missing `preset` = `clean-architecture`.

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
| `preset` | `clean-architecture` | which `presets/<name>/preset.json` pre-fills `layout`, `testTag`, `commands`, `tdd` | — |
| `product` | unset | `{product}` in every path and command below. Unset, it expands to `*`: `src/*.Application` finds the one Application project a repo usually has — set it as soon as there are two | — |
| `layout.sources` | `src`, `.cs`, `//`, a `using` line; no `languageGuard` | `roots`, `extensions`, comment prefix (`comment`: a string, or one per extension) and import line (`imports`: a regex, or one per extension — the lines `cctoolkit knowledge-scan` drops from the diff it hands the sync, with the comments and whitespace) of production code — the scope of `pre-audit.sh`'s comment and scope checks. Optional `languageGuard`, `{"file": "<architecture test>", "skip": ["<glob>"]}`, turns on its gate 8 (production messages stay in English): `file` is the architecture test that already fails an accented literal in production code — French written without accents slips past it — and the production files it quotes (its own exclusions) are left out; `skip` lists further globs of production files to leave alone. The gate lists every string literal added under the source roots that holds two French function words (`le`, `des`, `pas`, `l'`…). No `languageGuard`, or its file absent: the gate does not run | — |
| `layout.aggregate` | `*/*.Domain/*/Aggregates/*.cs`, `…/ValueObjects/*.cs` | where an aggregate and its value objects live — shell-`case` patterns on the full path, read by `knowledge-scan` (the knowledge reminder) | — |
| `layout.useCase` | `src/{product}.Application`, `*Handler.cs` holding a `class …Handler` | `roots` where use cases live, `marker` (`file` glob + `contains` regex) recognising a use-case folder at any depth, `label` naming them in the reports, `contextDepth` (1) the depth of the bounded-context folder under a use-case root — `Application/Catalog/Products/ArchiveProduct/` is `Catalog` at 1; 0 = the repo is one context. The knowledge base's scripts read a handler's context there; any other file's from a path segment naming a known context | — |
| `layout.ruleSheet` | `CLAUDE.md` | the rule sheet's file name, in the use-case folder | its `kit:rules` / `kit:flow` / `kit:events` anchors |
| `layout.tests` | `tests`; bound `tests/{product}.UnitTests`; interaction `tests/*.UnitTests`, `tests/*.CoreTests`; shared `tests/*.CoreTests` | `roots` scanned for tests, `bound` suites where every test cites a rule (`UNBOUND TEST`), `interaction` suites checked for spy assertions by `pre-audit.sh`, `shared` (optional) test infrastructure a `## Cycles` cycle may touch beyond its one test project and 4 test files (`sheet-cycles.py`) | — |
| `layout.integrationGuard` | none | optional `{"sources": ["<glob>"], "tests": ["<glob>"]}`, segment globs: turns on `pre-audit.sh` gate 9 — a file changed under `sources` (persistence code) needs a changed file under `tests` (integration suite) or an `Integration test waiver: <reason>` line in the sheet (`Dérogation TI : <raison>` read too). Absent: the gate does not run | — |
| `layout.skipDirs` | `bin`, `obj`, `Properties`… | folders never walked | — |
| `testTag.framework` | `xunit` | the carrier of the rule tag: `xunit` `[Trait("RM", "F/RM-01")]`, `pytest` `@pytest.mark.rm("F/RM-01")`, `junit` `@Tag("RM:F/RM-01")`, `jest` `[RM F/RM-01]` in an `it`/`test`/`describe` title (a `describe` tag covers its tests) | the value `<SheetFolder>/<RM\|RL-xx>` |
| `testTag.regex`, `testTag.files` | the adapter's | carrier regex (one capture group: the value), test file globs | — |
| `commands.build`, `commands.architectureTest` | `rtk dotnet build {product}.sln --no-restore`; the `ArchitectureTests` run and its `when` path regex | what `audit-capture.sh` runs; empty = section reported "not run" | — |
| `tdd.failedTest`, `tdd.stubFailure`, `tdd.stubLogic` | .NET: a `failed`/`Failed`/`[FAIL]` line naming the test; `NotImplementedException`; `if`/`switch`/loop/`catch`/`??` at line start. The other presets: the same failed line, `NotImplementedError`/`UnsupportedOperationException`/`not implemented`, branches of each stack | the RED check of `lib/tdd_scope.py`: it reruns the RED's test command, reads each failed test's block, and refuses a test whose block holds `stubFailure` (a RED fails on its assertion, never on the stub); `stubLogic` marks a stub's added lines as evidence for the audit, never a refusal. `stubFailure` unset: no rerun | — |
| `commands.test` | `rtk dotnet test --project tests/{product}.{suite}/…` | the suite command template, `{suite}` = the suite's name; the skills and agents resolve it with `kit_config.py command test <suite>` and append the runner's filter; empty = suite reported "not run" | — |
| `knowledge.root` | `docs/business` | the business knowledge base, one folder per bounded context (`skills/knowledge-sync/references/knowledge-format.md`); the same in every preset, so its defaults live in `lib/kit_config.py` | — |
| `knowledge.contexts` | `{}` | id prefix per context, `{"Catalog": "CAT"}` — the folder name maps to the prefix of its ids; `cctoolkit next-id` refuses a context or prefix absent from it, `cctoolkit doctor` warns on a context folder without one | an id already given |
| `knowledge.overviewBudget` | `1500` | the ceiling, in tokens, of each context's `OVERVIEW.md` | — |
| `knowledge.askBudget` | `1500` | what one `cctoolkit ask` answer may print, in tokens (characters / 4); the first item always shows, the rest are counted in `shown N of M` | — |
| `knowledge.syncBudget` | `12000` | the packet of one context `cctoolkit knowledge-scan` hands the sync agent, in tokens (diffs plus the use-case files they reach); above it `/cctoolkit:knowledge-sync` asks between a whole-context scan and the diff as is | — |

Path patterns are segment globs relative to the repo root (`*` stays inside one folder), `layout.aggregate` excepted. `cctoolkit doctor` validates the file; a hook never reports a broken config — it exits 0 in silence.

Any language code works: the model reads the value through `rules/markdown-output.md`, no list to maintain. The kit's own instructions (`skills/`, `agents/`, `rules/`) and the contracts between agents (`## RED`, `## Verdict — GAPS`…) stay English whatever the setting.

**Why anchors.** A parsed heading ends with an invisible HTML comment — `## Règles métier <!-- kit:rules -->` under `"docs": "fr"`, `## Business rules <!-- kit:rules -->` under `"en"`. Hooks and scripts match the anchor, never the title, so a translated document stays machine-readable. A document written without anchors — a French repo's older sheets — is still read by its exact English or French title (`docs/FROZEN-LITERALS.md` § French aliases). Parsed tables carry a schema anchor (`<!-- kit:cols id,rule,outcome -->`) and are read by position, or by their header row when the anchor is absent. The list of anchors and of their parsers: `docs/FROZEN-LITERALS.md`.

## What the config cannot express yet

Paths, markers, the tag carrier and the build and test commands are `kit.config.json`; the layer conventions are the repo's `.claude/rules/`. Everything else ships in the plugin: changing it means changing the kit — in a fork of this repo, published as your own marketplace — never the plugin cache.

| File | What to change |
|------|----------------|
| `skills/implement-tdd/references/test-scope.md` | test environment variable, namespace roots, the runner's filter syntax (the illustrations are the `clean-architecture` preset's): suites actually present, integration test splitting |
| `skills/quality-report/commands-dotnet.md` | suite list, SonarQube project key, Stryker config names |
| `skills/*/SKILL.md`, `skills/*/references/*.md` | code examples: namespaces and aggregate names |
| `docs/CONTEXT-COST.md` | the measured figures — re-measure with `dev/turn-batching-check.py` of a kit checkout, then create `.claude/context-baseline.json` (`--until <date> --save-baseline`) |

Hooks, `lib/` and `scripts/` adaptation points: [`hooks/README.md`](../hooks/README.md), [`scripts/README.md`](../scripts/README.md).

## Anonymisation

The kit comes from a real repo. The product name has been replaced everywhere by the `{{PRODUCT}}` placeholder:

```
src/{{PRODUCT}}.Domain/          namespace {{PRODUCT}}.Application.Catalog.Products;
tests/{{PRODUCT}}.UnitTests/     dotnet test --project tests/{{PRODUCT}}.UnitTests/…
```

Hooks, `lib/` and `scripts/` read it from `kit.config.json` `product` and carry no placeholder. The skills, agents and references keep it — they live in the plugin cache, shared by every repo — and the universal rule `cctoolkit.md` tells the model to read `{{PRODUCT}}` as `product`. Only the rules and test skills copied into a repo by `/cctoolkit:kit-init` have it substituted.

`cctoolkit kit-diff` replays that substitution before comparing a manual copy, so it is not a drift. Before a change flows back from a repo into the kit, the same script flags any line naming the repo's product or vocabulary (use-case folders and their parents, aggregate and value-object names read through its `layout`).

The code examples rest on a neutral fictional domain — aggregates `Product` and `ModuleDiagram`, sub-entities `ProductItem` and `DiagramNode`, bounded contexts `Catalog` and `Studio`. Rewriting them with the target domain's vocabulary makes the examples more telling, but is not needed to make things work.
