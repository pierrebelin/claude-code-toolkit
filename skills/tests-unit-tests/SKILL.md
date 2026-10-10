---
name: tests-unit-tests
description: "Create or modify xUnit unit tests for .NET application handlers/services with a fixture and hand-written doubles. Use for business rules, query results and command events; never to test an aggregate directly."
argument-hint: "[handler/service, scenario and business rule]"
model: sonnet
---

# Unit tests — handler, fixture, hand-written doubles

Behaviour through real handler/service. Mock Infrastructure only (repositories, logger, external accesses). Batch supplied → read only its **Tests** section + handler policy; don't rebuild DDD design.

## Workflow

1. Find test file + fixture of same use case; extend them.
2. Observation: query = mock fed with data, then result; command = `SavedEvents` by type and payload.
3. One red test at a time, then minimal code via `/implement-tdd`.
4. Run targeted test. Green only on exit code `0`.

## Non-negotiable rules

- Test/class naming → `.claude/rules/tests.md` (loads on opening a file under `tests/`).
- Every test carries its rule (`UnitTests` bind every test, `.claude/rules/tests.md`) under `[Fact]`/`[Theory]`: `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]`, `{HandlerFolder}` = handler folder under `src/{{PRODUCT}}.Application/**/`, id = row of its `kit:rules` table. Two rules → two attributes. The attribute is the traceability: the table has no test column, a rule with no trait counts untested (`scripts/rules-coverage.py`).
- Aggregate factory/method tested only through its handler/service, no direct aggregate test.
- No interaction observation: no spy, counter, `CallCount`, `Called`, `Received`, `Verify`, call count — not even for cost.
- Builders, seeds, DSL, JSON, payloads, business data → fixture. Test class = facts + fixture calls.
- Repetitive data → `[Theory]` + `MemberData` from fixture, business literals stay out of the test class.
- Under 30 tests per file. No shared state, database, file system, network.

## Structure

```text
tests/{{PRODUCT}}.CoreTests/
├── Doubles/Mock[Repository].cs      (shared doubles, referenced by UnitTests)
└── DataBuilder/[Entity]Builder.cs   (shared builders)

tests/{{PRODUCT}}.UnitTests/
└── [BoundedContext]/[Feature]/[Action][Entity]/
    ├── [Action][Entity]Tests.cs
    └── [Action][Entity]Fixture.cs
```

`CoreTests` = shared test infrastructure (doubles, builders, assets) referenced by `UnitTests`, not a suite. A double exists for nearly every repository — extend it rather than creating a local `Doubles/` inside `UnitTests`. Follow local names where they exist; the template doesn't justify a parallel file or fixture.

## Minimal templates

```csharp
public sealed class Create[Entity]Tests
{
    private readonly Create[Entity]Fixture _fixture = new();

    [Fact]
    [Trait("RM", "Create[Entity]/RM-01")]
    public async Task ShouldCreate[Entity]_WhenCommandIsValid()
    {
        var result = await _fixture.WithValidName().Execute();

        Assert.NotEqual(default, result.Value);
    }

    [Fact]
    [Trait("RM", "Create[Entity]/RL-01")]
    public async Task ShouldThrowEmptyNameException_WhenNameIsEmpty()
    {
        await Assert.ThrowsAsync<EmptyNameException>(() =>
            _fixture.WithEmptyName().Execute());
    }

    [Fact]
    [Trait("RM", "Create[Entity]/RM-03")]
    public async Task ShouldEmit[Entity]CreatedEvent_WhenSuccessful()
    {
        await _fixture.WithValidName().Execute();

        var @event = Assert.Single(_fixture.Repository.SavedEvents.OfType<[Entity]Created>());
        Assert.Equal(_fixture.ValidName, @event.Name);
    }
}
```

```csharp
public sealed class Create[Entity]Fixture
{
    public const string ValidName = "Valid";

    public Mock[Entity]Repository Repository { get; } = new();
    private readonly Create[Entity]CommandHandler _handler;
    private string _name = ValidName;

    public Create[Entity]Fixture()
    {
        _handler = new Create[Entity]CommandHandler(Repository, ...);
    }

    public Create[Entity]Fixture WithValidName() { _name = ValidName; return this; }
    public Create[Entity]Fixture WithEmptyName() { _name = string.Empty; return this; }
    public Create[Entity]Fixture WithExisting[Entity]() { ...; return this; }

    public Task<[EntityId]> Execute() =>
        _handler.Handle(new Create[Entity]Command(_name), CancellationToken.None);
}
```

```csharp
public sealed class Mock[Entity]Repository : I[Entity]Repository
{
    private readonly Dictionary<[EntityId], [Entity]> _entities = [];
    public List<IDomainEvent> SavedEvents { get; } = [];

    public Task<[Entity]?> GetById([EntityId] id, CancellationToken ct) =>
        Task.FromResult(_entities.GetValueOrDefault(id));

    public Task Save(List<IDomainEvent<[EntityId]>> events, CancellationToken ct)
    {
        SavedEvents.AddRange(events);
        return Task.CompletedTask;
    }
}
```

`references/fixture-data.md` only for DSL/JSON fixtures, multiple data sets, `MemberData`.

## Expected coverage

| Handler | Cover |
|---------|---------|
| Command | success, validation, business rule, event type + payload |
| Query | success, empty, filter/pagination, returned payload (`Paging<T>` / `IReadOnlyList<T>` / aggregate) |

## Verification

- [ ] `rtk dotnet test --project tests/{{PRODUCT}}.UnitTests/{{PRODUCT}}.UnitTests.csproj --no-build --no-restore --filter-class "*[Action][Entity]Tests"` green
- [ ] Real handler under test; Infrastructure mocks only
- [ ] Query by result, command by `SavedEvents`
