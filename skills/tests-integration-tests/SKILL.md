---
name: tests-integration-tests
description: "Crée tests d'intégration repositories/persistence EF Core avec pattern Builder et SQL Server Testcontainers. Seed via DbContext direct."
argument-hint: "[repository ou méthode à tester]"
model: sonnet
---

# Tests d'Intégration — Pattern Builder + DbContext direct

Verifient persistence contre SQL Server reel isole par `MsSqlContainerPool`. Builder pour data, seed via `DbContext` direct, jamais via repository teste.

Lire `references/examples.md` seulement si le template ci-dessous ne couvre pas le pattern de persistence vise.

Si le lot est fourni, lis seulement sa section Tests et Design DDD : elle decide si ce niveau est requis ; ce skill ne revoit pas le plan entier.

## Règles strictes

- **Builder par aggregate** : `With*()` pour properties (chaining `this`), `As*()` pour presets (`AsDraft`, `AsPublished`). `Build()` utilise `Restore()`. Jamais `Create()` direct.
- **Seed via DbContext direct** : jamais via repository testé (sinon circulaire).
- **DB SQL Server Testcontainers** : reutiliser `BaseTestFixture` / `MsSqlContainerPool`, jamais SQLite in-memory ni DB partagee.
- **Arrange-Act-Assert persistence** : separer setup, action repository, relecture/verification. Utiliser une nouvelle instance de contexte ou detacher les entites avant de verifier l'etat persiste si le test l'exige.
- **Enrichir fichiers existants** même dossier. Nouveau fichier seulement si aucun test pour feature.
- **Indépendants** : pas state partage. Chaque fixture recoit une database SQL Server isolee du pool et la libere apres le test.
- **Nommage** des tests et des classes → `.claude/rules/tests.md` (chargée dès que tu ouvres un fichier de `tests/`).
- Ne pas ajouter de commentaire qui répète le code. Conserver ceux qui expliquent une décision, une contrainte ou une exception ; ne les retoucher que **dans les lignes que tu touches**, jamais ailleurs dans le fichier.
- **Scope** : invoquer seulement quand le plan touche un repository, mapping EF, requete SQL ou contrainte de persistence. Les RM restent couvertes par TU handler.

## Structure

```
tests/{{PRODUCT}}.IntegrationTests/
├── Core/
│   ├── BaseIntegrationFixture.cs   (IAsyncLifetime, database isolee du pool)
│   ├── BaseTestFixture.cs          (AppDbContext, UnitOfWork, services)
│   └── DataBuilder/
│       └── [Entity]EntityBuilder.cs (1 par aggregate)
├── [BoundedContext]/
│   └── [Repository]/
│       └── [MethodName]/
│           ├── [MethodName]Fixture.cs    (extends BaseTestFixture)
│           └── [MethodName]Tests.cs
```

Nommage des classes → `.claude/rules/tests.md`, table `Naming`.

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

### Fixture SQL Server Testcontainers

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

## Couverture par repository

1. **CRUD** : Save (insert), Save (update via events), GetById, Delete
2. **Queries** : filtrage, pagination, includes (navigation properties)
3. **Contraintes** : unique constraints, FK enforced
4. **Representation Domain** : valeurs, relations et dates restaures correctement sans reexecuter `Create()`

## Vérification finale

- [ ] Test cible vert : `APP_TEST_MODE=true rtk dotnet test --project tests/{{PRODUCT}}.IntegrationTests/{{PRODUCT}}.IntegrationTests.csproj --no-build --no-restore --filter-class "*[MethodName]Tests"`
- [ ] Builder fluent par aggregate
- [ ] Seed direct DbContext, jamais via repository testé
- [ ] Fixture `BaseTestFixture` / `MsSqlContainerPool`, jamais SQLite in-memory ni DB partagee
- [ ] Etat persiste verifie apres detachement ou relecture si necessaire
- [ ] Commentaires utiles conservés ou améliorés
- [ ] Nommage `Should..._When...`
- [ ] RM et orchestration restent en TU handler ; ce test couvre bien la persistence
