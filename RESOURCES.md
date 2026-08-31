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

## [TheBeardedBearSAS/claude-craft](https://github.com/TheBeardedBearSAS/claude-craft)

A framework at the opposite end of the size scale: 31 default agents, 126 commands across 15 namespaces, 55 skills, 11 stacks (Symfony, React, Flutter, Python, Angular, Vue) plus infrastructure ones (Docker, Kubernetes, OpenTofu, Ansible), in 5 languages. Installed per project with `npx @the-bearded-bear/claude-craft install`, stack and language passed as flags.

Interesting for its orchestration layer rather than its catalogue: a sprint workflow with quality gates (Analyze → Plan → Design → Implement → QA), a loop that re-runs until the Definition of Done is met, browser acceptance testing that captures regression tests. This kit assumes one stack and one method and stays small; that one covers every stack and pays for it in surface area. Read it when wondering what a generic version of `/implement-tdd` would cost.

## [worldflowai/everything-claude-code](https://github.com/worldflowai/everything-claude-code)

8 agents (planner, architect, code-reviewer, security-reviewer), 8 skills, 10 slash commands (`/tdd`, `/plan`, `/code-review`), 6 rule files split by concern — security, style, testing, git, performance — and hooks for memory persistence and compaction hints. Installed from the plugin marketplace with `/plugin install everything-claude-code`, or copied by hand into `~/.claude/`.

Closest structural neighbour to this kit: same bricks, same split into `rules/`, comparable scale. The difference is the target — it is stack-agnostic and derived from daily use, this one encodes DDD and a .NET layering. Its hooks are the part worth stealing.
