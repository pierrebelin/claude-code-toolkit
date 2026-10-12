# Batch design — the `## Cycles` block

Read by the `run-lot` design agent, with `test-scope.md` and `parallelism.md`, when a sheet has no valid `## Cycles` block — at the start of its batch, or during the previous batch's audit (pre-design). It designs once, into the sheet; `tdd-test-author` and `tdd-implementer` then work from the contract `cctoolkit sheet-cycles <sheet> --cycle <id> --red|--green` prints, never from the sheet. `/plan-implementation` writes the same block when it drafts the sheet.

## Analysis

- Global plan by section: `grep -n "^## \|^### "`, then read the summary, the batch index and `### Batch FX` by range. Batch sheet whole.
- Applied DDD/APP/PERF ids of the sheet: their lines only, in `/plan-implementation`'s `references/ddd-rules.md` and `architecture-rules.md`.
- **Invariants → what they remove.** For each invariant of the sheet, name what it takes out of the code (loop, `GroupBy`, dictionary, defensive branch, second read): it goes into `invariants`.
- Exploration bounded to what the sheet names: those files by range, never `git show` nor `git log`. A relation → `graphify explain|path|query`. A repo-wide search only for a ripple the sheet does not list: `grep -rln` on the member name, paths only. A `DESIGN.md` chapter a behaviour needs → name that file in the cycle's `bounded`. A cost you cannot state → `conventions.md` § "Data access".
- Existing tests asserting a literal or contract the batch changes (message, error code, route, response field): `grep -rln` the current literal under the test roots, paths only; each file goes into `full` of the cycle that changes it and its methods into `methods` — the RED rewrites them to the new value, never into a negative assertion; the GREEN never may. One method per changed fact: a test asserting only the type stays as is.

## Behaviours

- **End-to-end business behaviours** (Command/Query + Handler, endpoint, repository method), each tied to RM/CU, ordered Domain → Application → Infrastructure → WebAPI.
- Sheet steps are an evidence checklist, not the cycle unit: several steps on the same handler + aggregate method = one cycle; a guard, refusal, visibility or uniqueness check = one more scenario of its behaviour; the same change repeated over several elements = one cycle within the caps of `parallelism.md`. All scenarios of a cycle are red before any production code.
- Test level, integration obligation and waiver → `test-scope.md` §1; handler test policy → §5. Never a cycle testing an aggregate directly.
- **Dead guards stay out.** A guard or exception no caller reaches (every path to it refused earlier, an exhaustive switch, a non-nullable result, only the aggregate reaches it) gets no method: one `review` line proposing its removal. A RED that finds one the design missed lists it in `unreachable`.

## The `## Cycles` block

One `## Cycles` section before `## Assumptions`, holding one ```json fence: `{"declaratives": [...], "cycles": [...]}`. Field by field (all required unless marked):

| Field | Content |
|---|---|
| `id` | short unique id (`C1`, `C2`) |
| `wave` | 1, 2… per `parallelism.md` |
| `behaviour` | one sentence in the docs language of `kit.config.json`, unique; kept verbatim once a run saved the cycle (its state file is named after it) |
| `rmcu`, `steps` | RM/CU ids; exact titles of the sheet steps the cycle carries |
| `refactor`, `guard` (optional, false) | refactor under an existing safety net (`methods` = the net, run unchanged); architecture or convention guard green at once on the current code (its RED writes and runs it, no GREEN) |
| `level`, `skill` | `UT`/`IT`/`contract`/`E2E`; the test skill name |
| `testClass`, `fixture`, `methods` | final names; `methods` = `Class.Method`, one per scenario, in the order of `scenarios` — never an ellipsis, placeholder nor open `When` |
| `full`, `bounded` | RED paths: files it rewrites (test file, fixture, existing tests above, marked `(to create)` when new); context only (handler or aggregate under test, shared doubles and builders under `layout.tests.shared`) |
| `scenarios`, `observation` | the scenarios in one line; what the test observes |
| `outOfScope` | the guard or branch of a later behaviour that would turn its RED green |
| `toCreate`, `production` | files the GREEN creates from scratch; every production file it may fill (created ones included, the handler `CLAUDE.md` whose rules it changes too) — nothing else under the source roots |
| `ripple` | `path — what changes` for each file a moved signature lands in (mappers, repository implementations, hand-written doubles, integration fixtures) |
| `boundedGreen` | GREEN context paths |
| `elements` | exact names and public signatures, declaration only, never a body |
| `appliedIds`, `invariants`, `expectedCost` | DDD/APP ids; invariants and what they remove; `n reads + n writes to Infrastructure, independent of [input]`, consistent with the sheet's access cost |
| `snapshot` (optional) | approval-testing suites: approved-file path + the literal seeded values expected (`test-scope.md` §6) |
| `decisions` (optional) | a `user decision` overriding this contract |

Paths are repo-relative and exact, copied from the sheet or the code — `sheet-cycles --index` refuses a path under the source or test roots that neither exists nor is created, a second test project in one cycle, more than 4 test files or 8 production files, and two cycles of one wave sharing a file. Never write what the agent definitions already bind, never a body.

## Declarative artefacts

The list and its limits: `common-rules.md` §4 point 5, that paragraph only. Listed in `declaratives` as `path — mirrors <existing file>; what it holds` (the enum member or discriminator the expected observation names included): the run writes them before the first RED. Nothing else goes there (no test, no signature stub).
