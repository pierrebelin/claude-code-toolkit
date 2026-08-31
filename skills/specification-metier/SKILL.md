---
name: specification-metier
description: "Utiliser quand on veut une spec métier courte, lisible et testable d'une fonctionnalité, après clarification des décisions métier. Sans conception ni implémentation technique."
argument-hint: "[fonctionnalite a specifier]"
---

# Specification metier (court)

Spec metier **concise**. Monde reel (utilisateurs, regles, cas d'usage). **Zero implementation** (classe, aggregate, handler, type, fichier, pattern, framework). Expert metier relit.

$ARGUMENTS

## Approche

1. Lis sources et explore seulement les chemins code qui eclairent le vocabulaire ou un comportement existant. Stoppe des que la question est resolue ; pas de scan large.
2. **Clarifie les decisions** jusqu'a comprehension partagee, **avant** rediger :
   - **Une decision a la fois.** Descends l'arbre branche par branche, resous dependances une par une — pas de groupage (reponse Q1 change Q2).
   - **Reponse dans code → explore, demande pas.** Question seulement sur l'indeduisible.
   - Via **AskUserQuestion** : 1 question = 1 decision, **reponse recommandee en 1er choix** (`(recommandé)`).
   - Continue jusqu'a zero decision qui change CU, RM, donnees, etats ou perimetre. Choix tranches → spec ; non tranche → section 11.
3. **Challenge PO** seulement si une decision peut reduire scope, complexite ou risque — au plus 3 questions via **AskUserQuestion** :
   - Scope minimal : peut-on livrer moins et valider le besoin ?
   - Alternative : existe-t-il un chemin plus simple (config, extension existante, convention) ?
   - Complexite : la complexite ajoutee vaut-elle la valeur metier ?
   Skip si reponses evidentes depuis grill.
4. Redige selon structure. Concision avant exhaustivite.
5. **Ecris toujours le doc dans `todo/` (jamais `docs/`)** : `todo/<code-kebab-case>/SPEC-<code-kebab-case>.md`. Un dossier par fonctionnalite : `/plan-implementation` y deposera ensuite `-PLAN.md` et ses fiches lot. Slug = kebab-case du code/nom de la fonctionnalite.

Le document doit permettre le design DDD ulterieur sans le faire : chaque RM dit clairement sujet, condition, resultat observable et CU concerne. Le choix d'aggregate, d'invariant technique, d'event ou de coherence appartient a `/plan-implementation`.

## Regles redaction

- Langue projet (francais defaut). 1 phrase si suffit. Zero redite.
- **Section vide → supprime** (titre compris). Pas de `_Non applicable._`.
- Tableau > prose. Pas de paragraphe intro : direct au contenu.
- Chaque regle : nomme origine (reglementation, norme, usage, choix produit), mention courte.
- **Autorite d'une regle** : quand la regle est detenue par un systeme externe (service de trousseaux/cles, delegation entre organisations, catalogue d'organisation), la spec dit **qui est autorite** et ce que le produit se contente de consommer. Ne pas rejouer ni redecrire une regle possedee ailleurs — la citer et nommer son detenteur.
- **Cible d'un partage, transfert ou delegation** : une organisation cible se valide par une **delegation existante**, jamais par sa seule existence. Formuler la RM en ces termes.
- Non tranche → `TBD`, liste section 11.

## Budget verbosite (doc produit)

- **Cible** : lecture quelques minutes, ~1-3 pages. Moitie d'une spec exhaustive.
- **CU** : scenario nominal ≤7 etapes. **Resultat attendu** seulement si pas evident depuis scenario.
- **RM** : enonce = 1 ligne. Pas de justification : origine suffit.
- **Champs inline** : `Applies to`, severite, origine sur 1 ligne, pas en puces eclatees.
- **Doublon = supprime** : info vit a 1 seul endroit (CU **ou** RM **ou** transverse, jamais les 3).

## Style d'ecriture

Ecris court et professionnel. Tableau ou fragment pour le contexte ; phrase complete pour une RM, une condition, une erreur ou une transition. Coupe le remplissage, pas la precision : termes metier, seuils, valeurs, etats et resultat attendu restent exacts. Regle incertaine → `TBD`, jamais hedging.

## Structure de sortie

```markdown
# [CODE] — [Nom]

> Resume 2-3 phrases : quoi, pour qui, pourquoi.

## 1. Contexte
Quel probleme, pour qui, impact si rien fait. 2-4 phrases.

## 2. Vocabulaire
| Terme | Definition |
Termes specifiques ou ambigus seulement. Definition une ligne.

## 3. Cas d'usage
### CU-XX — [Nom]
**Acteur** · **Intention** (1 phrase) · **Frequence**
**Scenario nominal :** etapes numerotees.
**Variantes :** chemins alternatifs. **Erreurs :** comportement en echec.
**Resultat attendu :** etat final observable en langage metier (ce qu'on verifie) — seulement si pas evident depuis le scenario.

## 4. Regles metier
### RM-XX — [Nom court]
- **Enonce** (testable) · **Origine** · **Severite** (bloquant / warning / informatif)
- **Applies to** : CU-XX gouvernes (ou `transverse` si globale).
- **Exemple conforme / non conforme** si non evident.

## 5. Donnees
| Donnee | Description | Source | Importance |
Source = saisie / calculee / importee / catalogue. Importance = essentiel / secondaire / expert. Donnees non triviales seulement.

## 6. Etats & transitions
_Seulement si l'entite a un cycle de vie._
| Etat | Evenement | Etat suivant | Condition |
Niveau metier (ex. brouillon → valide → archive). Pas d'enum ni de machine a etats technique.

## 7. Comportements transverses
Uniquement ce qui ne tient ni dans un seul CU ni dans une seule RM : valeurs par defaut, suppression en cascade, duplication, catalogue. **Si ca concerne un seul cas → le mettre dans le CU/RM, pas ici.** Une sous-section par comportement, seulement si applicable.

## 8. Relations
| Amont | Aval |
Une ligne par dependance, en langage metier.

## 9. Hors perimetre
| Exclusion | Raison |

## 10. Hypotheses
| # | Hypothese | A valider par |
Ce que tu as suppose faute de reponse — distinct d'une question ouverte.

## 11. Questions ouvertes
| # | Question | Impact | Options |
Tous les TBD du document.
```

## Auto-validation (obligatoire, apres redaction)

Relis spec produite. Verifie et corrige directement :

**Purete metier** : zero fuite technique (classe, type, fichier, table, framework, pattern, code HTTP). Present → reformule en metier. Relisible par expert non-dev.

**Coherence interne** :
- Chaque CU : acteur + intention + scenario nominal. Chaque RM : testable (oui/non) + origine + severite.
- Zero contradiction entre RM, ni CU↔RM. Renvois `RM-XX`/`CU-XX` valides (pas d'orphelin).
- Vocabulaire : chaque terme specifique defini, pas de definition morte.

**Completude** :
- CU couvrent cycle de vie (creation, lecture, modif, suppression/retrait selon sujet).
- Erreurs + cas limites la ou ils comptent. Donnees non triviales listees.
- Chaque TBD du corps figure section 11.
- Chaque RM donne assez de precision pour decider plus tard son porteur DDD, sans nommer ce porteur technique.
- RM, variantes et erreurs restent lisibles sans inferer une condition depuis un fragment telegraphique.

**Alignement codebase** (signalement, pas veto) :
- Concepts metier cles → cherche equivalent `Domain/`, `Application/`. Cite fichier:ligne.
- Doublon fonctionnel si capacite existe deja → signale.
- Chaque RM detenue par un systeme externe nomme son autorite ; aucune regle externe reecrite comme regle du produit.

Ecart → corrige la spec. Doute intention metier → demande user.

## Prochaine etape

Termine par : `→ Étape suivante : /plan-implementation`.
