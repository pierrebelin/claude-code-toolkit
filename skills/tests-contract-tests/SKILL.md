---
name: tests-contract-tests
description: "Create or modify xUnit HTTP contract tests with Verify and WebApplicationFactory. Use when a route or a public HTTP contract changes; not for business rules nor an E2E lifecycle."
argument-hint: "[route, action and nominal scenario]"
model: sonnet
---

# API contract tests — Verify

Freeze the nominal HTTP contract: method, route, status, headers and body. If the batch is supplied, read only its selected contract test; do not re-read or complete the DDD plan.

## Rules

- A test covering a rule of a handler's `## Règles métier` table carries it: `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]` under its `[Fact]`/`[Theory]`. A trait is read in every suite — this is how a rule proven only here stops counting as untested. A test covering no documented rule carries none.
- One `{HTTP} {route}` route = one happy-path contract test. Add an error test only when the public HTTP representation of an error changes (status, headers or body).
- GET: 200/204; POST: 201; PUT: 200; DELETE: 204.
- Validation and business rules stay in the handler unit tests. When `GlobalExceptionHandler` or the public error contract changes, freeze the affected HTTP mapping once; do not duplicate every business case per endpoint.
- Reuse the local fixture and `WebApplicationFactory`. Mock repositories only; handlers and Domain stay real.
- Deterministic IDs. Scrub ULIDs, GUIDs, dates and paths before snapshotting.
- List explicitly the public headers the route is expected to return (for example `Location`, `ETag`, `Cache-Control`, `Content-Type`); do not snapshot internal or volatile headers.
- Never add a comment. Delete the ones you wrote, and the ones that serve nothing **within the lines you touch** — elsewhere in the file, report without deleting. Keep only those explaining a decision, a constraint or an exception not deducible from naming. No status code in the name: `ShouldCreateEntity()`.
- Route unchanged, or a lifecycle of ≥2 operations: do not create this test; stay in the plan or use `/tests-e2e-tests`.

## Workflow

1. Locate the existing test for the route. Extend it, never add a second test for the same route.
2. Prepare the single nominal scenario with deterministic fixtures.
3. Run it, re-read the `received` snapshot, promote it to `verified` only if the contract is the intended one. Check the snapshot also contains the significant response headers.

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

Read `references/examples.md` only to configure a new scrubber or a new stable fixture.

## Verification

- [ ] `rtk dotnet test --project tests/{{PRODUCT}}.ContractTests/{{PRODUCT}}.ContractTests.csproj --no-build --no-restore --filter-class "*[Endpoint]Tests"` green
- [ ] A single route and its happy path, plus an error only when its HTTP contract changes; snapshot re-read and public headers explicitly selected
- [ ] No duplicated business rule; contractual error mapping centralised
- [ ] Infrastructure mocks only, stable IDs; no comment added
