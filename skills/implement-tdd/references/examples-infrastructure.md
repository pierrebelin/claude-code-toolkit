# Exemples de code — Infrastructure

Consulter quand le pattern est inconnu ou qu'il s'agit de la première implémentation d'un type d'élément dans cette couche.
Règles et pièges → `.claude/rules/` (chargées automatiquement).

---

## Infrastructure - Repository

Les repositories utilisent `IUnitOfWork<AppDbContext>` et `IAuditTrailWriter`. Ils traitent les domain events via un switch. Les entites mutees sont chargees **en une requete avant la boucle** : aucun `await` sur la base a l'interieur du `foreach`.

```csharp
public class ProductRepository(
    IUnitOfWork<AppDbContext> unitOfWork,
    IAuditTrailWriter auditTrailWriter) : IProductRepository
{
    public async Task<Product?> GetProduct(ProductId id, OrganizationId organizationId, CancellationToken ct)
    {
        var entity = await unitOfWork.DbContext.Products
            .AsNoTracking()
            .Include(k => k.ProductItems)
            .FirstOrDefaultAsync(k => k.Id == id.Value && k.OrganizationId == organizationId.Value, ct);

        return entity is null ? null : ProductMapper.MapToDomain(entity);
    }

    public async Task Save(List<IDomainEvent<ProductId>> events, CancellationToken ct)
    {
        var mutatedIds = events
            .Where(e => e is not ProductCreated)
            .Select(e => e.Id.Value)
            .Distinct()
            .ToList();

        var mutated = mutatedIds.Count == 0
            ? []
            : await unitOfWork.DbContext.Products
                .Where(k => mutatedIds.Contains(k.Id))
                .ToDictionaryAsync(k => k.Id, ct);

        foreach (var @event in events)
        {
            switch (@event)
            {
                case ProductCreated e:
                    unitOfWork.DbContext.Products.Add(ProductMapper.MapToEntity(e));
                    break;
                case ProductUpdated e:
                    var entity = Mutated(mutated, e.Id);
                    entity.Name = e.Name;
                    entity.Description = e.Description;
                    break;
                case ProductDeleted e:
                    unitOfWork.DbContext.Products.Remove(Mutated(mutated, e.Id));
                    break;
            }

            auditTrailWriter.Track(@event);
        }

        try
        {
            await unitOfWork.DbContext.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsNameConflict(ex))
        {
            throw new ProductNameAlreadyExistsException(ConflictingName(events));
        }
    }

    private static ProductEntity Mutated(IReadOnlyDictionary<Ulid, ProductEntity> mutated, ProductId id)
        => mutated.TryGetValue(id.Value, out var entity)
            ? entity
            : throw new ProductNotFoundException(id);

    private static bool IsNameConflict(DbUpdateException ex)
        => (ex.InnerException?.Message ?? ex.Message)
            .Contains("UK_Product_OrganizationId_Name", StringComparison.OrdinalIgnoreCase);

    private static string ConflictingName(List<IDomainEvent<ProductId>> events)
        => events.OfType<ProductCreated>().Select(e => e.Name)
            .Concat(events.OfType<ProductUpdated>().Select(e => e.Name))
            .First();
}
```

**Traduction d'une contrainte** : le repository est le seul endroit qui voit la violation. Il la rend en exception domain (`ProductNameAlreadyExistsException` → 409) ; sans lui, le `DbUpdateException` remonte non traite et sort en 500.

Le filtre nomme **l'index precis**. Un repli du type `message.Contains("duplicate")` attrape toutes les violations d'unicite de la table et rend un 409 faux des qu'une autre contrainte casse.

**Cout** : 1 lecture + 1 ecriture, quel que soit le nombre d'events. La boucle ne fait plus que du dispatch en memoire.

**Regles** :
- Aucune lecture base dans la boucle d'events. Les identifiants mutes sont connus avant d'entrer dedans : une requete `Contains` les charge tous d'un coup. Un `await FindAsync` par event, c'est N requetes pour une seule command.
- La lecture de `Save` est **suivie** (pas d'`AsNoTracking`) : c'est ce suivi qui fait persister les mutations. Seules les lectures de consultation (`GetProduct`, `GetProducts`) sont `AsNoTracking()`.
- Entite attendue mais absente : lever l'exception domain (`ProductNotFoundException`). Un `if (entity is not null)` sans `else` avale l'echec et rend un `Save` faussement reussi.
- `auditTrailWriter.Track(@event)` une seule fois apres le switch : il s'applique a tous les events, il n'a pas a etre recopie dans chaque `case`.

---

## Infrastructure - EF Core Entity

Les entites infrastructure heritent de `AbstractEntity<Ulid>` et utilisent `[EntityTypeConfiguration]` pour la configuration inline :

```csharp
[EntityTypeConfiguration(typeof(ProductEntityConfiguration))]
public class ProductEntity : AbstractEntity<Ulid>
{
    public required Ulid OrganizationId { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public List<ProductItemEntity> ProductItems { get; set; } = [];
}

public class ProductEntityConfiguration : IEntityTypeConfiguration<ProductEntity>
{
    public void Configure(EntityTypeBuilder<ProductEntity> builder)
    {
        builder.ToTable("Products");
        builder.HasIndex(x => new { x.OrganizationId, x.Name })
            .IsUnique()
            .HasDatabaseName("UK_Product_OrganizationId_Name");
        builder.HasIndex(x => x.OrganizationId);
    }
}
```

---

## Infrastructure - Mapper

Mapper bidirectionnel entre entites EF Core et aggregates domain. Utilise `Restore()` pour la reconstitution :

```csharp
public static class ProductMapper
{
    public static Product MapToDomain(ProductEntity entity)
        => Product.Restore(
            ProductId.From(entity.Id),
            OrganizationId.From(entity.OrganizationId),
            entity.Name,
            entity.Description,
            entity.ProductItems.Select(ProductItemMapper.MapToDomain).ToList(),
            AuditInfo.Restore(entity.Created, entity.CreatedBy, entity.Updated, entity.UpdatedBy));

    public static ProductEntity MapToEntity(ProductCreated e)
        => new()
        {
            Id = e.Id.Value,
            OrganizationId = e.OrganizationId.Value,
            Name = e.Name,
            Description = e.Description
        };
}
```

---
