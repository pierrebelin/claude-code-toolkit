---
name: verify-ddd-tdd
description: "Vérifier après /implement-tdd qu'un lot .NET respecte les règles d'écriture du code — correction, réutilisation, simplification, coût — puis sa conformité au plan, sa politique de tests handler et ses preuves TDD. Utiliser avant de passer au lot suivant, en mode rapide par défaut ou full sur demande explicite."
context: fork
agent: ddd-tdd-auditor
background: false
---

# Verification DDD + TDD

Audit sans modification de code. Le verdict porte sur un lot implemente par `/implement-tdd`, jamais sur une fonctionnalite sans plan. Utiliser `rtk dotnet` pour les validations et ne jamais retourner de log brut.

**Deux axes, dans cet ordre.**

1. **Regles d'ecriture du code** (§2) — correction, reutilisation, simplification, cout, placement de la logique. Axe principal. Il s'applique au code livre tel qu'il est, independamment de ce que le plan annonce.
2. **Conformite au plan et aux tests** (§3) — traçabilite RM/CU, IDs DDD/APP/PERF, politique de test, preuves TDD.

Le plan n'est pas la reference ultime : il se modifie en cours de lot quand l'implementation part dans une mauvaise direction. Un ecart entre code et plan se **classe** (§3), il ne se traduit jamais mecaniquement par « le code a tort ».

$ARGUMENTS

## Modes

- **Rapide** par defaut : plan global + fiche lot, couverture DDD/APP/PERF, IDs appliques, diff, fichiers modifies et tests cibles.
- **Full** seulement avec `full` dans l'argument : elargit l'inspection aux frontieres touchees et ajoute les suites rapides entieres (§4.6). **`full` n'autorise pas une suite `IntegrationTests` entiere** — elle reste filtree sur le contexte impacte.

Lis les index compacts `ddd-rules.md` et `architecture-rules.md` pour verifier la couverture complete. Lis ensuite seulement les lignes des IDs appliques dans la fiche. Ouvre `ddd-examples.md` uniquement si un ID reste ambigu.

## Workflow

### 1. Etablir le perimetre

1. Exige `lot FX` et retrouve le plan global + fiche `*-PLAN-FX.md`.
2. Releve RM/CU, couverture DDD/APP/PERF, IDs appliques, aggregate responsable, coherence, cout, niveaux de test et scenarios nommes.
3. Sans couverture complete ou sans section **Design** : conduis quand meme l'audit §2 sur le code livre, et rends la lacune du plan comme ecart **Majeur** avec pour correction la mise a jour de la fiche. Chaque ID doit etre `applique` ou `N/A — raison`. Ne reconstitue pas le design depuis le code et ne le deduis pas de l'implementation.
4. Lis `git status --short`, `git diff --check` puis le diff des fichiers concernes. Si le diff attendu est deja committe, exige une base explicite dans l'argument ; ne devine pas l'historique. Parcours le diff **hunk par hunk** et rattache chacun a une RM/CU ou a une etape de la fiche : ce qui ne se rattache a rien est un ecart de **Perimetre** (§2).

### 2. Verifier les regles d'ecriture du code

Axe principal, toujours execute, y compris quand le plan est incomplet ou modifie en cours de lot. Porte sur le diff du lot. Un test vert ne vaut aucune preuve ici.

| Axe | Ce qui est un ecart |
|-----|---------------------|
| Correction | Chemin d'erreur non traite, absence ou `null` non gere, borne de comparaison fausse, ordre d'operations qui laisse un etat intermediaire invalide, exception avalee, valeur par defaut silencieuse qui masque un echec, ecriture concurrente sur le meme aggregate sans concurrence geree. |
| Reutilisation | Type, service, VO ou methode cree alors qu'un element existant couvre le besoin ou 80 % du besoin. Deuxieme type de meme forme qu'un existant : renommer ou etendre l'existant, pas dupliquer. |
| Simplification | Branche defensive sur un cas rendu impossible par un invariant du lot. Indirection, wrapper ou mapping intermediaire a un seul appelant. Code mort introduit ou rendu orphelin par le lot, parametre jamais lu, abstraction sans second implementeur. Le code mort **preexistant** se rend en Mineur signale : exiger sa suppression est hors perimetre du lot. |
| Cout | Appel repository dans une boucle pilotee par l'entree, lecture non bornee, `Include` d'une collection qui grossit sans limite, materialisation avant filtrage, requete par element. Un cout borne mais different de celui annonce dans la fiche est un ecart de plan (§3), pas de code. |
| Placement | Regle metier ou validation portee par un handler, un repository, l'Infrastructure ou la WebAPI au lieu de l'aggregate concerne. Exception : un pre-controle qui double une autorite nommee ailleurs (contrainte de persistence, systeme externe) n'est pas un ecart de placement — il l'est seulement s'il est le **seul** porteur de la regle. Inversement, borne de ressource reecrite a la main dans un handler ou portee par le Domain, au lieu de son porteur dedie : `RequestLimits`/rate limiting WebAPI pour le transport, `PaginationBounds` pour la pagination, `QueryLimits` pour le plafond de lecture. |
| Perimetre | Hunk du diff sans RM/CU ni etape de fiche qui le porte. Refacto, renommage, reformatage ou reorganisation d'un code qui marchait et que le lot n'avait pas a modifier. Correction d'un bug adjacent hors RM/CU du lot. Suppression non demandee d'un code mort ou d'un commentaire preexistant hors des lignes touchees. Flexibilite, configurabilite ou abstraction ajoutee sans besoin exprime. |
| Commentaires | Commentaire ou doc XML `///` present dans le code de production. L'intention passe par le nommage. |

**Filtre obligatoire — un constat sans preuve ne se rend pas.**

- Correction : nommer un scenario de casse concret, `entrees X → comportement faux Y`. Sans scenario, ne pas rendre le constat.
- Reutilisation : nommer l'element existant en `path:line`. Sans element nomme, ne pas rendre le constat.
- Simplification, cout, placement : citer la ligne et l'effet concret. Pas de preference stylistique, pas de suggestion d'architecture alternative, pas de reecriture proposee.
- Perimetre : citer le hunk en `path:line` et nommer la RM/CU ou l'etape de fiche qui manque. Une ligne exigee par le comportement livre — signature propagee, enregistrement DI, `using` devenu necessaire — est tracee : ce n'est pas un ecart.

Ne jamais proposer d'ajouter un commentaire, une doc XML, une abstraction anticipee ni un test d'aggregate en isolation : ce sont des ecarts, pas des corrections.

### 3. Verifier la conformite au plan et aux tests

Pour chaque RM/CU et ID DDD/APP/PERF applique, trouve une preuve dans le code et un scenario planifie. Refuse un ID manquant de la couverture ou un `N/A` sans raison.

**Classer toute divergence code/plan avant de la rendre**, en une ligne explicite :

- **Code fautif** — le plan reste juste, l'implementation s'en ecarte. Correction attendue : le code.
- **Plan perime** — l'implementation est meilleure ou une decision a ete tranchee en cours de lot. Correction attendue : la fiche, plus l'eventuelle spec source si une RM/CU bouge. Severite **Majeur**, jamais bloquant.
- **Divergence non tranchable** — les deux lectures se defendent. Rendre les deux et laisser l'arbitrage a l'utilisateur. Ne pas trancher a la place du plan.

Une RM/CU sans porteur code reste bloquante dans les trois cas : c'est un trou, pas une divergence.

| Point | Attendu |
|-------|---------|
| Aggregate | Il porte les invariants annonces ; le handler orchestre chargement, appel metier et sauvegarde. |
| Une command | Elle modifie et sauvegarde un seul aggregate ; toute exception est documentee. |
| Invariant | Il retire vraiment une branche, boucle, regroupement ou lecture identifie dans le plan. |
| Frontieres | Plusieurs aggregates : exception DDD-08 et coherence explicites ; aucun evenement d'integration implicite. Infrastructure/WebAPI ne decide pas une RM. |
| Bornes (APP-05) | Transport (taille, debit) en WebAPI ; pagination normalisee via `PaginationBounds` a la creation de la query ; plafond de lecture via `QueryLimits`. Ecart = borne reecrite a la main dans un handler, borne technique dans le Domain, ou lecture non paginee sans plafond. |
| Autorite externe | Aucune regle detenue par un systeme externe (trousseaux/cles, delegation, catalogue d'organisation) rejouee dans le code ; cible d'un transfert validee par delegation, pas par simple existence. |
| Creation/persistence | `Create()` et `Restore()` restent distincts ; repository centre aggregate, sauvegarde events. |
| Unicite (APP-03) | La contrainte de persistence est l'autorite et le repository traduit sa violation en exception domain, filtre nommant l'index precis. Un test d'unicite en amont est un echec anticipe, pas un ecart ; l'ecart est l'absence de traduction (course sortant en 500) ou un filtre generique type `Contains("duplicate")`. |
| Porteur de la logique (DDD-09) | Aucune operation metier portee par un helper ou service statique qui recoit l'etat d'un objet metier ; Domain Service stateless et justifie. |
| Absence (DDD-11) | Aucune collection nullable en Domain/Application ; nullable de transport converti a la frontiere ; concept optionnel modelise, pas teste par `is null` a chaque usage. |
| Cout | Lectures/ecritures bornes, independantes de la taille d'entree ; aucune lecture repository dans une boucle pilotee par l'entree. |
| Test aggregate | Aucun test n'appelle directement factory ou methode d'aggregate pour verifier le comportement. |
| Test query handler | Mock alimente en donnees ; assertion sur le resultat retourne. |
| Test command handler | `SavedEvents` verifie par type et contenu. |
| Interactions | Aucun spy, compteur, `CallCount`, `Called`, `Received`, `Verify` ou assertion du nombre d'appels. |
| Niveau de test | TI seulement persistence, contrat seulement route nominale changee, E2E seulement lifecycle d'au moins deux operations. |
| Perimetre | Chaque hunk du diff se rattache a une RM/CU ou a une etape de la fiche. La traçabilite se lit dans les deux sens : RM → code, et code → RM. Un hunk sans porteur est un ecart, meme s'il ameliore le code. |
| Hypotheses (Hn) | Toute decision non evidente tranchee en cours de lot faute de reponse figure en `Hypothese Hn` dans la fiche : ce qui est suppose, et qui la valide. Ecart = decision silencieuse. |
| TDD | Chaque comportement livre porte RED, GREEN et COUT coches uniquement si observation reelle. |

Une preuve manquante n'est pas une supposition favorable. Cite le fichier et la ligne ou l'ecart est constate.

### 4. Executer les validations minimales

Runner Microsoft.Testing.Platform (xUnit v3) : toujours `--project <csproj> --no-build --no-restore`, filtres `--filter-class` / `--filter-method` (jokers `*` acceptes). La syntaxe VSTest `--filter "FullyQualifiedName~..."` echoue ici.

**Le volume de tests execute est une decision d'audit, pas un reflexe.** Une suite lancee en entier quand un filtre suffisait ne prouve rien de plus et coute plusieurs minutes. Ne relance jamais ce que `/implement-tdd` vient de faire tourner a l'identique : verifie le code retour rapporte, et n'execute toi-meme que ce qui manque ou ce dont la portee etait trop etroite.

1. Lance `rtk dotnet build --no-restore` si le diff contient du code source.
2. Lance seulement les tests nommes et projets indiques dans la fiche : filtre cible d'abord ; projet cible sans filtre si le filtre n'est pas exploitable.
3. **Lance `ArchitectureTests` en entier** des que le diff touche un handler, un endpoint, un repository, une frontiere de couche ou un enregistrement DI. Il verrouille mecaniquement nommage, CQRS, dependances, encapsulation et enregistrement : ce qu'il prouve n'a pas a etre re-argumente dans le verdict, et ce qu'il casse est bloquant.
   `rtk dotnet test --project tests/{{PRODUCT}}.ArchitectureTests/{{PRODUCT}}.ArchitectureTests.csproj --no-build --no-restore`
4. Lance TI, contrat ou E2E uniquement s'ils sont selectionnes par le lot. E2E non selectionne = ne pas demarrer Aspire.
5. **`IntegrationTests` ne se lance jamais en entier**, mode `full` compris. `--filter-class` accepte les jokers `*` et **se repete** — les valeurs s'unissent. Derive le filtre des dossiers de production du diff :
   ```bash
   APP_TEST_MODE=true rtk dotnet test --project tests/{{PRODUCT}}.IntegrationTests/{{PRODUCT}}.IntegrationTests.csproj \
     --no-build --no-restore --filter-class "*.Studio.Diagrams.*" --filter-class "*.Studio.Templates.Save.*"
   ```
   Racines sous `{{PRODUCT}}.IntegrationTests` : `Licensing`, `Catalog`, `Database`, `Dsl`, `Studio`, `Files`, `Http`, `Import`, `Performance`. Descends au sous-namespace des que la methode touchee est identifiee ; un doute se tranche en elargissant d'un niveau, jamais en lancant tout.
6. Mode `full` : ajoute `UnitTests` et `ContractTests` en entier, plus `DslTests` **seulement** si le diff touche `dsl/**`, le parseur ou les templates/presets.

Ne declare jamais un test vert sans code retour `0`. Distingue un test non execute, ignore et echoue. Dans le verdict, la ligne `Validations` porte la **portee** de chaque commande, pas seulement son code retour : un filtre presente sans son perimetre se lit comme une suite complete.

## Severites

- **Bloquant** — test direct d'aggregate, assertion d'interaction, RM/CU sans porteur code, ID non classe, regle appliquee sans porteur, `ArchitectureTests` rouge, preuve TDD cochee sans observation reelle, et tout ecart de **correction** dote d'un scenario de casse.
- **Majeur** — reutilisation manquee sur un element existant nomme, cout non borne, regle metier hors de son aggregate, borne de ressource hors WebAPI, commentaire en production, plan perime, hunk hors perimetre du lot, hypothese tranchee en cours de lot sans trace dans la fiche.
- **Mineur** — simplification sans consequence fonctionnelle, code mort preexistant signale (constat, pas demande de correction).

Verdict `ECARTS` des qu'il existe un Bloquant ou un Majeur. Les Mineurs se listent sous un verdict `VALIDE` sans le remettre en cause.

## Verdict

Ne pas récapituler le plan, les fichiers ni les logs. Une ligne par RM/CU, commande et code retour seulement ; en échec, au plus six lignes RTK utiles. Termine par l'un des deux formats :

```markdown
## Verdict — VALIDE

| RM/CU ou regle | Preuve code | Preuve test |
|----------------|-------------|-------------|
| RM-01 / DDD-02 / APP-01 | `path:line` | `Should...` |

Code — mineurs (n'empeche pas le lot suivant) :
| Axe | Constat | Preuve |
|-----|---------|--------|
| Simplification | Branche defensive sur un cas exclu par l'invariant | `path:line` |

Perimetre : `[n]` hunks, tous traces a une RM/CU ou etape — sinon lister les hunks non traces
Hypotheses : `Hn` — `[supposition]`, a valider par `[qui]` — ou « aucune »
Signale sans correction : `[code mort ou bug adjacent preexistant]` — `path:line`

Validations : `[commande]` — exit 0, portee `[filtre ou « suite entiere »]`, `[n]` tests
Non execute : `[suite]` — `[raison]`
```

```markdown
## Verdict — ECARTS

| Severite | Axe | Ecart | Preuve | Correction attendue |
|----------|-----|-------|--------|---------------------|
| Bloquant | Correction | Absence non geree : `entrees X → comportement faux Y` | `path:line` | Traiter le cas absent dans l'aggregate |
| Bloquant | Test | Spy dans test handler | `path:line` | Verifier resultat ou SavedEvents selon le type de handler |
| Majeur | Reutilisation | Second type de meme forme que l'existant | `path:line` | Renommer et etendre `path:line` |
| Majeur | Plan perime | Decision tranchee en cours de lot, absente de la fiche | `path:line` | Mettre a jour la fiche, et la spec si une RM bouge |
| Majeur | Perimetre | Hunk sans RM/CU ni etape porteuse | `path:line` | Revert le hunk, ou le rattacher a une etape de la fiche |

Validations : `[commande]` — exit N, portee `[filtre ou « suite entiere »]` / non exécuté
```

Ne corrige rien pendant cet audit ; la correction appartient a `/implement-tdd`. Aucun outil d'ecriture n'est disponible dans cet agent : un ecart se rend, il ne se repare pas.
