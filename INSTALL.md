# Installing cctoolkit

## Requirements

- Claude Code with plugin support
- `jq` and `python3`
- for `/cctoolkit:run-lot`: the `Workflow` tool (`disableWorkflows` absent or `false`)

## 1. Install the plugin

From the root of your repo, in your terminal — type it yourself, the auto-mode classifier refuses an agent enabling plugins:

```bash
claude plugin marketplace add pierrebelin/claude-code-toolkit --scope project
claude plugin install cctoolkit@cctoolkit --scope project
```

Project scope writes the marketplace (`extraKnownMarketplaces`) and the plugin (`enabledPlugins`) into the committed `.claude/settings.json`: every clone and worktree gets it, and a teammate opening the repo is offered the install.

Other ways:
- inside a session: `/plugin marketplace add pierrebelin/claude-code-toolkit`, then `/plugin install cctoolkit@cctoolkit`, scope picked in the dialog;
- `--scope local` keeps it to your checkout; a worktree then needs `cctoolkit install-git-hooks` ([`docs/TOOLING.md`](docs/TOOLING.md));
- a local checkout of this repo works as the marketplace too.

## 2. Run `/cctoolkit:kit-init`

Restart Claude Code, `/clear`, then run **`/cctoolkit:kit-init`** from the repo root.

This step is the one that matters. The plugin brings skills, agents and hooks, but a plugin cannot ship config, rules or settings: without `kit-init` the repo has no `kit.config.json`, no rules, no permissions, and the hooks assume the `clean-architecture` layout, whatever yours is. Don't set the repo up by hand.

| Step | What happens |
|------|--------------|
| Detect | `cctoolkit detect-stack` and `cctoolkit doctor`: manifests, test framework, product name guess, use-case folders each preset recognises in your tree |
| Migrate | a manual copy of the kit found in `.claude/` → saves its local edits, then removes it on confirmation; the repo's own skills, scripts, config and rules stay. Commit the deletions and the settings change together |
| Choose | one round of questions: the preset (ranked on your real folders), the documents' language, the code language, the product when ambiguous |
| Config | writes `.claude/kit.config.json` — only what differs from the preset — validates it, offers `migrate-anchors` on specs, plans and handler sheets older than the `<!-- kit:… -->` anchors |
| Rules | copies the universal rules and the preset's layer rules into `.claude/rules/`, `{{PRODUCT}}` substituted, dead `paths:` globs rewritten from your layout. **No preset fits?** It drafts one rule per layer from your most-changed files, each convention cited `file:line`, marked "review before trusting" |
| Settings | merges permissions and env into `.claude/settings.json`, installs the statusline, completes `.claude/.gitignore` |
| Report | applies the doctor's mechanical fixes, re-runs `cctoolkit doctor`, prints one summary table and the next step |

It **never overwrites** a file that differs: it shows the difference and asks keep / replace / merge. It **never commits**. Re-run it whenever you want to change the preset or the language, or pull a rule changed by a release. Configuration keys: [`presets/README.md`](presets/README.md).

## 3. Optional

- **Mods** — the in-terminal panes: [`mods/README.md`](mods/README.md).
- **Startup trim**: [`templates/README.md`](templates/README.md#startup-trim).
- Add `graphify-out/` to the repo's `.gitignore`.

## Dependencies

`jq` and `python3` are required. The rest degrades cleanly — every hook exits 0 when its tool is missing, except the guards that block by design ([`hooks/README.md`](hooks/README.md)).

| Tool | Used for | If missing |
|------|----------|------------|
| `perl` | `evals/run.sh` timer, `tools/doctor` | no latency budget in the evals |
| `graphify` | blast radius on aggregate edits, graph autosync | silently skipped |
| `rtk` | output compression of Bash commands | drop the `rtk ` prefix from `kit.config.json` `commands` |
| `caveman` plugin | terse output, per repo through `.caveman.json` when `/cctoolkit:kit-init` writes one; statusline badge | no effect |

## Updating

```bash
claude plugin marketplace update cctoolkit
claude plugin update cctoolkit@cctoolkit
```

Restart Claude Code, then `cctoolkit doctor`. Nothing in the repo changes: `kit.config.json`, `.claude/rules/` and the settings stay as they are. What each release brings: [CHANGELOG.md](CHANGELOG.md). A release listing **Rules changed** → re-run `/cctoolkit:kit-init` to pull them: it shows each difference and asks.

Updates are **not automatic** for this marketplace — Claude Code turns auto-update on only for Anthropic's own. To have them, toggle **Enable auto-update** on `cctoolkit` under `/plugin` → Marketplaces, or add `"autoUpdate": true` to its entry under `extraKnownMarketplaces` in `.claude/settings.json`, which turns it on for the whole team.

Never edit the plugin cache (`cctoolkit root`): the next update replaces it. A change to the kit itself goes into a checkout of this repo, then reaches every repo through the update.
