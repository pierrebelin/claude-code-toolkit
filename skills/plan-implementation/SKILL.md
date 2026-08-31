---
name: plan-implementation
description: "Utiliser quand une spec métier validée doit devenir un plan technique DDD découpé en lots avant de coder. Trace RM/CU, décisions DDD et scénarios tests ciblés."
argument-hint: "[chemin de la specification a transformer en plan]"
---

# Plan d'implementation depuis spec

**Plan d'implementation** depuis spec metier. Assez detaille pour `/implement-tdd` sans ambiguite, reste doc conception (pas code final).

$ARGUMENTS

## Mission

Spec → plan **decoupe par fonctionnalite** (pas par couche) :

1. Trace chaque **RM-XX** + **CU-XX** vers elements code porteurs.
2. Decris chaque element : **nom**, **role**, **signature publique**, **pseudo-code bullets**.
3. Classe et trace les **regles DDD et Architecture** : aggregate responsable, invariants, coherence, events, frontieres et cout d'acces.
4. Liste **scenarios tests** + RM associee + niveau adapte : TU handler, TI repository, contrat endpoint, E2E lifecycle.
5. Respecte conventions `/implement-tdd` et skills `/tests-*`.

**Zero code final** : pas corps methode, pas assertions, pas SQL. Plan = **quoi**, **pourquoi**, **ordre**.

## Approche

### Phase 1 — Comprendre

1. Lis spec integralement.
2. Lis `references/ddd-rules.md` et `references/architecture-rules.md`. Classe chaque ID `applique` ou `N/A — raison` dans le plan global. Une fiche lot ne reference ensuite que les IDs appliques. Lis `references/ddd-examples.md` seulement si un ID retenu reste ambigu.
3. Explore `src/` : aggregates, repos, handlers, endpoints, VO existants, conventions nommage, builders et doubles de test (`tests/{{PRODUCT}}.CoreTests/`).
4. **Analyse codebase cible** — scan bounded context, brief :
   - VO/entites/aggregates reutilisables (noms exacts)
   - Repos/handlers/endpoints similaires ou en conflit
   - **Handler portant deja le meme acte metier** : lire son `CLAUDE.md` de dossier avant de conclure
   - Routes `Endpoints/Endpoints.cs` (risque collision)
   - Patterns locaux du BC (nommage, conventions)
   - Documente section "1. Perimetre > Reutilisation".
5. Ambiguites techniques bloquantes → **demande user avant plan** via **AskUserQuestion** (≤4 decisions/appel, reponse recommandee en 1er choix). Pas de plan tant qu'une bloquante reste ouverte.
6. **Challenge technique** — au plus 3 questions via **AskUserQuestion**, seulement si une reponse peut **retirer du travail** :
   - Ce besoin se livre-t-il sans nouveau type, service, endpoint ni table ?
   - Une extension d'un element existant couvre-t-elle 80 % du besoin (cf. Reutilisation maximale) ?
   - Quelle part du perimetre peut attendre un lot ulterieur sans bloquer la valeur ?
   Skip si les reponses sont evidentes depuis l'exploration. Une reponse qui reduit le scope se reporte dans le plan, section Perimetre.

### Phase 2 — Decouper

Lots fonctionnels transverses (Domain + App + Infra + WebAPI + tests). Chaque lot livrable independamment, build vert.

Pour chaque lot, etablis aussi son **statut d'execution** : `sequentiel` par defaut, ou `parallelisable avec F?` dans deux worktrees. Ne declare deux lots parallelisables que si leurs prerequis sont deja termines et s'ils n'ont ni dependance fonctionnelle, ni fichier/fixture/configuration/migration/route partage(e). Un travail sur le meme aggregate, handler, endpoint, projet `.csproj`, DI, migration EF ou fixture de test est sequentiel. Indique la raison concrete dans le plan ; au moindre doute, sequentiel.

### Phase 3 — Rediger

**Lis template `references/plan-template.md` avant.** Deux niveaux :

1. **Dossier** `todo/[code-kebab-case]/` — celui ou `/specification-metier` a ecrit `SPEC-[code-kebab-case].md`. Reutilise-le ; cree-le seulement s'il n'existe pas.
2. **Plan global** (`[CODE]-PLAN.md`) : vue compacte, tableaux, lisible <2 min/lot. Dans le dossier.
3. **Fiches lot** (`[CODE]-PLAN-F1.md`, `-F2.md`...) : detail technique par lot. `/implement-tdd lot F1` charge plan global + fiche F1 seule. Meme dossier.

## Regles plan d'execution (3.FX.3)

- Etape = **comportement metier bout en bout**, pas couche, pas fichier
- Chaque etape → **≥1 test nomme selon le skill cible** + RM + projet test cible : TU/TI/E2E `Should{resultat}_When{condition}`, contrat `Should{Action}()`. Etape sans comportement metier nommable = mecanisme interne ("scanner", "detecter", "mapper", "convertir") → **refondre en comportement**. Pas de chemin fichier ni assertions (→ skills `/tests-*`).
- ~4-8 etapes/lot, jamais >10
- Derniere etape = `dotnet build` + `dotnet test` avec la **portee nommee** : suites lancees entieres, projet filtre et racine du filtre, suites volontairement non lancees et pourquoi. « `dotnet test` » sans portee est un critere de succes faible
- Pas meta-etape, pas couche pure, pas fichier seul

## Contenu du plan

### Plan global (`-PLAN.md`)

**Principe** : QUOI + POURQUOI + ORDRE. Lisible <2 min/lot.

**DOIT** : tableau compact par lot (Couche | Element | Action | Detail), traçabilite RM/CU → code, noms scenarios test + RM, decisions non-evidentes, reutilisation explicite, lien fiche lot et statut d'execution (dependances + parallelisation eventuelle).

**INTERDIT** : signatures, pseudo-code, structure fixtures/mocks/builders, tout detail derivable des regles de couche (`.claude/rules/*.md`).

### Fiches lot (`-PLAN-FX.md`)

**Principe** : detail technique suffisant pour `/implement-tdd`. 1 fichier = 1 lot.

**DOIT** : noms exacts elements (conventions `/implement-tdd`), signatures publiques, pseudo-code bullets, section **Design** avec IDs DDD/APP/PERF appliques, aggregate responsable, invariants + RM, coherence, events internes + payload, simplifications induites et cout d'acces. Prevoir une section **Hypotheses** vide, que `/implement-tdd` remplit en cours de lot (`Hn — [supposition] — a valider par [qui]`). Liste scenarios test + RM + projet cible : TU handler obligatoire pour comportement metier, TI si persistence change, contrat si route change, E2E seulement pour lifecycle multi-operations. Pas de chemin fichier ni assertions → skills `/tests-*`.

**INTERDIT** : corps methode C#, assertions test, SQL/DDL, LINQ, config DI complete, structure fixtures/mocks/builders (delegue skills test), justifications longues.

## Conventions

Nommage DDD et conventions par couche → **`.claude/rules/*.md`** (chargees automatiquement des qu'un fichier de la couche est lu, subagents compris). Duplique pas ici.

Les regles de conception vivent dans `references/ddd-rules.md` et `architecture-rules.md`, les contre-exemples DDD dans `references/ddd-examples.md`. Ne les duplique pas dans une fiche : cite les IDs puis applique-les au contexte.

## Workflow

1. **Lis spec** integralement.
2. **Explore code** bounded context — reutilisable, conventions.
3. **Questions bloquantes** via **AskUserQuestion** (reponse recommandee en tete). **Pas de plan tant que reponses manquent.** Puis **challenge technique** (Phase 1 §6) si une reponse peut retirer du travail.
4. **Dossier** `todo/[code-kebab-case]/` (celui de la spec).
5. **Redige plan global** (`-PLAN.md`) + **fiches lot** (`-PLAN-F1.md`...) dans le dossier.
6. **Documentation handler** — pour chaque handler cree ou modifie dans le plan, prevoir la mise a jour du `CLAUDE.md` du dossier handler (regles metier, flux + cout d'acces, evenements). Nouveau handler ou intention modifiee → prevoir aussi la mise a jour du `CLAUDE.md` index du dossier feature parent (lien, intention, nombre de regles). Format : `/implement-tdd` `references/claude-md-handler.md`. Ajouter comme etape dans la fiche lot.
7. **Auto-validation** — relis plan produit, verifie :
   - Nommage DDD conforme (tables `Naming` de `.claude/rules/*.md`) pour chaque element propose
   - Architecture : logique metier dans Domain/Application (pas WebAPI), Commands → ID, Queries → charge utile directe (`Paging<T>` / `IReadOnlyList<T>` / agregat), jamais `Result<T>`
   - Chaque ID DDD/APP/PERF est classe `applique` ou `N/A — raison` dans le plan global ; aucune omission silencieuse
   - Chaque lot reference ses IDs appliques ; aggregate, invariants, coherence, event interne et cout sont explicites
   - Chaque RM/CU → au moins un test nomme selon le skill cible
   - Tests : query handler = mock fourni en donnees + resultat ; command handler = type + contenu de `SavedEvents` ; jamais spy, compteur ou assertion d'appel
   - E2E choisi seulement si un scenario couvre au moins deux operations metier enchainees
   - Pas d'element "nouveau" quand l'existant suffit (cf. Reutilisation maximale)
   - Faisabilite : deps resolues, pas de breaking change non signale
   - Derniere etape de chaque lot nomme la portee de tests attendue, pas un `dotnet test` nu
   - Chaque fiche lot porte une section `Hypotheses`, vide a la redaction
   - Aucun element planifie pour une flexibilite, une configurabilite ou une extension non exprimee dans la spec
   - Chaque lot est `sequentiel` ou declare explicitement parallelisable avec un seul autre lot ; une parallelisation contient dependances terminees et absence de fichiers/configurations/fixtures partages
   Ecart → corrige le plan directement. Doute intention metier → demande user.
8. **Resume** : nb lots, RM/CU traces, fichiers produits, chemin dossier.

## Reutilisation maximale

**Avant nouvelle classe/service/VO** : cherche dans l'existant un mecanisme qui fait deja 80%+. Enrichis/etends, cree pas du neuf.

- **Meme acte metier deja porte par un handler** → **reecris ce handler**, jamais un second use case en parallele. Deux handlers pour un meme acte, c'est deux regles metier qui divergent. Vaut aussi pour l'endpoint et le contrat : on fait evoluer la route existante, on n'en ouvre pas une jumelle.
- **Type existant de meme forme** → renomme/etends le type existant, ne cree pas un second record identique.
- **Methode existante pattern similaire** → param optionnel ou surcharge, pas nouveau service
- **Dictionnaire/lookup en place** (ex: `DiagramDependencies`, mapping handler) → reutilise, pas nouveau VO mapping
- **Filtrage/exclusion existant** (ex: `excludedNodeIds` dans `DuplicateInternal`) → etends, pas duplique
- **Service Application existant** (ex: `PortBreakingDetection`) → appelle direct, pas wrapper

**Dans plan** : chaque element "nouveau" → justifie pourquoi l'existant ne suffit pas. Justification faible → c'est une extension, pas un nouvel element.

## Pieges

- Decoupage par couche au lieu de fonctionnalite
- Code C# complet au lieu de pseudo-code
- RM/CU sans porteur code = trou
- ID DDD/APP/PERF absent de la couverture, ou `N/A` sans raison = trou
- Regle appliquee sans aggregate responsable ou sans effet concret sur le code = trou
- Scenarios test sans RM associee
- **Second handler/endpoint pour un acte metier deja porte** au lieu de reecrire l'existant
- Filtre de test en syntaxe VSTest (`--filter "FullyQualifiedName~..."`) : le runner est Microsoft.Testing.Platform (`--project` + `--filter-class`)
- Migration EF planifiee : elles vivent dans un autre projet, hors perimetre, jamais modifiees ici
- E2E choisi pour un endpoint seul
- Spy, compteur ou assertion de nombre d'appels dans un scenario handler
- Noms non conformes `/implement-tdd`
- Plan avec ambiguites non tranchees
- Elements inexistants references sans Grep/Read
- **Cree classes/services quand enrichir l'existant suffit**
- Element planifie "pour plus tard" : flexibilite, configurabilite ou point d'extension sans besoin exprime dans la spec
- Derniere etape « build + test » sans portee nommee

## Prochaine etape

Termine par : `→ Validation manuelle du plan requise. Après validation : /implement-tdd lot F1`.
