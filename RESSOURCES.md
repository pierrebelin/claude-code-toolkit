# Ressources

Repos qui attaquent le même problème que ce kit — configurer un agent de code — par un autre angle. Tous sous licence MIT.

## [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)

Un seul `CLAUDE.md`, quatre principes tirés des observations de Karpathy sur les défauts des LLM en code : réfléchir avant d'écrire, simplicité d'abord, modifications chirurgicales, critères de succès vérifiables plutôt que liste d'ordres. Installable en plugin ou copié par projet, avec un équivalent `.cursor/rules`.

Stratégie inverse de celle d'ici. Ce kit découpe par couche et nomme ses interdits ; ce repo tient en quatre principes généraux. Bon point de comparaison pour mesurer ce que la spécificité rapporte vraiment.

## [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)

Les prompts système de Claude Code extraits du binaire compilé : plus de 500 fichiers — sous-agents, slash commands, composants du prompt principal — avec leur coût en tokens.

Référence, pas inspiration. Quand un hook ou un skill ne se déclenche pas comme prévu, la cause est souvent ce que Claude Code injecte déjà et qu'on ignorait.

## [trailhq/Graft](https://github.com/trailhq/Graft)

Construit un graphe du code — fichiers résumés, regroupés en concepts, reliés par des relations typées — et l'expose aux agents via MCP. 23 langages, construction locale.

C'est l'équivalent public de `graphify`, l'outil derrière les hooks `graphify-*`, qui lui n'est pas distribué. Si tu reprends ces hooks, Graft est le remplaçant crédible.

## [dotnet/skills](https://github.com/dotnet/skills)

Collection officielle de l'équipe .NET : 13 plugins couvrant EF Core, MSBuild, NuGet, ASP.NET Core, Blazor, MAUI, migration et couverture de tests, diagnostics, montées de version.

Même cible que ce kit, périmètre complémentaire. Ici on encode une méthode — DDD, TDD, découpe en lots ; là c'est l'outillage. Les deux cohabitent sans se marcher dessus.
