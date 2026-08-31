---
name: tests-unit-tests
description: "Create or modify xUnit unit tests for .NET application handlers/services with a fixture and hand-written doubles. Use for business rules, query results and command events; never to test an aggregate directly."
argument-hint: "[handler/service, scenario and business rule]"
model: sonnet
---

# Unit tests — handler, fixture, hand-written doubles

Test a business behaviour through its real handler/service. Mock Infrastructure only. If a batch is supplied, read only its **Tests** section and its handler policy; do not rebuild the DDD design.

## Workflow

1. First find the test file and the fixture of the same use case. Extend them before creating a file.
2. Choose the observation: query = mock fed with data, then the result; command = `SavedEvents` by type and payload.
3. Write one red test at a time, then the minimal code through `/implement-tdd`.
4. Run the targeted test. Declare green only on exit code `0`.

## Non-negotiable rules

- Test and class naming → `.claude/rules/tests.md` (loaded as soon as you open a file under `tests/`).
- Test an aggregate factory or method only through the handler/service that calls it. No orphan aggregate test.
- Query: data in the double, assertion on the output. Command: assertion on `SavedEvents` by type and content.
- Never observe an interaction: no spy, counter, `CallCount`, `Called`, `Received`, `Verify` nor call count — not even for cost.
- Mock only repositories, logger and external accesses. Domain/Application stay real.
- Put builders, seeds, DSL, JSON, payloads and business data in the fixture. The test class carries only facts and fixture calls.
- For repetitive data, prefer `[Theory]` + `MemberData` coming from the fixture. No business literal in the test class.
- Never add a comment. Delete the ones you wrote, and the ones that serve nothing (restating the code, stale) **within the lines you touch** — a useless comment elsewhere in the file is reported, not deleted. Keep only those explaining a decision, a constraint or an exception not deducible from naming.
- Keep a file under 30 tests, with no shared state, no database, no file system, no network.

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

`CoreTests` is not a suite: it is the shared test infrastructure (doubles, builders, assets), referenced by `UnitTests`. A double already exists for nearly every repository — extend it, never create a local `Doubles/` inside `UnitTests`.

Follow the local names where they exist: the template never justifies a parallel file or fixture.

## Minimal templates

```csharp
public sealed class Create[Entity]Tests
{
    private readonly Create[Entity]Fixture _fixture = new();

    [Fact]
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

Read `references/fixture-data.md` only for DSL/JSON fixtures, multiple data sets or `MemberData`.

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
- [ ] Business data and `MemberData` in the fixture; `CoreTests/Doubles` double and local file extended before creating anything
