---
name: tests-contract-tests
description: "Create or modify xUnit HTTP contract tests with Verify and WebApplicationFactory. Use when a route or a public HTTP contract changes; not for business rules nor an E2E lifecycle."
argument-hint: "[route, action and nominal scenario]"
model: sonnet
---

# API contract tests — Verify

Freeze nominal HTTP contract: method, route, status, headers, body. Batch supplied → read only its selected contract test; don't re-read or complete the DDD plan.

## Rules

- No `[Trait("RM", …)]`: a contract test freezes the route's HTTP shape; the business rule behind it is proven, and traced, by the handler test (`.claude/rules/tests.md`).
- One `{HTTP} {route}` = one happy-path contract test. Error test only when public HTTP representation of error changes (status, headers, body).
- Statuses: `.claude/rules/webapi-endpoints.md` § Responses (GET 200, POST 201, PUT 200, DELETE 204).
- Validation, business rules → handler unit tests. `GlobalExceptionHandler` or public error contract changes → freeze affected HTTP mapping once rather than duplicating every business case per endpoint.
- Reuse local fixture, `WebApplicationFactory`. Mock repositories only; handlers, Domain real.
- Deterministic IDs. Scrub ULIDs, GUIDs, dates, paths before snapshotting.
- `VerifyResponse(response)` (`tests/{{PRODUCT}}.ContractTests/Core/BaseEndpointTests.cs`) snapshots method, URI, status, body and `Location`; another public header means extending `ExtractContent` there.
- No status code in name: `ShouldCreateEntity()`.
- Route unchanged, or lifecycle ≥2 operations: no test here; stay in plan or `/tests-e2e-tests`.

## Workflow

1. Locate existing test for route and extend it.
2. Prepare single nominal scenario, deterministic fixtures.
3. Run, re-read `received` snapshot, promote to `verified` only if contract intended.

## Template

```csharp
public sealed class Create[Entity]Tests : BaseEndpointTests
{
    [Fact]
    public async Task ShouldCreate[Entity]()
    {
        var request = [Entity]Fixture.CreateRequest();

        var response = await Client.PostAsJsonAsync("entities", request);

        await VerifyResponse(response);
    }
}
```

`references/examples.md`: variant with an inline request, only if the template is not enough; base class shape when the suite has none.

## Verification

- [ ] `commands.testFast` with `{suite}` = `ContractTests` (the test project built alone, then run), narrowed to `*[Endpoint]Tests` (`skills/implement-tdd/references/test-scope.md` § Runner), green
- [ ] Single route, happy path, plus error only when its HTTP contract changes; snapshot re-read
- [ ] No duplicated business rule; contractual error mapping centralised
- [ ] Infrastructure mocks only, stable IDs
