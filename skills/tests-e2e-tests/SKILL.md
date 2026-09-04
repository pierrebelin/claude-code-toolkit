---
name: tests-e2e-tests
description: "Create or modify xUnit E2E tests through Aspire and the client SDK for a complete business lifecycle. Use only when the plan selects a scenario of at least two operations; never for a single endpoint."
argument-hint: "[business lifecycle selected in the plan]"
model: sonnet
---

# E2E tests — lifecycle through Aspire

Test a complete business story on the real stack: Aspire, database, auth, API and SDK. This level complements unit, integration and contract tests; it does not replace their scenarios.

## Preconditions

- The batch sheet explicitly selects a lifecycle of at least two operations.
- Reuse the existing `ApiApplicationFixture` and the SDK client already exposed. Do not recreate the fixture from a template.
- Credentials come from the secure local configuration, never from the code, the skill or the snapshots.

## Non-negotiable rules

- A test covering a rule of a handler's `## Règles métier` table carries it: `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]` under its `[Fact]`/`[Theory]`. A trait is read in every suite — this is how a rule proven only here stops counting as untested. A test covering no documented rule carries none.
- One test = a complete journey: `create → update → delete`, `create → activate → deactivate`, `initialize → create → get → delete`.
- Forbidden: `Create`, `Get`, `Compile` or `Delete` alone. Those are contract/integration tests.
- Zero mocks, zero direct database seeding, zero raw `HttpClient`: the client SDK only.
- Create the test's mutable data through the API; read only stable reference data, without modifying it.
- `[Collection("test")]`, shared fixture, `*LifecycleTests` file, fewer than 20 tests per file. Never add a comment; delete the ones you wrote and the ones that serve nothing **within the lines you touch** — elsewhere in the file, report without deleting — and keep only those explaining a decision, a constraint or an exception.
- Endpoint or SDK missing: write a `[Fact(Skip = "precise technical reason")]` with the full signature and `throw new NotImplementedException()`.

## Workflow

1. Check that the lifecycle is retained in the sheet; otherwise do not create an E2E test.
2. Look for the existing lifecycle file and extend it.
3. Create the dependencies through the SDK, run every operation, verify the API responses, then clean up through the API.
4. Run only the targeted E2E test or project.

## Template

```csharp
[Collection("test")]
public sealed class [Feature]LifecycleTests(ApiApplicationFixture fixture)
{
    [Fact]
    public async Task ShouldCompleteLifecycle_WhenCreateThenUpdateThenDelete()
    {
        var create = await fixture.Client.Create[Entity]Async(
            [Entity]Fixture.CreateRequest(), CancellationToken.None);
        Assert.True(create.IsSuccess);

        var update = await fixture.Client.Update[Entity]Async(
            create.Value, [Entity]Fixture.UpdateRequest(), CancellationToken.None);
        Assert.True(update.IsSuccess);

        var delete = await fixture.Client.Delete[Entity]Async(create.Value, CancellationToken.None);
        Assert.True(delete.IsSuccess);
    }
}
```

Read `references/lifecycle-patterns.md` only for dependencies, reference data, skips or a non-standard lifecycle.

## Verification

- [ ] `rtk dotnet test --project tests/{{PRODUCT}}.E2ETests/{{PRODUCT}}.E2ETests.csproj --no-build --no-restore --filter-class "*[Feature]LifecycleTests"` green, or a justified Skip
- [ ] Lifecycle selected, at least two operations and API cleanup
- [ ] Real SDK + Aspire; no mock, no database seeding, no secret, no isolated endpoint
- [ ] Existing file extended, existing fixture reused; no comment added
