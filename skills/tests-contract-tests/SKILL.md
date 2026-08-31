---
name: tests-contract-tests
description: "Créer ou modifier des tests de contrat HTTP xUnit avec Verify et WebApplicationFactory. Utiliser quand une route ou un contrat HTTP public change ; pas pour les règles métier ni un lifecycle E2E."
argument-hint: "[route, action et scénario nominal]"
model: sonnet
---

# Tests contrat API — Verify

Figer le contrat HTTP nominal : méthode, route, status, headers et body. Si le lot est fourni, lire seulement son test contrat sélectionné ; ne pas relire ni compléter le plan DDD.

## Règles

- Une route `{HTTP} {route}` = un test contrat happy path. Ajouter un test d'erreur seulement si la représentation HTTP publique d'une erreur change (status, headers ou body).
- GET : 200/204 ; POST : 201 ; PUT : 200 ; DELETE : 204.
- Validation et RM restent dans les TU handler. Lorsque `GlobalExceptionHandler` ou le contrat public d'erreur change, figer une fois le mapping HTTP concerné ; ne pas dupliquer tous les cas métier par endpoint.
- Réutiliser fixture et `WebApplicationFactory` locales. Mocker repositories seulement ; handlers et Domain réels.
- IDs déterministes. Scrubber ULIDs, GUIDs, dates et chemins avant snapshot.
- Lister explicitement les headers publics attendus par la route (par exemple `Location`, `ETag`, `Cache-Control`, `Content-Type`) ; ne pas snapshotter les headers internes ou volatils.
- Ne jamais ajouter de commentaire. Supprimer ceux que tu as écrits, et ceux qui ne servent pas **dans les lignes que tu touches** — ailleurs dans le fichier, signaler sans supprimer. Ne conserver que ceux qui expliquent une décision, une contrainte ou une exception non déductible du nommage. Pas de status code dans le nom : `ShouldCreateEntity()`.
- Route inchangée ou lifecycle ≥2 opérations : ne pas créer ce test ; rester dans le plan ou utiliser `/tests-e2e-tests`.

## Workflow

1. Localiser test existant de la route. L'enrichir, ne jamais ajouter un second test pour la même route.
2. Préparer le seul scénario nominal avec fixtures déterministes.
3. Exécuter, relire le snapshot `received`, promouvoir en `verified` seulement si le contrat est voulu. Vérifier que le snapshot contient aussi les headers de réponse significatifs.

## Template

```csharp
public sealed class Create[Entity]Tests : BaseEndpointTests
{
    [Fact]
    public async Task ShouldCreate[Entity]()
    {
        var request = [Entity]Fixture.CreateRequest();

        var response = await Client.PostAsJsonAsync("entities", request);

        await VerifyResponse(response, "Location", "Content-Type");
    }
}
```

Lire `references/examples.md` seulement pour configurer un nouveau scrubber ou une nouvelle fixture stable.

## Vérification

- [ ] `rtk dotnet test --project tests/{{PRODUCT}}.ContractTests/{{PRODUCT}}.ContractTests.csproj --no-build --no-restore --filter-class "*[Endpoint]Tests"` vert
- [ ] Une seule route et son happy path, plus une erreur seulement si son contrat HTTP change ; snapshot relu et headers publics explicitement selectionnes
- [ ] Aucune règle métier dupliquée ; mapping d'erreur contractuel centralisé
- [ ] Mocks Infrastructure uniquement, IDs stables ; aucun commentaire ajouté
