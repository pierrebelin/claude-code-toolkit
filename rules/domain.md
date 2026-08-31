---
paths:
  - "src/{{PRODUCT}}.Domain/**/*.cs"
---

# Domain rules

Full code examples for this layer: `.claude/skills/implement-tdd/references/examples-domain.md`.


**Domain depends on nothing** — no HTTP, EF, SQL, DTO or Infrastructure (DDD-10). Enforced by ArchitectureTests, which also checks that API contracts live in `Abstractions` and don't leak internals.

## Base classes (`Domain/Core/`)

| Type | Base class | Example |
|------|-----------|---------|
| Aggregate Root | `AggregateRoot<TEntityId>` | `Product : AggregateRoot<ProductId>` |
| Entity | `Entity<TEntityId>` | `ProductItem : Entity<ProductItemId>` |
| Value Object | `ValueObject` | `DisplaySettings : ValueObject` |
| EntityId | `EntityId<TEntityId>` | `ProductId : EntityId<ProductId>` |
| Domain Event | `DomainEvent<TEntityId>` | `ProductCreated : DomainEvent<ProductId>` |
| Exception | `DomainException` | `ProductNotFoundException : DomainException` |

## Rules

- **Aggregate Root**: private constructor, `Create()` + event, `Restore()` without validation, mutations through business methods + event. `UserContext` passed as a parameter for audit.
- **`Create()` vs `Restore()`**: `Create()` builds, validates and emits; `Restore()` rehydrates from the DB with no validation and no event. A repository **always** calls `Restore()` to read (DDD-06).
- **Collections**: `private readonly List<T> _items` exposed as `public IReadOnlyList<T> Items => _items.AsReadOnly()`.
- **Value Objects**: reuse existing ones (`TechnicalName`, `DiagramName`, …). Never a raw `string` when a VO exists. Records rebuilt from the DB go through the VO's `Restore()`.
- **Typed IDs**: never a raw `Ulid` for an identifier (`TemplateId`, `DiagramNodeId`, …). Conversion `Ulid` → typed ID happens at the endpoint boundary; Domain, Application and Infrastructure only handle typed IDs.
- **Mutation through business methods** (DDD-03): no public setter, no mutation driven from a handler.
- **Inter-aggregate reference by ID** (DDD-05), never object navigation.
- **Logic belongs to the object owning the data** (DDD-09): `exportDiagramsContext.Serialize()`, not `DiagramExportSerializer.Serialize(context)`; `ParsedImportFile.Create(json)`, not `IParser.Parse(json)`. A Domain Service only when no business object owns the operation naturally — stateless, no Infrastructure dependency, never a repository wrapper.
- **Repository interface**: one per aggregate root, centred on that aggregate, with `Save(List<IDomainEvent<TId>>, CancellationToken)`.
- **Aggregate methods read their own state**: an aggregate never receives its own sub-entities as parameters. `release.Activate(userContext)` consuming `_draftBlockIds`, not `release.Activate(draftBlockIds, userContext)`.

## No nullable in Domain (DDD-11)

Absence is modelled, never a convenience `null`. Missing collection → `[]`, `IReadOnlyList<T>` non-nullable, semantics documented on the method ("empty = no filter" / "unchanged"). Optional concept → Null Object (`NoConstraint` instead of `PortConstraint?`), not a nullable field. `null` is only admissible for a genuinely optional scalar business value (`string? Description`).

C# can't default a parameter to `[]`, so make it required and place it before the optional parameters.

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

`{Context}` is the bounded context root (`Catalog/`, `Studio/`, `Core/`).

## Naming

| Artifact | Pattern | Example |
|----------|---------|---------|
| EntityId | `{Aggregate}Id` | `ProductId` |
| Domain event | `{Entity}{PastAction}` | `ProductCreated` |
| Exception | `{Entity}{Reason}Exception` | `ProductNotFoundException` |
| Repository | `I{Entity}Repository` | `IProductRepository` |

## Traps

- Anaemic domain (logic sitting in handlers) → logic in the aggregate
- Public setters → mutation methods emitting events
- One repository per entity → one repository per **aggregate root**. A sub-entity never gets its own repository (`IDiagramNodeSnapshotRepository` alongside `IModuleDiagramRepository`); extend the root's.
- `Create()` to rebuild from the DB → always `Restore()`
- Nullable field for an optional concept → Null Object
- Parallel collection for a new graph node type (`SnapshotReferences` alongside `Blocks`) → subtype implementing `INode`, added to the existing `Blocks`. Heterogeneity through polymorphism, not parallel lists.
