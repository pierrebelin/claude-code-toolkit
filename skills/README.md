# Skills and agents

Installed, each skill is typed with the plugin's prefix — `/cctoolkit:implement-tdd batch F1 <plan>` — and the agents are `cctoolkit:<name>`; the bare names below designate them. The agents' documentation lives here: the plugin loads every `agents/*.md` as an agent, so that folder holds no README.

## Skills

Main chain: `business-spec` → `plan-implementation` → `/cctoolkit:run-plan <plan>` for the whole plan, or `/cctoolkit:run-lot <sheet>` per batch (Workflow scripts, `docs/TOOLING.md`). `implement-tdd` only launches that chain from a plan path (and applies a `— correction:` to a sheet); `verify-ddd-tdd` audits a batch on demand. Around it, the knowledge base: `knowledge-sync` builds it and catches up with changes made outside the chain, `business-spec` reads it, `knowledge-merge` writes a delivered plan into it, `ask` answers from it.

| Skill | When |
|-------|------|
| `business-spec` | short, testable business spec, no technical design. With a knowledge base: read by levels through `cctoolkit ask` first, then written as a delta — each use case, rule and business decision under its global id (`cctoolkit next-id`), marked `new`, `modified` or `retired` — with the technical points left to the plan; `adversarial-reviewer` reads it fresh, base included, every `Blocking` open question is put to the user |
| `plan-implementation` | validated spec → DDD plan split into batches, tracing RM/CU and decisions; settles each technical point of the spec in the `## Decisions` of a sheet (Choice / Why / Rejected / Links), an `ADR-nnn` from `cctoolkit next-id ADR` for a decision that outlives the plan; refuses to start while the spec carries a `Blocking` open question, ends with an `adversarial-reviewer` pass |
| `implement-tdd` | launches the `run-lot` workflow on a batch sheet (`run-plan` on a plan) and answers its questions from the session; the chain delegates RED to `tdd-test-author`, GREEN and REFACTOR to `tdd-implementer` |
| `verify-ddd-tdd` | audits the batch before moving to the next one; runs in a fork on `ddd-tdd-auditor`. `full` widens to the touched boundaries, `resume` re-audits only the deviations of a previous verdict |
| `kit-init` | once per repo, after installing the plugin: stack detection, preset, language, `kit.config.json`, rules (copied or drafted from the code), the preset's test skills, settings, statusline, doctor; also removes a manual copy of the kit; ends on `/cctoolkit:knowledge-sync` as the next step when the repo has no knowledge base |
| `quality-report` | periodic quality snapshot of the main branch (monthly, before a release): asks the Stryker mode (off by default), launches the `run-audit` workflow in a throwaway worktree — tests, coverage, SonarQube, git activity, churn × complexity hotspots, rule traceability, suppressions, dependency vulnerabilities, Infrastructure calls in loops, Danger Zone × coverage × survivors — .NET or JS/TS; a block without usable evidence reads `Missing`, a block not run `Skipped`, never clean |
| `learn` | when doctor prints `NOTE learn` (gaps untreated across at least two batches): groups the gaps recurring in past verdicts (≥ 3 batches, at most 3 motifs per axis) into motifs, writes each accepted one into a rule, an audit criterion or a mechanical check and retires the lines it makes useless; `/learn memory` audits the auto-memory for stale, duplicated or contradictory entries |
| `knowledge-sync` | builds the business knowledge base (`knowledge.root`) the first time, then aligns it with what changed outside the kit's flow since each context's sync mark; run before committing, so the base leaves with the code. `cctoolkit knowledge-scan` says what to look at, one `knowledge-extractor` per context drafts into the staging, the user validates (conflicts one by one, the rest by confidence level), `cctoolkit knowledge-write apply` writes. Renames and deletions of handlers need no agent; a context nothing touched gets its `sync` row alone. The base lives beside the test tags and rule sheets: it rewrites no tag and deletes no sheet |
| `knowledge-merge` | brings a delivered feature into the knowledge base: the spec's delta and the sheets' ADRs. `run-plan` stages the merge after a plan delivered whole and writes nothing; this skill prepares it when needed (`cctoolkit knowledge-merge prepare`, a collision with the base settled by `renumber` on the user's word), has `knowledge-merger` draft it, shows `+n −n` per file and the full diff on demand, then `cctoolkit knowledge-write apply --merge` writes it on confirmation. `--partial` for a plan abandoned for good: only the objects whose batches are all done |
| `ask` | answers a question on the product's behaviour from the knowledge base through `cctoolkit ask`, by levels — `INDEX.md`, the context's summary, ranked cards then the objects whole, the code last — each fact cited by its id, an `observed` one flagged; never writes the base, never reads a context's `rules.md`, `decisions.md` or `HISTORY.md` whole |

The test-authoring skills — `tests-unit-tests` (handlers/services: business rules, query results, command events), `tests-integration-tests` (repositories / persistence, Testcontainers), `tests-contract-tests` (public HTTP contract, Verify snapshots), `tests-e2e-tests` (lifecycle of at least two operations, never an isolated endpoint) — follow the layout and the test stack: they ship with the preset (`presets/<preset>/skills/`), `kit-init` copies them into the repo's `.claude/skills/`, and they are invoked without prefix ([`presets/README.md`](../presets/README.md)).

## Agents (`agents/`)

| Agent | Role |
|-------|------|
| `tdd-test-author` | writes the RED tests — test files only, applies the repo's `/tests-unit-tests`, `/tests-integration-tests`, `/tests-contract-tests` or `/tests-e2e-tests` |
| `tdd-implementer` | writes the production code in GREEN and REFACTOR — test files are read-only |
| `ddd-tdd-auditor` | audits a batch, read-only, for `/verify-ddd-tdd` |
| `adversarial-reviewer` | tries to refute a spec, a plan or the next batch sheet before any code, read-only; returns closed questions ranked `Blocking` / `Major` |
| `knowledge-merger` | drafts the merge of a delivered feature for `/knowledge-merge` and `run-plan`: the spec's use cases and rules rewritten in the base's format from the spec and the sheets' code elements, citations of retired objects removed, `OVERVIEW.md` rewritten when the spec reaches it; writes only into `<root>/.merge/<CODE>/.drafts/`, runs `cctoolkit knowledge-merge stage`, returns `## MERGE STAGED — <CODE>` |
| `knowledge-extractor` | drafts one bounded context of the knowledge base for `/knowledge-sync` — from the rule sheets (`specified`), and from guards, tests, `DESIGN.md`, git and graphify (`observed`, with `path:line` and a confidence level); writes only into the staging, with provisional ids, and returns `## EXTRACTED — <Context>`: counts, conflicts between sheet and code, objects to remove |

## How `run-lot` delegates

`run-lot` is not a step but a loop: one full turn per business behaviour, in the order Domain → Application → Infrastructure → WebAPI. Behaviours whose target test files are disjoint are grouped into a **wave**: their REDs go out as several `Agent` calls in a single message. GREEN never parallelises — two implementers on the same layer collide.

- **`run-lot` writes neither its tests nor its code.** RED goes to `tdd-test-author`, allowed to touch test files and nothing else. GREEN and REFACTOR go to `tdd-implementer`, for which test files are read-only: a test that cannot go green without being modified comes back as `BLOCKED` instead of being weakened. A hook holds both to it on the tree, not on their report (`hooks/README.md` § `tdd-scope-guard.sh`). The workflow produces nothing — it reads each contract off the sheet's `## Cycles` block, checks the reports, validates the cost and hands every stop to an arbiter agent.
- **Subagents produce and declare, the orchestrator judges.** That is also what keeps the main context usable over a long batch: build and test logs stay with whoever caused them.
- **The delegation contract names the paths.** Target test file, fixture, handler under test, shared builders: the orchestrator has just read the sheet and holds them, the subagent does not and would pay a full exploration to rebuild them. Any file search is forbidden to it; a missing path comes back as `BLOCKED` and is a plan gap. Same rule on the GREEN side, plus one: a GREEN contract carries the current behaviour only — a guard written ahead turns the next RED green, and the only way out is to strip the code and re-observe the red.
- **`COST` is a phase, not a review.** No test measures the number of Infrastructure calls: green proves nothing on that axis. An `await` on a repository inside a loop goes back to design.
- **`/verify-ddd-tdd` runs before the next batch**, in a fork and with no write access. It audits the delivered code as it is first, and only then its conformance to the plan — the plan is not the ultimate reference, it gets corrected mid-batch. The orchestrator hands it a capture produced by `cctoolkit audit-capture` (status, diff, coverage, `build` and `ArchitectureTests` exit codes) and the sheet's FX section: the audit opens that once instead of rebuilding it over thirty turns. On a re-audit after correction, `resume` narrows the scope to the previous verdict's deviation table plus the diff produced since — what already carries a verdict is not re-established.

**Progressive disclosure inside a skill** — what only one branch or one phase needs lives in its own reference file, read at that point and not before: `design.md` and `parallelism.md` open only when a sheet has no valid `## Cycles` block, `closing.md` only at GREEN and when the pre-audit gate or the audit asks for a fix. A reference loaded at the top of a skill is carried by every turn of the batch.

## What the kit imposes on the repo

**Layer separation** — the Domain depends on nothing (no HTTP, no EF, no DTO). Application orchestrates: load, call the Domain, save the events, return. Infrastructure and WebAPI translate IO and carry no business rule. Resource bounds sit at the WebAPI boundary, never in Domain nor in Application.

**The `.claude/rules/*.md` files are the single source of the layer conventions** — see [`presets/README.md`](../presets/README.md).

**Strict TDD** — Red-Green-Refactor. The red test precedes the code, the REFACTOR phase cleans up *then deletes* (a defensive branch made impossible by an invariant, an indirection with a single caller, dead code introduced by the batch).

**Surgical change** — every modified line ties back to the behaviour at hand. No improvement of adjacent code that worked, no renaming or reformatting outside scope, no flexibility "for later". An adjacent bug outside scope is reported, not fixed. `verify-ddd-tdd` audits that axis hunk by hunk: a hunk with no owning RM/CU is a gap, even if it improves the code.

**Comments only for what the code cannot say** — a constraint, a decision, a workaround — at the file's own density; naming carries the rest. `pre-audit.sh` lists every added comment, the audit's `Comments` axis judges each. Useless comments are removed only within the lines you touch.

**Rules ↔ tests traceability** — every use-case folder carries a rule sheet (`CLAUDE.md`) with a rules table (`kit:rules`), and every handler unit test (and each integration test proving a documented rule) declares the rule it covers on itself — contract and E2E tests carry none — value `{HandlerFolder}/{RM|RL-xx}` in the carrier of its framework (`testTag`; xUnit: `[Trait("RM", "{HandlerFolder}/{RM|RL-xx}")]`). `hooks/handler-claude-md-check.sh` checks both directions; `cctoolkit rules-coverage` gives the repo-wide count.

**Never commit to Git.** The user decides when to commit, except the batch commit the `run-lot`/`run-plan` workflow makes at the end of a `DONE` batch through `cctoolkit batch-baseline commit`. `lib/guard-git.sh` makes the instruction deterministic: a Git commit typed in a Bash command is always denied.

**Symbol discovery** — `grep`s for a symbol give way to `graphify explain` when the AST graph actually answers.

**Done checklist** — never announce completion without: the relevant tests green, no regression, plan files marked ✅ with a date, the handler's rules table (`kit:rules`) up to date, the parent feature's index `CLAUDE.md` up to date if a handler is added or its intent changes.

**Context discipline** — behaviour rules, independent of the domain: `rules/context-discipline.md`, loaded in every session (no `paths:`). A repo that copied them into its `CLAUDE.md` before that file existed removes the copy — two sources drift.
