# PRD-ARCH-PLAN — Product archiving

> Plan derived from `todo/product-archiving/SPEC-product-archiving.md`.
> Batch sheets: `PRD-ARCH-PLAN-F1.md`, `PRD-ARCH-PLAN-F2.md`.

## 0. Summary <!-- kit:summary -->

**Progress**: `1 / 2` (`50 %`)

### Batch execution

| Batch | Intent | RM/CU | Depends on | Execution | Reason |
|-------|--------|-------|------------|-----------|--------|
| F1 | A manager archives a published product | CAT-RM-003, CAT-RM-001 / CAT-CU-02 | — | sequential | foundation: adds the archived state |
| F2 | A manager restores an archived product; the listing hides archived products | CAT-RM-004, CAT-RM-005 / CAT-CU-03, CAT-CU-01 | F1 | sequential | same aggregate and endpoint group as F1 |

### Batch F1 — Archive a product — ✅ DONE (2026-10-09)
- [x] 1. A manager archives a published product of their organisation
- [x] 2. Handler documentation
- [x] 3. Build + test verification — scope: `UnitTests`, `ContractTests` · IT `--filter-class "*.Catalog.Products.*"`

### Batch F2 — Restore a product — ⬜
- [ ] 1. A manager restores an archived product
- [ ] 2. The catalogue listing hides archived products
- [ ] 3. Handler documentation
- [ ] 4. Build + test verification — scope: `UnitTests`, `ContractTests` · IT `--filter-class "*.Catalog.Products.*"`

## 1. Scope <!-- kit:scope -->

- **Spec**: `todo/product-archiving/SPEC-product-archiving.md`
- **Bounded context**: Catalog
- **Layers**: Domain / Application / Infrastructure / WebAPI / Abstractions.Models
- **Reuse**: `Product` aggregate and its `ProductStatus`; `ProductRepository.Save` event switch; `PublishProduct` handler as the sibling to mirror
- **Out of scope**: bulk archiving, customer notification (spec § 10)
- **Assumptions**: open question 1 of the spec (product in an order not yet delivered) taken as recommended — archiving allowed, the order keeps the product; to be confirmed by the product owner
- **Non-applicable rules** <!-- kit:na-rules -->: DDD-05: N/A — no cross-aggregate consistency; PERF-02: N/A — no collection loaded

## 2. Traceability <!-- kit:traceability -->

<!-- kit:cols item,owner,batch -->
| RM/CU | Code owner(s) | Batch |
|-------|---------------|-------|
| CAT-RM-003 — only a published product can be archived | `Product.Archive()` + `ProductNotPublishedException` | F1 |
| CAT-RM-001 — visible only to its organisation | `ProductRepository.GetById(orgId, id)` + `ProductNotFoundException` | F1 |
| CAT-CU-02 — archive a product | `ArchiveProductCommand` → `ArchiveProductCommandHandler` → `POST /products/{id}/archive` | F1 |
| CAT-RM-004 — archived product absent from the listing | `ProductRepository.GetPublished(orgId)` | F2 |
| CAT-CU-01 — consult products, listing without archived products | `ListCatalogueQueryHandler` → `ProductRepository.GetPublished(orgId)` | F2 |
| CAT-RM-005 — only an archived product can be restored | `Product.Restore()` + `ProductNotArchivedException` | F2 |
| CAT-CU-03 — restore a product | `RestoreProductCommand` → `RestoreProductCommandHandler` → `POST /products/{id}/restore` | F2 |
| T1 — storing an archived product, leaving it out of the listing | ADR-001 — soft archive through a status column | F1 |

## 3. DDD and Architecture design <!-- kit:ddd-design -->

| RM/CU | Owning aggregate | Invariant / code consequence | Consistency | Batch |
|-------|------------------|------------------------------|-------------|-------|
| CAT-RM-003 / CAT-CU-02 | `Product` | status checked in `Archive()` → no status check in the handler | synchronous, 1 aggregate | F1 |
| CAT-RM-005 / CAT-CU-03 | `Product` | status checked in `Restore()` | synchronous, 1 aggregate | F2 |

## 4. Cross-cutting elements (if applicable) <!-- kit:cross-cutting -->

- **DI**: none — handlers discovered by assembly scan | **Routes**: `Endpoints.Products.Archive`, `Endpoints.Products.Restore`
- **EF migrations**: out of scope — `Status` column already holds a string; `Archived` is a new value, no schema change
