---
paths:
  - "src/{{PRODUCT}}.Domain/**/*.cs"
---

# Domain rules

Code pattern: an existing file of the same kind in this repo — `graphify query`, or a sibling folder. The repo is the example.

**Domain depends on nothing** — no HTTP, EF, SQL, DTO, Infrastructure (DDD-10). Enforced by ArchitectureTests, which also checks API contracts live in `Abstractions`, leak no internals.

## Base classes (`Domain/Core/`)

| Type | Base class | Example |
|------|-----------|---------|
| Aggregate Root | `AggregateRoot<TEntityId>` | `Product : AggregateRoot<ProductId>` |
| Entity | `Entity<TEntityId>` | `ProductItem : Entity<ProductItemId>` |
| Value Object | `ValueObject` | `DisplaySettings : ValueObject` |
| EntityId | `EntityId<TEntityId>` | `ProductId : EntityId<ProductId>` |
| Domain Event | `DomainEvent<TEntityId>` | `ProductCreated : DomainEvent<ProductId>` |
| Exception | base under `Domain/Core/Exceptions/Base/`: `NotFoundException` (404), `ConflictException` (409) — both deriving from `DomainException` (400, default) —, `ForbiddenException` (403), `ValidationException` (400, error dictionary) — these two derive from `Exception` + `IInternalException` | `ProductNotFoundException : NotFoundException` |

## Rules

- **Aggregate Root**: private constructor, `Create()` + event, `Restore()` without validation, mutations via business methods + event. `UserContext` parameter for audit.
- **`Create()` vs `Restore()`**: `Create()` builds, validates, emits; `Restore()` rehydrates from DB, no validation, no event. Repository **always** reads via `Restore()` (DDD-06).
- **Properties**: mutable `{ get; private set; }`, immutable `{ get; }` set in the constructor.
- **Collections**: `private readonly List<T> _items` exposed as `public IReadOnlyList<T> Items => _items.AsReadOnly()`.
- **Value Objects**: reuse existing (`Name`, `TechnicalName`, `DiagramName` under `Domain/Core/ValueObjects/`). Never raw `string` for a concept carrying a format rule (DDD-04). Implement `GetEqualityComponents()`. A VO with a format rule exposes `Create()` (validates — the aggregate calls it, never rewrites the check: empty name = `EmptyNameException`) and `Restore()` (from DB, no validation).
- **Persistence event** carries the primitive form (`validatedName.Value`): it feeds the EF mapper.
- **Domain event = positional record** passing its parameters to the base: `sealed record ProductDeleted(ProductId Id, string Name, UserContext UserContext) : DomainEvent<ProductId>(Id);`. Never an explicit constructor copying into `{ get; }` properties — existing ones are legacy, never a pattern to copy. Changing an event's base (e.g. making it audited) never changes its shape.
- **Typed IDs**: `ProductId.Create()` new, `ProductId.From(ulid)` existing; never raw `Ulid` for identifier (`ProductItemId`, `DiagramNodeId`, …). `Ulid` → typed ID conversion at endpoint boundary; Domain, Application, Infrastructure handle typed IDs only.
- **Mutation via business methods** (DDD-03): no public setter, no handler-driven mutation.
- **Inter-aggregate reference by ID** (DDD-05), never object navigation.
- **Logic belongs to object owning data** (DDD-09): `exportDiagramsContext.Serialize()`, not `DiagramExportSerializer.Serialize(context)`; `ParsedImportFile.Create(json)`, not `IParser.Parse(json)`. Domain Service only when no business object owns operation naturally — stateless, no Infrastructure dependency, never repository wrapper.
- **Repository interface**: one per aggregate root, centred on it, with `Save(List<IDomainEvent<TId>>, CancellationToken)`.
- **Aggregate methods read own state**: aggregate never receives own sub-entities as parameters. `release.Activate(userContext)` consuming `_draftBlockIds`, not `release.Activate(draftBlockIds, userContext)`.

## No nullable in Domain (DDD-11)

Absence modelled, never convenience `null`. Missing collection → `[]`, `IReadOnlyList<T>` non-nullable, semantics documented on method ("empty = no filter" / "unchanged"). Optional concept → Null Object (`NoConstraint` instead of `PortConstraint?`), not nullable field. `null` admissible only for genuinely optional scalar business value (`string? Description`).

C# can't default parameter to `[]`: make it required, place before optional parameters.

## Folder layout

```
{Context}/{Feature}/
├── Aggregates/{Aggregate}.cs
├── Entities/{Entity}.cs
├── ValueObjects/{ValueObject}.cs
├── Events/{Event}.cs
├── Exceptions/{Exception}.cs
└── I{Entity}Repository.cs
```

`{Context}` = bounded context root (`Catalog/`, `Studio/`, `Core/`).

## Naming

| Artifact | Pattern | Example |
|----------|---------|---------|
| EntityId | `{Aggregate}Id` | `ProductId` |
| Domain event | `{Entity}{PastAction}` | `ProductCreated` |
| Exception | `{Entity}{Reason}Exception` | `ProductNotFoundException` |
| Repository | `I{Entity}Repository` | `IProductRepository` |

## Traps

- Anaemic domain (logic in handlers) → logic in aggregate
- Public setters → mutation methods emitting events
- Repository per entity → one per **aggregate root**. Sub-entity never gets own repository (`IDiagramNodeSnapshotRepository` alongside `IModuleDiagramRepository`); extend root's.
- `Create()` to rebuild from DB → always `Restore()`
- Nullable field for optional concept → Null Object
- Parallel collection for new graph node type (`SnapshotReferences` alongside `Blocks`) → subtype implementing `INode`, added to existing `Blocks`. Heterogeneity via polymorphism, not parallel lists.
