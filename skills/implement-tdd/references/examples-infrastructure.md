# Code examples — Infrastructure

Consult when the pattern is unknown, or when this is the first implementation of an element type in this layer.
Rules and pitfalls → `.claude/rules/` (loaded automatically).

---

## Infrastructure - Repository

Repositories use `IUnitOfWork<AppDbContext>` and `IAuditTrailWriter`. They process domain events through a switch. Mutated entities are loaded **in a single query before the loop**: no `await` on the database inside the `foreach`.

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

**Translating a constraint**: the repository is the only place that sees the violation. It turns it into a domain exception (`ProductNameAlreadyExistsException` → 409); without it, the `DbUpdateException` bubbles up untreated and surfaces as a 500.

The filter names **the precise index**. A fallback such as `message.Contains("duplicate")` catches every uniqueness violation on the table and returns a wrong 409 as soon as another constraint breaks.

**Cost**: 1 read + 1 write, whatever the number of events. The loop then only dispatches in memory.

**Rules**:
- No database read inside the event loop. The mutated identifiers are known before entering it: one `Contains` query loads them all at once. One `await FindAsync` per event means N queries for a single command.
- The `Save` read is **tracked** (no `AsNoTracking`): that tracking is what persists the mutations. Only consultation reads (`GetProduct`, `GetProducts`) are `AsNoTracking()`.
- Entity expected but missing: throw the domain exception (`ProductNotFoundException`). An `if (entity is not null)` with no `else` swallows the failure and returns a falsely successful `Save`.
- `auditTrailWriter.Track(@event)` once, after the switch: it applies to every event, it does not get copied into each `case`.

---

## Infrastructure - EF Core Entity

Infrastructure entities inherit from `AbstractEntity<Ulid>` and use `[EntityTypeConfiguration]` for inline configuration:

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

Two-way mapper between EF Core entities and domain aggregates. Uses `Restore()` for rehydration:

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
