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
- Status per verb → `.claude/rules/webapi-endpoints.md`, `Responses` table.
- Validation, business rules → handler unit tests. `GlobalExceptionHandler` or public error contract changes → freeze affected HTTP mapping once rather than duplicating every business case per endpoint.
- Reuse local fixture, `WebApplicationFactory`. Mock repositories only; handlers, Domain real.
- Deterministic IDs. Scrub ULIDs, GUIDs, dates, paths before snapshotting.
- List explicitly the public headers the route returns (`Location`, `ETag`, `Cache-Control`, `Content-Type`); don't snapshot internal or volatile headers.
- Method naming → `.claude/rules/tests.md` (`Should{Result}_When{Condition}`); no status code in name: `ShouldCreateEntity_WhenRequestIsValid`.
- Route unchanged, or lifecycle ≥2 operations: no test here; stay in plan or `/tests-e2e-tests`.

## Workflow

1. Locate existing test for route and extend it.
2. Prepare single nominal scenario, deterministic fixtures.
3. Run, re-read `received` snapshot, promote to `verified` only if contract intended. Check it holds significant response headers.

## Template

```csharp
public sealed class Create[Entity]Tests : BaseEndpointTests
{
    [Fact]
    [Trait("RM", "Create[Entity]/RM-01")]
    public async Task ShouldCreate[Entity]_WhenRequestIsValid()
    {
        var request = Create[Entity]Fixture.CreateRequest();

        var response = await Client.PostAsJsonAsync("entities", request);

        await VerifyResponse(response, "Location", "Content-Type");
    }
}
```

`references/examples.md` only for a new scrubber or new stable fixture.

## Verification

- [ ] `rtk dotnet test --project tests/{{PRODUCT}}.ContractTests/{{PRODUCT}}.ContractTests.csproj --no-build --no-restore --filter-class "*[Endpoint]Tests"` green
- [ ] Single route, happy path, plus error only when its HTTP contract changes; snapshot re-read, public headers explicitly selected
- [ ] No duplicated business rule; contractual error mapping centralised
- [ ] Infrastructure mocks only, stable IDs
