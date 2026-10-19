---
name: kit-init
description: "Use once per repo after enabling the cctoolkit plugin, or to reconfigure it: detects the stack, proposes a layout preset, asks the documents' language, writes .claude/kit.config.json, installs the rules, preset skills, settings and statusline the plugin cannot ship, drafts layer rules from the code when no preset fits, then runs the doctor."
argument-hint: "[optional preset name]"
---

# Set up cctoolkit in this repo

A plugin ships skills, agents and hooks — never rules, settings or config, nor a skill bound to one layout. This skill writes the repo's side: `.claude/kit.config.json`, `.claude/rules/`, the preset's `.claude/skills/`, the merged `.claude/settings.json`, `.claude/statusline-command.sh`, `.claude/.gitignore`, `.claude/.gitattributes`, and on request `.caveman.json`. Nothing else.

$ARGUMENTS

Run from the repo root, after `/clear`. Kit files: `$(cctoolkit root)` — read there, never written.

**Never overwrite.** A target that exists and differs → show the difference in three lines, AskUserQuestion: keep (default) / replace / merge. One question per file, batched in one call.

## 1. Detect

One message: `cctoolkit detect-stack` and `cctoolkit doctor`. `detect-stack` prints JSON: `stacks` (manifest evidence, `testFramework`, `product` guess), `presets` ranked by `useCaseFolders` (use-case folders each preset's markers recognise in the real tree, with `sample`), `fits` (false = no preset recognises one), `layers` (top code folders), `existing` (config, rules, settings, statusline).

No stack detected → stop: the kit needs code to anchor on; say which manifests were looked for.

## 2. Choose

One AskUserQuestion call, up to four questions:

- **Preset** — `presets` in their order, the first marked `(Recommended)` when `useCaseFolders > 0`; each option's description: `useCaseFolders` + two `sample` paths + `rulePack: true` → "ships layer rules", `skillPack: true` → "ships test skills". Argument naming a preset → preselect it. `fits: false` → first option `None fits — draft rules from the code (Recommended)`, then the presets.
- **Documents' language** (`language.docs`) — specs, plans, batch sheets, handler sheets, reports. Options: `fr`, `en`; Other for any code.
- **Code language** (`language.code`) — test names, comments: `en` (Recommended), `fr`.
- **Product** — only when `product` is null or `productCandidates` has several: candidates as options. It expands `{product}` in paths and `{{PRODUCT}}` in the kit's commands.

`existing.kitConfig` true → read it first; preselect its values and say so in each question.

## 3. Write `.claude/kit.config.json`

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
- `commands.build` — preset's empty and a stack known → propose one in the summary (§6): `dotnet build <sln> --no-restore`, `npm run build --if-present`, `mvn -q compile`, `./gradlew compileJava`; Python: none.
- `layout` overrides — only from §4, or when a `presets[].sourceRoots` / `testRoots` of the chosen preset is empty while the tree has the equivalent folder: name it, override that key alone.

Then `cctoolkit config validate .` — any `FAIL` → fix the file before going on.

Then `cctoolkit migrate-anchors` (dry run): specs and plans written before the `<!-- kit:… -->` anchors are invisible to the skills and gates locating a section by its anchor, and a rule sheet whose titles are not exactly `Business rules` / `Règles métier` (a suffix, another wording) is invisible to the parsers — `rules-coverage` counts 0 rules and reports each tagged test as a dead reference. `anchors to write: 0` → nothing to do. Otherwise show the count and the `UNRECOGNISED HEADING` lines (free-form headings, left as they are), AskUserQuestion: apply (Recommended) / skip. Apply → `cctoolkit migrate-anchors --apply`, then the first two lines of `cctoolkit rules-coverage` go into the report.

## 4. Rules

Into `.claude/rules/`, `{{PRODUCT}}` replaced by `product` in every copied line (unset → leave the placeholder, say so):

1. Universal, always: `$(cctoolkit root)/rules/*.md` — `cctoolkit.md`, `markdown-output.md`, `context-discipline.md`.
2. Chosen preset has `rulePack` → `$(cctoolkit root)/presets/<preset>/rules/*.md`. Check each `paths:` glob against the tree (`git ls-files ':(glob)<glob>' | head -1` — without the `:(glob)` magic, `<dir>/**/*.cs` misses the files sitting directly in `<dir>` and reports a live glob as dead): a glob matching nothing → rewrite it from `layout` (the layer's real folder, the stack's extension), list the rewrite in the summary.
3. **No preset fits, or the chosen one ships no pack → draft.** One rule per layer of `detect-stack` `layers` — at most six, the biggest; a layer is a top folder of the code (`src/domain`, `src/billing`), never a single file.
   - Per layer pick three files: most changed in `git log --since=6.months --name-only -- <dir>`, one of them a test when the layer has some.
   - Every layer in **one message**: one `Explore` agent per layer, `model: "sonnet"` (synthesising conventions takes judgment), its prompt naming the three files and Q = "Conventions these files share: naming (types, files, methods), base classes or interfaces, what they import and what they never import, recurring patterns, error handling, test style. Cite file:line for each. Say 'none' rather than guess."
   - Write `.claude/rules/<layer>.md`: frontmatter `paths:` = `<dir>/**/*<ext>`; first line `<!-- draft by /cctoolkit:kit-init <date> — review before trusting -->`; sections `Role`, `Naming`, `Dependencies`, `Patterns`, `Tests`, each line backed by a cited file. A convention seen in one file only is not written. English: rules are instruction files.
   - Use cases not recognised by any marker → AskUserQuestion: "Which folder is one use case (one handler, command or endpoint)?" with the two likeliest `layers` paths as options. Its handler file's name pattern and class/function signature become `layout.useCase.marker` (`file` glob, `contains` regex) and its parent `layout.useCase.roots` in `kit.config.json`; re-run `validate`: `layout.useCase.roots` must turn `ok`.

## 4b. Preset skills — chosen preset has `skillPack` only

The test-authoring skills (`tests-*`) follow the layout and the test stack, so they ship with the preset, not the plugin: `$(cctoolkit root)/presets/<preset>/skills/<name>/` into `.claude/skills/<name>/`, every file, `{{PRODUCT}}` replaced as in §4. Once copied they are the repo's own, invoked by their bare name (`rules/cctoolkit.md`).

A target folder that exists → compare file by file after substitution (`diff -ru <substituted copy> .claude/skills/<name>`); identical → kept, nothing asked. Different → the per-file question of **Never overwrite**, in the same call as the rules': the three lines show the differing lines' count and the first hunk; merge = bring the kit's hunks the user picks into the local file, never the reverse. A local file the preset lacks stays.

## 5. Settings, statusline, ignore

Source: `$(cctoolkit root)/templates/`. Edit with the Edit tool, never a script: the auto-mode classifier refuses scripts on settings files.

- `.claude/settings.json` — merge `templates/settings.json`: `permissions.allow` / `deny` as a union (drop `Bash(dotnet *)` off a .NET repo), `env` keys absent only, `statusLine` only when none is set. Never write `enabledPlugins` or `extraKnownMarketplaces` yourself — the classifier refuses an agent enabling plugins. Plugin enabled at user scope only (doctor `plugin enabled` line names `~/.claude/settings.json`) → tell the user to run `! claude plugin marketplace add pierrebelin/claude-code-toolkit --scope project` then `! claude plugin install cctoolkit@cctoolkit --scope project`, so clones and worktrees get it. Enabled at local scope → no such advice while the marketplace is a local path (it would commit an `enabledPlugins` key teammates cannot resolve): worktrees get it through `cctoolkit install-git-hooks`, project scope comes with a GitHub marketplace (`INSTALL.md`).
- `.claude/statusline-command.sh` — copy of `templates/statusline-command.sh` when absent.
- `.claude/.gitignore` — append the lines of `templates/claude.gitignore` it lacks.
- `.claude/.gitattributes` — append the lines of `templates/claude.gitattributes` it lacks.
- `templates/settings.local.json` — startup trim, opt-in: mention it in the summary, never apply it (`templates/README.md` § Startup trim).
- `.caveman.json` — only when the caveman mode is in use (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.caveman-active` exists) and the repo holds neither `.caveman.json` nor `.caveman/config.json`. AskUserQuestion, in the same call as the file questions: terse output for this repo — keep each user's own default (Recommended) / `ultra` / `full`. A mode chosen → write `{"defaultMode": "<mode>"}` at the repo root: caveman reads it before the user's config, for this repo only, and it is committed — every teammate's sessions here start in that mode. Never write the global `.caveman-active` flag.

## 6. Doctor and report

First, the mechanical fixes doctor asked for in §1, one message: `FAIL git post-checkout hook` → `cctoolkit install-git-hooks`; `FAIL graphify graph` with `binary graphify` ok → `graphify update .` (~60 s, `run_in_background`; the graph is written only when `graphify-out/graph.json` exists afterwards). A call refused → its `!` line in the report, no retry.

Then `cctoolkit doctor`. Then one summary:

| File | Action |
|---|---|
| `.claude/kit.config.json` | written / kept / merged — keys set |
| `.claude/rules/…` | copied / drafted / kept, one row each |
| `.claude/skills/tests-*` | copied / kept / replaced / merged, one row each |
| anchors | `migrate-anchors`: n written across m files / none needed / skipped |
| `.claude/settings.json`, statusline, `.gitignore`, `.gitattributes` | merged / created / kept |
| `.caveman.json` | written with its mode / not asked (caveman unused) / declined |

Then each doctor `FAIL` / `WARN` line verbatim with its fix, drafted rules listed as "to review", and the next step: no knowledge base yet (no `knowledge.root` folder) → `/cctoolkit:knowledge-sync` first, which builds it from the rule sheets, the code and the tests, then `/cctoolkit:business-spec <feature>`. Last line, opt-in: `cctoolkit install-git-hooks --pre-commit` reminds at each commit that the base may lag behind the staged handlers — never blocking. `!` lines left to the user (§6 refusals) → the next step comes after them: `cctoolkit doctor` again. Nothing committed.
