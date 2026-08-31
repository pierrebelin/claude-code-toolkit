# Regles communes — skills d'implementation (.NET)

Partage par `/implement-tdd`.
Regles de **tests** = PAS ici → skills `/tests-unit-tests`, `/tests-integration-tests`, `/tests-contract-tests`.
Conventions DDD par couche (nommage, classes de base, structure, pieges) → `.claude/rules/*.md`, chargees automatiquement. Exemples code → `examples-{domain,application,infrastructure,webapi}.md` (meme dossier), un par couche.

## 1. Regles de code

- **Ne jamais ajouter de commentaire**, doc XML `///` comprise. L'intention passe par le nommage.
- Supprimer les commentaires que tu as ecrits, et ceux qui ne servent pas — répétition du code, commentaire périmé, TODO sans porteur — **dans les lignes que ton changement touche**. Un commentaire inutile situe ailleurs dans le fichier se signale, il ne se supprime pas. Ne conserver que ceux, préexistants, qui expliquent une décision, une contrainte ou une exception non déductible du code.
- Le nommage doit rendre le flux et les invariants lisibles sans commentaire. Une règle métier durable est aussi documentée dans le `CLAUDE.md` du dossier handler.
- **Changement chirurgical** : chaque ligne modifiee se rattache au comportement en cours. Pas d'amelioration d'un code adjacent qui marchait, pas de renommage ni de reformatage hors perimetre, pas de flexibilite ni de configurabilite non demandee. Style local du fichier avant preference personnelle. Supprimer les orphelins (`using`, variable, methode, type) que **ton** changement a crees ; le code mort preexistant se signale, il ne se supprime pas.
- **`var`** pour les variables locales.
- **1 classe = 1 fichier**, nom du fichier = nom de la classe.
- Nommage DDD (Command/Handler/Repository/Endpoint/DomainEvent/Exception/EntityId...) → `.claude/rules/*.md`, table `Naming` de la couche concernee.

## 2. TDD test-first — Iron Law

```
ZERO CODE PROD SANS TEST ROUGE D'ABORD
```

Code de production ecrit avant son test ? Supprime-le. Recommence. **Violer la lettre = violer l'esprit.**

Pas d'exception : garde pas "en reference", "adapte" pas pendant l'ecriture du test, regarde-le pas. Supprimer = supprimer.

**Cycle par comportement** (Command/Query+Handler, endpoint, methode repository ; methode d'aggregate uniquement a travers son handler/service) :
1. **RED** — 1 test d'un **comportement metier observable** (etat final verifiable via API publique / sortie), rattache a une RM/CU, qui **echoue**. **Jamais** tester un helper prive ou un detail interne — si l'etape de la fiche est un mecanisme ("scanner", "detecter", "mapper", "convertir"), remonte au comportement metier qu'il sert et teste celui-la. Test filtre → confirme l'echec attendu (assertion rouge, pas erreur de compile parasite).
2. **GREEN** — code minimal pour passer **ce test seul**. Rien de plus. Build + test filtre → vert.
3. **REFACTOR — nettoie, puis supprime.** Duplications et nommage d'abord, sans changer le comportement. Puis passe la liste de ce qui doit **partir** : branche defensive rendue impossible par un invariant de la fiche, wrapper / indirection / mapping a un seul appelant, parametre jamais lu, abstraction sans second implementeur, second type de meme forme qu'un existant. Le minimum de GREEN n'est pas le minimum du lot : c'est ce qui reste apres trois comportements qui l'est. Perimetre : supprime ce que **ton** code a rendu orphelin, pas le mort preexistant. Re-test → vert.
4. **COUT** — **enonce le cout d'acces du comportement** : « n lectures, n ecritures » vers Infrastructure
   (repository, service externe, fichier). Vert ≠ fini : aucun test n'observe le nombre d'appels, la pression
   ne viendra jamais de la suite.
   - Le cout doit etre **borne et independant de la taille de l'entree**. N candidats → pas N requetes.
   - Appel Infrastructure **dans une boucle** → repars en **conception**, pas en refactor cosmetique.
   - Tu ne sais pas enoncer le cout → tu ne connais pas ton code, relis-le avant de continuer.
   Pieges d'acces detailles → `conventions.md` § « Acces aux donnees ».

Comportement deja couvert par un test pre-existant → saute RED, implemente pour passer vert (modifie pas le test).

### Red Flags — STOP, repars en RED
- Code avant test
- "Deja teste a la main"
- "Test apres fait pareil"
- "C'est l'esprit, pas le rituel"
- "Ce cas est different parce que..."

### Red Flags de perimetre — STOP, revert le hunk
- "Tant que j'y suis, je nettoie ce fichier"
- Renommage, reformatage ou reorganisation d'un code que le lot ne modifie pas
- Suppression d'un code mort ou d'un commentaire preexistant, hors des lignes touchees
- Bug adjacent hors RM/CU du lot corrige au passage → le signaler, pas le corriger
- Abstraction, parametre de configuration ou point d'extension ajoute "pour plus tard"

### Test vert des la 1re execution — deux cas, jamais "on garde au cas ou"

Un test cense etre RED qui passe immediatement n'a rien prouve. Tranche entre les deux causes avant de continuer :

| Cause | Diagnostic | Action |
|---|---|---|
| Comportement **deja couvert** par un test existant | Retrouve le test qui le couvre (meme handler, meme RM) | **Supprime le nouveau test.** Il ne prouve rien, il double le cout de maintenance. Passe au comportement suivant |
| Comportement **non couvert**, assertion trop faible | L'assertion n'observe pas la RM (etat par defaut, `NotNull`, resultat non discriminant) | **Corrige l'assertion** jusqu'au rouge, puis GREEN |

Ne jamais conserver un test vert-des-le-depart en esperant qu'il "protege quand meme" : il verrouille ce qui existait deja, pas ce que tu ecris.

### Red Flags de cout — STOP, repars en conception
- `await` sur un repository/service **a l'interieur d'un `foreach`/`for`/`while`**
- Une requete par identifiant recu (N+1)
- `Save` / `SaveChanges` dans une boucle
- Filtrage en memoire (`.Where(...)` sur le resultat) de ce que SQL sait filtrer
- Regroupement (`GroupBy`, dictionnaire, boucle sur les groupes) alors qu'une **invariante de la fiche**
  garantit un seul groupe → le code defend un cas impossible, supprime-le
- "C'est juste 3 ou 4 appels" → le nombre depend de l'entree, donc il n'est pas de 3 ou 4

### Rationalisations
| Excuse | Realite |
|---|---|
| "Trop simple pour tester" | Code simple casse aussi. Test = 30s. |
| "Je teste apres" | Test qui passe direct prouve rien. |
| "Test apres = meme but" | Apres = "ca fait quoi ?". Avant = "ca doit faire quoi ?". |
| "Deja teste a la main" | Ad-hoc ≠ systematique. Pas rejouable. |
| "Supprimer X h = gachis" | Cout irrecuperable. Code non prouve = dette. |
| "J'ameliore vite fait le code d'a cote" | Ligne non tracee a une RM/CU = revue impossible, regression invisible. |
| "Je le rends configurable au cas ou" | Pas demande = pas de test, pas de besoin. Supprime. |

## 3. Git

- **Jamais de commit.** L'utilisateur decide quand commiter.
- Jamais creer/changer de branche, jamais push, jamais rewrite l'historique.
