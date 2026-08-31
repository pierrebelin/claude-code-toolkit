# CLAUDE.md

## Nature du dépôt

**Kit `.claude` portable** pour un repo .NET/DDD en clean architecture. Pas de code applicatif : **rien à builder, rien à tester**. Le travail ici consiste à éditer des `.md`, des `.sh` et du JSON.

Ce que fait chaque brique, comment l'installer, ce que le kit impose au repo cible : **[README.md](README.md)**. Ne pas redupliquer ces explications ici.

## Anonymisation — à ne pas casser

Le nom du produit est partout le placeholder `{{PRODUCT}}`. Les exemples s'appuient sur un domaine fictif : agrégats `Product` / `ModuleDiagram`, sous-entités `ProductItem` / `DiagramNode`, contextes bornés `Catalog` / `Studio`. N'introduire aucun nom de projet, namespace ou agrégat réel.

## Où va un changement

| Changement | Fichier |
|------------|---------|
| convention de couche (nommage, pattern, interdit) | `rules/<couche>.md` — source unique, jamais recopiée dans un skill |
| procédure (cycle TDD, étapes d'audit) | le `SKILL.md` concerné |
| câblage (événement, matcher, ordre des hooks) | `settings.json` |
| description du comportement du kit | `README.md` |

Deux sources qui divergent font choisir au hasard : un fait vit à un seul endroit.

## Éditer un hook

- Doit sortir en 0 sur entrée JSON vide et quand sa dépendance manque. Seules exceptions voulues : `git-guard.sh` et `graphify-enforce.sh`, blocants par conception.
- Tester après édition : `echo '{}' | bash hooks/<nom>.sh`.
- Ne pas lancer `graphify-autosync.sh` à blanc : il reconstruit le graphe et bloque plusieurs minutes.
