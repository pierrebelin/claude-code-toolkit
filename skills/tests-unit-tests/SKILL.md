---
name: tests-unit-tests
description: "Créer ou modifier des tests unitaires xUnit de handlers/services applicatifs .NET avec fixture et doubles manuels. Utiliser pour règles métier, résultats de query et événements de command ; jamais pour tester directement un aggregate."
argument-hint: "[handler/service, scénario et RM]"
model: sonnet
---

# Tests unitaires — Handler, Fixture, doubles manuels

Tester un comportement métier à travers son handler/service réel. Mocker uniquement l'Infrastructure. Si un lot est fourni, lire seulement sa section **Tests** et sa politique handler ; ne pas reconstruire le design DDD.

## Workflow

1. Trouver d'abord le fichier de test et la fixture du même use case. Les enrichir avant de créer un fichier.
2. Choisir l'observation : query = mock alimenté puis résultat ; command = `SavedEvents` par type et payload.
3. Ecrire un test rouge à la fois, puis le code minimal via `/implement-tdd`.
4. Lancer le test ciblé. Ne déclarer vert qu'avec code retour `0`.

## Règles non négociables

- Nommage des tests et des classes → `.claude/rules/tests.md` (chargée dès que tu ouvres un fichier de `tests/`).
- Tester une factory ou méthode d'aggregate uniquement à travers le handler/service qui l'appelle. Aucun test d'aggregate orphelin.
- Query : données dans le double, assertion sur la sortie. Command : assertion sur `SavedEvents` par type et contenu.
- Ne jamais observer une interaction : ni spy, compteur, `CallCount`, `Called`, `Received`, `Verify` ni nombre d'appels, même pour le coût.
- Mocker uniquement repositories, logger et accès externes. Domain/Application restent réels.
- Mettre builders, seeds, DSL, JSON, payloads et données métier dans la fixture. La classe de test ne porte que faits et appels de fixture.
- Pour données répétitives, préférer `[Theory]` + `MemberData` provenant de la fixture. Aucun littéral métier dans la classe de test.
- Ne jamais ajouter de commentaire. Supprimer ceux que tu as écrits, et ceux qui ne servent pas (répètent le code, périmés) **dans les lignes que tu touches** — un commentaire inutile situé ailleurs dans le fichier se signale, il ne se supprime pas. Ne conserver que ceux qui expliquent une décision, une contrainte ou une exception non déductible du nommage.
- Garder un fichier sous 30 tests et sans état partagé, DB, FS ni réseau.

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

`CoreTests` n'est pas une suite : c'est l'infrastructure de test partagee (doubles, builders, assets), referencee par `UnitTests`. Un double existe deja pour la quasi-totalite des repositories — l'enrichir, jamais creer un `Doubles/` local dans `UnitTests`.

Suivre les noms locaux quand ils existent : le template ne justifie jamais un fichier ou une fixture parallèle.

## Templates minimaux

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

Lire `references/fixture-data.md` seulement pour fixtures DSL/JSON, données multiples ou `MemberData`.

## Couverture attendue

| Handler | Couvrir |
|---------|---------|
| Command | succès, validation, RM, événement type + payload |
| Query | succès, vide, filtre/pagination, charge utile retournée (`Paging<T>` / `IReadOnlyList<T>` / agrégat) |

## Vérification

- [ ] `rtk dotnet test --project tests/{{PRODUCT}}.UnitTests/{{PRODUCT}}.UnitTests.csproj --no-build --no-restore --filter-class "*[Handler]Tests"` vert
- [ ] Test handler réel ; mocks Infrastructure uniquement
- [ ] Query par résultat, command par `SavedEvents`
- [ ] Aucun test direct aggregate, spy, compteur ni assertion d'interaction ; aucun commentaire ajouté
- [ ] Données métier et `MemberData` dans fixture ; double `CoreTests/Doubles` et fichier local enrichis avant création
