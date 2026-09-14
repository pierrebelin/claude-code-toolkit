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
| `## Règles métier`, `## Flux`, `## Événements émis` | `.claude/hooks/handler-claude-md-check.sh`, `scripts/rules-coverage.py` |
| Columns `ID` / `Règle` / `Exception / Résultat` | same |
| `[Trait("RM", "{HandlerFolder}/{RM\|RL-xx}")]` on the tests | same, plus `scripts/untagged-tests.py` and `scripts/migrate-rm-traits.py` |
| `## Verdict — VALID`, `## Verdict — GAPS`, severities `Blocking`/`Major`/`Minor`, axes `Correctness`/`Reuse`/`Simplification`/`Cost`/`Placement`/`Comments`/`Test`/`Plan`/`Scope` | `/verify-ddd-tdd` verdict format |
| `## RED`, `## GREEN`, `## BLOCKED` and their fields | `/implement-tdd` orchestrator |
| `TDD: RED ✅ · GREEN ✅ · COST ✅`, `✅ DONE`, `## Assumptions`, `Correction Cn` | batch sheets |
| `DEAD REFERENCE`, `UNBOUND TEST` — report labels | `scripts/rules-coverage.py`, cited by `scripts/untagged-tests.py` |
| `docs/metrics/quality-report-YYYY-MM-DD.{md,json}` file names | quality-report history |

Identifier prefixes are language-neutral and stay as they are: `RM-xx`, `RL-xx`, `CU-xx`,
`DDD-nn`, `APP-nn`, `PERF-nn`.

**Accents in the handler sections are load-bearing.** `handler-claude-md-check.sh` compares
section names with `s not in ALLOWED` — exact strings, no accent folding — and
`scripts/rules-coverage.py` uses `line.startswith("## Règles métier")`. `## Evenements emis` is
rejected as both a forbidden and a missing section.
