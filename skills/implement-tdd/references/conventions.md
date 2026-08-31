# Conventions — Accès aux données

**Toujours lu par `/implement-tdd`.**

## Conventions par couche — ne sont plus ici

Nommage, classes de base, structure de dossiers, règles et pièges par couche vivent dans `.claude/rules/`, chargées automatiquement dès qu'un fichier de la couche est lu — y compris dans un subagent :

| Fichier | Couche |
|---------|--------|
| `.claude/rules/domain.md` | `Domain/` |
| `.claude/rules/application-cqrs.md` | `Application/` |
| `.claude/rules/infrastructure-ef.md` | `Infrastructure/`, `MigrationService/`, `MigrationDsl/` |
| `.claude/rules/webapi-endpoints.md` | `WebAPI/`, `Abstractions.Models/`, `SDK/` |
| `.claude/rules/tests.md` | `tests/` |

Ne pas dupliquer ces règles ici : deux sources qui divergent font choisir arbitrairement. Une convention de couche nouvelle va dans le fichier de règle de sa couche.

Exemples code complets → `examples-{domain,application,infrastructure,webapi}.md`, un fichier par couche. La regle de la couche donne le chemin exact.

Le tableau ci-dessous reste ici : il est indissociable de l'étape **COUT** du cycle (`regles-communes.md` §2).

---

## Accès aux données — coût des appels Infrastructure

**Aucun test ne verrouille le nombre d'appels** : un handler à 1 requête et un handler à 2N+2 requêtes sont aussi verts. La pression doit venir d'ici, pas de la suite de tests.

**Règle** : le nombre d'appels Infrastructure d'un comportement est **borné et indépendant de la taille de l'entrée**. Énoncer ce coût fait partie du cycle (`regles-communes.md` §2, étape COUT).

| Symptôme | Correction |
|---|---|
| `await repo.GetX(id)` dans un `foreach` | Méthode qui prend **la liste** : `GetX(IReadOnlyList<TId> ids, …)` |
| Une requête par identifiant reçu (N+1) | Une requête, `ids.Contains(...)` poussé en SQL |
| `Save` dans la boucle | Accumuler les événements, **un seul** `Save` |
| Lecture base dans la boucle d'events d'un `Save` de repository | Collecter les identifiants mutés, **une** requête `Contains` avant la boucle ; le `foreach` ne fait plus que du dispatch en mémoire |
| `.Where(...)` en mémoire sur un résultat de repository | Passer le prédicat au repository, filtrer en SQL |
| Deux lectures pour résoudre `A → B → agrégat` | Une lecture qui part de l'agrégat et filtre sur `A` (jointure) |
| `Include` d'une collection **non bornée** pour toucher un seul élément | Décision **explicite** : charger entier (agrégat cohérent, coût assumé) ou lecture dédiée. Jamais par défaut, jamais sans le dire |

**Avant d'ajouter une méthode de repository** : vérifier qu'aucune existante ne répond déjà en une requête. Une méthode dédiée est justifiée quand elle **change la forme** de la lecture (filtre SQL, projection, jointure), pas quand elle renomme l'existant.

**Exploiter les invariants avant d'écrire la boucle.** Une invariante énoncée par la fiche ou la spec (« une copie n'a qu'un référent », « toutes les clés d'une Configuration transférée viennent du même trousseau ») **supprime du code** : elle transforme un `GroupBy` + parcours en une lecture unique. Lire la fiche pour la documenter ne suffit pas — il faut en déduire ce qui disparaît.

**Ne pas confondre avec l'optimisation prématurée** : il ne s'agit pas de gagner des millisecondes mais de retirer une dépendance à la taille de l'entrée. `N` requêtes là où `1` suffit est un défaut de conception, pas un réglage de performance.

---
