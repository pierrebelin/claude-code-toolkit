# PRD-ARCH-PLAN-F1 — Archive a product — ✅ DONE (2026-10-09)

> Batch F1 of plan `PRD-ARCH-PLAN.md`. Spec: `todo/product-archiving/SPEC-product-archiving.md`.
> Reading: **Intent**, **Design**, **Decisions** say why; **TDD sequence** what gets written and in which order; **Code elements** the signature detail; **Ancrages** the exact paths where all of it lands.

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
| Access cost | 1 read + 1 write |

## Decisions <!-- kit:decisions -->

### ADR-001 — Soft archive through a status column
Choice: `Product.Status = Archived`; listing queries filter on it.
Why: one read path, history preserved (CAT-D-001).
Rejected: archive table (two read paths); event-sourced projection (no event store).
Consequences: every catalogue query filters on `Status`; index on (OrganisationId, Status).
Links: T1, CAT-RM-004, CAT-CU-02, CAT-CU-03

- `PublishProduct` mirrored for the handler, the endpoint and the tests: same aggregate, same shape.

## TDD sequence <!-- kit:tdd-sequence -->

One step = one RED → GREEN → COST cycle. The tests below are **written and red before a single production line** of the step. Order inside a step: success first (it fixes the signatures), refusals next, integration then contract last.

Declarative artefacts with no prior RED: `ArchiveProductRequest` DTO. Covered by the contract test of step 1.

### Step 1 — A manager archives a published product of their organisation

| # | Test | Level | Project | RM |
|---|------|-------|---------|-----|
| 1 | `ShouldSaveProductArchivedEvent_WhenProductIsPublished` | UT | `UnitTests` | CAT-RM-003 |
| 2 | `ShouldThrowProductNotPublishedException_WhenProductIsDraft` | UT | `UnitTests` | CAT-RM-003 |
| 3 | `ShouldThrowProductNotPublishedException_WhenProductIsAlreadyArchived` | UT | `UnitTests` | CAT-RM-003 |
| 4 | `ShouldThrowProductNotFoundException_WhenProductBelongsToAnotherOrganisation` | UT | `UnitTests` | CAT-RM-001 |
| 5 | `ShouldPersistArchivedStatus_WhenProductArchivedEventIsSaved` | IT | `IntegrationTests` | CAT-RM-003 |
| 6 | `ShouldReturnNoContent_WhenArchiveRequestIsValid` | contract | `ContractTests` | — |

Docker required from test 5.

TDD: RED ✅ · GREEN ✅ · COST ✅

### Step 2 — Handler documentation

No test: creates `ArchiveProduct/CLAUDE.md`; feature index unchanged.

✅ DONE (2026-10-09)

### Step 3 — Build + test verification

No new test: replay of the scopes named in `## Test policy and scopes`.

✅ DONE (2026-10-09)

## Test policy and scopes <!-- kit:test-policy -->

**Handler policy**: command = `SavedEvents` asserted by type and payload. Never a spy, a counter, nor a call assertion. Never a direct test on the aggregate: its behaviour is proven through the handler.

**IT regression scope**: `--filter-class "*.Catalog.Products.*"`.

**Verification step scope**: `UnitTests`, `ContractTests` whole; IT filtered above; E2E not run — no lifecycle before F2.

**E2E**: omitted in F1 — the archive → restore lifecycle lands with F2.

## Code elements <!-- kit:code-elements -->

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

**`ArchiveProduct`** — `POST /products/{id}/archive` → command → dispatch → `204`

## Ancrages <!-- kit:ancrages -->

| Step | Test class / fixture | `CoreTests` builders and doubles | Production filled or created |
|-------|--------------------------|----------------------------------|-----------------------------|
| 1 — Archive a product | `tests/{{PRODUCT}}.UnitTests/Catalog/Products/ArchiveProduct/ArchiveProductTests.cs` — _to create_ ; `ArchiveProductFixture.cs` — _to create_, mirrors `PublishProduct/PublishProductFixture.cs` | `tests/{{PRODUCT}}.CoreTests/DataBuilder/Products/ProductBuilder.cs` (`Archived()` to add) ; `Doubles/MockProductRepository.cs` | `src/{{PRODUCT}}.Application/Catalog/Products/ArchiveProduct/ArchiveProductCommandHandler.cs` — _to create_ ; `src/{{PRODUCT}}.Domain/Catalog/Aggregates/Product.cs` — `Archive` |
| 1 — Archive a product (IT) | `tests/{{PRODUCT}}.IntegrationTests/Catalog/ProductRepository/Save/SaveTests.cs` — _existing_ | `tests/{{PRODUCT}}.CoreTests/DataBuilder/Products/ProductEntityBuilder.cs` | `src/{{PRODUCT}}.Infrastructure/Catalog/ProductRepository.cs` |
| 1 — Archive a product (contract) | `tests/{{PRODUCT}}.ContractTests/Catalog/ArchiveProductTests.cs` — _to create_ | `tests/{{PRODUCT}}.ContractTests/Core/WebApplicationFactory.cs` | `src/{{PRODUCT}}.WebAPI/Endpoints/Products/ArchiveProduct.cs` ; `Endpoints/Endpoints.cs` |
| 2 — Documentation | — | — | `src/{{PRODUCT}}.Application/Catalog/Products/ArchiveProduct/CLAUDE.md` |
| 3 — Verification | — | — | — |

## Assumptions <!-- kit:assumptions -->

| # | Assumption | To be validated by |
|---|------------|--------------------|
| H1 | `ArchivedAt` comes from `TimeProvider`, not from the request | Tech lead |
