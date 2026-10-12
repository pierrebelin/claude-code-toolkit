# Conventions — data access

Read by `tdd-implementer` before returning `## BLOCKED` on a cost symptom, and by the `run-lot` design on a cost it cannot state. Per-layer conventions live in `.claude/rules/*.md`, loaded alone.

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
