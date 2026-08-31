# Exemples de code — WebAPI

Consulter quand le pattern est inconnu ou qu'il s'agit de la première implémentation d'un type d'élément dans cette couche.
Règles et pièges → `.claude/rules/` (chargées automatiquement).

---

## Abstractions.Models - Request DTO

Les Request DTOs definissent le contrat des endpoints API. Ils vivent dans `Abstractions.Models`, jamais dans le projet WebAPI. L'endpoint importe le DTO.

```
src/{{PRODUCT}}.Abstractions.Models/
└── Requests/
    └── Studio/
        └── Diagram/
            ├── DeleteTemplate/
            │   └── DeleteTemplateRequest.cs
            └── ExportDiagrams/
                └── ExportDiagramsRequest.cs
```

Exemples :

```csharp
// Requests/Studio/Diagram/DeleteTemplate/DeleteTemplateRequest.cs
namespace {{PRODUCT}}.Abstractions.Models.Requests.Studio.Diagram.DeleteTemplate;

public sealed record DeleteTemplateRequest(Ulid[] Ids);
```

```csharp
// Requests/Studio/Diagram/ExportDiagrams/ExportDiagramsRequest.cs
namespace {{PRODUCT}}.Abstractions.Models.Requests.Studio.Diagram.ExportDiagrams;

public sealed record ExportDiagramsRequest(
    Ulid[] TemplateIds,
    Ulid[] DiagramNodeIds,
    bool IncludeAssociatedElements = false);
```

**Regles** :
- `sealed record` obligatoire
- Namespace = chemin du fichier : `{{PRODUCT}}.Abstractions.Models.Requests.{Feature}.{Operation}`
- 1 fichier = 1 request DTO, dans un dossier nomme comme l'operation (`ExportDiagrams/`, `CreateProduct/`)
- Ne jamais definir un request DTO en nested record dans l'endpoint WebAPI

---

## WebAPI - Endpoint

Chaque endpoint est une classe statique avec un handler static et une nested class `Endpoint : IEndpoint`. Decouverts automatiquement par reflexion.

Le Request DTO est importe depuis `Abstractions.Models` (jamais defini en local) :

```csharp
using {{PRODUCT}}.Abstractions.Models.Requests.Catalog.Products.CreateProduct;

public static class CreateProduct
{
    private static async Task<IResult> HandlerAsync(
        [FromBody] CreateProductRequest request,
        ICreateProductCommandHandler handler,
        CancellationToken cancellationToken)
    {
        var command = CreateProductCommand.Create(request.Name, request.Description);
        var productId = await handler.Handle(command, cancellationToken);
        return Results.Created($"/api/v1/products/{productId.Value}", productId.Value);
    }

    public sealed class Endpoint : IEndpoint
    {
        public IEnumerable<RouteHandlerBuilder> MapEndpoints(ApplicationOptions applicationSettings, IEndpointRouteBuilder app)
        {
            yield return app.MapPost(Endpoints.PRODUCTS_URL, HandlerAsync)
                .RequireAuthorization()
                .WithName(nameof(CreateProduct))
                .ProducesValidationProblem()
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .ProducesProblem(StatusCodes.Status409Conflict)
                .ProducesProblem(StatusCodes.Status500InternalServerError)
                .Produces<Ulid>(StatusCodes.Status201Created)
                .WithTags("Products")
                .MapToApiVersion(1);
        }
    }
}
```

**Responses** :
- **POST** : `Results.Created($"/api/v1/{route}/{id.Value}", id.Value)` → 201
- **GET** : `Results.Ok(Mapper.ToResponse(data))` → 200
- **PUT** : `Results.Ok(id.Value)` → 200
- **DELETE** : `Results.NoContent()` → 204

Les erreurs sont gerees globalement par `GlobalExceptionHandler`. Aucun `try/catch` dans l'endpoint : il laisse remonter.

Le mapping est un `switch` **ordonne** — la premiere branche qui matche gagne. Une exception plus specialisee doit donc etre declaree avant sa base (`PartnerApiException` avant `UpstreamServiceException`), sinon elle est absorbee.

| Exception | Statut | Charge utile |
|-----------|--------|--------------|
| `PartnerApiException` | statut amont si 4xx, sinon **502** | detail masque hors Development |
| `SecurityContextUnavailableException` | **503** | — |
| `NotFoundException` | **404** | — |
| `FluentValidation.ValidationException` | **400** | `errors` |
| `ForbiddenException` | **403** | — |
| `ConflictException` | **409** | — |
| `ValidationFailedException` | **422** | `workflow` + `violations` |
| `DomainException` (defaut de la famille) | **400** | `AggregateValidationException` ajoute `errors` |
| `GridifyMapperException`, `GridifyFilteringException`, `GridifyOrderingException` | **400** | filtre ou tri invalide envoye par le client |
| `BadHttpRequestException { InnerException: InvalidDataException }` | **413** | corps de requete au-dela de la limite |
| `ArgumentException` | **400** | — |
| `IInternalException` | **400** | attrape `Core.Exceptions.Base.ValidationException` et toute exception marquee |
| `UpstreamServiceException` (autres que PartnerApi) | **503** | — |
| tout le reste | **500** | detail masque hors Development |

Hierarchie reelle des exceptions de base, a connaitre avant d'en creer une : `NotFoundException` et `ConflictException` heritent de `DomainException`. `ValidationException` et `ForbiddenException` n'en heritent **pas** — elles derivent d'`Exception` et portent `IInternalException`. `UpstreamServiceException` ne porte deliberement pas `IInternalException` : une panne amont n'est pas une faute du client, elle doit sortir en 503 et non en 400.

`.ProducesProblem(...)` ne declare que les statuts que **cette** route peut produire — ils viennent des exceptions levees par son handler, pas de la table entiere. `500` est toujours declare ; `413` seulement sur une route qui recoit un corps volumineux ; `422` seulement sur une route qui declenche une validation de workflow.
