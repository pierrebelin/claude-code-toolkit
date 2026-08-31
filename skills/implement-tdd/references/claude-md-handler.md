# Format des `CLAUDE.md` de l'Application

Deux niveaux, jamais melanges :

- **Dossier handler** (`Application/{Contexte}/{Feature}/{Action}{Entity}/CLAUDE.md`) : regles metier detaillees du use case.
- **Dossier feature** (`Application/{Contexte}/{Feature}/CLAUDE.md`) : index. Intention en une ligne par use case, concepts transverses, cycle de vie. **Aucune regle metier detaillee.**

Langue : francais, ton documentaire. Nommer les types exacts (`AuditTrailEntity`, `QueryLimits.MAX_UNPAGINATED_RESULTS`) — c'est une doc pour developpeur, pas une spec metier.

---

## Fiche handler

````markdown
# [Action][Entity]

[Intention en une phrase : ce que le use case fait, pour qui, sur quelle portee.]

## Règles métier

| ID | Règle | Exception / Résultat | Tests |
|----|-------|----------------------|-------|
| RM-01 | [enonce testable] | `[Exception]` → [status HTTP] | `[Classe]Tests.[Methode]` |

`RM-xx` = regle globale definie dans `docs/metier/REGLES-METIER-{AGREGAT}.md`, reutiliser le numero
existant. La numerotation y est **propre a chaque document** : `RM-02` ne veut rien dire hors de
l'agregat auquel il appartient. `RL-xx` = regle locale au handler, numerotation propre au fichier.

Colonne *Tests* : `ClasseDeTest.NomDeMethode`, plusieurs separes par `, `. Cellule vide = regle non
couverte, assumee. **Le test rouge ecrit en phase TDD renseigne sa cellule dans le meme lot.**

_Query pure sans regle_ : ecrire « Aucune (query pure) » et preciser le cloisonnement applique
(ex. scope restreint a l'organisation courante via `IUserContextWrapper`).

## Flux

```
[Etape 1] → [Etape 2] → [Etape 3]
```

[1 lecture + 1 ecriture, quel que soit le nombre de X.]

## Evenements emis

`[Event]` — payload : [champs]. / Aucun (query).
````

**Liste fermee : ces trois sections `##`, dans cet ordre, et aucune autre.** Pas de `## Decisions`,
pas de `## Raison d'etre`, pas de section ad hoc titree sur un point precis (`## La valeur ne sort
jamais`, `## Les neuf controles du resolveur`). Ce qui n'est ni une regle, ni le flux, ni un
evenement va dans `docs/` ou dans le plan, pas dans la fiche.

**La ligne de cout sous le flux est obligatoire.** Elle est la seule trace durable d'une decision qu'aucun test ne
verrouille. Lecture non bornee volontaire (`Include` d'une collection qui grossit) → le dire et dire pourquoi.

**Etat courant seulement — jamais d'historique.** Une fiche decrit ce que le handler fait aujourd'hui,
comme si elle etait ecrite d'un coup. Un changement structurant **reecrit** la section concernee ; il
n'en ajoute pas une nouvelle a la suite.

Ne jamais ecrire :

- une date ou un numero de lot — `(2026-08-11)`, `(lot F4)`. Un libelle de regle nomme la regle, rien
  d'autre. Une reference de spec (`RM-17`, `RG_TRANSFERT_5`) se garde : elle est stable, une
  date ne l'est pas.
- une section de journal : « Corrections d'audit », « Ecarts assumes », « Resolutions d'ecarts »,
  « Evolutions », « Historique », « Ce qui a change ».
- un recit de changement : « faisait lever… desormais », « l'ancienne signature », « au lieu de »,
  « a ete supprime », « depuis le 2026-08-24 ». Enoncer l'etat final au present suffit.

Le pourquoi d'une decision se garde quand il reste vrai (« un `404` inatteignable tromperait la
generation de client ») ; le recit de comment on y est arrive, non. Ce recit a deja deux porteurs :
les plans (`PLAN-*.md`, `todo/`) et l'historique Git.

**Pourquoi cette contrainte.** Une fiche handler est rechargee integralement a chaque lecture d'un
fichier du dossier. Empiler les sections datees fait croitre sans fin un contenu paye a chaque
session, pour du texte qui ne decrit plus le code.

---

## Index de feature

```markdown
# [Feature]

[2-3 phrases : perimetre du bounded context, entites concernees.]

## [Concept transverse]

[Enum, cycle de vie, invariant partage par plusieurs use cases.]

## Commands

| Use case | Intention | Regles metier |
|----------|-----------|---------------|
| [Create[Entity]]([Create[Entity]]/CLAUDE.md) | [une ligne] | [N regles, M testees] |

## Queries

| Use case | Intention | Regles metier |
|----------|-----------|---------------|
| [Get[Entity]s]([Get[Entity]s]/CLAUDE.md) | [une ligne] | 0 regle |
```

Lien relatif vers la fiche handler obligatoire. Un handler absent de l'index est un handler introuvable.

La colonne *Regles metier* se recalcule : `python3 scripts/rules-coverage.py --fix-index`.

---

## Mise a jour

| Evenement | Action |
|---|---|
| Regle metier ajoutee/modifiee/supprimee | Fiche handler : tableau des regles. Une regle supprimee **disparait**, elle ne devient pas une note d'historique |
| Flux ou cout d'acces change | Fiche handler : flux + ligne de cout |
| Nouvel evenement, payload change | Fiche handler : evenements emis |
| Nouveau handler | Creer la fiche **et** ajouter la ligne dans l'index de feature |
| Intention du handler changee | Fiche handler + ligne d'index |
| Decision structurante (securite, persistence, contrat) | **Reecrire** la section concernee au present, sans date ni numero de lot |

Exemples reels : `src/{{PRODUCT}}.Application/Catalog/Products/CLAUDE.md` (index) et
`Catalog/Products/GetProduct/CLAUDE.md` (fiche).
