---
paths:
  - "src/{{PRODUCT}}.WebAPI/**/*.cs"
  - "src/{{PRODUCT}}.Abstractions.Models/**/*.cs"
  - "src/{{PRODUCT}}.SDK/**/*.cs"
---

# WebAPI rules

Code pattern: an existing file of the same kind in this repo — `graphify query`, or a sibling folder. The repo is the example.

WebAPI translates HTTP. No business rule (APP-04).

**API versioning: v1.0 only.** "v2.0" = DSL language version, never API.

## Endpoints

Static class `{Action}{Entity}` holding static `HandlerAsync` and nested `Endpoint : IEndpoint` with `MapEndpoints`. Discovered by reflection. `HandlerAsync` co-located with its only caller — satisfies Sonar S3398.

Endpoint = pass-through: no service calls, no enrichment, no conversion beyond boundary ones below. Project handler payload straight to HTTP. Rest belongs in Command/Query and handler.

Routes = constants in `Endpoints/Endpoints.cs`.

`Ulid` → typed ID conversion happens **here**, at boundary. Same for transport nullable → `[]` (`request.GroupIds ?? []`), never propagated below.

## Request DTOs

Live in `Abstractions.Models`, **never** in WebAPI — no nested record, no internal class.

- Layout: `Requests/{Feature}/{Operation}/{Action}{Entity}Request.cs`
- Namespace: `{{PRODUCT}}.Abstractions.Models.Requests.{Feature}.{Operation}`
- Shape: `sealed record`, positional properties or `{ get; init; }`

## Responses

| Verb | Result |
|------|--------|
| POST | `Results.Created($"/api/v1/{route}/{id.Value}", id.Value)` — 201 |
| GET | `Results.Ok(Mapper.ToResponse(data))` — 200 |
| PUT | `Results.Ok(id.Value)` — 200 |
| DELETE | `Results.NoContent()` — 204 |

No `try/catch` in an endpoint: exceptions bubble to `GlobalExceptionHandler`. `.ProducesProblem(...)` declares only the statuses **this** route can produce, from what its handler throws: `500` always, `413` only on a large-body route, `422` only on a route triggering workflow validation.

## GlobalExceptionHandler

Backstop — handlers throw, exception propagates here (`WebAPI/GlobalExceptionHandler.cs`).

| Exception | Status |
|-----------|--------|
| `NotFoundException` | 404 |
| `ConflictException` | 409 |
| `ForbiddenException` | 403 |
| `ValidationException` (FluentValidation), `DomainException`, `ArgumentException`, `Gridify*Exception` | 400 |
| `ValidationFailedException` | 422 |
| `BadHttpRequestException { InnerException: InvalidDataException }` | 413 |
| `SecurityContextUnavailableException` | 503 |
| `UpstreamServiceException` | its own 4xx, else 502 |
| `OperationCanceledException` / `TimeoutRejectedException` | 504 |

Ordered `switch`, first match wins: a specialised exception goes before its base. `ValidationException` / `AggregateValidationException` add `errors`; `ValidationFailedException` adds `workflow` + `violations`; unmapped = 500, detail hidden outside Development. `UpstreamServiceException` carries no `IInternalException` on purpose: an upstream outage is not the client's fault.

504 = server exceeded own budget. Client abort filtered upstream by `ExceptionHandlerMiddlewareImpl`, sets 499.

## Transport bounds (APP-05)

Body size, rate limiting belong here (`RequestLimits`, Kestrel `MaxRequestBodySize`, `WithFormOptions`), not Domain.

## Naming

| Artifact | Pattern | Example |
|----------|---------|---------|
| Endpoint | `{Action}{Entity}` | `CreateProduct` |
| Request DTO | `{Action}{Entity}Request` | `CreateProductRequest` |
