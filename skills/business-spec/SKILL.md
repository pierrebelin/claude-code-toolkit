---
name: business-spec
description: "Use when a short, readable and testable business spec of a feature is wanted, after the business decisions have been clarified. No design and no technical implementation."
argument-hint: "[feature to specify]"
---

# Business specification (short)

**Concise** business spec. Real world (users, rules, use cases). **Zero implementation** (class, aggregate, handler, type, file, pattern, framework). Business expert proofreads it.

$ARGUMENTS

## Approach

1. Read sources; explore only code paths lighting vocabulary or existing behaviour. Stop once answered; no broad scan.
2. **Clarify decisions** until shared understanding, **before** writing:
   - **One at a time.** Branch by branch, dependencies one by one — no grouping (answer to Q1 changes Q2).
   - **Answer in code → explore, don't ask.** Ask only what can't be deduced.
   - Via **AskUserQuestion**: 1 question = 1 decision, **recommended answer as first option** (`(recommended)`).
   - **Business constraint = decision too**: regulation, standard, SLA, contractual commitment, existing behaviour that must survive. Elicit here; lands as business rule carrying its origin, never its own section. Technical, temporal or resource constraint: out of scope, belongs to `/plan-implementation`.
   - Continue until no decision left that would change a use case, business rule, data, states or scope. Settled → spec; unsettled → section 12.
3. **Challenge the product owner** only when a decision cuts scope, complexity or risk — ≤3 questions via **AskUserQuestion**:
   - Minimal scope: ship less, still validate the need?
   - Alternative: simpler path (configuration, extending existing, convention)?
   - Complexity: worth the business value?
   Skip when obvious from the interview.
4. Write following the structure. Concision before exhaustiveness.
5. **Always write into `todo/` (never `docs/`)**: `todo/<code-kebab-case>/SPEC-<code-kebab-case>.md`. One folder per feature: `/plan-implementation` later drops `-PLAN.md` + batch sheets there. Slug = kebab-case of feature code/name.

Document must make later DDD design possible without doing it: every business rule states subject, condition, observable outcome, use case concerned. Aggregate, technical invariant, event, consistency model → `/plan-implementation`.

## Writing rules

The spec is a produced artefact, proofread by a business expert.

- One sentence when one suffices. Zero repetition.
- **Empty section → delete it** (heading included). No `_Not applicable._`.
- Table over prose. No intro paragraph: straight to content.
- Every rule names its origin (regulation, standard, practice, product choice), briefly.
- **Authority of a rule**: rule owned by external system (product/key service, delegation between organisations, organisation catalogue) → spec names **the authority** and what the product merely consumes. Never replay or restate a rule owned elsewhere — cite it, name its owner.
- **Target of a share, transfer or delegation**: a target organisation is validated by an **existing delegation**, never by its mere existence. Phrase the business rule in those terms.
- **What must not break**: an existing behaviour the feature must preserve is stated as a business rule with `Origine` = existing product behaviour, not as a passing remark. Left unnamed, it will not be tested.
- Unsettled → `TBD`, listed in section 12.

## Verbosity budget (produced document)

- **Target**: few minutes' read, ~1-3 pages. Half of exhaustive spec.
- **Use cases**: nominal scenario ≤7 steps. **Expected outcome** only when not obvious from scenario.
- **Business rules**: statement 1 line. No justification: origin is enough.
- **Inline fields**: `Applies to`, severity, origin on one line, never exploded into bullets.
- **Duplicate = deleted**: information lives in exactly one place (use case **or** business rule **or** cross-cutting, never all three).

## Writing style

Short, professional. Table or fragment for context; full sentence for business rule, condition, error, transition. Cut filler, not precision: business terms, thresholds, values, states, expected outcome stay exact. Uncertain rule → `TBD`, never hedging.

## Output structure

```markdown
# [CODE] — [Name]

> 2-3 sentence summary: what, for whom, why.

## 1. Context
Which problem, for whom, impact if nothing is done. 2-4 sentences.

## 2. Vocabulary
| Term | Definition |
Specific or ambiguous terms only. One-line definition.

## 3. Overview
One mermaid flowchart (fenced `mermaid` block) of the whole behaviour: entry points, branches of the main decision, derived state, lifecycle states and transitions, consumption. Business labels only, `RM-XX`/`CU-XX` ids in parentheses. Delete the section when the feature has neither branch nor lifecycle.

## 4. Use cases
### CU-XX — [Name]
**Actor** · **Intent** (1 sentence) · **Frequency**
**Nominal scenario:** numbered steps.
**Variants:** alternative paths. **Errors:** behaviour on failure.
**Expected outcome:** observable final state in business language (what gets checked) — only if not obvious from the scenario.

## 5. Business rules
### RM-XX — [Short name]
- **Statement** (testable) · **Origin** · **Severity** (blocking / warning / informational)
- **Applies to**: CU-XX governed (or `cross-cutting` if global).
- **Compliant / non-compliant example** if not obvious.

## 6. Data
| Datum | Description | Source | Importance |
Source = entered / computed / imported / catalogue. Importance = essential / secondary / expert. Non-trivial data only.

## 7. States & transitions
_Only if the entity has a lifecycle._
| State | Event | Next state | Condition |
Business level (e.g. draft → validated → archived). No enum, no technical state machine.

## 8. Cross-cutting behaviours
Only what fits neither in a single CU nor in a single RM: default values, cascade deletion, duplication, catalogue. **If it concerns a single case → put it in the CU/RM, not here.** One subsection per behaviour, only if applicable.

## 9. Relations
| Upstream | Downstream |
One line per dependency, in business language.

## 10. Out of scope
| Exclusion | Reason |

## 11. Assumptions
| # | Assumption | To be validated by |
What you assumed for lack of an answer — distinct from an open question.

## 12. Open questions
| # | Question | Impact | Options |
Every TBD in the document.
```

## Self-validation (mandatory, after writing)

Re-read produced spec. Check and fix directly:

**Business purity**: zero technical leak (class, type, file, table, framework, pattern, HTTP status). Present → rephrase in business terms. Readable by non-developer expert.

**Internal consistency**:
- Every use case: actor + intent + nominal scenario. Every business rule: testable (yes/no) + origin + severity.
- Zero contradiction between rules, nor use case vs rule. `RM-XX`/`CU-XX` cross-references valid (no orphans).
- Vocabulary: every specific term defined, no dead definition.

**Completeness**:
- Use cases cover lifecycle (creation, read, update, deletion/withdrawal as relevant).
- Errors + edge cases where they matter. Non-trivial data listed.
- Every `TBD` in body appears in section 12.
- Every business rule precise enough to decide its DDD owner later, without naming that owner.
- Rules, variants, errors readable without inferring a condition from a telegraphic fragment.

**Codebase alignment** (signal, not veto):
- Key business concepts → look for equivalent in `Domain/`, `Application/`. Cite file:line.
- Functional duplicate where capability already exists → flag it.
- Every rule owned by external system names its authority; no external rule rewritten as product rule.

Deviation → fix spec. Doubt about business intent → ask user.

## Next step

End with: `→ Next step: /plan-implementation`.
