# Example — one feature through the kit

What the kit writes into a repo for one small feature, *archive a product* in a `Catalog` bounded context, `clean-architecture` preset, `language.docs = en`. The domain is fictional and the files are trimmed, but each one has the structure and anchors the skills produce. Read them in this order:

| # | File | Written by | What to look at |
|---|------|------------|-----------------|
| 1 | [`todo/product-archiving/SPEC-product-archiving.md`](todo/product-archiving/SPEC-product-archiving.md) | `/cctoolkit:business-spec` | what the feature changes in the knowledge base: each use case, rule and decision under its global id, marked `new`, `modified` or `retired`; the rule it keeps (`CAT-RM-001`) only cited; no technical word — the storage question is a technical point `T1` for the plan; one `Major` open question left, which doesn't block the plan |
| 2 | [`todo/product-archiving/PRD-ARCH-PLAN.md`](todo/product-archiving/PRD-ARCH-PLAN.md) | `/cctoolkit:plan-implementation` | the global plan: batches, their order, each RM/CU traced to its code owner, `T1` to the decision that settles it |
| 3 | [`todo/product-archiving/PRD-ARCH-PLAN-F1.md`](todo/product-archiving/PRD-ARCH-PLAN-F1.md) | `/cctoolkit:plan-implementation`, ticked by `/cctoolkit:run-lot` | one batch sheet: its decisions — `T1` settled as `ADR-001`, id taken with `cctoolkit next-id ADR` — its `## Cycles` block: tests named before any code, exact file paths, the signatures and the design left to `## Code elements` and `## Design` |
| 4 | [`todo/product-archiving/run/batches/F1.md`](todo/product-archiving/run/batches/F1.md) | `/cctoolkit:run-lot` | the end-of-batch report: status, verdict, files, access cost, validations, every test tied to its rule, what is left to validate |
| 5 | [`src/Application/Catalog/Products/ArchiveProduct/CLAUDE.md`](src/Application/Catalog/Products/ArchiveProduct/CLAUDE.md) | `/cctoolkit:run-lot` (closing) | the handler sheet: its rules table is checked against the tests' `[Trait("RM", …)]` tags |
| 6 | [`docs/business/`](docs/business/INDEX.md) | `/cctoolkit:knowledge-sync`, then the merge `run-plan` stages and `/cctoolkit:knowledge-merge` writes | the `Catalog` knowledge base as the merge writes it once F2 is done too — nothing is merged while a batch is left: one file per use case (archive, restore, and the queries grouped under *Consult products*), each opening its rules with the ones of other files it applies, `rules.md` for the rules several use cases apply, the decision, the ADR, `HISTORY.md`. Ids are global (`CAT-RM-003`), the same as in the spec and the plan: the spec took them with `cctoolkit next-id`. `CAT-RM-002` is still `observed`: deduced from the code by the first sync, not yet validated |

Batch F2 (restore) is still ⬜ in the plan: its sheet is left out, it reads like F1.

`docs/business/` is also the base of `/knowledge-pane demo`: the mod ships a copy under `mods/knowledge-pane/demo/`, refreshed by `bash dev/knowledge-pane-demo.sh` after a change here — `dev/release-check.sh` fails while it lags.

Files 3 and 4 cite the base's ids (`CAT-RM-003`); the handler sheet, file 5, keeps its own numbering (`RM-01` is `CAT-RM-003`, `RM-02` is `CAT-RM-001`), and so do the tests' `[Trait("RM", "ArchiveProduct/RM-01")]` tags: the base lives beside the rule sheets and the tags, it rewrites none of them.

In a real repo, file 5 sits under `src/<Product>.Application/…`, and `{{PRODUCT}}` in the paths is your product name.

## Glossary

| Term | Meaning |
|------|---------|
| `RM-xx` | business rule (*règle métier*): of a spec written without knowledge base; numbered per handler in the handler sheets |
| `RL-xx` | rule local to one handler, absent from the spec |
| `CU-xx` | use case (*cas d'utilisation*) of a spec written without knowledge base |
| `T1`, `T2`… | technical point of the spec, settled by the plan in the sheet of its batch |
| batch, `FX` | one deliverable slice of the plan, all layers at once; F1, F2… in order |
| sheet | the `-PLAN-FX.md` file detailing one batch |
| `DDD-nn`, `APP-nn`, `PERF-nn` | design rules the plan applies or declares N/A |
| `CAT-CU-nn`, `CAT-RM-nnn`, `CAT-D-nnn`, `ADR-nnn` | global ids of the knowledge base: use case, rule, business decision, ADR; `CAT` is the `Catalog` prefix. In a spec, a heading ends with `<!-- kit:new -->`, `<!-- kit:modified -->` or `<!-- kit:retired -->`: what the feature does to the base |
| `<!-- kit:… -->` | anchor the scripts and hooks find a section by; the heading before it can be translated, the anchor never |
