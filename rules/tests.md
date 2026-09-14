---
paths:
  - "tests/**/*.cs"
---

# Testing rules

xUnit v3 / Microsoft Testing Platform. Assertions: **xUnit built-in only** — no FluentAssertions.

## Suites

| Suite | Scope |
|-------|-------|
| `CoreTests` | Shared library, not a suite: hand-written mocks (`Doubles/`, no Moq/NSubstitute) + fluent builders (`DataBuilder/`), fixtures, assets |
| `UnitTests` | Domain logic + handlers on in-memory mocks, fixture builder pattern |
| `IntegrationTests` | SQL Server Testcontainers — needs Docker |
| `ContractTests` | `WebApplicationFactory` + Verify snapshots |
| `DslTests` | DSL parser, templates, presets |
| `E2ETests` | Business lifecycle over ≥2 operations, Aspire-driven |
| `ArchitectureTests` | ArchUnitNET (layer deps, naming) — no cross-layer leaks, Domain depends on nothing, API contracts in `Abstractions`, no leaked internals |

## What is tested

Target = **observable business behaviour** via public API, tied to a business rule. Never private helper or internal detail.

Domain class never tested directly (`PortConstraintTests`) — always via use case or service (`ValidateDiagramTests`). Aggregate method exercised via its handler.

## Traceability

Handler test declares its rule **on itself**, with `Trait`:

```csharp
[Fact]
[Trait("RM", "GetProduct/RL-02")]
public async Task ShouldThrowNotFound_WhenProductBelongsToAnotherOrganization()
```

Value: `{HandlerFolder}/{RM|RL-xx}` — handler folder name under `src/{{PRODUCT}}.Application/**/`, then row id in its `## Règles métier` table. Prefix = **handler folder**, not aggregate: `RM` numbering not unique across handlers of one feature. Test covering two rules carries two attributes. Trait read in any suite: integration or E2E test covers a rule as well as unit test.

`handler-claude-md-check.sh` reports, on every edit of handler or handler test: rules with no trait, traits citing rule absent from table, tests with no trait in a class carrying some. Warning only, never blocking. Only `UnitTests`, `ContractTests` expected to bind every test — other suites bind those covering a documented rule.

Tests outside handler folders (`Aggregates/`, `ValueObjects/`, `Core/`, `DslTests`) out of scope — no rule to bind.

## Naming

Test method: `Should{Result}_When{Condition}`, `{Result}` = **actual assertion**, not intent.

| Suite | Class pattern | Example |
|-------|---------------|---------|
| UnitTests, ContractTests | `{Feature}Tests` / `{Feature}Fixture` | `UpdateDiagramNodeTests` |
| IntegrationTests | `{MethodName}Tests` / `{MethodName}Fixture` — no repository-name prefix | `GetByOrganizationTests` |
| E2ETests | `{Feature}LifecycleTests` | `ProductLifecycleTests` |
| Mocks (CoreTests) | `Mock{Interface}` | `MockModuleDiagramRepository` |

Authoring guides: skills `/tests-unit-tests`, `/tests-integration-tests`, `/tests-contract-tests`, `/tests-e2e-tests`.
