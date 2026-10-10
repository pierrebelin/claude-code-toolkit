# Conventions — data access

**Opened by `/implement-tdd` on demand only** — a stated cost it can't validate against the code, a `## BLOCKED` on cost — and by `tdd-implementer` before returning `## BLOCKED` on a cost symptom. Never at the start of a batch.

## Per-layer conventions — no longer here

Naming, base classes, folder structure, per-layer rules and pitfalls live in `.claude/rules/`, loaded automatically as soon as a file of that layer is read — inside a subagent too:

| File | Layer |
|---------|--------|
| `.claude/rules/domain.md` | `Domain/` |
| `.claude/rules/application-cqrs.md` | `Application/` |
| `.claude/rules/infrastructure-ef.md` | `Infrastructure/`, `MigrationService/`, `MigrationDsl/` |
| `.claude/rules/webapi-endpoints.md` | `WebAPI/`, `Abstractions.Models/`, `SDK/` |
| `.claude/rules/tests.md` | `tests/` |

Code pattern → an existing file of the same kind in the repo (`graphify query`, sibling folder).

---

## Data access — cost of Infrastructure calls

`cctoolkit access-cost <files>` reads the awaited Infrastructure calls off the syntax tree and flags the first five symptoms below; the last two stay a reading.

| Symptom | Fix |
|---|---|
| `await repo.GetX(id)` inside a `foreach` | A method taking **the list**: `GetX(IReadOnlyList<TId> ids, …)` |
| One query per received identifier (N+1) | One query, `ids.Contains(...)` pushed to SQL |
| `Save` inside the loop | Accumulate the events, **one single** `Save` |
| Database read inside the event loop of a repository `Save` | Collect the mutated identifiers, **one** `Contains` query before the loop; the `foreach` then only dispatches in memory |
| `.Where(...)` in memory over a repository result | Pass the predicate to the repository, filter in SQL |
| Two reads to resolve `A → B → aggregate` | One read starting from the aggregate and filtering on `A` (join) |
| `Include` of an **unbounded** collection to touch a single element | An **explicit** decision: load it whole (coherent aggregate, cost accepted) or a dedicated read. Never by default, never unsaid |

**Before adding a repository method**: check that no existing one already answers in a single query. A dedicated method is justified when it **changes the shape** of the read (SQL filter, projection, join), not when it renames an existing one.

**Exploit invariants before writing the loop.** An invariant stated by the sheet or the spec ("a copy has a single owner", "every node of a duplicated ModuleDiagram comes from the same Product") **removes code**: it turns a `GroupBy` + traversal into a single read. Reading the sheet to document it is not enough — deduce what disappears.

---
