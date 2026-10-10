# PRD-ARCH-PLAN — Product archiving

> Plan derived from `todo/product-archiving/SPEC-product-archiving.md`.
> Batch sheets: `PRD-ARCH-PLAN-F1.md`, `PRD-ARCH-PLAN-F2.md`.

## 0. Summary <!-- kit:summary -->

**Progress**: `1 / 2` (`50 %`)

### Batch execution

| Batch | Intent | RM/CU | Depends on | Execution | Reason |
|-------|--------|-------|------------|-----------|--------|
| F1 | A manager archives a published product | RM-01, RM-02 / CU-01 | — | sequential | foundation: adds the archived state |
| F2 | A manager restores an archived product; the listing hides archived products | RM-03, RM-04 / CU-02 | F1 | sequential | same aggregate and endpoint group as F1 |

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
- **Assumptions**: open question 1 of the spec (retention limit) settled as "no limit" with the user on 2026-10-08
- **Non-applicable rules** <!-- kit:na-rules -->: DDD-05: N/A — no cross-aggregate consistency; PERF-02: N/A — no collection loaded

## 2. Traceability <!-- kit:traceability -->

| RM/CU | Code owner(s) | Batch |
|-------|---------------|-------|
| RM-01 — only a published product can be archived | `Product.Archive()` + `ProductNotPublishedException` | F1 |
| RM-02 — visible only to its organisation | `ProductRepository.GetById(orgId, id)` + `ProductNotFoundException` | F1 |
| CU-01 — archive a product | `ArchiveProductCommand` → `ArchiveProductCommandHandler` → `POST /products/{id}/archive` | F1 |
| RM-03 — archived product absent from the listing | `ProductRepository.GetPublished(orgId)` | F2 |
| RM-04 — only an archived product can be restored | `Product.Restore()` + `ProductNotArchivedException` | F2 |
| CU-02 — restore a product | `RestoreProductCommand` → `RestoreProductCommandHandler` → `POST /products/{id}/restore` | F2 |

## 3. DDD and Architecture design <!-- kit:ddd-design -->

| RM/CU | Owning aggregate | Invariant / code consequence | Consistency | Batch |
|-------|------------------|------------------------------|-------------|-------|
| RM-01 / CU-01 | `Product` | status checked in `Archive()` → no status check in the handler | synchronous, 1 aggregate | F1 |
| RM-04 / CU-02 | `Product` | status checked in `Restore()` | synchronous, 1 aggregate | F2 |

## 4. Cross-cutting elements (if applicable) <!-- kit:cross-cutting -->

- **DI**: none — handlers discovered by assembly scan | **Routes**: `Endpoints.Products.Archive`, `Endpoints.Products.Restore`
- **EF migrations**: out of scope — `Status` column already holds a string; `Archived` is a new value, no schema change
