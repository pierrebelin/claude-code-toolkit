# Implementation plan template

Structure expected by `/implement-tdd`. Two levels:
- **Global plan** (`-PLAN.md`): compact human-readable view, ~15 lines per batch
- **Batch sheets** (`-PLAN-F1.md`, `-PLAN-F2.md`…): technical detail per batch, loaded by `/implement-tdd`

**Principle**: global plan = WHAT + WHY + ORDER. Batch sheet = WHAT + HOW for that batch alone.

**The templates below are reproduced verbatim**: they are produced artefacts, read by the team. Copy the structure as-is, filling in the placeholders.

---

## Global plan (`[CODE]-PLAN.md`)

```markdown
# [CODE]-PLAN — [Feature name]

> Plan derived from `[path of the spec]`.
> Batch sheets: `[CODE]-PLAN-F1.md`, `[CODE]-PLAN-F2.md`...

## 0. Summary

**Progress**: `X / N` (`Y %`)

### Batch execution

| Batch | Depends on | Execution | Reason |
|-------|------------|-----------|--------|
| F1 | — | sequential | foundation / first contract |
| F2 | F1 | parallelisable with F3 (2 worktrees) / sequential | [no shared code, configuration or fixtures] |
| F3 | F1 | parallelisable with F2 (2 worktrees) / sequential | [concrete reason] |

`sequential` is the default. Mark `parallelisable` only if the prerequisites are finished and the batches touch neither the same aggregate, handler, endpoint, project, DI, migration, route nor test fixture.

### Batch F1 — [Name] — ⬜
- [ ] 1. [Step title]
- [ ] N. Build + test verification — scope: [whole suites] · [IT filter]

### Batch F2 — [Name] — ⬜
- [ ] 1. [Step title]

## 1. Scope

- **Spec**: `[path]`
- **Bounded context**: [name]
- **Layers**: [Domain / Application / Infrastructure / WebAPI / Abstractions.Models]
- **Reuse**: [existing elements identified during codebase analysis]
- **Assumptions**: [points settled with the user]

## 2. Traceability

| RM/CU | Code owner(s) | Batch |
|-------|---------------|-------|
| RM-01 — [statement] | `[Aggregate].[Method]()` + `[Exception]` | F1 |
| CU-01 — [statement] | `[Command]` → `[Handler]` → `[Endpoint]` | F1 |

## 3. Rule coverage

Every id of `ddd-rules.md` and `architecture-rules.md` must appear once: applied or `N/A — reason`.

| Family | Applied ids | N/A ids — reason |
|--------|-------------|------------------|
| DDD | DDD-01, DDD-02, DDD-03, DDD-06, DDD-08, DDD-11 | DDD-04 — no concept with its own invariant; DDD-05 — a single aggregate; DDD-07 — no evented mutation; DDD-09 — operation owned by the aggregate; DDD-10 — Domain untouched |
| APP/PERF | APP-01, APP-02, APP-03, PERF-01 | APP-04 — no WebAPI/Infrastructure layer touched; APP-05 — no route and no unbounded read touched |

## 4. DDD and Architecture design

| RM/CU | Applied rules | Owning aggregate | Invariant / code consequence | Consistency | Batch |
|-------|---------------|------------------|------------------------------|-------------|-------|
| RM-01 / CU-01 | DDD-02, DDD-03, DDD-08, APP-01 | `[Aggregate]` | [invariant] → [branch/read removed] | synchronous, 1 aggregate | F1 |

## 5. Functional batches

### Batch F1 — [Name]

**Intent**: [1 sentence — CU ref]
**RM**: RM-01, RM-03 | **CU**: CU-01
**Sheet**: `[CODE]-PLAN-F1.md`

| Layer | Element | Action | Detail |
|-------|---------|--------|--------|
| Domain | `[Aggregate]` | modified | +`[Method]()` (RM-XX), +`[Event]` |
| Domain | `[ValueObject]` | new | invariants: RM-XX |
| App | `[Command]` → `[Handler]` | new | — |
| Infra | `[Repository]` | modified | +Save case |
| WebAPI | `[VERB] /[route]` → [status] | new | — |

**Decisions**: [non-obvious choices]. Omitted if nothing notable.

**Tests**: `ShouldX_WhenY` (RM-XX, handler UT) · `ShouldA_WhenB` (repository IT) · `ShouldC()` (endpoint contract)

**E2E**: [lifecycle scenario ≥2 operations] / omitted — [reason].

**Steps**:
- [ ] 1. [End-to-end business behaviour] — TDD: RED ⬜ · GREEN ⬜ · COST ⬜
- [ ] 2. [Next behaviour]
- [ ] N. `dotnet build` + `dotnet test` verification — scope: [whole suites] · [IT filter] · [suites not run + reason]

### Batch F2 — [Next name]

[Same structure]

## 6. Cross-cutting elements (if applicable)

- **DI**: registrations | **Routes**: `Endpoints.cs` constants | **Bounds** (APP-05): `RequestLimits` (transport) / `PaginationBounds` (pagination) / `QueryLimits` (read)
- **EF migrations**: out of scope — another project, never modified here. A required schema change is reported, it is not planned as a step.
```

---

## Batch sheet (`[CODE]-PLAN-F1.md`)

```markdown
# [CODE]-PLAN-F1 — [Batch name]

> Batch F1 of plan `[CODE]-PLAN.md`. Spec: `[path]`.

## Intent

[1 sentence — CU ref]. **RM**: RM-01, RM-03 | **CU**: CU-01

## Design

| Point | Decision |
|-------|----------|
| Applied rules | DDD-01, DDD-02, DDD-03, DDD-08, APP-01, APP-02, PERF-01 |
| Owning aggregate | `[Aggregate]`; the handler only orchestrates |
| Invariants | [RM-XX]; consequence: [defensive code/read/collection avoided] |
| Consistency | one command modifies/saves `[Aggregate]`; targeted non-mutating external read if needed |
| Events | internal to persistence: `[Event]` in the past tense, payload [fields] / N/A — reason |
| Access cost | [n reads + n writes, bounded independently of the input] |

## Code elements

### Domain

**`[Aggregate]`** — _modified_ / _new_
- `Create(...)`: [params] → validates (RM-XX) → event `[Event]`
- `[BusinessMethod](...)`: [params] → [short logic] → event `[Event]`
- **Invariants**: [conditions — RM-XX]
- **Reuses**: `[existing VO]`

**`[ValueObject]`** — _new_
- `Create(...)`: [params], invariants (RM-XX)

**`[DomainEvent]`** — payload: [fields], emitted by `[Aggregate].[Method]`

**`[Exception]`** — raised by RM-XX

### Application

**`[Command]`** — props: [types], returns: `[EntityId]`

**`[Handler]`** — deps: `I[Repo]`, `IUserContextWrapper`
- OrgId → load aggregate → business method → Save events → return ID

### Infrastructure

**`[Repository]`** — _new_ / _modified_
- Methods: `Save(...)`, `GetById(...)`
- Save: switch on events `[Event1]`, `[Event2]`
- EF: `[Entity]Entity` + config

### Abstractions.Models

**`[Action][Entity]Request`** — props: [types]

### WebAPI

**`[Action][Entity]`** — `[VERB] /[route]` → `[Request]` → command → dispatch → [status]

## Tests

**UT**:
- `ShouldCreate[Entity]_WhenCommandIsValid` — success
- `ShouldEmit[Entity]CreatedEvent_WhenSuccessful` — event
- `ShouldThrowEmptyNameException_When[Prop]IsEmpty` (RM-XX — the VO's exception, not a local `ArgumentException`)
- `ShouldThrow[Exception]_When[Condition]` (RM-XX)

**Handler policy**: query = mock fed with data then result asserted; command = `SavedEvents` asserted by type and payload. Never a spy, a counter, nor a call assertion.

**IT regression scope**: `--filter-class "*.[Context].[Feature].*"` [+ other impacted namespaces]. The whole `IntegrationTests` suite is never run: naming the namespaces to replay here avoids having to derive them from the diff on every validation. Available roots: `Licensing`, `Catalog`, `Database`, `Dsl`, `Studio`, `Files`, `Http`, `Import`, `Performance`.

**Contract**: [happy-path route test name] / omitted — [route unchanged].

**E2E**: [lifecycle scenario name ≥2 operations] / omitted — [no cross-cutting lifecycle].

## Assumptions

_Empty when the plan is written. Filled by `/implement-tdd` on every non-obvious decision settled mid-batch._

| # | Assumption | To be validated by |
|---|------------|--------------------|
| H1 | [what was assumed for lack of an answer] | [who / what] |

## Decisions

[Non-obvious choices, trade-offs, reuses. Omitted if nothing notable.]
```
