---
name: business-spec
description: "Use when a short, readable and testable business spec of a feature is wanted, after the business decisions have been clarified. No design and no technical implementation."
argument-hint: "[feature to specify]"
---

# Business specification (short)

A **concise** business spec. Real world (users, rules, use cases). **Zero implementation** (class, aggregate, handler, type, file, pattern, framework). A business expert proofreads it.

$ARGUMENTS

## Approach

1. Read the sources and explore only the code paths that shed light on the vocabulary or an existing behaviour. Stop as soon as the question is answered; no broad scan.
2. **Clarify the decisions** until shared understanding, **before** writing:
   - **One decision at a time.** Walk the tree branch by branch, resolve dependencies one by one — no grouping (the answer to Q1 changes Q2).
   - **The answer is in the code → explore, do not ask.** Ask only about what cannot be deduced.
   - Through **AskUserQuestion**: 1 question = 1 decision, **recommended answer as the first option** (`(recommended)`).
   - Continue until no decision remains that would change a use case, a business rule, the data, the states or the scope. Settled choices → into the spec; unsettled → section 11.
3. **Challenge the product owner** only when a decision can reduce scope, complexity or risk — at most 3 questions through **AskUserQuestion**:
   - Minimal scope: can we ship less and still validate the need?
   - Alternative: is there a simpler path (configuration, extending something existing, a convention)?
   - Complexity: is the added complexity worth the business value?
   Skip it when the answers are obvious from the interview.
4. Write following the structure. Concision before exhaustiveness.
5. **Always write the document into `todo/` (never `docs/`)**: `todo/<code-kebab-case>/SPEC-<code-kebab-case>.md`. One folder per feature: `/plan-implementation` will later drop `-PLAN.md` and its batch sheets there. The slug is the kebab-case of the feature's code/name.

The document must make later DDD design possible without doing it: every business rule clearly states subject, condition, observable outcome and the use case concerned. Choosing the aggregate, the technical invariant, the event or the consistency model belongs to `/plan-implementation`.

## Writing rules

The spec is a produced artefact, proofread by a business expert.

- One sentence when one suffices. Zero repetition.
- **Empty section → delete it** (heading included). No `_Not applicable._`.
- Table over prose. No introductory paragraph: straight to the content.
- Every rule names its origin (regulation, standard, practice, product choice), briefly.
- **Authority of a rule**: when the rule is owned by an external system (product/key service, delegation between organisations, organisation catalogue), the spec says **who the authority is** and what the product merely consumes. Do not replay or restate a rule owned elsewhere — cite it and name its owner.
- **Target of a share, transfer or delegation**: a target organisation is validated by an **existing delegation**, never by its mere existence. Phrase the business rule in those terms.
- Unsettled → `TBD`, listed in section 11.

## Verbosity budget (produced document)

- **Target**: a few minutes' read, ~1-3 pages. Half of an exhaustive spec.
- **Use cases**: the nominal scenario ≤7 steps. **Expected outcome** only when not obvious from the scenario.
- **Business rules**: the statement is 1 line. No justification: the origin is enough.
- **Inline fields**: `Applies to`, severity, origin on one line, not exploded into bullets.
- **Duplicate = deleted**: a piece of information lives in exactly one place (use case **or** business rule **or** cross-cutting, never all three).

## Writing style

Write short and professional. Table or fragment for context; a full sentence for a business rule, a condition, an error or a transition. Cut the filler, not the precision: business terms, thresholds, values, states and expected outcome stay exact. Uncertain rule → `TBD`, never hedging.

## Output structure

```markdown
# [CODE] — [Name]

> 2-3 sentence summary: what, for whom, why.

## 1. Context
Which problem, for whom, impact if nothing is done. 2-4 sentences.

## 2. Vocabulary
| Term | Definition |
Specific or ambiguous terms only. One-line definition.

## 3. Use cases
### CU-XX — [Name]
**Actor** · **Intent** (1 sentence) · **Frequency**
**Nominal scenario:** numbered steps.
**Variants:** alternative paths. **Errors:** behaviour on failure.
**Expected outcome:** observable final state in business language (what gets checked) — only if not obvious from the scenario.

## 4. Business rules
### RM-XX — [Short name]
- **Statement** (testable) · **Origin** · **Severity** (blocking / warning / informational)
- **Applies to**: CU-XX governed (or `cross-cutting` if global).
- **Compliant / non-compliant example** if not obvious.

## 5. Data
| Datum | Description | Source | Importance |
Source = entered / computed / imported / catalogue. Importance = essential / secondary / expert. Non-trivial data only.

## 6. States & transitions
_Only if the entity has a lifecycle._
| State | Event | Next state | Condition |
Business level (e.g. draft → validated → archived). No enum, no technical state machine.

## 7. Cross-cutting behaviours
Only what fits neither in a single CU nor in a single RM: default values, cascade deletion, duplication, catalogue. **If it concerns a single case → put it in the CU/RM, not here.** One subsection per behaviour, only if applicable.

## 8. Relations
| Upstream | Downstream |
One line per dependency, in business language.

## 9. Out of scope
| Exclusion | Reason |

## 10. Assumptions
| # | Assumption | To be validated by |
What you assumed for lack of an answer — distinct from an open question.

## 11. Open questions
| # | Question | Impact | Options |
Every TBD in the document.
```

## Self-validation (mandatory, after writing)

Re-read the produced spec. Check and fix directly:

**Business purity**: zero technical leak (class, type, file, table, framework, pattern, HTTP status). Present → rephrase in business terms. Readable by a non-developer expert.

**Internal consistency**:
- Every use case: actor + intent + nominal scenario. Every business rule: testable (yes/no) + origin + severity.
- Zero contradiction between rules, nor between use case and rule. `RM-XX`/`CU-XX` cross-references valid (no orphans).
- Vocabulary: every specific term defined, no dead definition.

**Completeness**:
- Use cases cover the lifecycle (creation, read, update, deletion/withdrawal as relevant).
- Errors + edge cases where they matter. Non-trivial data listed.
- Every `TBD` in the body appears in section 11.
- Every business rule carries enough precision to decide its DDD owner later, without naming that technical owner.
- Rules, variants and errors stay readable without inferring a condition from a telegraphic fragment.

**Codebase alignment** (a signal, not a veto):
- Key business concepts → look for an equivalent in `Domain/`, `Application/`. Cite file:line.
- Functional duplicate where the capability already exists → flag it.
- Every rule owned by an external system names its authority; no external rule rewritten as a rule of the product.

Deviation → fix the spec. Doubt about business intent → ask the user.

## Next step

End with: `→ Next step: /plan-implementation`.
