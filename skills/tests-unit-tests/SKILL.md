---
name: tests-unit-tests
description: "Create or modify xUnit unit tests for .NET application handlers/services with a fixture and hand-written doubles. Use for business rules, query results and command events; never to test an aggregate directly."
argument-hint: "[handler/service, scenario and business rule]"
model: sonnet
---

# Unit tests — handler, fixture, hand-written doubles

Behaviour through real handler/service. Mock Infrastructure only. Batch supplied → read only its **Tests** section + handler policy; never rebuild DDD design.

## Workflow

1. Find test file + fixture of same use case. Extend before creating.
2. Observation: query = mock fed with data, then result; command = `SavedEvents` by type and payload.
3. One red test at a time, then minimal code via `/implement-tdd`.
4. Run targeted test. Green only on exit code `0`.

## Non-negotiable rules

- Test/class naming → `.claude/rules/tests.md` (loads on opening a file under `tests/`).
- **Every test covering a documented rule carries it**, under `[Fact]`/`[Theory]`: `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]`, `{HandlerFolder}` = handler folder under `src/{{PRODUCT}}.Application/**/`, id = row of its `## Règles métier` table. Two rules → two attributes. This attribute **is** traceability: table has no test column, rule with no trait counts untested (`scripts/rules-coverage.py`).
- Aggregate factory/method tested only through its handler/service. No orphan aggregate test.
- Query: data in double, assert output. Command: assert `SavedEvents` type + content.
- Never observe interaction: no spy, counter, `CallCount`, `Called`, `Received`, `Verify`, call count — not even for cost.
- Mock repositories, logger, external accesses only. Domain/Application real.
- Builders, seeds, DSL, JSON, payloads, business data → fixture. Test class = facts + fixture calls.
- Repetitive data → `[Theory]` + `MemberData` from fixture. No business literal in test class.
- Never add comment. Delete yours, and useless ones (restating code, stale) **within lines you touch** — elsewhere report, don't delete. Keep those explaining decision, constraint, exception not deducible from naming.
- Under 30 tests per file. No shared state, database, file system, network.

## Structure

```text
tests/{{PRODUCT}}.CoreTests/
├── Doubles/Mock[Repository].cs      (doubles partages, references par UnitTests)
└── DataBuilder/[Entity]Builder.cs   (builders partages)

tests/{{PRODUCT}}.UnitTests/
└── [BoundedContext]/[Feature]/[Handler]/
    ├── [Handler]Tests.cs
    └── [Handler]Fixture.cs
```

`CoreTests` = shared test infrastructure (doubles, builders, assets) referenced by `UnitTests`, not a suite. Double exists for nearly every repository — extend it, never create local `Doubles/` inside `UnitTests`. Follow local names where they exist: template never justifies a parallel file or fixture.

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
    public async Task ShouldThrowEmptyNameException_WhenNameIsEmpty()
    {
        await Assert.ThrowsAsync<EmptyNameException>(() =>
            _fixture.WithEmptyName().Execute());
    }

    [Fact]
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

- [ ] `rtk dotnet test --project tests/{{PRODUCT}}.UnitTests/{{PRODUCT}}.UnitTests.csproj --no-build --no-restore --filter-class "*[Handler]Tests"` green
- [ ] Real handler under test; Infrastructure mocks only
- [ ] Query by result, command by `SavedEvents`
- [ ] No direct aggregate test, no spy, no counter, no interaction assertion; no comment added
- [ ] Business data + `MemberData` in fixture; `CoreTests/Doubles` double and local file extended before creating anything
