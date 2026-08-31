# Code examples — Application

Consult when the pattern is unknown, or when this is the first implementation of an element type in this layer.
Rules and pitfalls → `.claude/rules/` (loaded automatically).

---

## Application - Command Handler

Commands inherit from `ICommand`. The handler inherits from `CommandHandler<TCommand, TResult>`, which automatically wraps in a transaction through `ITransactionManager`. The handler implements `HandleCommand()` (not `Handle()`).

Commands return the aggregate's ID directly (no `Result<T>`). Errors are domain exceptions.

```csharp
// CreateProductCommand.cs
public record CreateProductCommand(string Name, string? Description) : ICommand
{
    public static CreateProductCommand Create(string name, string? description) => new(name, description);
}

// ICreateProductCommandHandler.cs
public interface ICreateProductCommandHandler : IHandler<CreateProductCommand, ProductId>;

// CreateProductCommandHandler.cs
public sealed class CreateProductCommandHandler(
    IProductRepository productRepository,
    IUserContextWrapper userContextWrapper,
    ITransactionManager transactionManager)
    : CommandHandler<CreateProductCommand, ProductId>(transactionManager),
      ICreateProductCommandHandler
{
    protected override async Task<ProductId> HandleCommand(CreateProductCommand command, CancellationToken cancellationToken)
    {
        var userContext = userContextWrapper.GetUserContext();
        var organizationId = OrganizationId.From(userContext.OrganizationId);

        var existing = await productRepository.GetProductByName(command.Name, organizationId, cancellationToken);
        if (existing is not null)
            throw new ProductNameAlreadyExistsException(command.Name);

        var product = Product.Create(organizationId, command.Name, command.Description, userContext);
        await productRepository.Save(product.DomainEvents.ToList(), cancellationToken);
        return product.Id;
    }
}
```

**Uniqueness: who owns the rule.** The authority is the **persistence constraint** (`UK_Product_OrganizationId_Name`), translated by the repository. It alone checks and writes atomically.

The handler's `GetProductByName` is not the rule: it is an **early failure**, avoiding the rest of the transaction — a clone, an upstream call — before knowing it will fail. It does not protect against concurrency: two simultaneous commands both pass, whether the check sits in the handler or in the aggregate. The second `SaveChanges` waits on the index lock, then fails when the first commits.

Consequences to respect:
- Without the repository translating the violation, that race surfaces as **500** instead of 409. That is the defect, not the pre-check.
- A pre-check duplicating a named authority does not violate APP-01. A handler that would be the **only** owner of the rule does.
- The pre-check is optional: on a command with no expensive work ahead of the `Save`, the translation alone is enough and saves a read.

---

## Application - Query Handler

Queries implement `IHandler` directly (no base class, no transaction). They return **their payload directly**: `Paging<T>` for a paginated list, `IReadOnlyList<T>` for a list bounded by nature, the aggregate or the response for a single read. Never `Result<T>`: no query handler in the codebase uses one.

```csharp
// GetProductsQuery.cs
public sealed record GetProductsQuery(PaginateQuery? Query) : ICommand
{
    public static GetProductsQuery Create(PaginateQuery? query) => new(PaginationBounds.Normalize(query));
}

// IGetProductsQueryHandler.cs
public interface IGetProductsQueryHandler : IHandler<GetProductsQuery, Paging<Product>>;

// GetProductsQueryHandler.cs
public sealed class GetProductsQueryHandler(
    IProductRepository productRepository,
    IUserContextWrapper userContextWrapper) : IGetProductsQueryHandler
{
    public async Task<Paging<Product>> Handle(GetProductsQuery query, CancellationToken cancellationToken)
    {
        var organizationId = OrganizationId.From(userContextWrapper.GetUserContext().OrganizationId);
        return await productRepository.GetProducts(organizationId, query.Query, cancellationToken);
    }
}
```

**Bounds of a list read** (APP-05) — three distinct owners, never hand-rewritten:
- `PaginationBounds.Normalize(query)` inside the query's `Create`: page and page size brought back within their bounds before the query even exists.
- Filtering and sorting: Gridify in the repository (`GridifyAsync` + `IGridifyMapper`), pushed to SQL.
- Unpaginated branch: capped by `QueryLimits.MAX_UNPAGINATED_RESULTS` on the repository side. A list read with neither pagination **nor** a cap is a deviation.

Full model: `AuditTrailRepository.GetAuditTrails` + `GetAuditTrailsQuery.Create`.

**Which return type to pick**:

| Read | Repository and handler return type |
|---------|------------------------------------|
| List exposed by an endpoint, paginable or filterable | `Paging<T>` |
| List bounded by nature (children of an aggregate, short reference data) | `IReadOnlyList<T>` |
| Single read | the aggregate or the response; `null` on the repository side, `NotFound` exception thrown by the handler |

---
