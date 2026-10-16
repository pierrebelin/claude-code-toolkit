# CAT-CU-03 — Restore an archived product

A catalogue manager puts back on sale a product archived by mistake.

## Rules

Also applies: CAT-RM-001, CAT-RM-004 — the product reappears in the catalogue listing.

### CAT-RM-005 — Only an archived product can be restored
Outcome: `ProductNotArchivedException`

## Handlers <!-- kit:handlers -->

- `RestoreProductCommandHandler`: load Product (organisation scope), `Product.Restore()`, save. 1 read + 1 write. Emits `ProductRestored`.
