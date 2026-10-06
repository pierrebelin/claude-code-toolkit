---
name: kit-init
description: "Use once per repo after enabling the cctoolkit plugin, or to reconfigure it: detects the stack, proposes a layout preset, asks the documents' language, writes .claude/kit.config.json, installs the rules, settings and statusline the plugin cannot ship, drafts layer rules from the code when no preset fits, then runs the doctor. Also migrates a repo holding a manual copy of the kit."
argument-hint: "[optional preset name]"
---

# Set up cctoolkit in this repo

A plugin ships skills, agents and hooks — never rules, settings or config. This skill writes the repo's side: `.claude/kit.config.json`, `.claude/rules/`, the merged `.claude/settings.json`, `.claude/statusline-command.sh`, `.claude/.gitignore`. Nothing else.

$ARGUMENTS

Run from the repo root, after `/clear`. Kit files: `$(cctoolkit root)` — read there, never written.

**Never overwrite.** A target that exists and differs → show the difference in three lines, AskUserQuestion: keep (default) / replace / merge. One question per file, batched in one call.

## 1. Detect

One message: `cctoolkit detect-stack` and `cctoolkit doctor`. `detect-stack` prints JSON: `stacks` (manifest evidence, `testFramework`, `product` guess), `presets` ranked by `useCaseFolders` (use-case folders each preset's markers recognise in the real tree, with `sample`), `fits` (false = no preset recognises one), `layers` (top code folders), `existing` (config, rules, settings, statusline, `legacyCopy`).

No stack detected → stop: the kit needs code to anchor on; say which manifests were looked for.

## 2. Migrate a manual copy — `existing.legacyCopy` non-empty only

A copy made before the plugin runs beside it: every guard fires twice, bare skill names shadow the plugin's.

1. `cctoolkit kit-diff .` — DRIFT and ADDED lines are local changes the copy carries. Show them, grouped by file. Any worth keeping → list them for the user to bring into the toolkit repo; never into `$(cctoolkit root)`.
2. Copy's `kit.config.json` and `rules/` are the repo's: kept, they feed §3-4 as `existing`.
3. AskUserQuestion, one call, before any deletion: delete the kit's files in the listed `.claude/{hooks,lib,skills,agents,tools,presets,evals}`, in `.claude/scripts/` when listed as `scripts`, and under `scripts/` when listed as `../scripts` (names from `cctoolkit list`, nothing else there), plus the `hooks` key of `.claude/settings.json` / `settings.local.json` whose commands point under `.claude/hooks/`. The files come from `cctoolkit remove-copy` (dry run), never from a list of your own: `DELETE` = the kit ships the path; `KEEP` = the repo's own skill or script, stays where it is, listed as kept; `MOVE` = a file added inside a kit skill folder — read by a repo skill → move it into that skill and rewrite the reader's path (same question); read by the copy's own version of a kit file → a local extension of the kit: into the toolkit list of step 1, and the question warns that it stops working once deleted; read by nothing → dropped; `ORPHAN` = the repo's eval case, whose runner leaves with the copy: listed in the report, the user decides. Confirmed → `cctoolkit remove-copy --apply` (it deletes the DELETE lines and the mods marketplace, never stages). The classifier refuses it → no retry, no deleting by other means: the report gives the user `! cctoolkit remove-copy --apply`, and §3-6 go on — none of them needs the copy gone.
4. `mods` listed — `.claude/mods/` is the mods' former marketplace. Same question: the folder goes with `remove-copy --apply`; in the settings files, with the Edit tool, the `extraKnownMarketplaces` entry whose `source.path` is `./.claude/mods` and every `enabledPlugins` key `<mod>@<that marketplace>`. Removing is allowed; enabling is the user's: the report tells them to run `! claude plugin install <mod>@cctoolkit --scope <scope>` for each mod that was enabled, `<scope>` being the scope `cctoolkit` itself is enabled at (doctor `plugin enabled` line). An edit refused by the classifier → list the entries for the user to remove by hand.
5. What the copy leaves pointing at itself, settled with the same question — the default is the kit's side, the copy's version kept only on request:
   - `.claude/rules/markdown-output.md`, `context-discipline.md` — universal rules, the kit's, not the repo's: replace them in §5 (a copy's `markdown-output.md` without `kit:rules` teaches literals no parser reads).
   - `.claude/statusline-command.sh` naming `.claude/lib/` → replace it in §6 with the template, which finds its helper in the plugin cache.
   - The repo's `CLAUDE.md` and `.claude/rules/*.md` lines naming `.claude/{hooks,lib,scripts,tools,evals}/…`: rewrite `python3 .claude/scripts/<name>.py` / `bash .claude/scripts/<name>.sh` / `bash .claude/tools/<name>` into `cctoolkit <name>` when `cctoolkit list` has it, `bash .claude/evals/run.sh` into `cctoolkit evals`; a path to a script §2.3 kept as the repo's own stays as it is; a path into a kit skill or agent (`.claude/skills/<s>/references/<f>.md`) drops its `.claude/` — a kit path, which `rules/cctoolkit.md` resolves under `cctoolkit root`, as the presets write it; any other line (an eval count, a hook path, a guard cited by its `.claude/lib/` path) is shown in §7 with a proposed replacement — the guard named without its path, as the plugin's — and rewritten only on the user's yes. `cctoolkit doctor` `stale kit paths` lists what is left.

## 3. Choose

One AskUserQuestion call, up to four questions:

- **Preset** — `presets` in their order, the first marked `(Recommended)` when `useCaseFolders > 0`; each option's description: `useCaseFolders` + two `sample` paths + `rulePack: true` → "ships layer rules". Argument naming a preset → preselect it. `fits: false` → first option `None fits — draft rules from the code (Recommended)`, then the presets.
- **Documents' language** (`language.docs`) — specs, plans, batch sheets, handler sheets, reports. Options: `fr`, `en`; Other for any code.
- **Code language** (`language.code`) — test names, comments: `en` (Recommended), `fr`.
- **Product** — only when `product` is null or `productCandidates` has several: candidates as options. It expands `{product}` in paths and `{{PRODUCT}}` in the kit's commands.

`existing.kitConfig` true → read it first; preselect its values and say so in each question.

## 4. Write `.claude/kit.config.json`

Only what differs from the chosen preset's `preset.json`, plus `language`, `preset`, `product`:

```json
{
  "language": { "docs": "fr", "code": "en" },
  "preset": "vertical-slices",
  "product": "Shop",
  "testTag": { "framework": "pytest" }
}
```

- `testTag.framework` — from `detect-stack` `testTag` when it differs from the preset's. `testTagUnsupported` set (nunit, mstest…) → keep the preset's, warn: the traceability hook will find no tag until an adapter exists in `lib/kit_testtag.py`.
- `commands.build` — preset's empty and a stack known → propose one in the summary (§7): `dotnet build <sln> --no-restore`, `npm run build --if-present`, `mvn -q compile`, `./gradlew compileJava`; Python: none.
- `layout` overrides — only from §5, or when a `presets[].sourceRoots` / `testRoots` of the chosen preset is empty while the tree has the equivalent folder: name it, override that key alone.

Then `python3 "$(cctoolkit root)/lib/kit_config.py" validate .` — any `FAIL` → fix the file before going on.

Then `cctoolkit migrate-anchors` (dry run): rule sheets, specs and plans written before the `<!-- kit:… -->` anchors are invisible to every parser — `rules-coverage` counts 0 rules and reports each tagged test as a dead reference. `anchors to write: 0` → nothing to do. Otherwise show the count and the `UNRECOGNISED HEADING` lines (free-form headings, left as they are), AskUserQuestion: apply (Recommended) / skip. Apply → `cctoolkit migrate-anchors --apply`, then the first two lines of `cctoolkit rules-coverage` go into the report.

## 5. Rules

Into `.claude/rules/`, `{{PRODUCT}}` replaced by `product` in every copied line (unset → leave the placeholder, say so):

1. Universal, always: `$(cctoolkit root)/rules/*.md` — `cctoolkit.md`, `markdown-output.md`, `context-discipline.md`.
2. Chosen preset has `rulePack` → `$(cctoolkit root)/presets/<preset>/rules/*.md`. Check each `paths:` glob against the tree (`git ls-files ':(glob)<glob>' | head -1` — without the `:(glob)` magic, `<dir>/**/*.cs` misses the files sitting directly in `<dir>` and reports a live glob as dead): a glob matching nothing → rewrite it from `layout` (the layer's real folder, the stack's extension), list the rewrite in the summary.
3. **No preset fits, or the chosen one ships no pack → draft.** One rule per layer of `detect-stack` `layers` — at most six, the biggest; a layer is a top folder of the code (`src/domain`, `src/billing`), never a single file.
   - Per layer pick three files: most changed in `git log --since=6.months --name-only -- <dir>`, one of them a test when the layer has some.
   - Every layer in **one message**: `cctoolkit bulk-read --question "<Q>" --paths f1 f2 f3`, Q = "Conventions these files share: naming (types, files, methods), base classes or interfaces, what they import and what they never import, recurring patterns, error handling, test style. Cite file:line for each. Say 'none' rather than guess."
   - Write `.claude/rules/<layer>.md`: frontmatter `paths:` = `<dir>/**/*<ext>`; first line `<!-- draft by /cctoolkit:kit-init <date> — review before trusting -->`; sections `Role`, `Naming`, `Dependencies`, `Patterns`, `Tests`, each line backed by a cited file. A convention seen in one file only is not written. English: rules are instruction files.
   - Use cases not recognised by any marker → AskUserQuestion: "Which folder is one use case (one handler, command or endpoint)?" with the two likeliest `layers` paths as options. Its handler file's name pattern and class/function signature become `layout.useCase.marker` (`file` glob, `contains` regex) and its parent `layout.useCase.roots` in `kit.config.json`; re-run `validate`: `layout.useCase.roots` must turn `ok`.

## 6. Settings, statusline, ignore

Source: `$(cctoolkit root)/templates/`. Edit with the Edit tool, never a script: the auto-mode classifier refuses scripts on settings files.

- `.claude/settings.json` — merge `templates/settings.json`: `permissions.allow` / `deny` as a union (drop `Bash(dotnet *)` off a .NET repo), `env` keys absent only, `statusLine` only when none is set. **Never write `enabledPlugins` or `extraKnownMarketplaces` yourself** — the classifier refuses an agent enabling plugins. Plugin enabled at user scope only (doctor `plugin enabled` line names `~/.claude/settings.json`) → tell the user to run `! claude plugin install cctoolkit@cctoolkit --scope project`, so clones and worktrees get it. Enabled at local scope → no such advice while the marketplace is a local path (it would commit an `enabledPlugins` key teammates cannot resolve): worktrees get it through `cctoolkit install-git-hooks`, project scope comes with a GitHub marketplace (README § Installation).
- `.claude/statusline-command.sh` — copy of `templates/statusline-command.sh` when absent.
- `.claude/.gitignore` — append the lines of `templates/claude.gitignore` it lacks.
- `templates/settings.local.json` — startup trim, opt-in: mention it in the summary, never apply it (`templates/README.md` § Startup trim).

## 7. Doctor and report

First, the mechanical fixes doctor asked for in §1, one message: `FAIL git post-checkout hook` → `cctoolkit install-git-hooks`; `FAIL graphify graph` with `binary graphify` ok → `graphify update .` (~60 s, `run_in_background`; the graph is written only when `graphify-out/graph.json` exists afterwards). A call refused → its `!` line in the report, no retry.

Then `cctoolkit doctor`. Then one summary:

| File | Action |
|---|---|
| `.claude/kit.config.json` | written / kept / merged — keys set |
| `.claude/rules/…` | copied / drafted / kept, one row each |
| anchors | `migrate-anchors`: n written across m files / none needed / skipped |
| copy removed | folders and settings keys deleted (§2), mods to re-enable |
| `.claude/settings.json`, statusline, `.gitignore` | merged / created / kept |

Then each doctor `FAIL` / `WARN` line verbatim with its fix, the §2.5 lines shown with their proposed replacement, the ADDED files to bring into the toolkit repo, drafted rules listed as "to review", and the next step: `/cctoolkit:business-spec <feature>`. `!` lines left to the user (§2.3 `remove-copy --apply`, §7 refusals) → the next step comes after them: `cctoolkit doctor` again, no `legacy copy` line left. Nothing committed.
