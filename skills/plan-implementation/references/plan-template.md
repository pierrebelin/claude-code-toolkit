# Implementation plan template

Structure expected by `/implement-tdd`. Two levels:
- **Global plan** (`-PLAN.md`): compact human-readable view — one table row + the step list per batch, nothing repeated from the sheets
- **Batch sheets** (`-PLAN-F1.md`, `-PLAN-F2.md`…): technical detail per batch, loaded by `/implement-tdd`

**Principle**: global plan = WHAT + WHY + ORDER. Batch sheet = WHAT + HOW for that batch alone. A fact belongs to exactly one of the two — element lists, decisions, test names, applied rule ids live in the sheet only.

**Templates below reproduced verbatim** — produced artefacts, read by the team. Copy the structure as-is, fill the placeholders.

---

## Global plan (`[CODE]-PLAN.md`)

```markdown
# [CODE]-PLAN — [Feature name]

> Plan derived from `[path of the spec]`.
> Batch sheets: `[CODE]-PLAN-F1.md`, `[CODE]-PLAN-F2.md`...

## 0. Summary

**Progress**: `X / N` (`Y %`)

### Batch execution

| Batch | Intent | RM/CU | Depends on | Execution | Reason |
|-------|--------|-------|------------|-----------|--------|
| F1 | [1 sentence] | RM-01, RM-03 / CU-01 | — | sequential | foundation / first contract |
| F2 | [1 sentence] | RM-04 / CU-02 | F1 | parallelisable with F3 (2 worktrees) / sequential | [no shared code, configuration or fixtures] |
| F3 | [1 sentence] | RM-05 / CU-03 | F1 | parallelisable with F2 (2 worktrees) / sequential | [concrete reason] |

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
- **Out of scope**: [what the plan does not do, and where that gets decided]
- **Assumptions**: [points settled with the user, with the date] / [points still to validate, and why they do not block]
- **Non-applicable rules**: [DDD-XX — reason; APP-XX — reason] — no list of applied ids here: every batch sheet carries them in its `## Design`

## 2. Traceability

| RM/CU | Code owner(s) | Batch |
|-------|---------------|-------|
| RM-01 — [statement] | `[Aggregate].[Method]()` + `[Exception]` | F1 |
| CU-01 — [statement] | `[Command]` → `[Handler]` → `[Endpoint]` | F1 |

## 3. DDD and Architecture design

| RM/CU | Applied rules | Owning aggregate | Invariant / code consequence | Consistency | Batch |
|-------|---------------|------------------|------------------------------|-------------|-------|
| RM-01 / CU-01 | DDD-02, DDD-03, DDD-08, APP-01 | `[Aggregate]` | [invariant] → [branch/read removed] | synchronous, 1 aggregate | F1 |

## 4. Cross-cutting elements (if applicable)

- **DI**: registrations | **Routes**: `Endpoints.cs` constants | **Bounds** (APP-05): `RequestLimits` (transport) / `PaginationBounds` (pagination) / `QueryLimits` (read)
- **EF migrations**: out of scope — another project, never modified here. A required schema change is reported, it is not planned as a step.
```

---

## Batch sheet (`[CODE]-PLAN-F1.md`)

Section order is fixed: why (`Intent`, `Design`, `Decisions`), then what gets written and in which order (`TDD sequence`, `Test policy and scopes`), then the reference (`Code elements`, `Ancrages`), then `Assumptions` which fills up during the batch.

```markdown
# [CODE]-PLAN-F1 — [Batch name]

> Batch F1 of plan `[CODE]-PLAN.md`. Spec: `[path]`.
> Reading: **Intent**, **Design**, **Decisions** say why; **TDD sequence** what gets written and in which order; **Code elements** the signature detail; **Ancrages** the exact paths where all of it lands.

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

## Decisions

[Non-obvious choices, trade-offs, reuses, with the date of the user decisions. Omitted if nothing notable.]

## TDD sequence

One step = one RED → GREEN → COST cycle. The tests below are **written and red before a single production line** of the step. Order inside a step: success first (it fixes the signatures), refusals next, integration then contract last[, E2E at the very end].

Declarative artefacts with no prior RED (`/implement-tdd` rule §4.5): [`Abstractions.Models` DTO, `[Entity]` EF and its configuration, `DbSet`, DI] / none. They are covered by the integration or contract test of the behaviour they serve.

### Step 1 — [Exact title of the step in the global plan]

| # | Test | Level | Project | RM |
|---|------|-------|---------|-----|
| 1 | `ShouldCreate[Entity]_WhenCommandIsValid` | UT | `UnitTests` | RM-01 |
| 2 | `ShouldEmit[Entity]CreatedEvent_WhenSuccessful` | UT | `UnitTests` | RM-03 |
| 3 | `ShouldThrowEmptyNameException_When[Prop]IsEmpty` | UT | `UnitTests` | — (exception of the `Name` VO) |
| 4 | `ShouldPersist[Entity]_WhenSaved` | IT | `IntegrationTests` | RM-01 |
| 5 | `ShouldCreate[Entity]()` | contract | `ContractTests` | CU-01 |

[At most two lines: what merges into a single cycle, and from which test Docker is required.]

### Step N — Handler documentation

No test: update of the handler `CLAUDE.md` files and of the feature index.

### Step N+1 — Build + test verification

No new test: replay of the scopes named in `## Test policy and scopes`.

## Test policy and scopes

**Handler policy**: query = mock fed with data then result asserted; command = `SavedEvents` asserted by type and payload. Never a spy, a counter, nor a call assertion. Never a direct test on the aggregate: its behaviour is proven through the handler.

**IT regression scope**: `--filter-class "*.[Context].[Feature].*"` [+ other impacted namespaces]. The whole `IntegrationTests` suite is never run: naming the namespaces to replay here avoids having to derive them from the diff on every validation. Available roots: `Licensing`, `Catalog`, `Database`, `Dsl`, `Studio`, `Files`, `Http`, `Import`, `Performance`.

**Verification step scope**: [whole suites]; IT filtered above; [suites not run and why].

**E2E**: [lifecycle scenario name ≥2 operations, carrying step] / omitted — [no cross-cutting lifecycle].

## Code elements

Signature and pseudo-code detail of every artefact anchored in `## Ancrages`. Reference section, consulted during RED for the signatures and during GREEN for the content; it dictates neither order nor scope.

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

## Ancrages

**What this table is for.** `/implement-tdd` searches for no file: it copies these paths as they stand into the contracts it gives to the RED and GREEN subagents. One row = one step. Column 2 = where the test is written; column 3 = the shared `CoreTests` builders and doubles to extend (with the member to add); column 4 = the production files GREEN is allowed to touch — nothing else. A path marked _existing_ comes from the plan's inventory; a path _to create_ is the future path, mirrored on the named sibling. **A missing row or a path that cannot be copied is a plan hole**, to fill in this sheet before starting the step.

| Step | Test class / fixture | `CoreTests` builders and doubles | Production filled or created |
|-------|--------------------------|----------------------------------|-----------------------------|
| 1 — [Title] | `tests/{{PRODUCT}}.UnitTests/[Context]/[Feature]/[Action]/[Handler]Tests.cs` — _to create_ ; `[...]TestsFixture.cs` — _existing_ | `tests/{{PRODUCT}}.CoreTests/DataBuilder/[Feature]/[Aggregate]Builder.cs` (`With[Prop]` to add) ; `Doubles/Mock[Repo].cs` | `src/{{PRODUCT}}.Application/[Context]/[Feature]/[Action]/[Handler].cs` — _to create_ ; `src/{{PRODUCT}}.Domain/.../Aggregates/[Aggregate].cs` — `[Method]` |
| 1 — [Title] (IT) | `tests/{{PRODUCT}}.IntegrationTests/[Context]/[Feature]/[Repo]Tests.cs` | `tests/{{PRODUCT}}.IntegrationTests/Core/DataBuilder/[Entity]Builder.cs` | `src/{{PRODUCT}}.Infrastructure/.../[Repo].cs` ; `Mappers/[Entity]Mapper.cs` |
| 1 — [Title] (contract) | `tests/{{PRODUCT}}.ContractTests/[Context]/[Feature]Tests.cs` ; `Fixtures/[Feature]/[X]Fixture.cs` ; snapshot `Verified/[Feature]Tests.[Test].verified.txt` | `tests/{{PRODUCT}}.ContractTests/Core/WebApplicationFactory.cs` — repository substituted by its double | `src/{{PRODUCT}}.WebAPI/Endpoints/[Feature]/[Endpoint].cs` ; `Endpoints/Endpoints.cs` |
| N — Documentation | — | — | `src/{{PRODUCT}}.Application/[Context]/[Feature]/CLAUDE.md` ; `…/[Action]/CLAUDE.md` |
| N+1 — Verification | — | — | — |

## Assumptions

_Empty when the plan is written. Filled by `/implement-tdd` on every non-obvious decision settled mid-batch._

| # | Assumption | To be validated by |
|---|------------|--------------------|
| H1 | [what was assumed for lack of an answer] | [who / what] |
```
