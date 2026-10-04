---
paths:
  - "todo/**/*.md"
  - "docs/**/*.md"
  - ".claude/skills/**/*.md"
  - ".claude/agents/**/*.md"
  - ".claude/rules/**/*.md"
---

# Markdown files — produced vs. instruction

Two families, and one exception that overrides both.

- **Produced files** — specs, plans under `todo/`, handler and feature `CLAUDE.md` under `src/`, `docs/`, quality reports, verdicts, PR comments, user summaries. Deliverables the team proofreads.
- **Instruction files** — `.claude/skills/`, `.claude/agents/`, `.claude/rules/`. Prompts, not deliverables.
- **Overrides both: emitted literals stay verbatim**, in the language their parser expects. An instruction file describing an output quotes it as is — hooks, scripts match by exact string.

Skill template blocks (spec, plan, handler sheet, report structure) = produced text: copied verbatim.

**Set each family's language on installation.** The kit ships English throughout. A repo whose
deliverables are proofread in another language flips the produced family only — never the
instruction family, and never the frozen literals below.

## Frozen literals

| Frozen literal | Parsed by |
|---|---|
| `## Règles métier`, `## Flux`, `## Événements émis` and the columns `ID` / `Règle` / `Exception / Résultat` | `.claude/hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py`, `scripts/migrate-rm-traits.py` |
| `[Trait("RM", "{HandlerFolder}/{RM\|RL-xx}")]` — the attribute name `RM` and the `folder/id` shape of its value | idem, plus `scripts/untagged-tests.py` and `scripts/migrate-rm-traits.py` |
| `## Verdict — VALID`, `## Verdict — GAPS`, severities `Blocking`/`Major`/`Minor`, axes `Correctness`/`Reuse`/`Simplification`/`Cost`/`Placement`/`Comments`/`Test`/`Plan`/`Scope` | `/verify-ddd-tdd` verdict format, `scripts/learn-candidates.py` |
| `## RED`, `## GREEN`, `## BLOCKED` and their fields | `/implement-tdd` orchestrator |
| `TDD: RED ✅ · GREEN ✅ · COST ✅`, `✅ DONE`, `## Assumptions`, `Correction Cn` | batch sheets; the first one also by `scripts/pre-audit.sh` |
| `→ Batch FX complete — manual validation required` — the closing line | `.claude/hooks/implement-tdd-guard.sh` |
| Sheet row `\| Applied rules \|`, global plan line `**Non-applicable rules**`; output lines `not cited : `, `unknown references : `, `(none)` | `scripts/rules-coverage.py --ids`, then `scripts/pre-audit.sh` |
| Spec `## 12. Open questions` column `Severity`, values `Blocking`/`Major` | `/plan-implementation` gate (awk on the section) |
| `## Review — GAPS`, `## Review — CLEAR` | `adversarial-reviewer` output, read by the three callers |
| `docs/metrics/quality-report-YYYY-MM-DD.{md,json}` file names and the JSON's first-level keys | `scripts/quality-report-check.py`, the whole report history and any viewer built on it |
| `DEAD REFERENCE`, `UNBOUND TEST` — report labels | emitted by `scripts/rules-coverage.py`, cited by `scripts/untagged-tests.py`, `scripts/migrate-rm-traits.py`, `scripts/pre-audit.sh` and `.claude/skills/implement-tdd/references/closing.md` |

Identifier prefixes are language-neutral and stay as they are: `RM-xx`, `RL-xx`, `CU-xx`,
`DDD-nn`, `APP-nn`, `PERF-nn`.

**Write the handler sections with their accents.** The parsers fold accents and case —
`handler-claude-md-check.sh` compares `fold(s)`, `scripts/rules-coverage.py` matches
`R[eè]gles? m[eé]tier` — so `## Evenements emis` still passes. The accented form stays the
written one: the parsers tolerate the other, they do not produce it.
