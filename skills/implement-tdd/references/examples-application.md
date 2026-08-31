# Exemples de code — Application

Consulter quand le pattern est inconnu ou qu'il s'agit de la première implémentation d'un type d'élément dans cette couche.
Règles et pièges → `.claude/rules/` (chargées automatiquement).

---

## Application - Command Handler

Les commands heritent de `ICommand`. Le handler herite de `CommandHandler<TCommand, TResult>` qui wrappe automatiquement dans une transaction via `ITransactionManager`. Le handler implemente `HandleCommand()` (pas `Handle()`).

Les commands retournent directement l'ID de l'aggregate (pas de `Result<T>`). Les erreurs sont des exceptions domain.

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

**Unicite : qui porte la regle.** L'autorite est la **contrainte de persistence** (`UK_Product_OrganizationId_Name`), traduite par le repository. Elle seule verifie et ecrit de maniere atomique.

Le `GetProductByName` du handler n'est pas la regle : c'est un **echec anticipe**, qui evite d'engager le reste de la transaction — un clonage, un appel amont — avant de savoir qu'elle echouera. Il ne protege pas de la concurrence : deux commands simultanees passent toutes les deux, que le test soit dans le handler ou dans l'agregat. Le deuxieme `SaveChanges` attend le verrou d'index, puis echoue quand le premier commite.

Consequences a respecter :
- Sans traduction de la violation par le repository, cette course sort en **500** au lieu de 409. C'est le defaut, pas le pre-controle.
- Un pre-controle qui double une autorite nommee ne viole pas APP-01. Un handler qui serait le **seul** porteur de la regle, si.
- Le pre-controle est facultatif : sur une command sans travail couteux en amont du `Save`, la traduction suffit et economise une lecture.

---

## Application - Query Handler

Les queries implementent `IHandler` directement (pas de base class, pas de transaction). Elles retournent **directement leur charge utile** : `Paging<T>` pour une liste paginee, `IReadOnlyList<T>` pour une liste bornee par nature, l'agregat ou la reponse pour une lecture unitaire. Jamais de `Result<T>` : aucun query handler du codebase n'en utilise.

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

**Bornes d'une lecture de liste** (APP-05) — trois porteurs distincts, jamais recodes a la main :
- `PaginationBounds.Normalize(query)` dans le `Create` de la query : page et taille de page ramenees dans leurs bornes avant que la query n'existe.
- Filtre et tri : Gridify dans le repository (`GridifyAsync` + `IGridifyMapper`), pousses en SQL.
- Branche non paginee : plafonnee par `QueryLimits.MAX_UNPAGINATED_RESULTS` cote repository. Une lecture de liste sans pagination **et** sans plafond est un ecart.

Modele complet : `AuditTrailRepository.GetAuditTrails` + `GetAuditTrailsQuery.Create`.

**Quel retour choisir** :

| Lecture | Retour du repository et du handler |
|---------|------------------------------------|
| Liste exposee par un endpoint, paginable ou filtrable | `Paging<T>` |
| Liste bornee par nature (enfants d'un agregat, referentiel court) | `IReadOnlyList<T>` |
| Lecture unitaire | l'agregat ou la reponse ; `null` cote repository, exception `NotFound` levee par le handler |

---
