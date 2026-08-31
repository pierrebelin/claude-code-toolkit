# Code examples — WebAPI

Consult when the pattern is unknown, or when this is the first implementation of an element type in this layer.
Rules and pitfalls → `.claude/rules/` (loaded automatically).

---

## Abstractions.Models - Request DTO

Request DTOs define the API endpoints' contract. They live in `Abstractions.Models`, never in the WebAPI project. The endpoint imports the DTO.

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

Examples:

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

**Rules**:
- `sealed record` mandatory
- Namespace = file path: `{{PRODUCT}}.Abstractions.Models.Requests.{Feature}.{Operation}`
- 1 file = 1 request DTO, in a folder named after the operation (`ExportDiagrams/`, `CreateProduct/`)
- Never declare a request DTO as a nested record inside the WebAPI endpoint

---

## WebAPI - Endpoint

Every endpoint is a static class with a static handler and a nested `Endpoint : IEndpoint` class. Discovered automatically by reflection.

The Request DTO is imported from `Abstractions.Models` (never declared locally):

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

**Responses**:
- **POST**: `Results.Created($"/api/v1/{route}/{id.Value}", id.Value)` → 201
- **GET**: `Results.Ok(Mapper.ToResponse(data))` → 200
- **PUT**: `Results.Ok(id.Value)` → 200
- **DELETE**: `Results.NoContent()` → 204

Errors are handled globally by `GlobalExceptionHandler`. No `try/catch` in the endpoint: it lets them bubble up.

The mapping is an **ordered** `switch` — the first matching branch wins. A more specialised exception must therefore be declared before its base (`PartnerApiException` before `UpstreamServiceException`), otherwise it gets absorbed.

| Exception | Status | Payload |
|-----------|--------|--------------|
| `PartnerApiException` | upstream status if 4xx, otherwise **502** | detail hidden outside Development |
| `SecurityContextUnavailableException` | **503** | — |
| `NotFoundException` | **404** | — |
| `FluentValidation.ValidationException` | **400** | `errors` |
| `ForbiddenException` | **403** | — |
| `ConflictException` | **409** | — |
| `ValidationFailedException` | **422** | `workflow` + `violations` |
| `DomainException` (family default) | **400** | `AggregateValidationException` adds `errors` |
| `GridifyMapperException`, `GridifyFilteringException`, `GridifyOrderingException` | **400** | invalid filter or sort sent by the client |
| `BadHttpRequestException { InnerException: InvalidDataException }` | **413** | request body beyond the limit |
| `ArgumentException` | **400** | — |
| `IInternalException` | **400** | catches `Core.Exceptions.Base.ValidationException` and any marked exception |
| `UpstreamServiceException` (other than PartnerApi) | **503** | — |
| everything else | **500** | detail hidden outside Development |

Real hierarchy of the base exceptions, to know before creating one: `NotFoundException` and `ConflictException` inherit from `DomainException`. `ValidationException` and `ForbiddenException` do **not** — they derive from `Exception` and carry `IInternalException`. `UpstreamServiceException` deliberately does not carry `IInternalException`: an upstream outage is not the client's fault, it must surface as 503 and not as 400.

`.ProducesProblem(...)` declares only the statuses **this** route can produce — they come from the exceptions its handler throws, not from the whole table. `500` is always declared; `413` only on a route receiving a large body; `422` only on a route triggering a workflow validation.
