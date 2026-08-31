# Exemples de code — Domain

Consulter quand le pattern est inconnu ou qu'il s'agit de la première implémentation d'un type d'élément dans cette couche.
Règles et pièges → `.claude/rules/` (chargées automatiquement).

---

## Domain - Aggregate Root

Constructeur prive. Factory methods `Create()` (nouvelle instance + event) et `Restore()` (rehydratation, pas de validation metier). Methodes de mutation metier qui emettent des events.

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

**Regles** :
- Proprietes modifiables : `{ get; private set; }`
- Proprietes immuables : `{ get; }` (init dans constructeur)
- Jamais de setter public
- Collections : `private readonly List<T> _items` + `public IReadOnlyList<T> Items => _items.AsReadOnly()`
- Concept metier porteur d'une regle de format : type VO (`Name`, `TechnicalName`, `DiagramName`), jamais `string` (DDD-04). La regle vit dans le VO ; `Create()` et `Update()` appellent `Name.Create(name)`, ils ne reecrivent pas la validation. Un nom vide leve `EmptyNameException`, pas un `ArgumentException` local.
- `Restore()` reconstruit le VO sans validation (`Name.Restore(name)`) : la donnee vient de la base, elle a deja ete validee a l'ecriture.
- L'event de persistence transporte la forme primitive (`validatedName.Value`) : il alimente le mapper EF, pas le Domain.

---

## Domain - EntityId

Utilise ULID, herite de `EntityId<T>` :

```csharp
public class ProductId : EntityId<ProductId> { }
```

Creation : `ProductId.Create()` (nouveau) ou `ProductId.From(ulid)` (existant).

---

## Domain - Value Objects

Implementer `GetEqualityComponents()` :

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

Un VO porteur d'une regle de format expose `Create()` (validation, appelee par le Domain) et `Restore()` (rehydratation depuis la base, sans validation). C'est ce couple qui retire la validation des aggregates :

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

`Name`, `TechnicalName` et `DiagramName` existent deja dans `Domain/Core/ValueObjects/` : les reutiliser avant d'en creer un.

---

## Domain - Domain Events

Records qui heritent de `DomainEvent<TEntityId>`. Emis via `AddEvent()` dans l'aggregate :

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

Heriter d'une base de `Domain/Core/Exceptions/Base/` : `NotFoundException` (404), `ConflictException` (409), `ForbiddenException` (403), `ValidationException` (400, porte un dictionnaire d'erreurs), ou `DomainException` (400) par defaut. Nommer `{Entity}{Raison}Exception`.

`NotFoundException` et `ConflictException` derivent de `DomainException` ; `ValidationException` et `ForbiddenException` derivent d'`Exception` + `IInternalException`. Le statut vient de la base choisie — le mapping complet est en fin de fichier (§ WebAPI - Endpoint).

```csharp
public class ProductNotFoundException(ProductId id)
    : NotFoundException("Product", id.Value);

public class ProductNameAlreadyExistsException(string name)
    : ConflictException($"Product with name '{name}' already exists");
```

---

## Domain - Repository Interface

Centree sur l'aggregate. Inclut la methode `Save` pour les domain events :

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
