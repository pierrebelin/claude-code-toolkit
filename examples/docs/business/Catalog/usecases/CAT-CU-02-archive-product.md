# CAT-CU-02 — Archive a product

A catalogue manager withdraws a published product; it stays readable for history.

## Rules

Also applies: CAT-RM-001, CAT-RM-004 — the product leaves the catalogue listing.

### CAT-RM-003 — Only a published product can be archived
Outcome: `ProductNotPublishedException`

## Handlers <!-- kit:handlers -->

- `ArchiveProductCommandHandler`: load Product (organisation scope), `Product.Archive(now)`, save. 1 read + 1 write. Emits `ProductArchived`.
