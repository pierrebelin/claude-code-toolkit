# Exemples DDD

Lire seulement les sections des IDs appliques dans la fiche lot.

## DDD-02 / DDD-03 — Aggregate et comportement

**Conforme** : `ChangeOwnerHandler` charge `Document`, appelle `document.ChangeOwner(ownerId)`, puis sauvegarde `DocumentOwnerChanged`. `Document` refuse un owner invalide.

**Non conforme** : le handler teste la RM puis assigne `document.OwnerId = ownerId`.

## DDD-04 / DDD-05 — Concept et reference

**Conforme** : `Product.Name` est un VO `Name` qui valide son format une seule fois (`Name.Create`), reutilise par tous les aggregates qui portent un nom ; `ProductItem` stocke `ProductId`, pas un `Product` navigable.

**Non conforme** : `public string Name` avec la regle de format recopiee dans `Create()` puis dans `Update()` ; un VO `ProductName` cree alors que `Name` couvre deja le besoin ; un aggregate contient les objets d'un autre aggregate.

## DDD-06 / DDD-07 — Lifecycle et event interne

**Conforme** : `Product.Create(...)` produit `ProductCreated`; le repository appelle `Product.Restore(...)` pour relire la base et traduit `ProductCreated` dans `Save`.

**Non conforme** : le repository appelle `Create()` a la rehydratation ou publie l'event hors du processus de persistence.

## DDD-08 — Une command, un aggregate modifie

**Conforme** : `RenameProductHandler` charge et sauvegarde `Product`; une lecture ciblee fournit seulement un identifiant de contexte.

**Non conforme** : le handler charge, modifie et sauvegarde `Product` et `Order` dans la meme command sans exception explicite.

## DDD-09 / DDD-10 — Porteur de la logique et frontiere technique

**Conforme** : l'objet qui possede les donnees porte l'operation — `exportDiagramsContext.Serialize()`, `ParsedImportFile.Create(json)`. Un Domain Service stateless n'apparait que pour une regle qu'aucun objet metier ne possede. EF et HTTP restent en Infrastructure/WebAPI.

**Non conforme** : `DiagramExportSerializer.Serialize(context)`, `IParser.Parse(json)` ou tout helper statique qui prend en parametre l'etat d'un objet metier pour raisonner a sa place. `OrderDomainService` wrapper de repository. Une entity Domain qui porte un `DbContext`.

## DDD-11 — Absence modelisee

**Conforme** : `IReadOnlyList<GroupId> groupIds` non nullable, vide = « aucun filtre » documente sur la methode ; l'endpoint convertit `request.GroupIds ?? []` a la frontiere. Contrainte optionnelle → `NoConstraint` qui implemente le comportement neutre.

**Non conforme** : `IReadOnlyList<GroupId>? groupIds` propage jusqu'au repository, `PortConstraint?` teste par `is null` a chaque usage, ou un handler qui interprete `null` comme « inchange » sans que la methode le dise.
