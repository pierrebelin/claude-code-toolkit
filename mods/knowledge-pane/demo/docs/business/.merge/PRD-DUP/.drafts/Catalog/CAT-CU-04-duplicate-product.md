# CAT-CU-04 — Duplicate a product

A catalogue manager copies a product to start a new one from it; the copy is a separate product.

## Rules

Also applies: CAT-RM-001.

### CAT-RM-006 — A duplicate starts as a draft
Outcome: the copy has `Status = Draft` whatever the status of its source, archived included.

## Handlers <!-- kit:handlers -->

- `DuplicateProductCommandHandler`: load Product (organisation scope), `Product.Duplicate(newId)`, save the copy. 1 read + 1 write. Emits `ProductDuplicated`.
