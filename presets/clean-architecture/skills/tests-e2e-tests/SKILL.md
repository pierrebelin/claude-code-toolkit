---
name: tests-e2e-tests
description: "Create or modify xUnit E2E tests through Aspire and the client SDK for a complete business lifecycle. Use only when the plan selects a scenario of at least two operations; never for a single endpoint."
argument-hint: "[business lifecycle selected in the plan]"
model: sonnet
---

# E2E tests — lifecycle through Aspire

Complete business story on real stack: Aspire, database, auth, API, SDK. Complements unit, integration, contract tests, doesn't replace their scenarios.

## Preconditions

- Batch sheet explicitly selects lifecycle of ≥2 operations.
- Reuse existing `ApiApplicationFixture`, SDK client already exposed; don't recreate the fixture from the template.
- Credentials from secure local configuration, never from code, skill, snapshots.

## Rules

- No `[Trait("RM", …)]` on E2E tests: rule traceability lives in `UnitTests` and `IntegrationTests` (`.claude/rules/tests.md`).
- One test = complete journey: `create → update → delete`, `create → activate → deactivate`, `initialize → create → get → delete`.
- Forbidden: `Create`, `Get`, `Compile`, `Delete` alone — those are contract/integration tests.
- Zero mocks, zero direct database seeding, zero raw `HttpClient`: client SDK only.
- Mutable test data created through API; reference data read only.
- `[Collection("test")]`, shared fixture, `*LifecycleTests` file, under 20 tests per file.
- Endpoint or SDK missing: `[Fact(Skip = "precise technical reason")]` with full signature and `throw new NotImplementedException()`.

## Workflow

1. Check lifecycle retained in sheet; otherwise no E2E test.
2. Find existing lifecycle file, extend it.
3. Create dependencies through SDK, run every operation, verify API responses. No cleanup step: what the journey generated stays.
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

- [ ] `commands.testFast` with `{suite}` = `E2ETests` (the test project built alone, then run), narrowed to `*[Feature]LifecycleTests` (`skills/implement-tdd/references/test-scope.md` § Runner), green, or justified Skip
- [ ] Lifecycle selected, ≥2 operations, no cleanup step
- [ ] Real SDK + Aspire; no mock, no database seeding, no secret, no isolated endpoint
- [ ] Existing file extended, existing fixture reused
