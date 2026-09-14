# Integration examples

Only when the skill's template is not enough. These use the project's SQL Server pool; never test an aggregate method directly.

## Re-read after persistence

```csharp
public class Get[Entity]Fixture : BaseTestFixture
{
    private [Repository] _repository = null!;

    protected override void OnInitialized()
    {
        _repository = new [Repository](UnitOfWork, AuditTrailWriter);
    }

    public Get[Entity]Fixture With[Entity](Action<[Entity]EntityBuilder> configure)
    {
        var builder = [Entity]EntityBuilder.Create();
        configure(builder);
        DbContext.Set<[Entity]Entity>().Add(builder.Build());
        DbContext.SaveChanges();
        return this;
    }

    public Task<[Entity]?> GetById([EntityId] id)
        => _repository.GetById(id, CancellationToken.None);
}

public class Get[Entity]Tests : IAsyncLifetime
{
    private readonly Get[Entity]Fixture _fixture = new();

    public ValueTask InitializeAsync() => _fixture.InitializeAsync();
    public ValueTask DisposeAsync() => _fixture.DisposeAsync();

    [Fact]
    public async Task ShouldRestore[Entity]_WhenIdExists()
    {
        var id = [EntityId].Create();
        var entity = await _fixture
            .With[Entity](builder => builder.WithId(id).WithName("Persisted"))
            .GetById(id);

        Assert.NotNull(entity);
        Assert.Equal(id, entity.Id);
    }
}
```

## SQL constraints

Unique or FK constraint only when the SQL schema guarantees it. Seed the first row with `DbContext`, run the repository action, check the error or persisted state. Not a business-rule test: the rule stays in the handler.

## Choosing the test level

| Subject | Suite |
|-------|-------|
| Business decision, event, validation | Handler unit test |
| EF mapping, query, migration, SQL constraint | SQL Server integration |
| Nominal HTTP contract | Contract |
| Multi-operation journey | E2E |
