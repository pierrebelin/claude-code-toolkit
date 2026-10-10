# ArchiveProductCommandHandler

Withdraws a published product from the catalogue, keeping it readable for history.

## Business rules <!-- kit:rules -->

<!-- kit:cols id,rule,outcome -->
| ID | Rule | Exception / Outcome |
|----|------|---------------------|
| RM-01 | Only a published product can be archived | `ProductNotPublishedException` |
| RM-02 | Partitioned to the current organisation | `ProductNotFoundException` |

## Flow <!-- kit:flow -->

Load Product (organisation scope) → `Product.Archive(now)` → Save

1 read + 1 write.

## Emitted events <!-- kit:events -->

- `ProductArchived`
