---
paths:
  - "tests/**/*.cs"
---

# Testing rules

xUnit v3 / Microsoft Testing Platform. Assertions: **xUnit built-in only** — no FluentAssertions.

## Suites

| Suite | Scope |
|-------|-------|
| `CoreTests` | Shared library, not a suite: hand-written mocks (`Doubles/`, no Moq/NSubstitute) + fluent data builders (`DataBuilder/`), fixtures and assets |
| `UnitTests` | Domain logic + handlers on in-memory mocks, fixture builder pattern |
| `IntegrationTests` | SQL Server Testcontainers — needs Docker |
| `ContractTests` | `WebApplicationFactory` + Verify snapshots |
| `DslTests` | DSL parser, templates and presets |
| `E2ETests` | Business lifecycle over ≥2 operations, Aspire-driven |
| `ArchitectureTests` | ArchUnitNET (layer deps, naming) — no cross-layer leaks, Domain depends on nothing, API contracts in `Abstractions` not leaked internals |

## What is tested

A test targets an **observable business behaviour** through the public API, tied to a business rule. Never a private helper or an internal detail.

A domain class is never tested directly (`PortConstraintTests`) — always through its use case or service (`ValidateDiagramTests`). An aggregate method is exercised through its handler.

## Traceability

A handler test declares its rule **on itself**, with a `Trait`:

```csharp
[Fact]
[Trait("RM", "GetProduct/RL-02")]
public async Task ShouldThrowNotFound_WhenProductBelongsToAnotherOrganization()
```

Value: `{HandlerFolder}/{RM|RL-xx}` — the folder name of the handler under `src/{{PRODUCT}}.Application/**/`, then the id of the row in its `## Règles métier` table. The prefix is the **handler folder**, not the aggregate: `RM` numbering is not unique across the handlers of one feature. A test covering two rules carries two attributes. A trait is read in any suite, so an integration or E2E test covers a rule just as well as a unit test.

The `handler-claude-md-check.sh` hook reports, on every edit of a handler or of a handler test: rules carried by no trait, traits citing a rule absent from the table, and tests with no trait in a class that carries some. Warning only, never blocking. Only `UnitTests` and `ContractTests` are expected to bind every test — the other suites bind the ones that cover a documented rule.

Tests outside handler folders (`Aggregates/`, `ValueObjects/`, `Core/`, `DslTests`) are out of scope — no rule to bind them to.

## Naming

Test method: `Should{Result}_When{Condition}`, where `{Result}` describes the **actual assertion**, not the intent.

| Suite | Class pattern | Example |
|-------|---------------|---------|
| UnitTests, ContractTests | `{Feature}Tests` / `{Feature}Fixture` | `UpdateDiagramNodeTests` |
| IntegrationTests | `{MethodName}Tests` / `{MethodName}Fixture` — no repository-name prefix | `GetByOrganizationTests` |
| E2ETests | `{Feature}LifecycleTests` | `ProductLifecycleTests` |
| Mocks (CoreTests) | `Mock{Interface}` | `MockModuleDiagramRepository` |

Detailed authoring guides: skills `/tests-unit-tests`, `/tests-integration-tests`, `/tests-contract-tests`, `/tests-e2e-tests`.
