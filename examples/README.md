# Example — one feature through the kit

What the kit writes into a repo for one small feature, *archive a product* in a `Catalog` bounded context, `clean-architecture` preset, `language.docs = en`. The domain is fictional and the files are trimmed, but each one has the structure and anchors the skills produce. Read them in this order:

| # | File | Written by | What to look at |
|---|------|------------|-----------------|
| 1 | [`todo/product-archiving/SPEC-product-archiving.md`](todo/product-archiving/SPEC-product-archiving.md) | `/cctoolkit:business-spec` | business rules `RM-xx` and use cases `CU-xx`, no technical word; one `Major` open question left, which doesn't block the plan |
| 2 | [`todo/product-archiving/PRD-ARCH-PLAN.md`](todo/product-archiving/PRD-ARCH-PLAN.md) | `/cctoolkit:plan-implementation` | the global plan: batches, their order, each RM/CU traced to its code owner |
| 3 | [`todo/product-archiving/PRD-ARCH-PLAN-F1.md`](todo/product-archiving/PRD-ARCH-PLAN-F1.md) | `/cctoolkit:plan-implementation`, ticked by `/cctoolkit:run-lot` | one batch sheet: tests named before any code, exact file paths, the `TDD:` progress line |
| 4 | [`todo/product-archiving/run/F1/F1-report.md`](todo/product-archiving/run/F1/F1-report.md) | `/cctoolkit:run-lot` | the end-of-batch report: status, files, access cost, validations, every test tied to its rule |
| 5 | [`src/Application/Catalog/Products/ArchiveProduct/CLAUDE.md`](src/Application/Catalog/Products/ArchiveProduct/CLAUDE.md) | `/cctoolkit:run-lot` (closing) | the handler sheet: its rules table is checked against the tests' `[Trait("RM", …)]` tags |

Batch F2 (restore) is still ⬜ in the plan: its sheet is left out, it reads like F1.

In a real repo, file 5 sits under `src/<Product>.Application/…`, and `{{PRODUCT}}` in the paths is your product name.

## Glossary

| Term | Meaning |
|------|---------|
| `RM-xx` | business rule of the spec (*règle métier*); numbered per aggregate in the handler sheets |
| `RL-xx` | rule local to one handler, absent from the spec |
| `CU-xx` | use case of the spec (*cas d'utilisation*) |
| batch, `FX` | one deliverable slice of the plan, all layers at once; F1, F2… in order |
| sheet | the `-PLAN-FX.md` file detailing one batch |
| `DDD-nn`, `APP-nn`, `PERF-nn` | design rules the plan applies or declares N/A |
| `<!-- kit:… -->` | anchor the scripts and hooks find a section by; the heading before it can be translated, the anchor never |
