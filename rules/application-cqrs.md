---
paths:
  - "src/{{PRODUCT}}.Application/**/*.cs"
---

# Application layer rules

Examples: `.claude/skills/implement-tdd/references/examples-application.md`.

Layer technical conventions live here. Folder `CLAUDE.md` under `src/` = business rules, handler/feature intent — never technical convention: only sessions opening that folder see it.

Handler orchestrates: load, call Domain, save events, return result (APP-01). No business rule, no direct mutation. Pure query reads, returns.

## Commands

Inherit `CommandHandler<TCommand, TResult>` with `ITransactionManager`, implement `HandleCommand()`, return aggregate id. Failures = domain exceptions.

One command modifies, saves **single aggregate** (DDD-08). External read targeted, non-mutating.

## Queries

`IHandler<TQuery, T>` directly — no base class, no transaction. Payload:

| Shape | Return |
|-------|--------|
| Paginated list | `Paging<T>` |
| Bounded list | `IReadOnlyList<T>` |
| Single read | aggregate or its response |

**Never `Result<T>`** — absent from codebase.

Paginated list as `IReadOnlyList<T>` loses page total: use `Paging<T>`.

## Bounds (APP-05)

- Pagination: `PaginationBounds.Normalize(query)` in query's `Create`; filter, sort pushed to SQL via Gridify
- Unpaginated branch: capped by `QueryLimits.MAX_UNPAGINATED_RESULTS`
- Never hand-code bound in handler

## Multi-tenancy

Always `IUserContextWrapper.GetUserContext()`, then `OrganizationId.From(userContext.OrganizationId)`.

## DI

Handlers auto-registered by reflection. No manual registration.

Required dependency never optional: no `IFooService? service = null`. Can be absent → revisit design.

## Folder layout

```
{Context}/{Feature}/
└── {Action}{Entity}/
    ├── {Action}{Entity}Command.cs   (or Query.cs)
    ├── I{Action}{Entity}CommandHandler.cs
    └── {Action}{Entity}CommandHandler.cs
```

`{Context}` = bounded context root (`Catalog/`, `Studio/`, `AuditTrails/`, `Import/`, `Peers/`).

## Naming

| Artifact | Pattern | Example |
|----------|---------|---------|
| Command | `{Action}{Entity}Command` | `CreateProductCommand` |
| Query | `{Action}{Entity}Query` | `GetProductsQuery` |
| Handler | `{Command/Query}Handler` | `CreateProductCommandHandler` |

## No nullable in Application (DDD-11)

As Domain: commands, queries, repository signatures take no convenience `null`. Transport nullable (WebAPI DTO, query parameter) converted at boundary (`request.GroupIds ?? []`), never propagated down.

## Documentation duty

Done checklist unsatisfied until:

1. **Handler or its tests modified** → update handler folder `CLAUDE.md`, `[Trait("RM", "…")]` on every test written

### Fixed shape of a handler `CLAUDE.md`

**Closed list — exactly these three `##` sections, this order, nothing else.** No `## Decisions`, no `## Rationale`, no ad-hoc section: neither rule, flow nor event → `docs/` or plan file, not here.

```markdown
# {Handler}

{Intent, one sentence.}

## Règles métier

| ID | Règle | Exception / Résultat |
|----|-------|----------------------|
| RM-02 | Partitioned to the current organisation | `ProductNotFoundException` |
| RL-01 | The macro block to update exists | `DiagramNodeNotFoundException` |

## Flux

Load DiagramNodeDefinition → Validate/prepare graph → UpdateFromStudio → Save

1 read + 1 write, whatever the number of blocks.

## Événements émis

- `DiagramNodeUpdated`
```

Authoring rules:

| Element | Rule |
|---------|------|
| `RM-xx` | Rule shared by several handlers of same aggregate. Numbering **per aggregate** — `RM-02` meaningless without it. Before assigning, read sibling handler `CLAUDE.md` under same feature, reuse number rule already carries; never renumber existing |
| `RL-xx` | Rule local to this handler. Numbering restarts per file |
| *Règle* cell | Label, not paragraph. Table = index |
| Rule ↔ test link | **On the test**, `[Trait("RM", "{HandlerFolder}/{RM\|RL-xx}")]`. No cell to fill: rule with no trait = knowingly untested |
| Cost line | Mandatory under flow. Only durable trace of decision no test locks |
| Sections | Those three, no other. Hook reports forbidden, missing, out-of-order section |

`handler-claude-md-check.sh` (PostToolUse) reports untested rules, traits citing rule absent from table, tests with no trait. Warning only.

Repo report: `python3 scripts/rules-coverage.py [--untested]`.

Guide: `.claude/skills/implement-tdd/references/claude-md-handler.md`.

## Traps

- Redundant named arguments: never `Create(foo: foo, bar: bar)` when variables already carry parameter names
- Bulk `SaveImport(list)` → `Save(aggregate.DomainEvents)` per aggregate, via existing repositories
- Separate context object alongside session → merge into one business object when context has no reason to exist alone
