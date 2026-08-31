# Resources

Repos tackling the same problem as this kit — configuring a coding agent — from another angle. All MIT-licensed.

## [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)

A single `CLAUDE.md`, four principles drawn from Karpathy's observations on how LLMs fail at code: think before writing, simplicity first, surgical edits, verifiable success criteria rather than a list of orders. Installable as a plugin or copied per project, with a `.cursor/rules` equivalent.

The opposite strategy to this one. This kit splits by layer and names its bans; that repo fits in four general principles. A good comparison point for measuring what specificity actually buys.

## [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)

Claude Code's system prompts extracted from the compiled binary: over 500 files — subagents, slash commands, components of the main prompt — with their token cost.

A reference, not an inspiration. When a hook or a skill does not fire as expected, the cause is often something Claude Code already injects that you did not know about.

## [trailhq/Graft](https://github.com/trailhq/Graft)

Builds a graph of the code — summarised files, grouped into concepts, linked by typed relations — and exposes it to agents over MCP. 23 languages, local build.

It is the public equivalent of `graphify`, the tool behind the `graphify-*` hooks, which is not distributed. If you pick up those hooks, Graft is the credible replacement.

## [dotnet/skills](https://github.com/dotnet/skills)

The .NET team's official collection: 13 plugins covering EF Core, MSBuild, NuGet, ASP.NET Core, Blazor, MAUI, migration and test coverage, diagnostics, version upgrades.

Same target as this kit, complementary scope. Here a method is encoded — DDD, TDD, batch splitting; there it is the tooling. The two coexist without stepping on each other.
