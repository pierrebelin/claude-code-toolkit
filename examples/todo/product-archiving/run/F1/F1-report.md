## STATUS — DONE

Reason: every behaviour green, audit `VALID` on the first pass.

**Files**

| Layer | File | Change |
|-------|------|--------|
| Domain | `Catalog/Aggregates/Product.cs` | `Archive` |
| Domain | `Catalog/Events/ProductArchived.cs` | new |
| Domain | `Catalog/Exceptions/ProductNotPublishedException.cs` | new |
| Application | `Catalog/Products/ArchiveProduct/ArchiveProductCommandHandler.cs` | new |
| Application | `Catalog/Products/ArchiveProduct/CLAUDE.md` | new |
| Infrastructure | `Catalog/ProductRepository.cs` | `Save` switch |
| WebAPI | `Endpoints/Products/ArchiveProduct.cs` | new |

**Access cost**: archive a product — 1 read + 1 write.

**Assumptions**: `H1` — `ArchivedAt` from `TimeProvider`, to be validated by the tech lead.

**Reported without fixing**: none.

**Verdict**: `VALID` — DDD-01, DDD-02, DDD-03, DDD-08, APP-01, APP-02, PERF-01.

**Validations**

| Command | Exit | Scope | Tests |
|---------|------|-------|-------|
| `dotnet test --project tests/{{PRODUCT}}.UnitTests` | 0 | whole suite | 412 |
| `dotnet test --project tests/{{PRODUCT}}.ContractTests` | 0 | whole suite | 96 |
| `dotnet test --project tests/{{PRODUCT}}.IntegrationTests --filter-class "*.Catalog.Products.*"` | 0 | filtered | 38 |

Not run: E2E — no lifecycle before F2.

**ArchiveProductTests**

| Test | RM/CU | Use case verified |
|------|-------|-------------------|
| `ShouldSaveProductArchivedEvent_WhenProductIsPublished` | RM-01 | Published product archived |
| `ShouldThrowProductNotPublishedException_WhenProductIsDraft` | RM-01 | Draft refused |
| `ShouldThrowProductNotPublishedException_WhenProductIsAlreadyArchived` | RM-01 | Archived refused |
| `ShouldThrowProductNotFoundException_WhenProductBelongsToAnotherOrganisation` | RM-02 | Other organisation hidden |

**SaveTests**

| Test | RM/CU | Use case verified |
|------|-------|-------------------|
| `ShouldPersistArchivedStatus_WhenProductArchivedEventIsSaved` | RM-01 | Archived status stored |

**ArchiveProductTests (contract)**

| Test | RM/CU | Use case verified |
|------|-------|-------------------|
| `ShouldReturnNoContent_WhenArchiveRequestIsValid` | CU-01 | Route answers 204 |

## Audit gaps

None.
