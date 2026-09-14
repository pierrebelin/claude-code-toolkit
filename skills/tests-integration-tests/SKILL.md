---
name: tests-integration-tests
description: "Creates EF Core repository/persistence integration tests with the Builder pattern and SQL Server Testcontainers. Seeding through the DbContext directly."
argument-hint: "[repository or method to test]"
model: sonnet
---

# Integration tests — Builder pattern + direct DbContext

Verify persistence against real SQL Server isolated by `MsSqlContainerPool`. Builder for data, seeding through `DbContext` directly, never through repository under test.

`references/examples.md` only when template below misses the persistence pattern at hand.

Batch supplied → read only its Tests and DDD Design sections: they decide whether this level is required. No review of whole plan.

## Strict rules

- Test covering rule of handler's `## Règles métier` table carries it: `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]` under `[Fact]`/`[Theory]`. Trait read in every suite — rule proven only here stops counting untested. No documented rule → no trait.
- **One builder per aggregate**: `With*()` for properties (chaining `this`), `As*()` for presets (`AsDraft`, `AsPublished`). `Build()` uses `Restore()`. Never `Create()` directly.
- **Seed through DbContext directly**: never through repository under test (circular).
- **SQL Server Testcontainers database**: reuse `BaseTestFixture` / `MsSqlContainerPool`, never SQLite in-memory nor shared database.
- **Arrange-Act-Assert on persistence**: separate setup, repository action, re-read/verification. Fresh context instance or detached entities when checking persisted state needs it.
- **Extend existing files** in same folder. New file only when no test exists for the feature.
- **Independent**: no shared state. Each fixture gets isolated SQL Server database from pool, releases it after the test.
- **Naming** of tests, classes → `.claude/rules/tests.md` (loads on opening a file under `tests/`).
- No comment restating code. Keep those explaining decision, constraint, exception; touch them only **within lines you touch**, never elsewhere.
- **Scope**: only when plan touches repository, EF mapping, SQL query, persistence constraint. Business rules stay in handler unit tests.

## Structure

```
tests/{{PRODUCT}}.IntegrationTests/
├── Core/
│   ├── BaseIntegrationFixture.cs   (IAsyncLifetime, pool-isolated database)
│   ├── BaseTestFixture.cs          (AppDbContext, UnitOfWork, services)
│   └── DataBuilder/
│       └── [Entity]EntityBuilder.cs (one per aggregate)
├── [BoundedContext]/
│   └── [Repository]/
│       └── [MethodName]/
│           ├── [MethodName]Fixture.cs    (extends BaseTestFixture)
│           └── [MethodName]Tests.cs
```

Class naming → `.claude/rules/tests.md`, `Naming` table.

## Templates

### Builder

```csharp
public class [Entity]Builder
{
    private [EntityId] _id = [EntityId].Create();
    private string _name = "Test";
    private EntityStatus _status = EntityStatus.Draft;

    public static [Entity]Builder Create() => new();

    public [Entity]Builder WithId([EntityId] id) { _id = id; return this; }
    public [Entity]Builder WithName(string name) { _name = name; return this; }
    public [Entity]Builder AsDraft() { _status = EntityStatus.Draft; return this; }
    public [Entity]Builder AsPublished() { _status = EntityStatus.Published; return this; }

    public [Entity] Build() => [Entity].Restore(_id, _name, _status);
}
```

### SQL Server Testcontainers fixture

```csharp
public class [MethodName]Fixture : BaseTestFixture
{
    private [Repository] _repository = null!;

    protected override void OnInitialized()
    {
        _repository = new [Repository](UnitOfWork, AuditTrailWriter);
    }

    public [MethodName]Fixture With[Setup]()
    {
        DbContext.Set<[Entity]Entity>().Add([Entity]EntityBuilder.Create().Build());
        DbContext.SaveChanges();
        return this;
    }

    public Task<[Result]> Execute() => _repository.[Method](...);
}
```

### Test class

```csharp
public class [MethodName]Tests : IAsyncLifetime
{
    private readonly [MethodName]Fixture _fixture = new();

    public ValueTask InitializeAsync() => _fixture.InitializeAsync();
    public ValueTask DisposeAsync() => _fixture.DisposeAsync();

    [Fact]
    public async Task Should[Result]_When[Condition]()
    {
        var result = await _fixture
            .With[Setup]()
            .Execute();

        Assert.Equal(expected, result);
    }
}
```

## Coverage per repository

1. **CRUD**: Save (insert), Save (update through events), GetById, Delete
2. **Queries**: filtering, pagination, includes (navigation properties)
3. **Constraints**: unique constraints, FK enforced
4. **Domain representation**: values, relations, dates restored correctly without re-running `Create()`

## Final verification

- [ ] Target test green: `APP_TEST_MODE=true rtk dotnet test --project tests/{{PRODUCT}}.IntegrationTests/{{PRODUCT}}.IntegrationTests.csproj --no-build --no-restore --filter-class "*[MethodName]Tests"`
- [ ] Fluent builder per aggregate
- [ ] Direct DbContext seeding, never through repository under test
- [ ] `BaseTestFixture` / `MsSqlContainerPool` fixture, never SQLite in-memory nor shared database
- [ ] Persisted state verified after detaching or re-reading where needed
- [ ] Useful comments kept or improved
- [ ] `Should..._When...` naming
- [ ] Business rules, orchestration stay in handler unit tests; this test really covers persistence
