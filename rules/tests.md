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

A handler test is bound to a rule: its `Class.Method` appears in the *Tests* column of the `## Business rules` table in the handler's `CLAUDE.md` (`src/{{PRODUCT}}.Application/**/<Handler>/`). Write the test, then fill the cell — same commit.

The `handler-claude-md-check.sh` hook reports, on every edit of a handler or of a handler test: rules with an empty *Tests* cell, referenced tests that no longer exist, tests in a cited class bound to no rule. Warning only, never blocking.

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
