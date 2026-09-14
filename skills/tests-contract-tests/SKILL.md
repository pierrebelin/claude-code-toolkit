---
name: tests-contract-tests
description: "Create or modify xUnit HTTP contract tests with Verify and WebApplicationFactory. Use when a route or a public HTTP contract changes; not for business rules nor an E2E lifecycle."
argument-hint: "[route, action and nominal scenario]"
model: sonnet
---

# API contract tests — Verify

Freeze nominal HTTP contract: method, route, status, headers, body. Batch supplied → read only its selected contract test; never re-read or complete DDD plan.

## Rules

- Test covering rule of handler's `## Règles métier` table carries it: `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]` under `[Fact]`/`[Theory]`. Trait read in every suite — rule proven only here stops counting untested. No documented rule → no trait.
- One `{HTTP} {route}` = one happy-path contract test. Error test only when public HTTP representation of error changes (status, headers, body).
- GET: 200/204; POST: 201; PUT: 200; DELETE: 204.
- Validation, business rules → handler unit tests. `GlobalExceptionHandler` or public error contract changes → freeze affected HTTP mapping once, never duplicate every business case per endpoint.
- Reuse local fixture, `WebApplicationFactory`. Mock repositories only; handlers, Domain real.
- Deterministic IDs. Scrub ULIDs, GUIDs, dates, paths before snapshotting.
- List explicitly public headers route returns (`Location`, `ETag`, `Cache-Control`, `Content-Type`); never snapshot internal or volatile headers.
- Never add comment. Delete yours, and useless ones **within lines you touch** — elsewhere report, don't delete. Keep those explaining decision, constraint, exception not deducible from naming. No status code in name: `ShouldCreateEntity()`.
- Route unchanged, or lifecycle ≥2 operations: no test here; stay in plan or `/tests-e2e-tests`.

## Workflow

1. Locate existing test for route. Extend, never second test for same route.
2. Prepare single nominal scenario, deterministic fixtures.
3. Run, re-read `received` snapshot, promote to `verified` only if contract intended. Check it holds significant response headers.

## Template

```csharp
public sealed class Create[Entity]Tests : BaseEndpointTests
{
    [Fact]
    public async Task ShouldCreate[Entity]()
    {
        var request = [Entity]Fixture.CreateRequest();

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
- [ ] Infrastructure mocks only, stable IDs; no comment added
