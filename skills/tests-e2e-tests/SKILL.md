---
name: tests-e2e-tests
description: "Créer ou modifier des tests E2E xUnit via Aspire et SDK client pour un lifecycle métier complet. Utiliser seulement quand le plan sélectionne un scénario d'au moins deux opérations ; jamais pour un endpoint isolé."
argument-hint: "[lifecycle métier sélectionné dans le plan]"
model: sonnet
---

# Tests E2E — Lifecycle via Aspire

Tester une histoire métier complète sur la stack réelle : Aspire, DB, auth, API et SDK. Ce niveau complète TU, intégration et contrat ; il ne remplace pas leurs scénarios.

## Préconditions

- La fiche lot sélectionne explicitement un lifecycle d'au moins deux opérations.
- Réutiliser `ApiApplicationFixture` existante et le client SDK déjà exposé. Ne pas recréer la fixture depuis un template.
- Les credentials viennent de la configuration locale sécurisée, jamais du code, du skill ou des snapshots.

## Règles non négociables

- Un test = parcours complet : `create → update → delete`, `create → activate → deactivate`, `initialize → create → get → delete`.
- Interdit : `Create`, `Get`, `Compile` ou `Delete` seul. Ce sont des tests contrat/integration.
- Zéro mock, zéro seed DB direct, zéro `HttpClient` brut : SDK client uniquement.
- Créer les données mutables du test via API ; lire seulement des données de référence stables sans les modifier.
- `[Collection("test")]`, fixture partagée, fichier `*LifecycleTests`, moins de 20 tests/fichier. Ne jamais ajouter de commentaire ; supprimer ceux que tu as écrits et ceux qui ne servent pas **dans les lignes que tu touches** — ailleurs dans le fichier, signaler sans supprimer — et ne conserver que ceux qui expliquent une décision, une contrainte ou une exception.
- Endpoint ou SDK absent : écrire un `[Fact(Skip = "raison technique précise")]` avec signature complète et `throw new NotImplementedException()`.

## Workflow

1. Vérifier que le lifecycle est retenu dans la fiche ; sinon ne pas créer d'E2E.
2. Rechercher le fichier lifecycle existant et l'enrichir.
3. Créer les dépendances via SDK, exécuter toutes les opérations, vérifier les réponses API, puis cleanup par API.
4. Lancer uniquement le test ou projet E2E visé.

## Template

```csharp
[Collection("test")]
public sealed class [Feature]LifecycleTests(ApiApplicationFixture fixture)
{
    [Fact]
    public async Task ShouldCompleteLifecycle_WhenCreateThenUpdateThenDelete()
    {
        var create = await fixture.Client.Create[Entity]Async(
            [Entity]Fixture.CreateRequest(), CancellationToken.None);
        Assert.True(create.IsSuccess);

        var update = await fixture.Client.Update[Entity]Async(
            create.Value, [Entity]Fixture.UpdateRequest(), CancellationToken.None);
        Assert.True(update.IsSuccess);

        var delete = await fixture.Client.Delete[Entity]Async(create.Value, CancellationToken.None);
        Assert.True(delete.IsSuccess);
    }
}
```

Lire `references/lifecycle-patterns.md` seulement pour dépendances, données de référence, skip ou un lifecycle non standard.

## Vérification

- [ ] `rtk dotnet test --project tests/{{PRODUCT}}.E2ETests/{{PRODUCT}}.E2ETests.csproj --no-build --no-restore --filter-class "*[Feature]LifecycleTests"` vert, ou Skip justifié
- [ ] Lifecycle sélectionné, au moins deux opérations et cleanup API
- [ ] SDK + Aspire réels ; aucun mock, seed DB, secret ni endpoint isolé
- [ ] Fichier existant enrichi, fixture existante réutilisée ; aucun commentaire ajouté
