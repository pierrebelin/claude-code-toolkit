# ADR-001 — Soft archive through a status column

Choice: `Product.Status = Archived`; listing queries filter on it.
Why: one read path, history preserved (CAT-D-001).
Rejected: archive table (two read paths); event-sourced projection (no event store).
Consequences: every catalogue query filters on `Status`; index on (OrganisationId, Status).
Links: CAT-RM-004, CAT-CU-02, CAT-CU-03
