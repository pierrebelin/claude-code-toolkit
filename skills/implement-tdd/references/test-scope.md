# Test scope — which level to write, which scope to run

Single source for the `run-lot` agents and `/verify-ddd-tdd`.

## Runner

The build and test commands are the repo's, never written here: `commands.build` and `commands.test` of `.claude/kit.config.json` (the preset's when the repo sets none). `{suite}` is the suite's name — `UnitTests`, `IntegrationTests`… under the `clean-architecture` preset. Resolve once per session, then run the printed command **literally**:

```bash
cctoolkit config command build
cctoolkit config command test UnitTests
```

Never `eval "$(…)"` it: the guards and the `rtk` rewrite read the command text. Nothing printed = the key is unset: no run, report `Not run: [suite] — commands.test unset`.

Narrowing to a class or a method appends the runner's own filter. Illustration, `clean-architecture` preset — Microsoft.Testing.Platform (xUnit v3): `--project <csproj>` mandatory, always `--no-build --no-restore`; filters `--filter-class` / `--filter-method`, `*` wildcards, **repeatable** — values unioned; VSTest syntax `--filter "FullyQualifiedName~..."` doesn't exist there.

```bash
<commands.test, {suite}=UnitTests> --filter-class "*CreateProductTests"
<commands.test, {suite}=UnitTests> --filter-class "*CreateProductTests" --filter-method "Should*_WhenNameIsEmpty"
```

RTK compacts logs, never replaces an exit code. No suite green without exit `0`. Distinguish a test not run, skipped, failed.

**Suite run from the main agent writes its output to a file, never to context.** The global green agent of `run-lot` and any audit re-run — whole suites once per batch, independent suites in one message:

```bash
<commands.test, {suite}=<Suite>> > "$SCRATCH/test-<Suite>.txt" 2>&1; echo "exit=$?"; tail -15 "$SCRATCH/test-<Suite>.txt"
```

`$SCRATCH` = session scratchpad. On exit `0` the tail is the whole evidence — stop there. On failure only, open the file, take at most six useful lines. A green suite's full log is otherwise carried by every later turn. Does **not** apply to subagents: they run one filtered test in their own context, discarded on return.

## 1. Which test level to write

| The behaviour is about… | Skill (the repo's, `rules/cctoolkit.md`) | Project |
|---|---|---|
| Command/Query + Handler | `/tests-unit-tests` | `tests/{{PRODUCT}}.UnitTests/` |
| Repository method | `/tests-integration-tests` | `tests/{{PRODUCT}}.IntegrationTests/` |
| API endpoint | `/tests-contract-tests` | `tests/{{PRODUCT}}.ContractTests/` |

**Touching `src/{{PRODUCT}}.Infrastructure/` mandates an integration test.** As soon as a hunk of the batch modifies that project — repository, EF mapper, entity configuration, query, persistence-exception translation — the behaviour carries a test in `tests/{{PRODUCT}}.IntegrationTests/`, on top of the handler test. The handler unit test works on a double: proves nothing about generated SQL, join, filter pushed to the database, nor index violation translated into a domain exception.

Three cases, only one is a waiver:

| Situation | Expected |
|---|---|
| Repository method new or modified | Integration test mandatory on that method |
| EF configuration, mapping or entity modified | Integration test mandatory on a persistence behaviour crossing the touched mapping |
| Infrastructure hunk with no effect on persistence (DI registration, adapter of an already-doubled external service) | No integration test required — **say so explicitly** in sheet and summary, with the reason |

Batch touching Infrastructure with no integration test and no written waiver = **Blocking** deviation at audit.

## 2. Which scope to run

| Suite | Scope | Condition |
|---|---|---|
| `UnitTests` | **whole** | always — fast, only suite covering handlers repo-wide |
| `ArchitectureTests` | **whole** | as soon as a handler, endpoint, repository, layer boundary or DI registration changes. Locks naming, CQRS, dependencies, registration better than a re-read |
| `ContractTests` | **whole** | as soon as an endpoint, an HTTP contract or an `Abstractions.Models` type changes |
| `IntegrationTests` | **filtered** | as soon as the diff touches `src/{{PRODUCT}}.Infrastructure/`. **Never the whole suite**, `full` mode included |

The one whole run of every suite, `IntegrationTests` included, is run-plan's final check, once per plan after its last batch, under the `KIT_FINAL_CHECK=1` marker; never inside a batch.

**Scope is decided, not endured.** A suite run whole where a filter would have done proves nothing more and costs minutes.

## 3. Filtering integration tests

A whole integration suite rebuilds every fixture and re-seeds the database: cost proportional to test count, not just container startup. Here the full suite exceeds 4 minutes where the impacted context fits in one.

Build the filter from the **production folders touched**, not from the batch. Illustration, `clean-architecture` preset — another runner takes the same union of namespaces in its own filter syntax:

```bash
APP_TEST_MODE=true <commands.test, {suite}=IntegrationTests> \
  --filter-class "*.Studio.Diagrams.*" \
  --filter-class "*.Studio.ModuleDiagrams.Save.*" \
  --filter-class "*.Catalog.Products.Save.*" > "$SCRATCH/test-integration.txt" 2>&1; echo "exit=$?"; tail -15 "$SCRATCH/test-integration.txt"
```

`APP_TEST_MODE` stands for the integration suite's test-mode variable: use the name the repo documents for it (typically in the suite's own `CLAUDE.md`). Namespace roots = the first-level folders of `{{PRODUCT}}.IntegrationTests` (`ls`), never a remembered list.

**Selection rule**: modified repository → its aggregate's namespace **and** that of any aggregate whose persistence test builds it. One level deeper (`*.Catalog.Products.Save.*` rather than `*.Catalog.Products.*`) as soon as the touched method is identified; one level up only when a shared signature changes. Doubt about scope → widen one level, never run everything.

## 4. Reporting scope

**State the scope chosen and what it leaves out.** A filtered suite presented as "tests green" without saying what didn't run reads as full coverage, which it is not.

Format expected everywhere — batch sheet, run report, `Validations` line of a verdict:

```
[command] — exit N, scope [filter applied or "whole suite"], [n] tests
Not run: [suite] — [reason]
```

## 5. Handler test policy

Absolute, shared by writing (`run-lot`) and audit (`/verify-ddd-tdd`).

- **Never test an aggregate directly.** A Domain behaviour (factory `Create()`, method `SetDefault()`, …) is tested through the handler/service calling it; domain events are side effects observed at handler level. No handler yet for that behaviour → test not written. No orphan test on an aggregate.
- **Query handler**: the double supplies the data, the test asserts on the returned result.
- **Command handler**: the test asserts type and payload of `SavedEvents`.
- **Never an interaction**: no spy, counter, `CallCount`, `Called`, `Received`, `Verify`, no assertion on a call count — not even to observe cost.

Deviation on any of these four = **Blocking**, axis `Test`.

## 6. Approval-testing snapshots

A test asserting through an approval library (Verify, ApprovalTests, …) writes a received file on first run and fails.

- GREEN contract hands the agent the approved-file path and the **literal** expected values, taken from the seed fixture. Not "the expected representation of the resource" — the values themselves. Anything less makes acceptance a judgement call the agent can't make.
- Agent reads the received file, compares, then promotes it to the approved file. Any mismatch — a wrong status code, a validation problem, a field that shouldn't be there — is `## BLOCKED`, never an accepted snapshot.
- **Only** write allowed under `tests/` during GREEN. Not a test modification.
