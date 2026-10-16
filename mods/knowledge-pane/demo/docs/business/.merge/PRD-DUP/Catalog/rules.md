# Catalog — cross-cutting rules

### CAT-RM-001 — A product is visible only to its organisation
Outcome: a product of another organisation is reported as not found, `ProductNotFoundException`, never as forbidden; a duplicate stays in the organisation of its source.

### CAT-RM-004 — An archived product is absent from the catalogue listing
Outcome: the listing returns published products only; an archived product stays readable by its id.
