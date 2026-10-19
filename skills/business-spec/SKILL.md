---
name: business-spec
description: "Use for a short, testable business spec of a feature once its business decisions are clarified. Reads the knowledge base, writes the feature's delta with global ids. No technical design."
argument-hint: "[feature to specify]"
---

# Business specification (short)

Concise business spec. Real world (users, rules, use cases). Zero implementation (class, aggregate, handler, type, file, pattern, framework). Business expert proofreads it.

$ARGUMENTS

## Approach

1. **Read the base first** when `<knowledge.root>/INDEX.md` exists (`knowledge.root` of `.claude/kit.config.json`, `docs/business` by default). By levels, stop at the one that answers — 3 to 5k tokens whatever the size of the base:
   - `INDEX.md` whole: the context or contexts the feature lands in. Ambiguous → AskUserQuestion.
   - Per context: its `OVERVIEW.md` whole, then `cctoolkit ask --context <C>` — its use cases and rules, one line each.
   - `cctoolkit ask "<subject of the feature>" --context <C>`, then `cctoolkit ask --id <id>[,<id>]` for the objects the feature reuses, changes or retires, whole.
   - A neighbour named under the relations of an `OVERVIEW.md`: its `OVERVIEW.md` only.
   - Code only for what the base leaves open. Never a whole `rules.md`, `decisions.md` or `HISTORY.md`.

   No base → read the sources; explore only code paths lighting vocabulary or existing behaviour. Stop once answered; no broad scan.
2. **Clarify decisions** until shared understanding, **before** writing:
   - One question at a time, branch by branch (answer to Q1 changes Q2).
   - Answer in code → explore, don't ask. Ask only what can't be deduced.
   - Via **AskUserQuestion**: 1 question = 1 decision, **recommended answer as first option** (`(recommended)`, `(recommandé)` in French).
   - Business constraint = decision too: regulation, standard, SLA, contractual commitment, existing behaviour that must survive. Elicit here; lands as business rule carrying its origin, never its own section. Technical, temporal or resource constraint: never settled here — one line of section `kit:technical-points`, for `/plan-implementation`.
   - An object of the base the feature touches is a decision: kept as is (cited by its id), rewritten (`modified`) or retired (`retired`). A rule of the base the feature contradicts without retiring it is a hole.
   - A choice between real alternatives that explains why a rule is so → a business decision, section `kit:decisions`. A plain answer lands in the rule or use case it shaped, nowhere else.
   - Continue until no decision left that would change a use case, business rule, data, states or scope. Settled → spec; unsettled → section `kit:open-questions`.
3. **Challenge the product owner** only when a decision cuts scope, complexity or risk — ≤3 questions via **AskUserQuestion**:
   - Minimal scope: ship less, still validate the need?
   - Alternative: simpler path (configuration, extending existing, convention)?
   - Complexity: worth the business value?
   Skip when obvious from the interview.
4. **Ids**, once, just before writing — the spec is written once, and two calls before it would return the same id. With a base: per context and kind, `cctoolkit next-id <Context> CU --count <n>`, then `RM`, then `D`, n = the new objects of that kind; an object of the base keeps its id. A context absent from `knowledge.contexts` → `next-id` refuses it: AskUserQuestion for its prefix (2 to 5 capitals, recommended first), add it to `knowledge.contexts` of `.claude/kit.config.json`, then take the ids. No base: local ids `CU-01`, `RM-01`, `D-01`, no delta anchor.
5. Write following the structure. Concision before exhaustiveness.
6. Write into `todo/` (not `docs/`): `todo/<code-kebab-case>/SPEC-<code-kebab-case>.md`. One folder per feature: `/plan-implementation` later drops `-PLAN.md` + batch sheets there. Slug = kebab-case of feature code/name. `next-id` reads `todo/`: the ids the spec holds stay taken until the merge writes them into the base.

Document must make later DDD design possible without doing it: every business rule states subject, condition, observable outcome, use case concerned. Aggregate, technical invariant, event, consistency model → `/plan-implementation`.

## Writing rules

The spec is a produced artefact, proofread by a business expert.

- Empty section → delete it (heading included). No `_Not applicable._`.
- Table over prose. No intro paragraph: straight to content.
- Every rule names its origin (regulation, standard, practice, product choice), briefly.
- Authority of a rule: rule owned by external system (identity provider, external catalogue, organisation directory) → spec names the authority and what the product merely consumes. Never replay or restate a rule owned elsewhere — cite it, name its owner.
- Target of a share or transfer: a target organisation is validated by the relationship that authorises it, not by its mere existence. Phrase the business rule in those terms.
- What must not break: an existing behaviour the feature must preserve is stated as a business rule with `Origin` = existing product behaviour, not as a passing remark. Left unnamed, it will not be tested.
- Every `##` heading keeps its `<!-- kit:… -->` anchor; the title before it is written in `language.docs` (`.claude/rules/markdown-output.md`). Numbering stays as in the template.
- **Delta**, with a base: the spec carries what the feature changes in the base, nothing else. Each `###` heading of a use case, a rule or a decision ends with one anchor:
  - `<!-- kit:new -->` — an id just taken with `next-id`;
  - `<!-- kit:modified -->` — the base's id; a rule or a decision stated again whole, a use case only by what changes (a step, a variant, an error, a rule it now applies);
  - `<!-- kit:retired -->` — the base's id and title, one line saying why.

  An object of the base kept as is gets no heading: cited by its id where it applies (`Applies to`, a step, an error). The base states what is true now: never "previously", never a second version beside the first.

## Verbosity budget (produced document)

- Target: few minutes' read, ~1-3 pages. Half of exhaustive spec.
- Use cases: nominal scenario ≤7 steps. Expected outcome only when not obvious from scenario.
- Business rules: statement 1 line. No justification: origin is enough.
- Inline fields: `Applies to`, severity, origin on one line, never exploded into bullets.
- Duplicate = deleted: information lives in exactly one place (use case or business rule or cross-cutting, never all three). What the base already says is cited by its id, never copied.
- Decisions: four lines at most each. Technical points: one line each, no answer.

## Writing style

Short, professional. Table or fragment for context; full sentence for business rule, condition, error, transition. Cut filler, not precision: business terms, thresholds, values, states, expected outcome stay exact. Uncertain rule → `TBD`, never hedging.

## Output structure

```markdown
# [CODE] — [Name]

> 2-3 sentence summary: what, for whom, why.

## 1. Context <!-- kit:context -->
Which problem, for whom, impact if nothing is done. 2-4 sentences.

## 2. Vocabulary <!-- kit:vocabulary -->
| Term | Definition |
Specific or ambiguous terms only. One-line definition.

## 3. Overview <!-- kit:overview -->
One mermaid flowchart (fenced `mermaid` block) of the whole behaviour: entry points, branches of the main decision, derived state, lifecycle states and transitions, consumption. Business labels only, use case and rule ids in parentheses. Delete the section when the feature has neither branch nor lifecycle.

## 4. Use cases <!-- kit:use-cases -->
### <PREFIX>-CU-nn — [Name] <!-- kit:new|modified|retired -->
_Ids: with a base, `<PREFIX>-CU-nn`, `<PREFIX>-RM-nnn`, `<PREFIX>-D-nnn` from `cctoolkit next-id` (or the base's own) and one delta anchor; without, `CU-XX`, `RM-XX`, `D-XX` and none._
**Actor** · **Intent** (1 sentence) · **Frequency**
**Nominal scenario:** numbered steps.
**Variants:** alternative paths. **Errors:** behaviour on failure.
**Expected outcome:** observable final state in business language (what gets checked) — only if not obvious from the scenario.

## 5. Business rules <!-- kit:business-rules -->
### <PREFIX>-RM-nnn — [Short name] <!-- kit:new|modified|retired -->
- **Statement** (testable) · **Origin** · **Severity** (blocking / warning / informational)
- **Applies to**: use cases governed, by id (or `cross-cutting` if global).
- **Compliant / non-compliant example** if not obvious.

## 6. Data <!-- kit:data -->
| Datum | Description | Source | Importance |
Source = entered / computed / imported / catalogue. Importance = essential / secondary / expert. Non-trivial data only.

## 7. States & transitions <!-- kit:states -->
_Only if the entity has a lifecycle._
| State | Event | Next state | Condition |
Business level (e.g. draft → validated → archived). No enum, no technical state machine.

## 8. Cross-cutting behaviours <!-- kit:cross-cutting -->
Only what fits neither in a single CU nor in a single RM: default values, cascade deletion, duplication, catalogue. **If it concerns a single case → put it in the CU/RM, not here.** One subsection per behaviour, only if applicable.

## 9. Relations <!-- kit:relations -->
| Upstream | Downstream |
One line per dependency, in business language.

## 10. Out of scope <!-- kit:out-of-scope -->
| Exclusion | Reason |

## 11. Assumptions <!-- kit:assumptions -->
| # | Assumption | To be validated by |
What you assumed for lack of an answer — distinct from an open question.

## 12. Open questions <!-- kit:open-questions -->
<!-- kit:cols n,severity,question,impact,options -->
| # | Severity | Question | Impact | Options |
Every TBD in the document. Severity `Blocking` or `Major` — values kept verbatim, whatever `language.docs`.

## 13. Decisions <!-- kit:decisions -->
### <PREFIX>-D-nnn — [The choice, in a few words] <!-- kit:new|modified|retired -->
Choice: [what was chosen]
Why: [the reason, one line]
Rejected: [option] ([reason]); [option] ([reason])
Links: [the ids it explains]
Business choices between real alternatives only — the why the base keeps. Same four lines in `decisions.md` of the base.

## 14. Technical points <!-- kit:technical-points -->
<!-- kit:cols n,point,raised-by -->
| # | Point | Raised by |
`T1`, `T2`… One line each, never answered here: `/plan-implementation` settles each in the sheet of the batch it governs. Raised by = the ids it bears on.
```

## Self-validation (mandatory, after writing)

Re-read produced spec. Check and fix directly:

Business purity: zero technical leak (class, type, file, table, framework, pattern, HTTP status). Present → rephrase in business terms.

Internal consistency:
- Zero contradiction between rules, nor use case vs rule. Use case and rule cross-references valid (no orphans).

Base consistency (with a base):
- Every id the spec cites is in the spec or in the base: one `cctoolkit ask --id <id>,<id>…` call for the ids not defined in the spec — `not in the base` is a wrong id, `retired` a dead one.
- Every `modified` or `retired` id is the base's; every `new` one comes from `next-id`; a retired object is cited nowhere else in the spec.
- Every rule of the base the feature contradicts is `modified` or `retired`.

Completeness:
- Use cases cover lifecycle (creation, read, update, deletion/withdrawal as relevant).
- Errors + edge cases where they matter. Non-trivial data listed.
- Every `TBD` in body appears in section `kit:open-questions`.
- Every technical, temporal or resource constraint met in the interview is a line of section `kit:technical-points`.
- Rules, variants, errors readable without inferring a condition from a telegraphic fragment.

Codebase alignment (signal, not veto):
- With a base, the reading of step 1 covers it: code only for what the base left open.
- Without: key business concepts → look for equivalent in `Domain/`, `Application/`. Cite file:line.
- Functional duplicate where capability already exists → flag it.

Deviation → fix spec. Doubt about business intent → ask user.

## Adversarial review (mandatory, after self-validation)

You wrote the spec, so you read what you meant. Delegate one fresh reading: `Agent` with `subagent_type: cctoolkit:adversarial-reviewer`, a `description`, prompt starting `mode: spec <path>`.

- `## Review — CLEAR` → next step.
- `## Review — GAPS` → each row into section `kit:open-questions` with its severity (`Blocking` / `Major`), merged with a row already asking the same thing.
- Then every `Blocking` of section `kit:open-questions`, one at a time, via **AskUserQuestion** (recommended answer first). Answered → write the answer into the body (rule, use case, data, scope) and remove the row. Unanswered stays: `/plan-implementation` refuses to start while one `Blocking` remains.
- `Major` rows stay for the user to settle or for `/plan-implementation` to carry as assumptions.

## Next step

End with: `→ Next step: /plan-implementation`.
