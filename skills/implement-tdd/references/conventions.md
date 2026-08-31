# Conventions — data access

**Always read by `/implement-tdd`.**

## Per-layer conventions — no longer here

Naming, base classes, folder structure, per-layer rules and pitfalls live in `.claude/rules/`, loaded automatically as soon as a file of that layer is read — inside a subagent too:

| File | Layer |
|---------|--------|
| `.claude/rules/domain.md` | `Domain/` |
| `.claude/rules/application-cqrs.md` | `Application/` |
| `.claude/rules/infrastructure-ef.md` | `Infrastructure/`, `MigrationService/`, `MigrationDsl/` |
| `.claude/rules/webapi-endpoints.md` | `WebAPI/`, `Abstractions.Models/`, `SDK/` |
| `.claude/rules/tests.md` | `tests/` |

Do not duplicate those rules here: two sources that drift make the choice arbitrary. A new layer convention goes into that layer's rule file.

Full code examples → `examples-{domain,application,infrastructure,webapi}.md`, one file per layer. The layer rule gives the exact path.

The table below stays here: it is inseparable from the **COST** step of the cycle (`common-rules.md` §2).

---

## Data access — cost of Infrastructure calls

**No test locks down the call count**: a handler making 1 query and a handler making 2N+2 queries are equally green. The pressure has to come from here, not from the test suite.

**Rule**: a behaviour's number of Infrastructure calls is **bounded and independent of input size**. Stating that cost is part of the cycle (`common-rules.md` §2, COST step).

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

**Exploit invariants before writing the loop.** An invariant stated by the sheet or the spec ("a copy has a single owner", "every key of a transferred Configuration comes from the same product") **removes code**: it turns a `GroupBy` + traversal into a single read. Reading the sheet to document it is not enough — you must deduce what disappears.

**Do not confuse this with premature optimisation**: this is not about shaving milliseconds but about removing a dependency on input size. `N` queries where `1` suffices is a design defect, not a performance setting.

---
