# DDD examples

Read only the sections of the ids applied in the batch sheet.

## DDD-02 / DDD-03 — Aggregate and behaviour

**Conforming**: `ChangeOwnerHandler` loads `Document`, calls `copy.ChangeOwner(ownerId)`, then saves `DocumentOwnerChanged`. `Document` rejects an invalid owner.

**Not conforming**: the handler checks the business rule then assigns `copy.OwnerId = ownerId`.

## DDD-04 / DDD-05 — Concept and reference

**Conforming**: `Product.Name` is a `Name` VO validating its format once (`Name.Create`), reused by every aggregate carrying a name; `Key` stores a `ProductId`, not a navigable `Product`.

**Not conforming**: `public string Name` with the format rule copied into `Create()` and again into `Update()`; a `ProductName` VO created while `Name` already covers the need; an aggregate holding another aggregate's objects.

## DDD-06 / DDD-07 — Lifecycle and internal event

**Conforming**: `Product.Create(...)` produces `ProductCreated`; the repository calls `Product.Restore(...)` to read the database back and translates `ProductCreated` inside `Save`.

**Not conforming**: the repository calls `Create()` on rehydration, or publishes the event outside the persistence process.

## DDD-08 — One command, one modified aggregate

**Conforming**: `RenameProductHandler` loads and saves `Product`; a targeted read supplies only a context identifier.

**Not conforming**: the handler loads, modifies and saves `Product` and `Order` in the same command with no explicit exception.

## DDD-09 / DDD-10 — Owner of the logic and technical boundary

**Conforming**: the object owning the data owns the operation — `exportDiagramsContext.Serialize()`, `ParsedImportFile.Create(json)`. A stateless Domain Service appears only for a rule no business object owns. EF and HTTP stay in Infrastructure/WebAPI.

**Not conforming**: `DiagramExportSerializer.Serialize(context)`, `IParser.Parse(json)` or any static helper taking a business object's state as a parameter to reason in its place. `OrderDomainService` as a repository wrapper. A Domain entity carrying a `DbContext`.

## DDD-11 — Modelled absence

**Conforming**: `IReadOnlyList<GroupId> groupIds` non-nullable, empty = "no filter" documented on the method; the endpoint converts `request.GroupIds ?? []` at the boundary. Optional constraint → `NoConstraint`, implementing the neutral behaviour.

**Not conforming**: `IReadOnlyList<GroupId>? groupIds` propagated down to the repository, `PortConstraint?` tested with `is null` at every use, or a handler interpreting `null` as "unchanged" without the method saying so.
