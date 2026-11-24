# CAT-CU-03 — Restore an archived product

A catalogue manager puts back on sale a product archived by mistake.

## Rules

Also applies: CAT-RM-001, CAT-RM-004 — the product reappears in the catalogue listing.

### CAT-RM-005 — Only an archived product can be restored
Outcome: `ProductNotArchivedException`; the archive date is cleared on restore.
Observed: `src/{{PRODUCT}}.Domain/Catalog/Aggregates/Product.cs:58` <!-- kit:observed high -->

### CAT-RM-?1 — A product archived more than a year ago cannot be restored
Outcome: `ProductArchiveExpiredException`
Observed: `src/{{PRODUCT}}.Domain/Catalog/Aggregates/Product.cs:61` <!-- kit:observed medium -->

## Handlers <!-- kit:handlers -->

- `RestoreProductCommandHandler`: load Product (organisation scope), `Product.Restore(now)`, save. 1 read + 1 write. Emits `ProductRestored`.
