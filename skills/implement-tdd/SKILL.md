---
name: implement-tdd
description: "Utiliser quand on implémente une fonctionnalité ou un lot .NET/DDD toutes couches en TDD strict : orchestre la chaîne test rouge, implémentation et audit final avec des sous-agents."
argument-hint: "[lot FX | lot FX — correction: constat manuel]"
---

# Orchestrateur d'implémentation — TDD strict (Red-Green-Refactor)

Pilote toute la chaîne **test-first** : sous-agent tests → implémentation → sous-agent vérification. Boucle RED-GREEN-REFACTOR explicite par comportement. Stop quand tout est vérifié ou bloque sur ambiguïté métier.

$ARGUMENTS

## Regles communes

Code, TDD test-first (Iron Law, cycle, Red Flags, rationalisations) → **lire `references/regles-communes.md`**. **Jamais de commit.** Regles de tests → skills `/tests-*`. Utiliser `rtk dotnet` pour build/test ; RTK compacte les logs mais ne remplace jamais un code retour.

## Orchestration obligatoire

Ce skill reste dans l'agent principal : **ne pas** lui ajouter `context: fork`. Un sous-agent ne peut pas déléguer à son tour.

Utilise les agents projet suivants :

| Phase | Agent | Autorisation |
|---|---|---|
| RED | `tdd-test-author` | Écrire uniquement le test demandé |
| Vérification finale | `/verify-ddd-tdd` forké | Lire et exécuter les validations, sans modifier |

Les phases sont **séquentielles**, jamais parallèles sur le même lot. Attends le résultat du sous-agent tests avant toute modification de production. Attends GREEN global avant de lancer le vérificateur.

Si `tdd-test-author` est introuvable, arrête avant de coder et indique le fichier manquant dans `.claude/agents/` ; ne remplace pas silencieusement sa responsabilité.

## Projets du workspace

| Couche | Projet | Chemin |
|--------|--------|--------|
| Abstractions.Models | `{{PRODUCT}}.Abstractions.Models` | `src/{{PRODUCT}}.Abstractions.Models/` |
| Domain | `{{PRODUCT}}.Domain` | `src/{{PRODUCT}}.Domain/` |
| Application | `{{PRODUCT}}.Application` | `src/{{PRODUCT}}.Application/` |
| Infrastructure | `{{PRODUCT}}.Infrastructure` | `src/{{PRODUCT}}.Infrastructure/` |
| WebAPI | `{{PRODUCT}}.WebAPI` | `src/{{PRODUCT}}.WebAPI/` |
| Unit Tests | `{{PRODUCT}}.UnitTests` | `tests/{{PRODUCT}}.UnitTests/` |
| Integration Tests | `{{PRODUCT}}.IntegrationTests` | `tests/{{PRODUCT}}.IntegrationTests/` |
| Contract Tests | `{{PRODUCT}}.ContractTests` | `tests/{{PRODUCT}}.ContractTests/` |
| E2E Tests | `{{PRODUCT}}.E2ETests` | `tests/{{PRODUCT}}.E2ETests/` |
| Architecture Tests | `{{PRODUCT}}.ArchitectureTests` | `tests/{{PRODUCT}}.ArchitectureTests/` |
| DSL Tests | `{{PRODUCT}}.DslTests` | `tests/{{PRODUCT}}.DslTests/` |
| Infra de test partagee (doubles, builders, assets) — pas une suite | `{{PRODUCT}}.CoreTests` | `tests/{{PRODUCT}}.CoreTests/` |

Les migrations EF vivent dans un autre projet : **ne jamais les modifier depuis ce workspace**.

## Compilation et Tests

Runner Microsoft.Testing.Platform (xUnit v3) : `--project` obligatoire, filtres `--filter-class` / `--filter-method` (jokers `*` acceptes). La syntaxe VSTest `--filter "FullyQualifiedName~..."` n'existe pas ici.

```bash
rtk dotnet build --no-restore
rtk dotnet test --project tests/{{PRODUCT}}.UnitTests/{{PRODUCT}}.UnitTests.csproj --no-build --no-restore
rtk dotnet test --project tests/{{PRODUCT}}.UnitTests/{{PRODUCT}}.UnitTests.csproj --no-build --no-restore --filter-class "*CreateProductTests"
```

Analyse erreurs, corrige, relance jusqu'au vert.

## Workflow

### 1. Analyse

- **Argument = `lot FX`** (ex: `implement-tdd lot F1`) :
  1. Lis plan global (`*-PLAN.md`) — contexte + perimetre
  2. Lis fiche lot (`*-PLAN-FX.md`) — detail technique
  3. **Etapes cochees ✅** dans plan global → skip, reprends a 1re etape ⬜
  4. Suis elements + etapes restantes de la fiche
  5. Verifie la couverture DDD/APP/PERF du plan global, puis releve les IDs appliques de la fiche. Lis dans `/plan-implementation` `references/ddd-rules.md` et `architecture-rules.md` **uniquement** les lignes de ces IDs ; ouvre `ddd-examples.md` seulement si le pattern reste inconnu.
- **Argument = `lot FX — correction: [constat manuel]`** :
  1. Lis le plan global, la fiche lot et le constat. Retrouve le comportement, la RM/CU et le scenario concernes.
  2. Si le constat modifie le perimetre, une RM/CU ou une decision de conception absente du plan, arrete et dirige vers `/specification-metier` ou `/plan-implementation` avant de coder.
  3. Sinon, ajoute sous le comportement concerne une sous-etape `Correction Cn — [constat]` avec `TDD : RED ⬜ · GREEN ⬜ · COUT ⬜`. Conserve les preuves ✅ precedentes : ne les efface pas et ne saute pas cette correction.
  4. Reprends la boucle RED → GREEN → REFACTOR → COUT pour cette correction, puis l'audit final du lot.
- **Sinon** : ne code pas. La conception DDD doit etre explicite dans un plan ; dirige vers `/plan-implementation`.

**Invariants → ce qu'ils SUPPRIMENT.** Une fiche enonce des invariants (« une copie n'a qu'un seul owner », « toutes les cles viennent du meme trousseau »). Ne te contente pas de les recopier dans la doc : ecris **ce qu'ils retirent du code** — une boucle, un `GroupBy`, un dictionnaire, une branche defensive, une seconde lecture. Un invariant documente mais non exploite produit du code qui defend un cas impossible.

**Ambiguite en cours de lot → hypothese tracee, jamais decision silencieuse.** Une question qui change le perimetre, une RM/CU ou une decision de conception arrete le lot (retour `/specification-metier` ou `/plan-implementation`). Une question qui ne change rien de tout cela se tranche, mais s'ecrit : ajoute dans la fiche lot, sous `## Hypotheses`, une ligne `Hn — [ce que tu supposes] — a valider par [qui]`, et reporte-la dans le resume final. Une hypothese non ecrite est une decision que personne ne peut relire.

**Au debut (une fois)** : lis `references/conventions.md` (« Acces aux donnees »). Les conventions par couche — nommage, classes de base, structure de dossiers, pieges — arrivent seules via `.claude/rules/*.md` des que tu lis un fichier de la couche : ne les recherche pas, ne les redemande pas. Les exemples de code complets sont decoupes par couche (`references/examples-domain.md`, `-application`, `-infrastructure`, `-webapi`) : la regle de la couche te donne le chemin exact. N'en lis un que si le pattern t'est inconnu.

### 2. Boucle Red-Green-Refactor par comportement

Decoupe le lot en **comportements metier bout-en-bout** portes par un Command/Query+Handler, endpoint ou repository — chacun rattache a une RM/CU. Une methode d'aggregate reste une etape interne de ce comportement, jamais une cible de test isolee. Applique le cycle **RED → GREEN → REFACTOR → COUT** (`regles-communes.md` §2) a chaque, ordre dependance **Domain → Application → Infrastructure → WebAPI**.

**COUT = obligatoire avant de passer au comportement suivant.** Enonce en une ligne le nombre d'appels Infrastructure du comportement (« 1 lecture + 1 ecriture »), et verifie qu'il ne depend pas de la taille de l'entree. Aucun test n'observe ce nombre : vert ne prouve rien ici. Un `await` sur un repository dans une boucle = defaut de **conception**, on repart en conception. Table des symptomes et corrections → `references/conventions.md` § « Acces aux donnees ».

**RED = délègue TOUJOURS l'écriture du test** au sous-agent `tdd-test-author`, en lui demandant d'appliquer le skill adapté (+ nom de scénario + RM) :

| Comportement porte sur... | Skill | Projet |
|---|---|---|
| Command/Query + Handler | `/tests-unit-tests` | `tests/{{PRODUCT}}.UnitTests/` |
| Méthode sur Repository | `/tests-integration-tests` | `tests/{{PRODUCT}}.IntegrationTests/` |
| Endpoint API | `/tests-contract-tests` | `tests/{{PRODUCT}}.ContractTests/` |
| Lifecycle metier ≥2 operations prevu par la fiche | `/tests-e2e-tests` | `tests/{{PRODUCT}}.E2ETests/` |

**Regle absolue : jamais de test direct sur methode d'agregat.** Un comportement Domain (factory `Create()`, methode `SetDefault()`, etc.) se teste toujours **a travers le handler/service qui l'appelle**. Les domain events sont des effets de bord verifies au niveau handler, pas sur l'agregat en isolation. Si aucun handler n'existe encore pour ce comportement, **ne pas ecrire le test** — il sera ecrit quand le handler existera. Pas de test orphelin sur un agregat.

**Politique handler absolue** : pour une query, le mock fournit les donnees et le test verifie le resultat retourne. Pour une command, le test verifie le type et le payload de `SavedEvents`. **Jamais** spy, compteur, `Called`, `Received`, `Verify` ou assertion du nombre d'appels, meme pour le cout.

Lire les plans une seule fois dans l'agent principal. Pour chaque comportement, délègue ce contrat compact, sans joindre ni demander de relire le plan :

```text
RM/CU : …
Comportement : …
Niveau / skill : …
Projet et fixture existante : …
Scénarios : …
Observation attendue : …
```

L'agent ne modifie que les fichiers de test, lance le test filtré et retourne son format `## RED` compact. Ne pas lui demander de réexpliquer le plan ni recopier ses logs.

Après son retour : lis son diff, confirme qu'il ne contient aucun code de production, puis contrôle l'échec attendu du test filtré. Seulement alors, écris le minimum de code de production pour GREEN. Respecte les conventions du skill test invoqué — **pas de règles de test ici**. Jamais de code prod en avance d'un test rouge.

### 3. Boucle verte globale

Corrige jusqu'au vert total (tous comportements du lot). **La portee de chaque suite se decide, elle ne se subit pas** — voir « Portee des suites » ci-dessous. Dans la fiche lot, coche RED seulement apres echec attendu du test filtre, GREEN apres succes, COUT apres revue du cout. Ne coche jamais une preuve non observee.

#### Portee des suites

Toujours `--project <csproj> --no-build --no-restore`.

| Suite | Portee | Condition |
|---|---|---|
| `UnitTests` | **entiere** | toujours — rapide, et c'est la seule qui couvre les handlers de tout le repo |
| `ArchitectureTests` | **entiere** | des qu'un handler, endpoint, repository, frontiere de couche ou enregistrement DI change. Verrouille nommage, CQRS, dependances et enregistrement mieux qu'une relecture |
| `ContractTests` | **entiere** | des qu'un endpoint, un contrat HTTP ou un type d'`Abstractions.Models` change |
| `DslTests` | **entiere** | seulement si le diff touche `dsl/**`, le parseur ou les templates/presets. Sinon ne pas lancer |
| `IntegrationTests` | **filtree** | seulement si le diff touche un repository, un mapper EF ou une entite EF. **Jamais la suite entiere** |
| `E2ETests` | — | seulement si la fiche selectionne un lifecycle ≥2 operations. Sinon ne pas demarrer Aspire |

#### Filtrer les tests d'integration

Une suite TI entiere reconstruit chaque fixture et re-seede la base : le cout est proportionnel au nombre de tests, pas seulement au demarrage du conteneur. Sur ce repo, la suite complete depasse les 4 minutes la ou le contexte impacte tient en une minute.

`--filter-class` accepte les jokers `*` **et se repete** ; les valeurs s'unissent. Construis le filtre depuis les **dossiers de production touches**, pas depuis le lot :

```bash
APP_TEST_MODE=true rtk dotnet test --project tests/{{PRODUCT}}.IntegrationTests/{{PRODUCT}}.IntegrationTests.csproj \
  --no-build --no-restore \
  --filter-class "*.Studio.Diagrams.*" \
  --filter-class "*.Studio.ModuleDiagrams.Save.*" \
  --filter-class "*.Studio.Templates.Save.*"
```

Racines de namespace disponibles sous `{{PRODUCT}}.IntegrationTests` : `Licensing`, `Catalog`, `Database`, `Dsl`, `Studio`, `Files`, `Http`, `Import`, `Performance`.

**Regle de selection** : un repository modifie → le namespace de son agregat **et** celui de tout agregat dont un test de persistence le construit. Descends d'un cran (`*.Studio.ModuleDiagrams.Save.*` plutot que `*.Studio.*`) des que la methode touchee est identifiee ; remonte d'un cran seulement si une signature partagee change. Un doute sur la portee se tranche en elargissant d'un niveau, jamais en lancant tout.

**Enonce la portee retenue et ce qu'elle laisse de cote.** Une suite filtree presentee comme « tests verts » sans dire ce qui n'a pas tourne se lit comme une couverture complete qu'elle n'est pas.

### 4. Audit final délégué

Après la boucle verte globale, invoque `/verify-ddd-tdd lot FX`. Son `context: fork` l'exécute dans un sous-agent isolé, en mode rapide, sans écrire de fichier. Attends son verdict avant de conclure.

- Verdict `VALIDE` : conserve son tableau de preuves et ses commandes avec codes retour dans le résumé final. S'il liste des écarts **Mineurs**, reporte-les tels quels dans le résumé sans les corriger ni les taire : l'utilisateur tranche.
- Verdict `ECARTS` : corrige dans l'agent principal, relance les validations concernées, puis délègue à nouveau le même audit.
- Après deux itérations de correction/audit encore en écart, arrête et retourne les écarts bloquants ; ne contourne ni le plan ni l'audit.

Un verdict `VALIDE` clôt **uniquement le lot courant**. Arrête-toi : ne démarre, ne délègue et ne suggère aucun lot suivant. Termine par `→ Lot FX terminé — validation manuelle requise avant tout autre lot.`

### 5. Mise a jour du plan

Implementation reference un plan (`PLAN-*.md`, `SPEC-*-PLAN.md` dans `todo/` ou `docs/`) → **toujours** maj apres complétion :
- Lot/etape → **✅ DONE** + date
- Resume court fichiers crees/modifies
- Ecarts (fichiers en plus, decisions differentes) → documente
- Hypotheses posees en cours de lot → section `## Hypotheses` de la fiche : `Hn — [supposition] — a valider par [qui]`. Une hypothese confirmee plus tard devient une decision : la deplacer en `## Decisions`.
- **Correction change une RM/CU** → maj spec source aussi. Traçabilite bidirectionnelle : spec = source de verite metier.
- Correction issue d'une validation manuelle → ajoute `Correction Cn` sous le comportement concerne ; conserve l'historique TDD initial et les preuves de correction.
- Pour chaque comportement termine : `TDD : RED ✅ · GREEN ✅ · COUT ✅` seulement si les trois preuves ont ete observees.

### 6. Mise a jour documentation handler

Handler modifie ou cree → **mettre a jour le `CLAUDE.md` du dossier handler** (dans `Application/`). Tableau des regles metier **colonne Tests comprise** (chaque test rouge ecrit dans le lot y est rattache a sa regle), flux, evenements emis. Si nouveau handler : creer le `CLAUDE.md`. **Format et exemple → `references/claude-md-handler.md`** (lire avant d'ecrire).

**Nouveau handler ou intention modifiee → mettre a jour aussi le `CLAUDE.md` index du dossier feature parent** : ligne du use case dans le tableau Commands/Queries (lien relatif `[Nom](Nom/CLAUDE.md)`, intention en une ligne, `N regles, M testees` — `python3 scripts/rules-coverage.py --fix-index` recalcule la colonne). Un handler absent de l'index est un handler introuvable.

**Section « Flux » : consigner le cout.** Une ligne apres le flux — « 1 lecture + 1 ecriture, quel que soit le nombre de candidats ». C'est la seule trace durable d'une decision qu'aucun test ne verrouille. Si une lecture non bornee est chargee volontairement (`Include` d'une collection qui grossit sans limite), le dire et dire pourquoi.

### 7. Cloture

Avant de resumer : relis ton propre diff (`git diff`), **hunk par hunk**.

- **Chaque hunk se rattache a une RM/CU ou a une etape de la fiche.** Ce qui ne se rattache a rien se revert : refacto d'un code qui marchait deja, renommage hors lot, reformatage, reorganisation d'imports, correction d'un bug adjacent. Un bug adjacent reel se **signale dans le resume**, il ne se corrige pas dans ce lot.
- **Style local d'abord** : aligne-toi sur le fichier que tu modifies, meme si tu ecrirais autrement ailleurs.
- **Aucun commentaire ajouté** — supprime ceux que tu as écrits. Supprime aussi ceux qui ne servent pas (répètent le code, périmés) **dans les lignes que le lot touche**, pas ailleurs dans le fichier. Ne subsistent que les commentaires préexistants qui expliquent une décision, une contrainte ou une exception non déductible du nommage.
- **Orphelins** : supprime les `using`, variables, methodes et types que **ton** changement a rendus inutilises. Le code mort préexistant se signale dans le resume, il ne se supprime pas.

Resume : fichiers créés/modifiés, couches touchées, **coût d'accès par comportement livré**, **hypothèses `Hn` posées en cours de lot**, **code mort ou bug adjacent signalé mais volontairement non touché**, IDs DDD/APP/PERF et verdict de `/verify-ddd-tdd`. Pour les validations, indiquer commande + exit + **portée** (filtre appliqué ou « suite entière ») et nombre de tests ; nommer les suites volontairement non lancées et pourquoi. En échec, joindre au plus six lignes RTK utiles. **Pas de commit** — l'utilisateur décide quand commiter.

**Tableau recapitulatif des tests** — toujours terminer par un tableau Markdown listant chaque test implemente :

| Test | UC valide |
|------|-----------|
| `NomDuTest` | Description courte du cas d'usage / regle metier valide |

Un test par ligne, nom exact de la methode, description concise du comportement verifie.

---

## Reference

Conventions DDD par couche (nommage, classes de base, structure, pieges) → `.claude/rules/*.md`, chargees automatiquement. Exemples de code complets → `references/examples-{domain,application,infrastructure,webapi}.md`, un par couche. Cout d'acces aux donnees → `references/conventions.md`.

## Fin du lot

Après verdict `VALIDE`, attendre la validation manuelle de l'utilisateur avant toute nouvelle commande `/implement-tdd`.
