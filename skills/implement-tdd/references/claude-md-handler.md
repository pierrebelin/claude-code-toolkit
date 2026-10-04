# Format of the Application `CLAUDE.md` files

Two levels, never mixed:

- **Handler folder** (`Application/{Context}/{Feature}/{Action}{Entity}/CLAUDE.md`): the use case's detailed business rules.
- **Feature folder** (`Application/{Context}/{Feature}/CLAUDE.md`): two or three sentences — the bounded context — and, when a `DESIGN.md` exists beside it, one line naming its sections. **Nothing else**: no use-case table, no counters, no chapter body. `ls` lists the handlers, `graphify explain` finds them, and the file is auto-loaded by every `Read` under the folder, agents included.
- **Feature design** (`Application/{Context}/{Feature}/DESIGN.md`): cross-cutting chapters (lifecycle, group scope, external contracts). Never auto-loaded; a delegation contract names the section to read, bounded.

**Documentary tone** — these files are a produced artefact, read by the team. Name the exact types (`ProductItemEntity`, `QueryLimits.MAX_UNPAGINATED_RESULTS`): this is developer documentation, not a business spec.

The three `##` headings are found by their anchor (`<!-- kit:rules -->`, `<!-- kit:flow -->`, `<!-- kit:events -->`) by `hooks/handler-claude-md-check.sh` and `scripts/rules-coverage.py`. The title is prose in `language.docs`; the anchor never moves.

---

## Handler sheet

Template, closed list of sections, `RM-xx` / `RL-xx` numbering, trait link and cost line → `.claude/rules/application-cqrs.md` § "Fixed shape of a handler `CLAUDE.md`" (single source, copied verbatim). Additions:

- **The red test written during the TDD phase carries its trait from the start.**
- _Pure query with no rule_: write "None (pure query) <!-- kit:none -->" under `kit:rules` — the anchor tells the parsers the section is empty on purpose — and state the partitioning applied (e.g. scope restricted to the current organisation through `IUserContextWrapper`). No event → "None (query)" under `kit:events`.
- No ad-hoc section titled after some specific point (`## The value never leaves`, `## The resolver's nine checks`): neither rule, flow nor event → `docs/` or the plan.
- Deliberately unbounded read (`Include` of a growing collection) → the cost line says so and why.

**Current state only — never history.** A sheet describes what the handler does today, as if written in one go. A structural change **rewrites** the affected section; it doesn't append a new one.

Never write:

- a date or a batch number — `(2026-08-11)`, `(batch F4)`. A rule's wording names the rule, nothing else. A spec reference (`RM-17`, `CU-05`) is kept: stable, a date isn't.
- a journal section: "Audit fixes", "Accepted gaps", "Gap resolutions", "Changes", "History", "What changed".
- a change narrative: "used to throw… now", "the old signature", "instead of", "was removed", "since 2026-08-24". Final state in the present tense is enough.

The *why* of a decision is kept while it stays true ("an unreachable `404` would mislead client generation"); the story of how it was reached is not — that belongs to the plans (`PLAN-*.md`, `todo/`) and Git history. A handler sheet is reloaded in full on every `Read` of the folder: stacked dated sections are paid every session, for text that no longer describes the code.

---

## Feature index

```markdown
# [Feature]

[2-3 sentences: scope of the bounded context, entities involved.]

Cross-cutting design: `DESIGN.md` — sections: [Title A]; [Title B].
```

The pointer line exists only when a `DESIGN.md` exists. Handlers are found by `ls` and `graphify explain`, never by a hand-maintained table.

---

## Updating

| Event | Action |
|---|---|
| Business rule added/modified/removed | Handler sheet: rules table. A removed rule **disappears**, it doesn't become a history note |
| Flow or access cost changed | Handler sheet: flow + cost line |
| New event, changed payload | Handler sheet: emitted events |
| New handler | Create the sheet |
| Handler intent changed | Handler sheet |
| Structural decision (security, persistence, contract) | **Rewrite** the affected `DESIGN.md` section in the present tense, no date, no batch number |

Real examples: `src/{{PRODUCT}}.Application/Studio/ModuleDiagrams/CLAUDE.md` (index), `ModuleDiagrams/DESIGN.md` (chapters) and
`Catalog/Products/GetProduct/CLAUDE.md` (sheet).
