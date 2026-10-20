# Implementation plan template

Structure expected by the `run-plan` / `run-lot` workflows. Two levels:
- **Global plan** (`-PLAN.md`): compact human-readable view — one table row + the step list per batch, nothing repeated from the sheets
- **Batch sheets** (`-PLAN-F1.md`, `-PLAN-F2.md`…): technical detail per batch, loaded by `run-lot`

**Principle**: global plan = WHAT + WHY + ORDER. Batch sheet = WHAT + HOW for that batch alone. A fact belongs to exactly one of the two — element lists, decisions, test names, applied rule ids live in the sheet only.

**Templates below reproduced verbatim** — produced artefacts, read by the team. Copy the structure as-is, fill the placeholders. Every `<!-- kit:… -->` anchor is copied as is; the prose around it — titles included — is written in `language.docs` (`.claude/rules/markdown-output.md`).

---

## Global plan (`[CODE]-PLAN.md`)

```markdown
# [CODE]-PLAN — [Feature name]

> Plan derived from `[path of the spec]`.
> Batch sheets: `[CODE]-PLAN-F1.md`, `[CODE]-PLAN-F2.md`...

## 0. Summary <!-- kit:summary -->

**Progress**: `X / N` (`Y %`)

### Batch execution

| Batch | Intent | RM/CU | Depends on | Repo | Execution | Reason |
|-------|--------|-------|------------|------|-----------|--------|
| F1 | [1 sentence] | RM-01, RM-03 / CU-01 | — | . | sequential | foundation / first contract |
| F2 | [1 sentence] | RM-04 / CU-02 | F1 | . | parallelisable with F3 (2 worktrees) / sequential | [no shared code, configuration or fixtures] |
| F3 | [1 sentence] | RM-05 / CU-03 | F1 | ../[Other.Repo] | parallelisable with F2 (2 repos) / sequential | [concrete reason] |

`Repo`: path relative to the root of this repository, `.` by default — read by `cctoolkit plan-next-batch` for `/run-plan`. `sequential` is the default. Mark `parallelisable` only if the prerequisites are finished and the batches touch neither the same aggregate, handler, endpoint, project, DI, migration, route nor test fixture.

### Batch F1 — [Name] — ⬜
- [ ] 1. [Step title]

### Batch F2 — [Name] — ⬜
- [ ] 1. [Step title]

## 1. Scope <!-- kit:scope -->

- **Spec**: `[path]`
- **Bounded context**: [name]
- **Layers**: [Domain / Application / Infrastructure / WebAPI / Abstractions.Models]
- **Reuse**: [existing elements identified during codebase analysis]
- **Out of scope**: [what the plan does not do, and where that gets decided]
- **Assumptions**: [points settled with the user, with the date] / [points still to validate, and why they do not block]
- **Non-applicable rules** <!-- kit:na-rules -->: [DDD-XX: N/A — reason; APP-XX: N/A — reason] — no list of applied ids here: every batch sheet carries them in its `## Design` `kit:applied-rules` row

## 2. Traceability <!-- kit:traceability -->

<!-- kit:cols item,owner,batch -->
| RM/CU | Code owner(s) | Batch |
|-------|---------------|-------|
| RM-01 — [statement] | `[Aggregate].[Method]()` + `[Exception]` | F1 |
| CU-01 — [statement] | `[Command]` → `[Handler]` → `[Endpoint]` | F1 |
| T1 — [technical point of the spec] | ADR-[nnn] — [choice] / [decision title] | F1 |

## 3. DDD and Architecture design <!-- kit:ddd-design -->

| RM/CU | Owning aggregate | Invariant / code consequence | Consistency | Batch |
|-------|------------------|------------------------------|-------------|-------|
| RM-01 / CU-01 | `[Aggregate]` | [invariant] → [branch/read removed] | synchronous, 1 aggregate | F1 |

## 4. Cross-cutting elements (if applicable) <!-- kit:cross-cutting -->

- **DI**: registrations | **Routes**: `Endpoints.cs` constants | **Bounds** (APP-05): `RequestLimits` (transport) / `PaginationBounds` (pagination) / `ReadLimits` (read)
- **EF migrations**: out of scope — another project, never modified here. A required schema change is reported, it is not planned as a step.
```

---

## Batch sheet (`[CODE]-PLAN-F1.md`)

Section order is fixed: why (`Intent`, `Design`, `Decisions`), then how it is verified (`Test policy and scopes`), then the reference (`Code elements`), then the TDD contract (`Cycles`, read by `run-lot` through `cctoolkit sheet-cycles`), then `Assumptions`. About 20 KB at most: the block names tests and paths, it never repeats `## Code elements` nor `## Design` — `sheet-cycles --cycle` prints them to the GREEN.

````markdown
# [CODE]-PLAN-F1 — [Batch name]

> Batch F1 of plan `[CODE]-PLAN.md`. Spec: `[path]`.
> Reading: **Intent**, **Design**, **Decisions** say why; **Code elements** the signature detail; **Cycles** the tests, the exact paths and the order of the TDD cycles.

## Intent <!-- kit:intent -->

[1 sentence — CU ref]. **RM**: RM-01, RM-03 | **CU**: CU-01

## Design <!-- kit:design -->

| Point | Decision |
|-------|----------|
| Applied rules <!-- kit:applied-rules --> | DDD-01, DDD-02, DDD-03, DDD-08, APP-01, APP-02, PERF-01 |
| Owning aggregate | `[Aggregate]`; the handler only orchestrates |
| Invariants | [RM-XX]; consequence: [defensive code/read/collection avoided] |
| Consistency | one command modifies/saves `[Aggregate]`; targeted non-mutating external read if needed |
| Events | internal to persistence: `[Event]` in the past tense, payload [fields] / N/A — reason |
| Access cost | [n reads + n writes, bounded independently of the input] |

## Decisions <!-- kit:decisions -->

### ADR-[nnn] — [Choice that outlives the plan]
Choice: [what is done]
Why: [the reason, one line — the business decision or rule it serves]
Rejected: [option] ([reason]); [option] ([reason])
Consequences: [what every later change must respect]
Links: [T1, the rule and use case ids it serves]

### [Choice local to this batch — no id, it ends with the plan]
Choice: […]
Why: […]
Rejected: […]
Links: […]

[Then one line per lesser choice, trade-off or reuse, with the date of the user decisions; the run and the review add their lines here too. Section omitted if nothing notable.]

## Test policy and scopes <!-- kit:test-policy -->

**Handler policy**: query = mock fed with data then result asserted; command = `SavedEvents` asserted by type and payload. Never a spy, a counter, nor a call assertion. Never a direct test on the aggregate: its behaviour is proven through the handler.

**IT regression scope**: `--filter-class "*.[Context].[Feature].*"` [+ other impacted namespaces]. The whole `IntegrationTests` suite is never run: naming the namespaces to replay here avoids having to derive them from the diff on every validation. Available roots: [first-level folders of the integration test project, from the inventory].

**Global green scope**: [whole suites]; IT filtered above; [suites not run and why].

**E2E**: [lifecycle scenario name ≥2 operations, carrying step] / omitted — [no cross-cutting lifecycle].

## Code elements <!-- kit:code-elements -->

Signature and pseudo-code detail of every artefact `## Cycles` cites. Reference section, consulted during RED for the signatures and during GREEN for the content; it dictates neither order nor scope.

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

**`[Handler]`** — deps: `I[Repo]`, `IUserContextAccessor`
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

## Cycles

TDD contract of the batch, read by `run-lot` through `cctoolkit sheet-cycles <sheet> --index` (exit 0 required). Fields: `/implement-tdd` `references/design.md` § "The `## Cycles` block"; waves and caps: `parallelism.md`. One cycle = one homogeneous pattern, one test project, at most 4 test files and 8 production files. A step split past a cap never shares a test method between its cycles: a data-driven theory becomes one theory per cycle (`parallelism.md` of `implement-tdd`). Order inside a cycle: success first (it fixes the signatures), refusals next. No anchor comment needed on this heading.

```json
{
 "declaratives": ["src/{{PRODUCT}}.Abstractions.Models/[Feature]/[Action][Entity]Request.cs — mirrors [sibling].cs; props [types]"],
 "cycles": [
  {
   "id": "C1", "wave": 1,
   "behaviour": "A valid [entity] creation is saved",
   "rmcu": "RM-01, RM-03 / CU-01", "steps": ["1. [Exact title of the step in the global plan]"],
   "level": "UT", "skill": "tests-unit-tests",
   "testClass": "[Action][Entity]Tests", "fixture": "[Action][Entity]Fixture",
   "methods": ["[Action][Entity]Tests.ShouldCreate[Entity]_WhenCommandIsValid", "[Action][Entity]Tests.ShouldThrowEmptyNameException_When[Prop]IsEmpty"],
   "full": ["tests/{{PRODUCT}}.UnitTests/[Context]/[Feature]/[Action][Entity]/[Action][Entity]Tests.cs (to create)"],
   "bounded": ["tests/{{PRODUCT}}.CoreTests/DataBuilder/[Feature]/[Aggregate]Builder.cs"],
   "observation": "SavedEvents holds [Event] with [fields]; EmptyNameException",
   "outOfScope": "[guard of the next cycle]",
   "toCreate": ["src/{{PRODUCT}}.Application/[Context]/[Feature]/[Action]/[Handler].cs"],
   "production": ["src/{{PRODUCT}}.Application/[Context]/[Feature]/[Action]/[Handler].cs", "src/{{PRODUCT}}.Domain/[...]/Aggregates/[Aggregate].cs", "src/{{PRODUCT}}.Application/[Context]/[Feature]/[Action]/CLAUDE.md"],
   "ripple": [], "boundedGreen": [],
   "models": ["src/{{PRODUCT}}.Application/[Context]/[Feature]/[SiblingAction]/[SiblingHandler].cs — same command shape", "tests/{{PRODUCT}}.UnitTests/[Context]/[Feature]/[SiblingAction]/[SiblingAction]Tests.cs"]
  }
 ]
}
```

## Assumptions <!-- kit:assumptions -->

_Empty when the plan is written. The run never writes here: its decisions go to `## To validate` of the run report; a decision that changes the scope goes under `## Decisions`._

| # | Assumption | To be validated by |
|---|------------|--------------------|
| H1 | [what was assumed for lack of an answer] | [who / what] |
````
