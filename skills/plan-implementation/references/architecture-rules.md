# Architecture rules

The plan classifies **every id**: `applied` or `N/A — reason`. Implementation detail lives in `/implement-tdd` and the test skills; do not duplicate their examples here.

| ID | Rule | When | Plan decision and evidence | Exception |
|----|-------|-------|----------------------------|-----------|
| APP-01 | The handler orchestrates: loads, calls the Domain, saves events, returns the result. | Handler created/modified. | Describe that flow; no business rule and no direct mutation inside the handler. | Pure query: read + result only. |
| APP-02 | A command expresses an intent and returns an ID; a query reads and returns its payload (`Paging<T>` when paginated, `IReadOnlyList<T>` when bounded, aggregate or response for a single read) — never `Result<T>`. | Application contract created/modified. | Name the contract, its input and its observable output. | None. |
| APP-03 | The repository is aggregate-centred and translates events into persistence, as well as constraint violations into domain exceptions. | Aggregate persistence touched. | Name the aggregate, the events and the Save/Restore cases; name the unique index and the exception returned. | N/A if persistence is untouched. |
| APP-04 | WebAPI translates HTTP; Infrastructure translates IO; neither owns a business rule. | WebAPI or Infrastructure touched. | Locate the mapping/IO; business rules in Domain/Application. | N/A if the layer is untouched. |
| APP-05 | A resource limit is carried by its dedicated owner, never re-coded ad hoc. | A public route or an unpaginated read added/modified. | Name the bound and its owner: transport (body size, rate) in WebAPI (`RequestLimits`, rate limiting); pagination normalised when the query is created (`Application/Core/PaginationBounds`); read cap on the persistence side (`Infrastructure/Database/QueryLimits`). No bound in the Domain, no bound hand-rewritten in a handler. | N/A if no route and no unbounded read is touched. |
| PERF-01 | Infrastructure access cost bounded, independent of input size. | Handler or IO touched. | State the reads/writes; no IO read inside an input-driven loop. | An unbounded cost only where the plan explicitly justifies it. |
