# Patterns E2E lifecycle

Lire seulement si le lifecycle sélectionné demande plus que le template minimal.

## Donnée de référence stable

```csharp
var categories = await fixture.Client.GetProductCategories(CancellationToken.None);
Assert.True(categories.IsSuccess);
Assert.NotEmpty(categories.Value!.Categories);
var categoryId = categories.Value.Categories[0].Id;
```

Lire la référence, ne pas la modifier. Toute donnée mutable créée par le test est supprimée à la fin du parcours.

## Dépendances API

```csharp
var parent = await fixture.Client.CreateParentAsync(
    ParentFixture.CreateRequest(), CancellationToken.None);
Assert.True(parent.IsSuccess);

var child = await fixture.Client.CreateChildAsync(
    ChildFixture.CreateRequest(parent.Value), CancellationToken.None);
Assert.True(child.IsSuccess);
```

Créer les dépendances dans l'ordre métier requis, jamais par accès DB.

## Test temporairement bloqué

```csharp
[Fact(Skip = "Blocked: CreateChild endpoint is absent from SDK")]
public async Task ShouldCompleteLifecycle_WhenCreateThenActivateThenDelete()
{
    throw new NotImplementedException();
}
```

Retirer `Skip` dès que la route et le SDK sont disponibles.
