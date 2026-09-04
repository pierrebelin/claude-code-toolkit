# Format of the Application `CLAUDE.md` files

Two levels, never mixed:

- **Handler folder** (`Application/{Context}/{Feature}/{Action}{Entity}/CLAUDE.md`): the use case's detailed business rules.
- **Feature folder** (`Application/{Context}/{Feature}/CLAUDE.md`): an index. One-line intent per use case, cross-cutting concepts, lifecycle. **No detailed business rule.**

**Documentary tone** — these files are a produced artefact, read by the team. Name the exact types (`AuditTrailEntity`, `QueryLimits.MAX_UNPAGINATED_RESULTS`): this is developer documentation, not a business spec.

The three `##` headings are parsed verbatim by `.claude/hooks/handler-claude-md-check.sh` and by `scripts/rules-coverage.py`. Never reword them.

---

## Handler sheet

````markdown
# [Action][Entity]

[Intent in one sentence: what the use case does, for whom, over what scope.]

## Règles métier

| ID | Règle | Exception / Résultat |
|----|-------|----------------------|
| RM-01 | [testable statement] | `[Exception]` → [HTTP status] |

## Flux

```
[Step 1] → [Step 2] → [Step 3]
```

[1 read + 1 write, whatever the number of X.]

## Événements émis

`[Event]` — payload: [fields]. / None (query).
````

`RM-xx` = a rule shared by several handlers of the same aggregate. Numbering is **per aggregate**: `RM-02` means nothing outside the aggregate it belongs to. Before assigning a number, read the `CLAUDE.md` of the neighbouring handlers in the same feature and reuse the one the rule already carries there; never renumber an existing rule. `RL-xx` = a rule local to the handler, numbered per file.

The rule ↔ test link lives **on the test**, as `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]` — no column to fill. A rule carried by no trait is uncovered, knowingly. **The red test written during the TDD phase carries its trait from the start.**

_Pure query with no rule_: write "None (pure query)" and state the partitioning applied (e.g. scope restricted to the current organisation through `IUserContextWrapper`).

**Closed list: those three `##` sections, in that order, and no other.** No `## Decisions`, no `## Rationale`, no ad-hoc section titled after some specific point (`## The value never leaves`, `## The resolver's nine checks`). Whatever is neither a rule, nor the flow, nor an event goes into `docs/` or into the plan, not into the sheet.

**The cost line under the flow is mandatory.** It is the only durable trace of a decision no test locks down. A deliberately unbounded read (`Include` of a growing collection) → say so and say why.

**Current state only — never history.** A sheet describes what the handler does today, as if written in one go. A structural change **rewrites** the affected section; it does not append a new one.

Never write:

- a date or a batch number — `(2026-08-11)`, `(batch F4)`. A rule's wording names the rule, nothing else. A spec reference (`RM-17`, `RG_TRANSFER_5`) is kept: it is stable, a date is not.
- a journal section: "Audit fixes", "Accepted gaps", "Gap resolutions", "Changes", "History", "What changed".
- a change narrative: "used to throw… now", "the old signature", "instead of", "was removed", "since 2026-08-24". Stating the final state in the present tense is enough.

The *why* of a decision is kept while it stays true ("an unreachable `404` would mislead client generation"); the story of how it was reached is not. That story already has two owners: the plans (`PLAN-*.md`, `todo/`) and the Git history.

**Why this constraint.** A handler sheet is reloaded in full every time a file of the folder is read. Stacking dated sections grows, without limit, content paid for on every session, for text that no longer describes the code.

---

## Feature index

```markdown
# [Feature]

[2-3 sentences: scope of the bounded context, entities involved.]

## [Cross-cutting concept]

[Enum, lifecycle, invariant shared by several use cases.]

## Commands

| Use case | Intent | Business rules |
|----------|--------|----------------|
| [Create[Entity]]([Create[Entity]]/CLAUDE.md) | [one line] | [N rules, M tested] |

## Queries

| Use case | Intent | Business rules |
|----------|--------|----------------|
| [Get[Entity]s]([Get[Entity]s]/CLAUDE.md) | [one line] | 0 rule |
```

The relative link to the handler sheet is mandatory. A handler missing from the index is a handler nobody can find.

The `Business rules` column is recomputed by: `python3 scripts/rules-coverage.py --fix-index`.

---

## Updating

| Event | Action |
|---|---|
| Business rule added/modified/removed | Handler sheet: rules table. A removed rule **disappears**, it does not become a history note |
| Flow or access cost changed | Handler sheet: flow + cost line |
| New event, changed payload | Handler sheet: emitted events |
| New handler | Create the sheet **and** add the row to the feature index |
| Handler intent changed | Handler sheet + index row |
| Structural decision (security, persistence, contract) | **Rewrite** the affected section in the present tense, with no date and no batch number |

Real examples: `src/{{PRODUCT}}.Application/Catalog/Products/CLAUDE.md` (index) and
`Catalog/Products/GetProduct/CLAUDE.md` (sheet).
