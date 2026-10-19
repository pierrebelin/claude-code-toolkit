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

Hooks, scripts, workflows and mods parse these by exact match: copy them character for character, never translate, compress or reword them. Each one's parser: `docs/FROZEN-LITERALS.md` of the kit (`cctoolkit root`).

- **Anchors** — every `<!-- kit:… -->` of the templates (`kit:rules`, `kit:flow`, `kit:events`, `kit:none`, `kit:applied-rules`, `kit:na-rules`, `kit:open-questions`, `kit:new` / `kit:modified` / `kit:retired`, `kit:handlers`, `kit:observed high|medium|low`, `kit:cols <columns>` above a table…). The title before a heading anchor is prose in `language.docs`; an instruction naming a section by its English template title (`## TDD sequence`) designates the section carrying that heading's anchor. A range `DDD-05 → DDD-08` in an applied or non-applicable list stands for every id between.
- **Headings and markers** — `## Cycles` and its single ```json block; sheet title `# <CODE>-PLAN-FX — <title>`, ` — ✅ DONE (<date>)` once done; `Correction Cn — <finding>`; `Integration test waiver: <reason>`; assumption rows `| H<n> | <text> | <validated by> |`, markers `user decision to validate` / `user decision`; global plan `### Batch execution`, columns `Batch` / `Depends on` / `Repo`, `### Batch FX — <title> — ⬜`; object heading `<id> — <title>` (em dash only, never `–` nor `-`); `### ADR-nnn — …` with its `Consequences` line.
- **Verdicts and reports** — `## Verdict — VALID|GAPS`, severities `Blocking` / `Major` / `Minor`, axes `Correctness` / `Reuse` / `Simplification` / `Cost` / `Placement` / `Comments` / `Test` / `Plan` / `Scope`, GAPS columns `Severity` / `Axis` / `Gap` / `Evidence` / `Closure` / `Expected fix`, contest answers `Accept` / `Counter` / `Refute` / `Escalate`; `## Review — GAPS|CLEAR`; `## RED`, `## GREEN`, `## BLOCKED` and their fields; `## STATUS — DONE|BLOCKED|GAPS`, `Verdict:`, `Reason:`, `## To validate`, `## Audit gaps`; `## EXTRACTED — <Context>`, `## MERGE STAGED — <CODE>` and their lines; `→ Batch FX complete — manual validation required`.
- **Tags and ids** — the rule tag `{HandlerFolder}/{RM|RL-xx}` in its test carrier; knowledge-base ids `<PREFIX>-CU-nn`, `<PREFIX>-RM-nnn`, `<PREFIX>-D-nnn`, `ADR-nnn`, provisional `<PREFIX>-CU-?n` (`~` for `?` in a file name); the trailer `Kit-Batch: <plan folder>/FX`.
- **Files** — `todo/<code>/<CODE>-PLAN.md`, `<CODE>-PLAN-F<n>.md`, `SPEC-<slug>.md`, everything under `<plan folder>/run/`, `docs/metrics/quality-report-YYYY-MM-DD.{md,json}`, the knowledge base's layout and its `INDEX.md`.
- **Tool output** — a `cctoolkit` command's output lines and JSON fields are read as printed: quote them, never paraphrase what another step parses.

Identifier prefixes are language-neutral: `RM-xx` (business rule), `RL-xx` (rule local to a handler), `CU-xx` (use case), `D-xx` (business decision), `Tn` (technical point of a spec), `Hn` (assumption of a batch sheet), `DDD-nn`, `APP-nn`, `PERF-nn`, and the knowledge base's global ids (`CAT-RM-012`, `ADR-007`).

Documents written in French before the kit spoke English (no anchors, French titles and verdicts) are read as they are and never converted; the kit's templates and agents write the English literals.
