---
paths:
  - "src/{{PRODUCT}}.WebAPI/**/*.cs"
  - "src/{{PRODUCT}}.Abstractions.Models/**/*.cs"
  - "src/{{PRODUCT}}.SDK/**/*.cs"
---

# WebAPI rules

Full code examples for this layer: `.claude/skills/implement-tdd/references/examples-webapi.md`.


WebAPI translates HTTP. It carries no business rule (APP-04).

**API versioning: v1.0 only.** "v2.0" names a version of the DSL language, never the API.

## Endpoints

Static class `{Action}{Entity}` holding a static `HandlerAsync` and a nested `Endpoint : IEndpoint` with `MapEndpoints`. Discovered by reflection. `HandlerAsync` is co-located with its only caller — satisfies Sonar S3398.

The endpoint is a pass-through: no conversion, no service calls, no enrichment. Project the handler payload straight to HTTP. Everything else belongs in the Command/Query and its handler.

Routes are constants in `Endpoints/Endpoints.cs`.

The `Ulid` → typed ID conversion happens **here**, at the boundary. Same for the transport nullable → `[]` (`request.GroupIds ?? []`), never propagated below.

## Request DTOs

Live in `Abstractions.Models`, **never** in WebAPI — no nested record, no internal class.

- Layout: `Requests/{Feature}/{Operation}/{Action}{Entity}Request.cs`
- Namespace: `{{PRODUCT}}.Abstractions.Models.Requests.{Feature}.{Operation}`
- Shape: `sealed record`, positional properties or `{ get; init; }`

## Responses

| Verb | Status |
|------|--------|
| POST | 201 |
| GET | 200 |
| PUT | 200 |
| DELETE | 204 |

## GlobalExceptionHandler

Backstop — handlers throw and the exception propagates here (`WebAPI/GlobalExceptionHandler.cs`).

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

504 means the server exceeded its own budget. A client abort is filtered upstream by `ExceptionHandlerMiddlewareImpl`, which sets 499.

## Transport bounds (APP-05)

Body size and rate limiting belong here (`RequestLimits`, Kestrel `MaxRequestBodySize`, `WithFormOptions`), not in the Domain.

## Naming

| Artifact | Pattern | Example |
|----------|---------|---------|
| Endpoint | `{Action}{Entity}` | `CreateProduct` |
| Request DTO | `{Action}{Entity}Request` | `CreateProductRequest` |
