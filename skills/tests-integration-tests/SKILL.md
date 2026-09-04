---
name: tests-integration-tests
description: "Creates EF Core repository/persistence integration tests with the Builder pattern and SQL Server Testcontainers. Seeding through the DbContext directly."
argument-hint: "[repository or method to test]"
model: sonnet
---

# Integration tests — Builder pattern + direct DbContext

They verify persistence against a real SQL Server isolated by `MsSqlContainerPool`. A builder for the data, seeding through the `DbContext` directly, never through the repository under test.

Read `references/examples.md` only if the template below does not cover the persistence pattern at hand.

If the batch is supplied, read only its Tests and DDD Design sections: they decide whether this level is required; this skill does not review the whole plan.

## Strict rules

- A test covering a rule of a handler's `## Règles métier` table carries it: `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]` under its `[Fact]`/`[Theory]`. A trait is read in every suite — this is how a rule proven only here stops counting as untested. A test covering no documented rule carries none.
- **One builder per aggregate**: `With*()` for properties (chaining `this`), `As*()` for presets (`AsDraft`, `AsPublished`). `Build()` uses `Restore()`. Never `Create()` directly.
- **Seed through the DbContext directly**: never through the repository under test (that would be circular).
- **SQL Server Testcontainers database**: reuse `BaseTestFixture` / `MsSqlContainerPool`, never SQLite in-memory nor a shared database.
- **Arrange-Act-Assert on persistence**: separate setup, repository action, re-read/verification. Use a fresh context instance or detach the entities before checking the persisted state when the test requires it.
- **Extend existing files** in the same folder. A new file only when no test exists for the feature.
- **Independent**: no shared state. Each fixture receives an isolated SQL Server database from the pool and releases it after the test.
- **Naming** of tests and classes → `.claude/rules/tests.md` (loaded as soon as you open a file under `tests/`).
- Do not add a comment that restates the code. Keep the ones explaining a decision, a constraint or an exception; touch them only **within the lines you touch**, never elsewhere in the file.
- **Scope**: invoke only when the plan touches a repository, an EF mapping, a SQL query or a persistence constraint. Business rules stay covered by handler unit tests.

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
4. **Domain representation**: values, relations and dates restored correctly without re-running `Create()`

## Final verification

- [ ] Target test green: `APP_TEST_MODE=true rtk dotnet test --project tests/{{PRODUCT}}.IntegrationTests/{{PRODUCT}}.IntegrationTests.csproj --no-build --no-restore --filter-class "*[MethodName]Tests"`
- [ ] A fluent builder per aggregate
- [ ] Direct DbContext seeding, never through the repository under test
- [ ] `BaseTestFixture` / `MsSqlContainerPool` fixture, never SQLite in-memory nor a shared database
- [ ] Persisted state verified after detaching or re-reading where needed
- [ ] Useful comments kept or improved
- [ ] `Should..._When...` naming
- [ ] Business rules and orchestration stay in handler unit tests; this test really covers persistence
