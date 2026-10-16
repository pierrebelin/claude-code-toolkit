# CAT-CU-01 — Consult products

A user of an organisation reads one of its products or browses its catalogue listing.

## Rules

Also applies: CAT-RM-001, CAT-RM-004.

### CAT-RM-002 — The catalogue listing is sorted by name
Observed: `src/{{PRODUCT}}.Application/Catalog/Products/ListCatalogue/ListCatalogueQueryHandler.cs:31` <!-- kit:observed medium -->

## Handlers <!-- kit:handlers -->

- `GetProductQueryHandler`: load Product (organisation scope). 1 read.
- `ListCatalogueQueryHandler`: published products of the organisation, sorted by name. 1 read.
