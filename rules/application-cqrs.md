---
paths:
  - "src/{{PRODUCT}}.Application/**/*.cs"
---

# Application layer rules

Full code examples for this layer: `.claude/skills/implement-tdd/references/examples-application.md`.


A handler orchestrates: load, call the Domain, save events, return the result (APP-01). No business rule and no direct mutation inside a handler. A pure query only reads and returns.

## Commands

Inherit `CommandHandler<TCommand, TResult>` with `ITransactionManager`, implement `HandleCommand()`, return the aggregate id. Failures are domain exceptions.

One command modifies and saves **a single aggregate** (DDD-08). An external read stays targeted and non-mutating.

## Queries

Implement `IHandler<TQuery, T>` directly — no base class, no transaction. Return the payload:

| Shape | Return |
|-------|--------|
| Paginated list | `Paging<T>` |
| Bounded list | `IReadOnlyList<T>` |
| Single read | the aggregate or its response |

**Never `Result<T>`** — it does not exist in this codebase.

A paginated list returned as `IReadOnlyList<T>` loses the page total: use `Paging<T>`.

## Bounds (APP-05)

- Pagination: `PaginationBounds.Normalize(query)` inside the query's `Create`; filter and sort pushed to SQL through Gridify
- Unpaginated branch: capped by `QueryLimits.MAX_UNPAGINATED_RESULTS`
- Never recode a bound by hand in a handler

## Multi-tenancy

Always `IUserContextWrapper.GetUserContext()`, then `OrganizationId.From(userContext.OrganizationId)`.

## DI

Handlers auto-registered by reflection. No manual registration.

A required dependency is never optional: no `IFooService? service = null`. If it can be absent, the design needs revisiting.

## Folder layout

```
{Context}/{Feature}/
└── {Action}{Entity}/
    ├── {Action}{Entity}Command.cs   (or Query.cs)
    ├── I{Action}{Entity}CommandHandler.cs
    └── {Action}{Entity}CommandHandler.cs
```

`{Context}` is the bounded context root (`Catalog/`, `Studio/`, `AuditTrails/`, `Import/`, `Peers/`).

## Naming

| Artifact | Pattern | Example |
|----------|---------|---------|
| Command | `{Action}{Entity}Command` | `CreateProductCommand` |
| Query | `{Action}{Entity}Query` | `GetProductsQuery` |
| Handler | `{Command/Query}Handler` | `CreateProductCommandHandler` |

## No nullable in Application (DDD-11)

Same rule as the Domain: commands, queries and repository signatures don't take a convenience `null`. The transport nullable (WebAPI DTO, query parameter) is converted at the boundary (`request.GroupIds ?? []`), never propagated down.

## Documentation duty

Touching this layer, the done checklist is not satisfied until:

1. **Handler or its tests modified** → update the handler folder `CLAUDE.md`, *Tests* column included
2. **New handler or changed intent** → update the index `CLAUDE.md` of the parent feature folder (links, intent)

### Fixed shape of a handler `CLAUDE.md`

**Closed list — exactly these three `##` sections, in this order, nothing else.** No `## Décisions`, no `## Raison d'être`, no ad-hoc section: what is neither a rule, nor the flow, nor an event belongs in `docs/` or in the plan file, not here.

```markdown
# {Handler}

{Intent, one sentence.}

## Règles métier

| ID | Règle | Exception / Résultat | Tests |
|----|-------|----------------------|-------|
| RM-02 | Cloisonnement à l'organisation courante | `ProductNotFoundException` | `GetProductTests.ShouldThrowNotFound_WhenProductBelongsToAnotherOrganization` |
| RL-01 | Le macro-bloc à mettre à jour existe | `DiagramNodeNotFoundException` | `UpdateDiagramNodeTests.ShouldThrowNotFound_WhenDiagramNodeDoesNotExist` |

## Flux

Charger DiagramNodeDefinition → Valider/préparer graphe → UpdateFromStudio → Save

1 lecture + 1 écriture, quel que soit le nombre de blocs.

## Événements émis

- `DiagramNodeUpdated`
```

Authoring rules:

| Element | Rule |
|---------|------|
| `RM-xx` | Cross-handler business rule, defined in the aggregate's `docs/metier/REGLES-METIER-{AGGREGATE}.md`. Reuse the existing number. Numbering is **per document** — `RM-02` means nothing without the aggregate it belongs to, so the handler folder must sit under that aggregate's feature |
| `RL-xx` | Rule local to this handler. Numbering restarts per file |
| *Règle* cell | A label, not a paragraph. The table is an index |
| *Tests* cell | `TestClass.MethodName`, comma-separated. Empty = knowingly untested |
| Cost line | Mandatory under the flow. The only durable trace of a decision no test locks |
| Sections | Those three and no other. The hook reports a forbidden, missing or out-of-order section |

`handler-claude-md-check.sh` (PostToolUse) reports untested rules, dead test references and unbound tests. Warning only.

Repo-wide report: `python3 scripts/rules-coverage.py [--untested]`; `--fix-index` recomputes the `N règles, M testées` column of the feature index `CLAUDE.md`.

Detailed authoring guide, including the feature index format: `.claude/skills/implement-tdd/references/claude-md-handler.md`.

## Traps

- Redundant named arguments: never `Create(foo: foo, bar: bar)` when the variables already carry the parameter names
- Bulk `SaveImport(list)` → `Save(aggregate.DomainEvents)` per aggregate, through the existing repositories
- A separate context object alongside a session → merge into one business object when the context has no reason to exist alone
