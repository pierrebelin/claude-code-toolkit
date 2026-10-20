# PRD-ARCH-PLAN-F1 — Archive a product — ✅ DONE (2026-10-09)

> Batch F1 of plan `PRD-ARCH-PLAN.md`. Spec: `todo/product-archiving/SPEC-product-archiving.md`.
> Reading: **Intent**, **Design**, **Decisions** say why; **Code elements** the signature detail; **Cycles** the tests, the exact paths and the order of the TDD cycles.

## Intent <!-- kit:intent -->

A catalogue manager archives a published product of their organisation (CAT-CU-02). **RM**: CAT-RM-003, CAT-RM-001 | **CU**: CAT-CU-02

## Design <!-- kit:design -->

| Point | Decision |
|-------|----------|
| Applied rules <!-- kit:applied-rules --> | DDD-01, DDD-02, DDD-03, DDD-08, APP-01, APP-02, PERF-01 |
| Owning aggregate | `Product`; the handler only orchestrates |
| Invariants | CAT-RM-003; consequence: the handler reads no status, `Archive()` refuses |
| Consistency | one command modifies and saves `Product` |
| Events | internal to persistence: `ProductArchived`, payload `ProductId`, `ArchivedAt` |
| Access cost | 1 read + 1 write, independent of the number of products of the organisation |

## Decisions <!-- kit:decisions -->

### ADR-001 — Soft archive through a status column
Choice: `Product.Status = Archived`; listing queries filter on it.
Why: one read path, history preserved (CAT-D-001).
Rejected: archive table (two read paths); event-sourced projection (no event store).
Consequences: every catalogue query filters on `Status`; index on (OrganisationId, Status).
Links: T1, CAT-RM-004, CAT-CU-02, CAT-CU-03

- `PublishProduct` mirrored for the handler, the endpoint and the tests: same aggregate, same shape.

## Test policy and scopes <!-- kit:test-policy -->

**Handler policy**: command = `SavedEvents` asserted by type and payload. Never a spy, a counter, nor a call assertion. Never a direct test on the aggregate: its behaviour is proven through the handler.

**IT regression scope**: `--filter-class "*.Catalog.Products.*"`.

**Global green scope**: `UnitTests`, `ContractTests` whole; IT filtered above; E2E not run — no lifecycle before F2.

**E2E**: omitted in F1 — the archive → restore lifecycle lands with F2.

## Code elements <!-- kit:code-elements -->

Signature and pseudo-code detail of every artefact `## Cycles` cites. Reference section, consulted during RED for the signatures and during GREEN for the content; it dictates neither order nor scope.

### Domain

**`Product`** — _modified_
- `Archive(DateTimeOffset now)`: status `Published` → `Archived` (CAT-RM-003) → event `ProductArchived`
- **Invariants**: only `Published` can be archived — CAT-RM-003

**`ProductArchived`** — payload: `ProductId`, `ArchivedAt`, emitted by `Product.Archive`

**`ProductNotPublishedException`** — raised by CAT-RM-003

### Application

**`ArchiveProductCommand`** — props: `ProductId`, returns: nothing

**`ArchiveProductCommandHandler`** — deps: `IProductRepository`, `IUserContextAccessor`, `TimeProvider`
- OrgId → load `Product` (CAT-RM-001) → `Archive(now)` → Save events

### Infrastructure

**`ProductRepository`** — _modified_
- Save: switch adds `ProductArchived` → `Status = "Archived"`

### WebAPI

**`ArchiveProduct`** — `POST /products/{id}/archive` → `ArchiveProductRequest` → command → dispatch → `204`

## Cycles

```json
{
 "declaratives": ["src/{{PRODUCT}}.Abstractions.Models/Catalog/ArchiveProductRequest.cs — mirrors PublishProductRequest.cs; props `ProductId`"],
 "cycles": [
  {
   "id": "C1", "wave": 1,
   "behaviour": "A manager archives a published product of their organisation",
   "rmcu": "CAT-RM-003, CAT-RM-001 / CAT-CU-02", "steps": ["1. A manager archives a published product of their organisation"],
   "level": "UT", "skill": "tests-unit-tests",
   "testClass": "ArchiveProductTests", "fixture": "ArchiveProductFixture",
   "methods": ["ArchiveProductTests.ShouldSaveProductArchivedEvent_WhenProductIsPublished", "ArchiveProductTests.ShouldThrowProductNotPublishedException_WhenProductIsDraft", "ArchiveProductTests.ShouldThrowProductNotPublishedException_WhenProductIsAlreadyArchived", "ArchiveProductTests.ShouldThrowProductNotFoundException_WhenProductBelongsToAnotherOrganisation"],
   "full": ["tests/{{PRODUCT}}.UnitTests/Catalog/Products/ArchiveProduct/ArchiveProductTests.cs (to create)", "tests/{{PRODUCT}}.UnitTests/Catalog/Products/ArchiveProduct/ArchiveProductFixture.cs (to create)"],
   "bounded": ["tests/{{PRODUCT}}.CoreTests/DataBuilder/Products/ProductBuilder.cs — `Archived()` to add", "tests/{{PRODUCT}}.CoreTests/Doubles/MockProductRepository.cs"],
   "observation": "SavedEvents holds ProductArchived with ProductId and ArchivedAt; ProductNotPublishedException; ProductNotFoundException",
   "outOfScope": "",
   "toCreate": ["src/{{PRODUCT}}.Application/Catalog/Products/ArchiveProduct/ArchiveProductCommand.cs", "src/{{PRODUCT}}.Application/Catalog/Products/ArchiveProduct/ArchiveProductCommandHandler.cs", "src/{{PRODUCT}}.Domain/Catalog/Events/ProductArchived.cs", "src/{{PRODUCT}}.Domain/Catalog/Exceptions/ProductNotPublishedException.cs"],
   "production": ["src/{{PRODUCT}}.Application/Catalog/Products/ArchiveProduct/ArchiveProductCommand.cs", "src/{{PRODUCT}}.Application/Catalog/Products/ArchiveProduct/ArchiveProductCommandHandler.cs", "src/{{PRODUCT}}.Domain/Catalog/Aggregates/Product.cs", "src/{{PRODUCT}}.Domain/Catalog/Events/ProductArchived.cs", "src/{{PRODUCT}}.Domain/Catalog/Exceptions/ProductNotPublishedException.cs", "src/{{PRODUCT}}.Application/Catalog/Products/ArchiveProduct/CLAUDE.md"],
   "ripple": [], "boundedGreen": [],
   "models": ["src/{{PRODUCT}}.Application/Catalog/Products/PublishProduct/PublishProductCommandHandler.cs — same command shape", "tests/{{PRODUCT}}.UnitTests/Catalog/Products/PublishProduct/PublishProductFixture.cs"]
  },
  {
   "id": "C2", "wave": 2,
   "behaviour": "An archived product is stored with the archived status",
   "rmcu": "CAT-RM-003 / CAT-CU-02", "steps": ["1. A manager archives a published product of their organisation"],
   "level": "IT", "skill": "tests-integration-tests",
   "testClass": "SaveTests", "fixture": "SaveFixture",
   "methods": ["SaveTests.ShouldPersistArchivedStatus_WhenProductArchivedEventIsSaved"],
   "full": ["tests/{{PRODUCT}}.IntegrationTests/Catalog/ProductRepository/Save/SaveTests.cs"],
   "bounded": ["tests/{{PRODUCT}}.CoreTests/DataBuilder/Products/ProductEntityBuilder.cs"],
   "observation": "the stored product has Status = \"Archived\"",
   "outOfScope": "",
   "toCreate": [],
   "production": ["src/{{PRODUCT}}.Infrastructure/Catalog/ProductRepository.cs"],
   "ripple": [], "boundedGreen": []
  },
  {
   "id": "C3", "wave": 2,
   "behaviour": "The archive route answers 204 on a valid request",
   "rmcu": "CAT-CU-02", "steps": ["1. A manager archives a published product of their organisation"],
   "level": "contract", "skill": "tests-contract-tests",
   "testClass": "ArchiveProductTests", "fixture": "WebApplicationFactory",
   "methods": ["ArchiveProductTests.ShouldReturnNoContent_WhenArchiveRequestIsValid"],
   "full": ["tests/{{PRODUCT}}.ContractTests/Catalog/ArchiveProductTests.cs (to create)"],
   "bounded": ["tests/{{PRODUCT}}.ContractTests/Core/WebApplicationFactory.cs"],
   "observation": "204, empty body",
   "outOfScope": "",
   "toCreate": ["src/{{PRODUCT}}.WebAPI/Endpoints/Products/ArchiveProduct.cs"],
   "production": ["src/{{PRODUCT}}.WebAPI/Endpoints/Products/ArchiveProduct.cs", "src/{{PRODUCT}}.WebAPI/Endpoints/Endpoints.cs"],
   "ripple": [], "boundedGreen": []
  }
 ]
}
```

## Assumptions <!-- kit:assumptions -->

| # | Assumption | To be validated by |
|---|------------|--------------------|
| H1 | `ArchivedAt` comes from `TimeProvider`, not from the request | Tech lead |
