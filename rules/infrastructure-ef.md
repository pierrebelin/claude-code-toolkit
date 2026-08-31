---
paths:
  - "src/{{PRODUCT}}.Infrastructure/**/*.cs"
  - "src/{{PRODUCT}}.MigrationService/**/*.cs"
  - "src/{{PRODUCT}}.MigrationDsl/**/*.cs"
---

# Infrastructure rules

Full code examples for this layer: `.claude/skills/implement-tdd/references/examples-infrastructure.md`.


Infrastructure translates IO. It carries no business rule (APP-04).

## Repositories

- Inject `IUnitOfWork<AppDbContext>` + `IAuditTrailWriter`. `Save` switches over the domain events (APP-03).
- Read for consultation with `AsNoTracking()`; a read feeding a `Save` stays tracked.
- Rehydration always through the aggregate's `Restore()`, never `Create()`.
- One repository per **aggregate root**. A sub-entity never gets its own repository; extend the root's.

## Uniqueness is owned by the persistence constraint

The repository translates the constraint violation into a domain exception (`{Entity}{Reason}AlreadyExistsException`), with a filter naming the precise index. Without that translation, a concurrent creation surfaces as a 500 instead of a 409. An upstream uniqueness check in a handler or aggregate is an early failure, never the guard.

## EF Core entities

Inherit `AbstractEntity<Ulid>`. Inline configuration via `[EntityTypeConfiguration]` + `IEntityTypeConfiguration<T>`.

## Mappers

Static `{Entity}Mapper` with `MapToDomain()` (calls `Restore()`) and `MapToEntity()`. No AutoMapper.

## DI

Explicit registration `AddScoped<IRepo, Repo>()` in `InfrastructureServicesExtensions.cs`. Unlike Application handlers, Infrastructure is not auto-scanned.

## DB storage

- String size ladder: 26/32/64/128/256/512/1024/2048/max
- Enums as **bounded** strings
- `Latin1_General_CS_AS` collation on natural-key names (`ModuleDiagramEntity`, `StoredFileEntity.Path`, `FileDeclarationEntity`) — SQL Server only
- Unique indexes named `UK_{Entity}_{Columns}` via `HasDatabaseName`

## Access cost (PERF-01)

The number of Infrastructure calls for a behaviour is **bounded and independent of the input size**. No test observes the call count, so the pressure comes from design, not from the suite. An `await` on a repository inside a loop is a design defect.

Before adding a repository method, check no existing one already answers in one query. A dedicated method is justified when it **changes the shape** of the read (SQL filter, projection, join), not when it renames the existing one.

Symptom/fix table and the COST step of the TDD cycle → skill `/implement-tdd`, `.claude/skills/implement-tdd/references/conventions.md` § "Data access".

## Naming

| Artifact | Pattern | Example |
|----------|---------|---------|
| EF entity | `{Entity}Entity` | `ProductEntity` |
| Mapper | `{Entity}Mapper` | `ProductMapper` |
