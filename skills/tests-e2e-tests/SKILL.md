---
name: tests-e2e-tests
description: "Create or modify xUnit E2E tests through Aspire and the client SDK for a complete business lifecycle. Use only when the plan selects a scenario of at least two operations; never for a single endpoint."
argument-hint: "[business lifecycle selected in the plan]"
model: sonnet
---

# E2E tests — lifecycle through Aspire

Complete business story on real stack: Aspire, database, auth, API, SDK. Complements unit, integration, contract tests; never replaces their scenarios.

## Preconditions

- Batch sheet explicitly selects lifecycle of ≥2 operations.
- Reuse existing `ApiApplicationFixture`, SDK client already exposed. Never recreate fixture from template.
- Credentials from secure local configuration, never from code, skill, snapshots.

## Non-negotiable rules

- Test covering rule of handler's `## Règles métier` table carries it: `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]` under `[Fact]`/`[Theory]`. Trait read in every suite — rule proven only here stops counting untested. No documented rule → no trait.
- One test = complete journey: `create → update → delete`, `create → activate → deactivate`, `initialize → create → get → delete`.
- Forbidden: `Create`, `Get`, `Compile`, `Delete` alone — those are contract/integration tests.
- Zero mocks, zero direct database seeding, zero raw `HttpClient`: client SDK only.
- Mutable test data created through API; reference data read only, never modified.
- `[Collection("test")]`, shared fixture, `*LifecycleTests` file, under 20 tests per file. Never add comment; delete yours and useless ones **within lines you touch** — elsewhere report, don't delete — keep those explaining decision, constraint, exception.
- Endpoint or SDK missing: `[Fact(Skip = "precise technical reason")]` with full signature and `throw new NotImplementedException()`.

## Workflow

1. Check lifecycle retained in sheet; otherwise no E2E test.
2. Find existing lifecycle file, extend it.
3. Create dependencies through SDK, run every operation, verify API responses, clean up through API.
4. Run only targeted E2E test or project.

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

`references/lifecycle-patterns.md` only for dependencies, reference data, skips, non-standard lifecycle.

## Verification

- [ ] `rtk dotnet test --project tests/{{PRODUCT}}.E2ETests/{{PRODUCT}}.E2ETests.csproj --no-build --no-restore --filter-class "*[Feature]LifecycleTests"` green, or justified Skip
- [ ] Lifecycle selected, ≥2 operations, API cleanup
- [ ] Real SDK + Aspire; no mock, no database seeding, no secret, no isolated endpoint
- [ ] Existing file extended, existing fixture reused; no comment added
