---
paths:
  - "todo/**/*.md"
  - "src/**/CLAUDE.md"
  - "docs/**/*.md"
  - ".claude/rules/**/*.md"
---

# Markdown files — produced vs. instruction

Two families, and one exception that overrides both.

- **Produced files** — specs, plans under `todo/`, handler and feature `CLAUDE.md` under `src/`, `docs/`, quality reports, verdicts, PR comments, user summaries. Deliverables the team proofreads.
- **Instruction files** — the kit's `skills/` and `agents/` (plugin), `.claude/rules/`. Prompts, not deliverables.
- **Overrides both: anchors and contracts stay verbatim.** An instruction file describing an output quotes it as is — hooks, scripts match by exact string.

Skill template blocks (spec, plan, handler sheet, report structure) = produced text: structure copied verbatim, every `<!-- kit:… -->` anchor kept.

## Language

`.claude/kit.config.json`, key `language` — read it once before writing a produced file. Missing file or key = `en`.

- `docs` — prose and headings of the produced family: specs, plans, batch sheets, handler and feature `CLAUDE.md`, reports, summaries to the user. Translate a template heading, keep its anchor: `## Business rules <!-- kit:rules -->` becomes `## Règles métier <!-- kit:rules -->` under `"docs": "fr"`.
- `code` — test names, code comments, identifiers chosen by the model. The words filling a naming pattern follow it; the pattern's own keywords (`Should…_When…`) and the layer conventions stay as written in `.claude/rules/`.
- Never moved by `language`: the instruction family, the anchors, the contracts below, identifier prefixes, values quoted verbatim (`Blocking`, `Major`).

## Frozen literals

### Anchors — documents for humans

The title is prose in `language.docs`; the anchor is the literal. A parser matches the anchor, never the title — a document written without anchors is read by the exact titles the French aliases table lists, English or French.

| Anchor | Where | Parsed by |
|---|---|---|
| `<!-- kit:rules -->`, `<!-- kit:flow -->`, `<!-- kit:events -->` ending the three `##` headings; `<!-- kit:cols id,rule,outcome -->` above the rules table (columns read by position, or by the table's header row when the anchor is absent); `<!-- kit:none -->` on an explicitly empty rules section | handler `CLAUDE.md` | `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`; `scripts/knowledge-scan.py` counts the rows opening `\| RM-xx \|` / `\| RL-xx \|` (`RULE_ROW`) |
| `<!-- kit:applied-rules -->` in the first cell of the `Design` row listing the applied ids; `<!-- kit:na-rules -->` after the global plan's non-applicable label | batch sheet, global plan | `scripts/rules-coverage.py --ids`, then `scripts/pre-audit.sh` |
| `<!-- kit:open-questions -->` heading, `<!-- kit:cols n,severity,question,impact,options -->` above its table; severity values `Blocking`/`Major` stay verbatim | spec | `/plan-implementation` gate (awk on the section) |
| Delta anchors `<!-- kit:new -->`, `<!-- kit:modified -->`, `<!-- kit:retired -->` ending the `###` heading of a use case, a rule or a decision that carries a knowledge-base id | spec | `lib/knowledge.py` (`DELTA`), hence `scripts/knowledge-merge.py prepare`; `adversarial-reviewer` (`mode: spec`) |
| `<!-- kit:cols n,point,raised-by -->` above the technical points table, its points `T1`, `T2`… | spec | `/plan-implementation` (one decision per point, `T1` in `2. Traceability`); `scripts/knowledge-merge.py` strips `Tn` from an ADR's lines (`PLAN_ID`) |
| `<!-- kit:vocabulary -->`, `<!-- kit:states -->`, `<!-- kit:relations -->` ending their `##` headings | spec | `scripts/knowledge-merge.py prepare` (a non-empty section → `overview: … rewrite`), then `knowledge-merger` |
| Object heading `<#…> <id> — <title>` — the em dash is the literal written; the panes also accept `–` and `-`, `lib/knowledge.py` only `—` | knowledge base, spec, batch sheet | `lib/knowledge.py` (`HEADING`), hence every knowledge script, over specs and sheets too; `scripts/knowledge-write.py` (`PROV_HEADING`, a provisional id); the `knowledge-pane` mod (`sliceObject`); the `spec-pane` mod (`ITEM_PATTERN`, the `CU`/`RM` ids of a spec) |
| `### ADR-nnn — …` with its `Consequences` line, under `## Decisions` | batch sheet | written by `/plan-implementation`; `scripts/knowledge-merge.py prepare` drafts each into the merge staging |
| `<!-- kit:cols item,owner,batch -->` above the table of the global plan's `kit:traceability` section — ids of the first cell, batches of the third | global plan | `scripts/knowledge-merge.py prepare --partial` |
| Every other heading anchor of the templates — spec `kit:context` … `kit:technical-points`, global plan `kit:summary` … `kit:cross-cutting`, sheet `kit:intent` … `kit:assumptions` | spec, global plan, batch sheet | the skills and agents locating a section in any language; `scripts/migrate-anchors.py` writes them into older documents |
| `## Cycles` heading and its single ```json block (fields of `skills/implement-tdd/references/design.md`), never translated | batch sheet | `scripts/sheet-cycles.py`, hence `run-lot`, `scripts/pre-audit.sh`, `scripts/audit-capture.sh` |
| Status tokens `✅ DONE`, `Correction Cn` — never translated | batch sheet | `cctoolkit plan-next-batch`, `run-lot` |
| Status tokens `TDD: RED ✅ · GREEN ✅ · COST ✅`, `TDD: GUARD ⬜` / `TDD: GUARD ✅` — sheets older than `## Cycles` only, never translated | batch sheet | `scripts/pre-audit.sh` (sheet without the block) |
| `<!-- kit:handlers -->` ending the handlers heading of a use case (first code span of each item = a handler); a line ending `<!-- kit:observed high\|medium\|low -->` in an object's own lines; `<!-- kit:cols date,feature,delta -->` above the `HISTORY.md` table, its rows `\| <date> \| <feature> \| <delta> \|` — feature `sync <short commit>` for a sync, `<CODE>` or `<CODE> partial` for a merge, delta `+id` `~id` `-id` or `—` | knowledge base under `knowledge.root` | `lib/knowledge.py`, hence `scripts/knowledge-scan.py`, `scripts/knowledge-write.py`, `scripts/next-id.py`, `lib/knowledge_index.py`, `scripts/knowledge-index.py`, `scripts/ask.py`; the `knowledge-pane` mod (the `HISTORY.md` table, an object's heading, the `OVERVIEW.md` headings and `kit:cols` tables) |
| `OVERVIEW.md`: the first sentence of its first line under the title = the context's summary, written by `knowledge-extractor` and `knowledge-merger`; `<!-- kit:vocabulary -->`, `<!-- kit:relations -->` ending two of its headings | knowledge base | the summary: `lib/knowledge_index.py` (`summary`), the `summary` column of `INDEX.md`; the anchors: no script — `/business-spec` reads the neighbours under `kit:relations`, the `knowledge-pane` mod shows every `##` heading whatever its anchor |
| `<!-- generated by cctoolkit knowledge-index — do not edit -->`, `<!-- kit:cols context,prefix,usecases,rules,decisions,summary -->` above its table, the closing `ADR: <n>.` | `INDEX.md` of the knowledge base | written whole by `lib/knowledge_index.py`; `cctoolkit knowledge-index --check` compares it byte for byte; the `knowledge-pane` mod reads the table by position and the `ADR: <n>.` line |

An instruction naming a section by its English template title (`## TDD sequence`, `## Assumptions`) designates the section carrying that template heading's anchor, whatever its title.

### Contracts — between agents, hooks and scripts

English, verbatim, whatever `language`.

| Frozen literal | Parsed by |
|---|---|
| The rule tag's value `{HandlerFolder}/{RM\|RL-xx}`, and each carrier of `lib/kit_testtag.py`: xUnit `[Trait("RM", "…")]`, pytest `@pytest.mark.rm("…")`, JUnit `@Tag("RM:…")`, Jest `[RM …]` in a title | `lib/kit_testtag.py`, read by `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`, `scripts/untagged-tests.py`, `scripts/pre-audit.sh`, `scripts/knowledge-scan.py` (`OLD_TAG`: `{HandlerFolder}/…` names the handler; a value equal to a knowledge-base id, its use case) |
| `## Verdict — VALID`, `## Verdict — GAPS`, severities `Blocking`/`Major`/`Minor`, axes `Correctness`/`Reuse`/`Simplification`/`Cost`/`Placement`/`Comments`/`Test`/`Plan`/`Scope`; GAPS columns `Severity`/`Axis`/`Gap`/`Evidence`/`Closure`/`Expected fix` (a table without `Closure` is read too); contest answers `Accept`/`Counter`/`Refute`/`Escalate` | `/verify-ddd-tdd` verdict format, `scripts/learn-candidates.py`, `run-lot` (answers) |
| `## RED`, `## GREEN`, `## BLOCKED` and their fields | `tdd-test-author` / `tdd-implementer` reports, `run-lot`, `hooks/subagent-report-shape.sh` |
| `Test files you may modify, granted: <paths>.` in a GREEN prompt; reasons opening a `BLOCKED` diagnostic `tests modified at GREEN: <paths> — granted: <paths>`, `RED on stub: <marker> in <methods>` | written by `run-lot` (grant) and `lib/tdd_scope.py` (reasons); read by `lib/tdd_scope.py` (grant) and `run-lot` `checkRed`/`checkGreen`/`decide` (reasons) |
| `→ Batch FX complete — manual validation required` — the closing line | `hooks/implement-tdd-guard.sh` |
| Output lines `not cited : `, `unknown references : `, `(none)` | `scripts/rules-coverage.py --ids`, then `scripts/pre-audit.sh` |
| `## Review — GAPS`, `## Review — CLEAR` | `adversarial-reviewer` output, read by the three callers |
| `### Batch execution`, columns `Batch` / `Depends on` / `Repo`, `### Batch FX — … — ✅ DONE` | `cctoolkit plan-next-batch` |
| `## STATUS — DONE\|BLOCKED\|GAPS` first line, `Verdict:` (`VALID`, `GAPS`, `GAPS carried`, `to redo`, `none`), `Reason:`, `## To validate` of `run/batches/FX.md`; `Workflow run-lot, batch FX.` first line of every run-lot prompt | `run-plan` gate, `run-lot-pane` mod |
| Run files: `run/<YYYY-MM-DD-HHMM>.md` (sections `## Plan stopped — common cause` when the breaker stopped the plan, `## To validate`, `## Minor`, `## Final check`, `## Knowledge base`, `## Journal`), `run/<YYYY-MM-DD-HHMM>-aside-FX.patch`, `run/batches/FX.md`, work file `run/.work.jsonl` (one JSON line per event: `preexisting`, `cycle`, `question`, `answer`, `journal`, `audit-round`, `attempt`, `breaker`, `ack` — fields in `lib/work_file.py`), pane file `run/.pane.jsonl` (`pause`, `note`, `validation`, written by the `run-lot-pane` mod only — `lib/pane_file.py`), `plan-next-batch --next` kind `PAUSED`; markers `user decision to validate` (taken without the user) and `user decision` (made by the user) | `run-plan`, `cctoolkit plan-next-batch --context`, `cctoolkit run-question`, `run-lot-pane` mod |
| `docs/metrics/quality-report-YYYY-MM-DD.{md,json}` file names and the JSON's first-level keys; evidence statuses `measured` / `not_configured` / `skipped` / `missing` | `scripts/quality-report-check.py`, `scripts/report-assemble.py` (refuses any other first-level key), the whole report history and any viewer built on it |
| Trailer `Kit-Batch: <plan folder>/FX` closing the batch commit's message | written by `scripts/batch-baseline.py commit`; read by `scripts/knowledge-scan.py` (`git log --format=%(trailers:key=Kit-Batch)`), which skips the commit as covered |
| Provisional ids `<PREFIX>-CU-?n`, `<PREFIX>-RM-?n`, `<PREFIX>-D-?n`, `ADR-?n` in the drafts under `<knowledge.root>/.sync/`, their file names included | written by `agents/knowledge-extractor.md`; numbered by `scripts/knowledge-write.py apply`; refused in a merge draft by `scripts/knowledge-merge.py stage` (`PROVISIONAL`); accepted by the `knowledge-pane` mod (`ID_PATTERN`) |
| `## EXTRACTED — <Context>` and its lines `Mode:`, `Status:`, `ADR:`, `Removed:`, `Retire:`, `Overview:`; `### Conflicts` (columns `Object` / `Sheet` / `Code` / `Evidence`), `### Not covered`; the value `none`; `## BLOCKED` | `knowledge-extractor` report, read by `/knowledge-sync` |
| `knowledge-write` output `refused: `, `dangling: `, `nothing staged`, `WARN … OVERVIEW.md`, `WARN <id> in <file>, applied by …`; `knowledge-scan` summary `— OVER BUDGET`, `— no agent needed`, `rename: `, `retire: `, `no context: ` | `/knowledge-sync`, `/knowledge-merge` |
| Merge staging `<knowledge.root>/.merge/<CODE>/`: `.drafts/<Context>/<id>-<slug>.md` (a use case or an ADR whole), `<id>.md` (a rule or a decision alone), `OVERVIEW.md`; `.feature` holding `<CODE>` or `<CODE> partial`, `.packet.json` | written by `scripts/knowledge-merge.py` and `agents/knowledge-merger.md`; read by `knowledge-merge stage`, `knowledge-write status\|apply --merge` (`.feature` = the `HISTORY.md` feature label); `tools/doctor` lists the folder names under `.merge/`, dot names left out, as staged and not written; the `knowledge-pane` mod reads `.feature` (` partial$` = a partial merge), the `objects` of `.packet.json` (`id`, `kind`, `change` `new`\|`modified`\|`retired`, `context`, `title`, `status` `todo`), the drafts and the whole files `stage` lays under `<CODE>/<Context>/` (present = staged) |
| Derived index `<knowledge.root>/.index/knowledge.jsonl`, one JSON object per line: `id`, `kind` (`CU`\|`RM`\|`D`\|`ADR`), `context`, `title`, `text`, `status` (`specified`\|`observed`), `level`, `path` (repo-relative), `line`, `end`, `cites`, `usecases`, `handlers`, `cited_by`, `contexts`; `.index/files.json` `files.<path>.stamp` = `[mtime_ns, size]` | written by `lib/knowledge_index.py`; read by `scripts/ask.py` and the `knowledge-pane` mod (the stamps tell it the index is behind) |
| Base layout under `knowledge.root`: `<Context>/usecases/<id>-<slug>.md`, `<Context>/rules.md`, `<Context>/decisions.md`, `<Context>/OVERVIEW.md`, `<Context>/HISTORY.md`, `adr/<id>-<slug>.md`, `INDEX.md` | `lib/knowledge.py` (contexts, `misplaced`, `guarded`), hence `lib/knowledge_index.py`, `scripts/ask.py`, `scripts/knowledge-write.py`, `scripts/knowledge-merge.py`; `lib/bounds-common.sh` `bounds_knowledge_guarded` (basenames `rules.md`, `decisions.md`, `HISTORY.md`), hence `hooks/read-bounds.sh`, `lib/guard-cat-bounds.sh`; the `knowledge-pane` mod (`rules.md` = a shared rule) |
| Sync staging `<knowledge.root>/.sync/<Context>/…`, laid out as the base | written by `agents/knowledge-extractor.md`; read by `cctoolkit knowledge-write`; listed by the `knowledge-pane` mod |
| `cctoolkit ask --id <id>[,<id>]` and `cctoolkit ask --handler <Name>` typed in a Bash command (`--id=` alike) | read by the `knowledge-pane` mod, which shows the object asked for |
| `knowledge-merge` output `nothing to merge: `, `refused: `, `collision: … — next free <id>: <command>`, `left: `, `merged already: `, `write: `, `cite: `, `retire: `, `dead: `, `drafted: `, `read: `, `ask: `, `overview: `, `sheets: `, `+<n> −<n> <file>`, `staged: `, `WARN `, `renumbered: ` | `knowledge-merger`, `/knowledge-merge`, `run-plan` (`Merge` phase) |
| `## MERGE STAGED — <CODE>` and its lines `Staged:`, `Files:`, `Warnings:`, `Overview:`; the value `none`; `## BLOCKED` | `knowledge-merger` report, read by `/knowledge-merge`, `run-plan` (`Merge` phase) |
| Knowledge-base ids `<PREFIX>-CU-nn`, `<PREFIX>-RM-nnn`, `<PREFIX>-D-nnn`, `ADR-nnn` — prefix from `knowledge.contexts` — read whole wherever they stand in `knowledge.root` and `todo/`, a retired one (`-CAT-RM-007` in a `HISTORY.md`) included; formats in `skills/knowledge-sync/references/knowledge-format.md` | `scripts/next-id.py`, `lib/knowledge.py` |
| `cctoolkit ask` output: last line `shown N of M`, its tail `— budget reached`; a card `- <id> — <title> · <kind>[ · <use cases>][ · observed <level>]`, then its first line and `path:line`; an object whole under its `path:line`, then `applies to:`, `handlers:`, `cited by:`; `<id>: retired — `, `<id>: not in the base`, `no use case lists ` | `/ask`, any skill or agent reading the base |
| `knowledge-index --check` output `INDEX.md stale` (the pre-commit hook of `scripts/install-git-hooks.sh` prints it as is) | `tools/doctor` (`case "INDEX.md stale"*`) |
| `DEAD REFERENCE`, `UNBOUND TEST` — report labels | emitted by `scripts/rules-coverage.py`, cited by `scripts/untagged-tests.py`, `scripts/pre-audit.sh` and `skills/implement-tdd/references/closing.md` |

### French aliases — parsers read both vocabularies

A repo that started in French keeps its deliverables as they are: specs, plans and sheets with French headings and no anchors, and the history of run reports and verdicts written before the kit spoke English, are never converted. So every parser of a literal above accepts the French form beside the English one, through an alias table (never an English-only `startswith`), and writes the vocabulary of the repo: the English form, or the French one when the document it amends already uses it. Both forms are recognised in the same document.

| English | French alias |
|---|---|
| `REPORT.md`, `TO-VALIDATE.md` (older `run/<stamp>/` folders), `run/batches/FX.md` | `RAPPORT.md`, `A-VALIDER.md`, `run/lots/FX.md` (moved to `run/batches/` by `cctoolkit run-work purge`) |
| `## STATUS — DONE\|BLOCKED\|GAPS`, `Verdict:`, `Reason:`, `## To validate` | `## STATUT — TERMINÉ\|BLOQUÉ\|ECARTS`, `Verdict :`, `Raison :`, `## À valider` |
| `Verdict:` values `VALID`, `GAPS`, `GAPS carried`, `to redo`, `none` | `VALIDE`, `ECARTS`, `ECARTS reportés`, `à refaire`, `aucun` |
| `user decision to validate`, `user decision` | `décision user à valider`, `décision utilisateur` |
| GAPS column `Closure` | `Fermeture` |
| `## Verdict — VALID\|GAPS`; severities `Blocking`/`Major`/`Minor`; axes `Correctness`/`Reuse`/`Simplification`/`Cost`/`Placement`/`Comments`/`Test`/`Plan`/`Scope`; class `Worsened` | `## Verdict — VALIDE\|ECARTS`; `Bloquant`/`Majeur`/`Mineur`; `Correction`/`Réutilisation`/`Simplification`/`Coût`/`Placement`/`Commentaires`/`Test`/`Plan`/`Périmètre`; `Aggravé` |
| `## RED`, `## GREEN`, `## BLOCKED` | `## RED`, `## GREEN`, `## BLOQUÉ` |
| `## RED` fields `Tests`, `Command`, `Production diff`, `Expected failure`, `Case covered`; `## GREEN` fields `Production`, `Command`, `Tests diff`, `Cost`, `Deleted at REFACTOR`, `Reported without fixing`; `exit N` on the `Command` line; the `Cost` line's `Infrastructure in loop or in-memory filter: none` | `Tests`, `Commande`, `Diff production`, `Échec attendu`, `Cas couvert`; `Production`, `Commande`, `Diff tests`, `Coût`, `Supprimé au REFACTOR`, `Signalé sans correction`; `exit N`; `Infrastructure en boucle ou filtre mémoire : aucun` |
| `## Review — GAPS\|CLEAR` | `## Relecture — ECARTS\|RAS` |
| `→ Batch FX complete — manual validation required` | `→ Lot FX terminé — validation manuelle requise` |
| `### Batch execution`, columns `Batch` / `Depends on` / `Repo`, `### Batch FX — … — ✅ DONE` | `### Execution des lots`, `Lot` / `Depend de` / `Dépôt`, `### Lot FX — … — ✅ DONE` |
| `## Assumptions`, `## Decisions`, `## Cycles`, `Correction Cn`, `TDD: …` | `## Hypotheses`, `## Decisions`, `## Cycles`, `Correction Cn`, `TDD : …` |
| handler sheet without anchors: headings `## Business rules`, `## Flow`, `## Emitted events`; rules table columns `ID` / `Rule` / `Exception / Outcome` (or `Result`); empty section `None (…)` | `## Règles métier`, `## Flux`, `## Événements émis`; `ID` / `Règle` / `Exception / Résultat`; `Aucun (…)` — compared exactly after folding case and accents (`REGLES METIER` matches), a title with a suffix is not recognised |
| spec section anchored `<!-- kit:open-questions -->`, severity values `Blocking`/`Major` | spec without anchors: heading `## 12. Questions ouvertes`, column `Sévérité`, values `Bloquant`/`Majeur` |
| anchors `<!-- kit:applied-rules -->`, `<!-- kit:na-rules -->`; output lines `not cited : `, `unknown references : `, `(none)`, `DEAD REFERENCE`, `UNBOUND TEST` | sheet row `\| Règles appliquées \|`, global plan line `**Regles non applicables**`; `non cités : `, `références inconnues : `, `(aucun)` / `(aucune)`, `RÉFÉRENCE MORTE`, `TEST NON RATTACHÉ` |

The aliases are read, never produced by the kit's own templates and agents. A parser added later registers its French forms in the same change.

Identifier prefixes are language-neutral and stay as they are: `RM-xx` (business rule), `RL-xx` (rule local to a handler), `CU-xx` (use case), `D-xx` (business decision) — the three of a spec written without knowledge base —, `Tn` (technical point of a spec), `DDD-nn`, `APP-nn`, `PERF-nn`, and the knowledge base's global ids (`CAT-RM-012`, `ADR-007`).
