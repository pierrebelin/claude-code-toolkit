# Knowledge base — formats

The repo's business knowledge, one folder per bounded context under `knowledge.root` of `kit.config.json` (`docs/business` by default). Markdown in git, reviewed in pull requests; the index derived from it is never committed. Worked example: `examples/docs/business/` in the kit.

```
docs/business/
  INDEX.md                          generated: one line per context
  adr/ADR-001-<slug>.md             technical decisions, global
  Catalog/
    OVERVIEW.md                     the context in ~1.5k tokens, rewritten, never appended to
    usecases/CAT-CU-01-<slug>.md    one use case: its own rules, its handlers
    rules.md                        rules applied by several use cases, nothing else
    decisions.md                    business decisions CAT-D-nnn
    HISTORY.md                      one line per merge or sync, newest first
  .index/                           derived by cctoolkit knowledge-index, git-ignored
  .sync/                            drafts of a sync in progress, git-ignored
  .merge/<CODE>/                    drafts of a feature's merge, git-ignored
```

## What a script reads

Ids in headings, `kit:` anchors, code in backticks — nothing else. Labels (`Outcome:`, `Choice:`, `Also applies:`…) are prose: they follow `language.docs` and no script matches them.

- An object is a heading carrying its id: `### CAT-RM-012 — <title>` for a rule or a decision, `# CAT-CU-01 — <title>` for a use case, `# ADR-007 — <title>` for an ADR. Its body runs to the next heading of the same or a higher level.
- Any other id in a body is a citation. A rule cited anywhere in a use case's file applies to it — cited is applied, whatever the sentence around it; the contexts an ADR touches are the prefixes of the ids it cites. No list of links is kept elsewhere.
- Under `## … <!-- kit:handlers -->`, the first code span of each list item is a handler name.
- A line ending with `<!-- kit:observed high|medium|low -->` marks its object `observed`: deduced from the code by `/knowledge-sync`, not yet validated. The line cites its source `path:line`; validation deletes it. Without it an object is `specified`. Its label follows `language.docs`: ``Observed: `src/Catalog/ListCatalogueQueryHandler.cs:31` <!-- kit:observed medium -->``.
- In `OVERVIEW.md`, `<!-- kit:vocabulary -->` ends the vocabulary heading and `<!-- kit:relations -->` the relations heading; a context name in the relations section is a neighbour.
- A parsed table carries `<!-- kit:cols … -->` above it and is read by position.

## Ids

Global from the spec on, taken with `cctoolkit next-id`, never given twice: a retired or abandoned id leaves a gap.

| Object | Id | Lives in |
|---|---|---|
| Use case | `<PREFIX>-CU-nn` | `usecases/<id>-<slug>.md`, the slug in English kebab-case |
| Rule | `<PREFIX>-RM-nnn` | the file of its use case when only that one applies it, `rules.md` when several do — moving keeps the id; `knowledge-write apply` refuses a rule left in a use case's file that several apply |
| Business decision | `<PREFIX>-D-nnn` | `decisions.md` |
| ADR | `ADR-nnn`, no prefix | `adr/<id>-<slug>.md` |

`<PREFIX>` comes from `knowledge.contexts` (`{"Catalog": "CAT"}`), the context being the folder name.

**Provisional ids.** A draft of `/knowledge-sync` gives a new object `<PREFIX>-CU-?n`, `<PREFIX>-RM-?n`, `<PREFIX>-D-?n` or `ADR-?n` — in a use-case file name too (`CAT-CU-?1-archive-product.md`) — and cites it under that form. `cctoolkit knowledge-write apply` numbers them as `next-id` would, in reading order: use cases, `rules.md`, `decisions.md`, the other files, ADRs last. A draft dropped at validation takes no id; an object already in the base keeps its own.

## Staging

`/knowledge-sync` never writes the base: its drafts go to `<root>/.sync/`, one folder per context laid out as the base (`.sync/Catalog/usecases/…`). An ADR, global in the base, belongs to the context whose sync drafts it: staged under `.sync/Catalog/adr/…`, written to `adr/…`. A staged file replaces the base file at the same path, whole; an empty staged file deletes it. `cctoolkit knowledge-write` alone moves a context's drafts into the base, after the user's validation, and clears them.

## Use case

```markdown
# CAT-CU-02 — Archive a product

A catalogue manager withdraws a published product; it stays readable for history.

## Rules

Also applies: CAT-RM-001, CAT-RM-004 — the product leaves the catalogue listing.

### CAT-RM-003 — Only a published product can be archived
Outcome: `ProductNotPublishedException`

## Handlers <!-- kit:handlers -->
- `ArchiveProductCommandHandler`: load Product (organisation scope), `Product.Archive(now)`, save. 1 read + 1 write. Emits `ProductArchived`.
```

A command handler is one use case. The query handlers of one aggregate form a single use case, *Consult <aggregate>*; a query carrying a rule of its own — beyond the organisation partition — gets its own use case.

The line citing the rules of other files opens `## Rules`, before the first rule: under a rule it would be that rule's body, and leave with it when the rule moves.

A rule is its title, stated as the behaviour, plus at most a few lines: the outcome (exception or result, in code), a condition the title cannot hold. Exceptions and events are written in code spans: the drift check looks them up in the code.

## Cross-cutting rules — `rules.md`

`# <Context> — cross-cutting rules`, then rules in the use-case format. The use cases that apply one cite it; `rules.md` does not list them back.

## Business decision — `decisions.md`

`# <Context> — decisions`, then four lines at most per decision, one block without blank line, the same in the spec, the batch sheet and here:

```markdown
### CAT-D-001 — Archive instead of delete
Choice: an archived product stays in the database, hidden from the catalogue.
Why: past orders and diagrams must stay readable.
Rejected: hard delete (breaks history); restore limited in time (no demand).
Links: CAT-RM-004, CAT-CU-02, CAT-CU-03
```

## ADR — `adr/ADR-nnn-<slug>.md`

The decision format plus its consequences:

```markdown
# ADR-001 — Soft archive through a status column
Choice: `Product.Status = Archived`; listing queries filter on it.
Why: one read path, history preserved (CAT-D-001).
Rejected: archive table (two read paths); event-sourced projection (no event store).
Consequences: every catalogue query filters on `Status`; index on (OrganisationId, Status).
Links: CAT-RM-004, CAT-CU-02, CAT-CU-03
```

## `OVERVIEW.md`

Under `knowledge.overviewBudget` tokens (1,500 by default), rewritten as a whole when a merge changes its vocabulary, states or relations, never appended to. Detail stays in the use cases.

```markdown
# Catalog

<role of the context, one paragraph — its first sentence is the INDEX.md summary>

## Vocabulary <!-- kit:vocabulary -->
<!-- kit:cols term,definition -->
| Term | Definition |

## Lifecycle
<states and transitions, citing the rules that guard them>

## Key aggregates
<one line each>

## Relations <!-- kit:relations -->
<one line per neighbour context, named by its folder name>
```

## `HISTORY.md`

`# <Context> — history`, then one table, newest row first. Two writers:

- the merge of a delivered feature (§ Merge): `Feature` is the spec's code, `<CODE> partial` for a partial merge;
- `/knowledge-sync`: `Feature` is `sync <commit>`, the short hash of `HEAD` when the sync ran. A sync covers that commit and the working tree beside it, so the base update is committed with the code it describes. A sync that changes nothing still writes its row, so the mark moves on. The merge never writes one: it aligns its own feature, not what landed beside it.

The context's sync marks are every `sync` row whose commit is an ancestor of `HEAD` — not the first row: after a merge of two branches that each synced, both rows are there, and both are marks. The next sync reads the commits reachable from `HEAD` and from none of the marks, plus the working tree, and skips two kinds of commit, already covered: the kit's batch commits (trailer `Kit-Batch: <plan>/FX`) and a commit that adds a `sync` row to this file. No mark, or none git still knows (rebase, squash, shallow clone): the context is scanned whole.

The file merges with `merge=union` (`<root>/.gitattributes`, written by `cctoolkit knowledge-write` with the base's first sync): two branches that each added rows keep both, with no conflict.

Delta: `+id` added, `~id` rewritten, `-id` retired — the only trace of a retired id, read by `next-id`; `—` when nothing changed. Decisions and ADRs sit in the delta like any object: they are the why. An ADR sits in the delta of the context that wrote it, and only there: a row moves its context's mark, so a context nobody looked at gets none. The commit of a merge is not recorded: git blame on the line gives it.

```markdown
<!-- kit:cols date,feature,delta -->
| Date | Feature | Delta |
|------|---------|-------|
| 2026-10-15 | PRD-ARCH | ~CAT-CU-01 +CAT-CU-02 +CAT-CU-03 +CAT-RM-003 +CAT-RM-004 +CAT-RM-005 +CAT-D-001 +ADR-001 |
| 2026-10-01 | sync 3f9e2c1 | +CAT-CU-01 +CAT-RM-001 +CAT-RM-002 |
```

## `INDEX.md`

Generated by `cctoolkit knowledge-index`, never edited: one row per context — name linked to its `OVERVIEW.md`, prefix, counts of use cases, rules and decisions, the first sentence of its `OVERVIEW.md` — then the ADR count. `cctoolkit knowledge-write apply` and `mark` rebuild it; after a change by hand, `cctoolkit knowledge-index` — `cctoolkit doctor` and the opt-in pre-commit say when it lags.

## Reading the base

`INDEX.md`, an `OVERVIEW.md`, a use-case file and an ADR are read whole: each is bounded. A context's `rules.md`, `decisions.md` and `HISTORY.md` grow with the repo: they are read through `cctoolkit ask` — ranked cards, `--id` for an object whole, `--context` for a context's summary, `--history` — and a whole `Read`, `cat`, `head` or `tail` of them is refused. `ask` answers from `.index/knowledge.jsonl`, refreshed from the files whose stamp moved.

## Writing rules

- The base states what is true now. A changed rule is rewritten in place — never "Previously…", never a second version beside the first; a retired object is deleted and its citations with it. The past is git and one line of `HISTORY.md`.
- No date, author or status field: git carries them, `kit:observed` excepted.
- What git, the code or another object already says is cited, not copied.

## Merge

The base changes once per feature, when its plan is delivered: `run-plan` stages the merge after its last batch, every batch ✅ DONE, and writes nothing; `/knowledge-merge` shows the diff and writes it on the user's confirmation. A plan blocked or partial merges nothing: the spec stays under `todo/`, its ids taken, and the run that finishes it stages the merge. A plan abandoned for good: `--partial` merges the objects whose batches are all ✅ DONE (the plan's `kit:traceability` table), a decision or an ADR only when every object of the delta it links is in.

- **Mechanical** — `cctoolkit knowledge-merge prepare` checks the plan and the spec, drafts the decisions (same format in the spec) and the ADRs of the sheets (`T1`-style plan ids dropped; an ADR's context is the one its ids cite most) and lists what is left. `stage` assembles the drafts over the base — an object replaced in its own lines wherever the base holds it, a new rule to `rules.md`, a new decision to `decisions.md`, a retired object cut — and prints `+n −n` per file. `knowledge-write apply --merge <CODE>` writes, adds the `HISTORY.md` rows and rebuilds `INDEX.md`.
- **Written by `knowledge-merger`** — the use cases and rules in this format, from the spec and the sheets' code elements (exceptions, handlers, costs, events); a rule rewritten in place; a citation of a retired object removed; `OVERVIEW.md` rewritten when the spec reaches its vocabulary, states or relations.
- **Refused** — an id `new` the base holds under another title: a collision, settled by `cctoolkit knowledge-merge renumber <plan> <old> <new>`, which rewrites the plan folder and the source and test roots; an id `modified` or `retired` the base lacks; an object of the delta without draft, or a draft no delta announces; an object of the base gone without being retired; a citation of an id defined nowhere; a rule left in a use case's file that several apply; an `OVERVIEW.md` above `knowledge.overviewBudget` — condensed before the merge goes through. A rule rewritten without a line removed is warned: what the feature makes false goes before what it adds.

Drafts under `<root>/.merge/<CODE>/.drafts/<Context>/`, named after their object: a use case or an ADR as its whole file, `<id>-<slug>.md`; a rule or a decision as the object alone, `<id>.md`; `OVERVIEW.md` whole. A feature whose `HISTORY.md` row exists has nothing left to merge; an object of the delta the base already holds under the same title is merged already.
