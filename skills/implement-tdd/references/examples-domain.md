# Code examples — Domain

Consult when the pattern is unknown, or when this is the first implementation of an element type in this layer.
Rules and pitfalls → `.claude/rules/` (loaded automatically).

---

## Domain - Aggregate Root

Private constructor. Factory methods `Create()` (new instance + event) and `Restore()` (rehydration, no business validation). Business mutation methods that emit events.

```csharp
public class Product : AggregateRoot<ProductId>
{
    public OrganizationId OrganizationId { get; }
    public Name Name { get; private set; }
    public string? Description { get; private set; }
    public AuditInfo Audit { get; }

    private readonly List<ProductItem> _productItems;
    public IReadOnlyList<ProductItem> ProductItems => _productItems.AsReadOnly();

    public static Product Create(OrganizationId organizationId, string name, string? description, UserContext userContext)
    {
        var validatedName = Name.Create(name);

        var product = new Product(ProductId.Create(), organizationId, validatedName, description, [], AuditInfo.Create(userContext.Email));
        product.AddEvent(new ProductCreated(product.Id, organizationId, validatedName.Value, description, userContext));
        return product;
    }

    public static Product Restore(ProductId id, OrganizationId organizationId, string name, string? description, List<ProductItem> productItems, AuditInfo audit)
        => new(id, organizationId, Name.Restore(name), description, productItems, audit);

    public void Update(string name, string? description, UserContext userContext)
    {
        Name = Name.Create(name);
        Description = description;
        AddEvent(new ProductUpdated(Id, OrganizationId, Name.Value, description, userContext));
    }

    public void Delete(UserContext userContext)
    {
        AddEvent(new ProductDeleted(Id, OrganizationId, userContext));
    }

    private Product(ProductId id, OrganizationId organizationId, Name name, string? description, List<ProductItem> productItems, AuditInfo audit) : base(id)
    {
        OrganizationId = organizationId;
        Name = name;
        Description = description;
        _productItems = productItems;
        Audit = audit;
    }
}
```

**Rules**:
- Mutable properties: `{ get; private set; }`
- Immutable properties: `{ get; }` (set in the constructor)
- Never a public setter
- Collections: `private readonly List<T> _items` + `public IReadOnlyList<T> Items => _items.AsReadOnly()`
- A business concept carrying a format rule: a VO type (`Name`, `TechnicalName`, `DiagramName`), never `string` (DDD-04). The rule lives in the VO; `Create()` and `Update()` call `Name.Create(name)`, they do not rewrite the validation. An empty name throws `EmptyNameException`, not a local `ArgumentException`.
- `Restore()` rebuilds the VO without validation (`Name.Restore(name)`): the data comes from the database, it was already validated on write.
- The persistence event carries the primitive form (`validatedName.Value`): it feeds the EF mapper, not the Domain.

---

## Domain - EntityId

Uses ULID, inherits from `EntityId<T>`:

```csharp
public class ProductId : EntityId<ProductId> { }
```

Creation: `ProductId.Create()` (new) or `ProductId.From(ulid)` (existing).

---

## Domain - Value Objects

Implement `GetEqualityComponents()`:

```csharp
public class DisplaySettings : ValueObject
{
    public int Brightness { get; }
    public static DisplaySettings Create(int brightness) => new(brightness);
    private DisplaySettings(int brightness) { Brightness = brightness; }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Brightness;
    }
}
```

A VO carrying a format rule exposes `Create()` (validation, called by the Domain) and `Restore()` (rehydration from the database, no validation). That pair is what takes validation out of the aggregates:

```csharp
public sealed class Name : ValueObject
{
    private const int MaxLength = 128;

    public string Value { get; }
    private Name(string value) { Value = value; }

    public static Name Create(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new EmptyNameException();
        if (value.Length > MaxLength)
            throw new NameTooLongException(MaxLength);

        return new Name(value);
    }

    public static Name Restore(string value) => new(value);

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Value;
    }
}
```

`Name`, `TechnicalName` and `DiagramName` already exist under `Domain/Core/ValueObjects/`: reuse them before creating one.

---

## Domain - Domain Events

Records inheriting from `DomainEvent<TEntityId>`. Emitted through `AddEvent()` inside the aggregate:

```csharp
public sealed record ProductCreated(
    ProductId Id,
    OrganizationId OrganizationId,
    string Name,
    string? Description,
    UserContext UserContext
) : DomainEvent<ProductId>(Id);
```

---

## Domain - Exceptions

Inherit from a base under `Domain/Core/Exceptions/Base/`: `NotFoundException` (404), `ConflictException` (409), `ForbiddenException` (403), `ValidationException` (400, carries an error dictionary), or `DomainException` (400) by default. Name it `{Entity}{Reason}Exception`.

`NotFoundException` and `ConflictException` derive from `DomainException`; `ValidationException` and `ForbiddenException` derive from `Exception` + `IInternalException`. The status comes from the chosen base — the full mapping is at the end of the WebAPI file (§ WebAPI - Endpoint).

```csharp
public class ProductNotFoundException(ProductId id)
    : NotFoundException("Product", id.Value);

public class ProductNameAlreadyExistsException(string name)
    : ConflictException($"Product with name '{name}' already exists");
```

---

## Domain - Repository Interface

Aggregate-centred. Includes the `Save` method for domain events:

```csharp
public interface IProductRepository
{
    Task<Product?> GetProduct(ProductId id, OrganizationId organizationId, CancellationToken ct);
    Task<Product?> GetProductByName(string name, OrganizationId organizationId, CancellationToken ct);
    Task<Paging<Product>> GetProducts(OrganizationId organizationId, PaginateQuery? query, CancellationToken ct);
    Task Save(List<IDomainEvent<ProductId>> events, CancellationToken ct);
}
```

---
