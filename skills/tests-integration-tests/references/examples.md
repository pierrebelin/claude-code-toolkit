# Exemples integration

Utiliser seulement si le template du skill ne suffit pas. Ces exemples emploient le pool SQL Server du projet ; ils ne testent jamais une methode d'aggregate directement.

## Relecture apres persistence

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

## Contraintes SQL

Utiliser une contrainte unique ou FK seulement si elle est effectivement garantie par le schema SQL. Seeder la premiere ligne avec `DbContext`, executer l'action repository visee, puis verifier l'erreur ou l'etat persiste. Ne pas transformer ce test en test de RM : la RM reste dans le handler.

## Choix de niveau de test

| Sujet | Suite |
|-------|-------|
| Decision metier, evenement, validation | TU handler |
| Mapping EF, requete, migration, contrainte SQL | Integration SQL Server |
| Contrat HTTP nominal | Contrat |
| Parcours multi-operations | E2E |
