---
paths:
  - "src/{{PRODUCT}}.Infrastructure/**/*.cs"
  - "src/{{PRODUCT}}.MigrationService/**/*.cs"
  - "src/{{PRODUCT}}.MigrationDsl/**/*.cs"
---

# Infrastructure rules

Examples: `.claude/skills/implement-tdd/references/examples-infrastructure.md`.

Infrastructure translates IO. No business rule (APP-04).

## Repositories

- Inject `IUnitOfWork<AppDbContext>` + `IAuditTrailWriter`. `Save` switches over domain events (APP-03).
- Read for consultation with `AsNoTracking()`; a read feeding a `Save` stays tracked.
- Rehydration always through the aggregate's `Restore()`, never `Create()`.
- One repository per **aggregate root**. A sub-entity never gets its own repository; extend the root's.

## Uniqueness is owned by the persistence constraint

Repository translates constraint violation into domain exception (`{Entity}{Reason}AlreadyExistsException`), filter naming precise index. Without it, concurrent creation = 500 not 409. Upstream check in handler or aggregate = early failure, never the guard.

## EF Core entities

Inherit `AbstractEntity<Ulid>`. Inline configuration via `[EntityTypeConfiguration]` + `IEntityTypeConfiguration<T>`.

## Mappers

Static `{Entity}Mapper` with `MapToDomain()` (calls `Restore()`) and `MapToEntity()`. No AutoMapper.

## DI

Explicit `AddScoped<IRepo, Repo>()` in `InfrastructureServicesExtensions.cs`. Unlike Application handlers, Infrastructure not auto-scanned.

## DB storage

- String size ladder: 26/32/64/128/256/512/1024/2048/max
- Enums as **bounded** strings
- `Latin1_General_CS_AS` collation on natural-key names (`ModuleDiagramEntity`, `StoredFileEntity.Path`, `FileDeclarationEntity`) — SQL Server only
- Unique indexes named `UK_{Entity}_{Columns}` via `HasDatabaseName`

## Access cost (PERF-01)

Call count per behaviour **bounded, independent of input size**. No test observes it: pressure comes from design, not suite. `await` on repository inside loop = design defect.

Before adding repository method, check none answers in one query already. Dedicated method justified when it **changes shape** of read (SQL filter, projection, join), not when renaming existing.

Symptom/fix table, COST step of TDD cycle → skill `/implement-tdd`, `.claude/skills/implement-tdd/references/conventions.md` § "Data access".

## Naming

| Artifact | Pattern | Example |
|----------|---------|---------|
| EF entity | `{Entity}Entity` | `ProductEntity` |
| Mapper | `{Entity}Mapper` | `ProductMapper` |
