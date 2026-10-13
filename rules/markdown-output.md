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
| `<!-- kit:rules -->`, `<!-- kit:flow -->`, `<!-- kit:events -->` ending the three `##` headings; `<!-- kit:cols id,rule,outcome -->` above the rules table (columns read by position, or by the table's header row when the anchor is absent); `<!-- kit:none -->` on an explicitly empty rules section | handler `CLAUDE.md` | `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py` |
| `<!-- kit:applied-rules -->` in the first cell of the `Design` row listing the applied ids; `<!-- kit:na-rules -->` after the global plan's non-applicable label | batch sheet, global plan | `scripts/rules-coverage.py --ids`, then `scripts/pre-audit.sh` |
| `<!-- kit:open-questions -->` heading, `<!-- kit:cols n,severity,question,impact,options -->` above its table; severity values `Blocking`/`Major` stay verbatim | spec | `/plan-implementation` gate (awk on the section) |
| Every other heading anchor of the templates — spec `kit:context` … `kit:assumptions`, global plan `kit:summary` … `kit:cross-cutting`, sheet `kit:intent` … `kit:assumptions` | spec, global plan, batch sheet | the skills and agents locating a section in any language; `scripts/migrate-anchors.py` writes them into older documents |
| `## Cycles` heading and its single ```json block (fields of `skills/implement-tdd/references/design.md`), never translated | batch sheet | `scripts/sheet-cycles.py`, hence `run-lot`, `scripts/pre-audit.sh`, `scripts/audit-capture.sh` |
| Status tokens `✅ DONE`, `Correction Cn` — never translated | batch sheet | `cctoolkit plan-next-batch`, `run-lot` |
| Status tokens `TDD: RED ✅ · GREEN ✅ · COST ✅`, `TDD: GUARD ⬜` / `TDD: GUARD ✅` — sheets older than `## Cycles` only, never translated | batch sheet | `scripts/pre-audit.sh` (sheet without the block) |

An instruction naming a section by its English template title (`## TDD sequence`, `## Assumptions`) designates the section carrying that template heading's anchor, whatever its title.

### Contracts — between agents, hooks and scripts

English, verbatim, whatever `language`.

| Frozen literal | Parsed by |
|---|---|
| The rule tag's value `{HandlerFolder}/{RM\|RL-xx}`, and each carrier of `lib/kit_testtag.py`: xUnit `[Trait("RM", "…")]`, pytest `@pytest.mark.rm("…")`, JUnit `@Tag("RM:…")`, Jest `[RM …]` in a title | `lib/kit_testtag.py`, read by `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`, `scripts/untagged-tests.py`, `scripts/pre-audit.sh` |
| `## Verdict — VALID`, `## Verdict — GAPS`, severities `Blocking`/`Major`/`Minor`, axes `Correctness`/`Reuse`/`Simplification`/`Cost`/`Placement`/`Comments`/`Test`/`Plan`/`Scope` | `/verify-ddd-tdd` verdict format, `scripts/learn-candidates.py` |
| `## RED`, `## GREEN`, `## BLOCKED` and their fields | `tdd-test-author` / `tdd-implementer` reports, `run-lot`, `hooks/subagent-report-shape.sh` |
| `→ Batch FX complete — manual validation required` — the closing line | `hooks/implement-tdd-guard.sh` |
| Output lines `not cited : `, `unknown references : `, `(none)` | `scripts/rules-coverage.py --ids`, then `scripts/pre-audit.sh` |
| `## Review — GAPS`, `## Review — CLEAR` | `adversarial-reviewer` output, read by the three callers |
| `### Batch execution`, columns `Batch` / `Depends on` / `Repo`, `### Batch FX — … — ✅ DONE` | `cctoolkit plan-next-batch` |
| `## STATUS — DONE\|BLOCKED\|GAPS` first line, `Verdict:` (`VALID`, `GAPS`, `GAPS carried`, `to redo`, `none`), `Reason:`, `## To validate` of `run/batches/FX.md`; `Workflow run-lot, batch FX.` first line of every run-lot prompt | `run-plan` gate, `run-lot-pane` mod |
| Run files: `run/<YYYY-MM-DD-HHMM>.md` (sections `## To validate`, `## Minor`, `## Final check`, `## Journal`), `run/<YYYY-MM-DD-HHMM>-aside-FX.patch`, `run/batches/FX.md`, scratch folder `run/.work/` (`.work/FX/cycles.jsonl` once the batch is done); markers `user decision to validate` (taken without the user) and `user decision` (made by the user) | `run-plan`, `cctoolkit plan-next-batch --context`, `cctoolkit run-question`, `run-lot-pane` mod |
| `docs/metrics/quality-report-YYYY-MM-DD.{md,json}` file names and the JSON's first-level keys | `scripts/quality-report-check.py`, the whole report history and any viewer built on it |
| `DEAD REFERENCE`, `UNBOUND TEST` — report labels | emitted by `scripts/rules-coverage.py`, cited by `scripts/untagged-tests.py`, `scripts/pre-audit.sh` and `skills/implement-tdd/references/closing.md` |

### French aliases — parsers read both vocabularies

A repo that started in French keeps its deliverables as they are: specs, plans and sheets with French headings and no anchors, and the history of run reports and verdicts written before the kit spoke English, are never converted. So every parser of a literal above accepts the French form beside the English one, through an alias table (never an English-only `startswith`), and writes the vocabulary of the repo: the English form, or the French one when the document it amends already uses it. Both forms are recognised in the same document.

| English | French alias |
|---|---|
| `REPORT.md`, `TO-VALIDATE.md` (older `run/<stamp>/` folders), `run/.work/`, `run/batches/FX.md` | `RAPPORT.md`, `A-VALIDER.md`, `run/.travail/`, `run/lots/FX.md` |
| `## STATUS — DONE\|BLOCKED\|GAPS`, `Verdict:`, `Reason:`, `## To validate` | `## STATUT — TERMINÉ\|BLOQUÉ\|ECARTS`, `Verdict :`, `Raison :`, `## À valider` |
| `Verdict:` values `VALID`, `GAPS`, `GAPS carried`, `to redo`, `none` | `VALIDE`, `ECARTS`, `ECARTS reportés`, `à refaire`, `aucun` |
| `user decision to validate`, `user decision` | `décision user à valider`, `décision utilisateur` |
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

Identifier prefixes are language-neutral and stay as they are: `RM-xx` (business rule), `RL-xx` (rule local to a handler), `CU-xx` (use case), `DDD-nn`, `APP-nn`, `PERF-nn`.
