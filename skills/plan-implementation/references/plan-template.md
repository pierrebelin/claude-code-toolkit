# Template de plan d'implementation

Structure attendue par `/implement-tdd`. Deux niveaux :
- **Plan global** (`-PLAN.md`) : vue compacte lisible humain, ~15 lignes/lot
- **Fiches lot** (`-PLAN-F1.md`, `-PLAN-F2.md`...) : detail technique par lot, charge par `/implement-tdd`

**Principe** : plan global = QUOI + POURQUOI + ORDRE. Fiche lot = QUOI + COMMENT pour ce lot seul.

---

## Plan global (`[CODE]-PLAN.md`)

```markdown
# [CODE]-PLAN — [Nom de la fonctionnalite]

> Plan derive de `[chemin de la spec]`.
> Fiches lot : `[CODE]-PLAN-F1.md`, `[CODE]-PLAN-F2.md`...

## 0. Resume

**Avancement** : `X / N` (`Y %`)

### Execution des lots

| Lot | Depend de | Execution | Raison |
|-----|-----------|-----------|--------|
| F1 | — | sequentiel | socle / premier contrat |
| F2 | F1 | parallelisable avec F3 (2 worktrees) / sequentiel | [absence de code, configuration et fixtures partages] |
| F3 | F1 | parallelisable avec F2 (2 worktrees) / sequentiel | [raison concrete] |

`sequentiel` est la valeur par defaut. Marquer `parallelisable` uniquement si les prerequis sont termines et si les lots ne touchent ni le meme aggregate, handler, endpoint, projet, DI, migration, route ni fixture de test.

### Lot F1 — [Nom] — ⬜
- [ ] 1. [Titre etape]
- [ ] N. Verification build + tests — portee : [suites entieres] · [filtre TI]

### Lot F2 — [Nom] — ⬜
- [ ] 1. [Titre etape]

## 1. Perimetre

- **Spec** : `[chemin]`
- **Bounded context** : [nom]
- **Couches** : [Domain / Application / Infrastructure / WebAPI / Abstractions.Models]
- **Reutilisation** : [elements existants identifies lors analyse codebase]
- **Hypotheses** : [points tranches avec utilisateur]

## 2. Traçabilite

| RM/CU | Porteur(s) code | Lot |
|-------|-----------------|-----|
| RM-01 — [enonce] | `[Aggregate].[Methode]()` + `[Exception]` | F1 |
| CU-01 — [enonce] | `[Command]` → `[Handler]` → `[Endpoint]` | F1 |

## 3. Couverture des regles

Chaque ID de `ddd-rules.md` et `architecture-rules.md` doit apparaitre une fois : applique ou `N/A — raison`.

| Famille | IDs appliques | IDs N/A — raison |
|----------|---------------|------------------|
| DDD | DDD-01, DDD-02, DDD-03, DDD-06, DDD-08, DDD-11 | DDD-04 — aucun concept avec invariant propre ; DDD-05 — un seul aggregate ; DDD-07 — aucune mutation eventee ; DDD-09 — operation possedee par aggregate ; DDD-10 — Domain non touche |
| APP/PERF | APP-01, APP-02, APP-03, PERF-01 | APP-04 — aucune couche WebAPI/Infrastructure touchee ; APP-05 — aucune route ni lecture non bornee touchee |

## 4. Design DDD et Architecture

| RM/CU | Regles appliquees | Aggregate responsable | Invariant / consequence code | Coherence | Lot |
|-------|-------------------|-----------------------|------------------------------|-----------|-----|
| RM-01 / CU-01 | DDD-02, DDD-03, DDD-08, APP-01 | `[Aggregate]` | [invariant] → [branche/lecture supprimee] | synchrone, 1 aggregate | F1 |

## 5. Lots fonctionnels

### Lot F1 — [Nom]

**Intention** : [1 phrase — ref CU]
**RM** : RM-01, RM-03 | **CU** : CU-01
**Fiche** : `[CODE]-PLAN-F1.md`

| Couche | Element | Action | Detail |
|--------|---------|--------|--------|
| Domain | `[Aggregate]` | modifie | +`[Methode]()` (RM-XX), +`[Event]` |
| Domain | `[ValueObject]` | nouveau | invariants: RM-XX |
| App | `[Command]` → `[Handler]` | nouveau | — |
| Infra | `[Repository]` | modifie | +Save case |
| WebAPI | `[VERBE] /[route]` → [status] | nouveau | — |

**Decisions** : [choix non-evidents]. Absent si rien de notable.

**Tests** : `ShouldX_WhenY` (RM-XX, TU handler) · `ShouldA_WhenB` (TI repository) · `ShouldC()` (contrat endpoint)

**E2E** : [scenario lifecycle ≥2 operations] / absent — [raison].

**Etapes** :
- [ ] 1. [Comportement metier bout en bout] — TDD : RED ⬜ · GREEN ⬜ · COUT ⬜
- [ ] 2. [Comportement suivant]
- [ ] N. Verification `dotnet build` + `dotnet test` — portee : [suites entieres] · [filtre TI] · [suites non lancees + raison]

### Lot F2 — [Nom suivant]

[Meme structure]

## 6. Elements transverses (si applicable)

- **DI** : enregistrements | **Routes** : constantes `Endpoints.cs` | **Bornes** (APP-05) : `RequestLimits` (transport) / `PaginationBounds` (pagination) / `QueryLimits` (lecture)
- **Migrations EF** : hors perimetre — autre projet, jamais modifiees ici. Un changement de schema requis se signale, il ne se planifie pas comme une etape.
```

---

## Fiche lot (`[CODE]-PLAN-F1.md`)

```markdown
# [CODE]-PLAN-F1 — [Nom du lot]

> Lot F1 du plan `[CODE]-PLAN.md`. Spec : `[chemin]`.

## Intention

[1 phrase — ref CU]. **RM** : RM-01, RM-03 | **CU** : CU-01

## Design

| Point | Decision |
|-------|----------|
| Regles appliquees | DDD-01, DDD-02, DDD-03, DDD-08, APP-01, APP-02, PERF-01 |
| Aggregate responsable | `[Aggregate]` ; le handler orchestre uniquement |
| Invariants | [RM-XX] ; consequence : [code defensif/lecture/collection evite] |
| Coherence | une command modifie/sauve `[Aggregate]` ; lecture externe ciblee non mutante si necessaire |
| Events | internes a la persistence : `[Event]` au passe, payload [champs] / N/A — raison |
| Cout d'acces | [n lectures + n ecritures, borne independante de l'entree] |

## Elements de code

### Domain

**`[Aggregate]`** — _modifie_ / _nouveau_
- `Create(...)` : [params] → valide (RM-XX) → event `[Event]`
- `[MethodeMetier](...)` : [params] → [logique courte] → event `[Event]`
- **Invariants** : [conditions — RM-XX]
- **Reutilise** : `[VO existant]`

**`[ValueObject]`** — _nouveau_
- `Create(...)` : [params], invariants (RM-XX)

**`[DomainEvent]`** — payload: [champs], emis par `[Aggregate].[Methode]`

**`[Exception]`** — declenchee par RM-XX

### Application

**`[Command]`** — props: [types], retour: `[EntityId]`

**`[Handler]`** — deps: `I[Repo]`, `IUserContextWrapper`
- OrgId → charger aggregate → methode metier → Save events → retourner ID

### Infrastructure

**`[Repository]`** — _nouveau_ / _modifie_
- Methodes : `Save(...)`, `GetById(...)`
- Save : switch events `[Event1]`, `[Event2]`
- EF : `[Entity]Entity` + config

### Abstractions.Models

**`[Action][Entity]Request`** — props: [types]

### WebAPI

**`[Action][Entity]`** — `[VERBE] /[route]` → `[Request]` → command → dispatch → [status]

## Tests

**TU** :
- `ShouldCreate[Entity]_WhenCommandIsValid` — succes
- `ShouldEmit[Entity]CreatedEvent_WhenSuccessful` — event
- `ShouldThrowEmptyNameException_When[Prop]IsEmpty` (RM-XX — exception du VO, pas d'`ArgumentException` local)
- `ShouldThrow[Exception]_When[Condition]` (RM-XX)

**Politique handler** : query = mock alimente puis resultat verifie ; command = `SavedEvents` verifie par type et payload. Jamais spy, compteur, ni assertion d'appel.

**TI** :
- `ShouldPersist[Entity]_WhenSaved`
- `ShouldReturn[Entity]_WhenIdExists`

**Portee TI de non-regression** : `--filter-class "*.[Contexte].[Feature].*"` [+ autres namespaces impactes]. La suite `IntegrationTests` entiere ne se lance jamais : nommer ici les namespaces a rejouer evite d'avoir a le deduire du diff a chaque validation. Racines disponibles : `Licensing`, `Catalog`, `Database`, `Dsl`, `Studio`, `Files`, `Http`, `Import`, `Performance`.

**Contrat** : [nom test route happy path] / absent — [route inchangee].

**E2E** : [nom scenario lifecycle ≥2 operations] / absent — [pas de lifecycle transverse].

## Hypotheses

_Vide a la redaction du plan. Rempli par `/implement-tdd` a chaque decision non evidente tranchee en cours de lot._

| # | Hypothese | A valider par |
|---|-----------|---------------|
| H1 | [ce qui a ete suppose faute de reponse] | [qui / quoi] |

## Decisions

[Choix non-evidents, arbitrages, reutilisations. Absent si rien de notable.]
```
