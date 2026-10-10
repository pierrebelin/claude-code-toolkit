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

The title is prose in `language.docs`; the anchor is the literal. A parser matches the anchor, never the title.

| Anchor | Where | Parsed by |
|---|---|---|
| `<!-- kit:rules -->`, `<!-- kit:flow -->`, `<!-- kit:events -->` ending the three `##` headings; `<!-- kit:cols id,rule,outcome -->` above the rules table (columns read by position); `<!-- kit:none -->` on an explicitly empty rules section | handler `CLAUDE.md` | `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`, `scripts/migrate-rm-traits.py` |
| `<!-- kit:applied-rules -->` in the first cell of the `Design` row listing the applied ids; `<!-- kit:na-rules -->` after the global plan's non-applicable label | batch sheet, global plan | `scripts/rules-coverage.py --ids`, then `scripts/pre-audit.sh` |
| `<!-- kit:open-questions -->` heading, `<!-- kit:cols n,severity,question,impact,options -->` above its table; severity values `Blocking`/`Major` stay verbatim | spec | `/plan-implementation` gate (awk on the section) |
| Every other heading anchor of the templates — spec `kit:context` … `kit:assumptions`, global plan `kit:summary` … `kit:cross-cutting`, sheet `kit:intent` … `kit:assumptions` | spec, global plan, batch sheet | the skills and agents locating a section in any language; `scripts/migrate-anchors.py` writes them into older documents |
| Status tokens `TDD: RED ✅ · GREEN ✅ · COST ✅`, `✅ DONE`, `Correction Cn` — never translated | batch sheet | the first one by `scripts/pre-audit.sh` |

An instruction naming a section by its English template title (`## TDD sequence`, `## Assumptions`) designates the section carrying that template heading's anchor, whatever its title.

### Contracts — between agents, hooks and scripts

English, verbatim, whatever `language`.

| Frozen literal | Parsed by |
|---|---|
| The rule tag's value `{HandlerFolder}/{RM\|RL-xx}`, and each carrier of `lib/kit_testtag.py`: xUnit `[Trait("RM", "…")]`, pytest `@pytest.mark.rm("…")`, JUnit `@Tag("RM:…")`, Jest `[RM …]` in a title | `lib/kit_testtag.py`, read by `hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`, `scripts/untagged-tests.py`, `scripts/migrate-rm-traits.py`, `scripts/pre-audit.sh` |
| `## Verdict — VALID`, `## Verdict — GAPS`, severities `Blocking`/`Major`/`Minor`, axes `Correctness`/`Reuse`/`Simplification`/`Cost`/`Placement`/`Comments`/`Test`/`Plan`/`Scope` | `/verify-ddd-tdd` verdict format, `scripts/learn-candidates.py` |
| `## RED`, `## GREEN`, `## BLOCKED` and their fields | `/implement-tdd` orchestrator |
| `→ Batch FX complete — manual validation required` — the closing line | `hooks/implement-tdd-guard.sh` |
| Output lines `not cited : `, `unknown references : `, `(none)` | `scripts/rules-coverage.py --ids`, then `scripts/pre-audit.sh` |
| `## Review — GAPS`, `## Review — CLEAR` | `adversarial-reviewer` output, read by the three callers |
| `docs/metrics/quality-report-YYYY-MM-DD.{md,json}` file names and the JSON's first-level keys | `scripts/quality-report-check.py`, the whole report history and any viewer built on it |
| `DEAD REFERENCE`, `UNBOUND TEST` — report labels | emitted by `scripts/rules-coverage.py`, cited by `scripts/untagged-tests.py`, `scripts/migrate-rm-traits.py`, `scripts/pre-audit.sh` and `skills/implement-tdd/references/closing.md` |

Identifier prefixes are language-neutral and stay as they are: `RM-xx` (business rule), `RL-xx` (rule local to a handler), `CU-xx` (use case), `DDD-nn`, `APP-nn`, `PERF-nn`.
