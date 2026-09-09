# Test scope — which level to write, which scope to run

**Single source** for `/implement-tdd` and `/verify-ddd-tdd`. Do not restate these rules in a SKILL: two sources that drift make the choice random.

## Runner

Microsoft.Testing.Platform (xUnit v3). `--project <csproj>` mandatory, always `--no-build --no-restore`.
Filters `--filter-class` / `--filter-method`, `*` wildcards accepted, options are **repeatable** — values are unioned.
The VSTest syntax `--filter "FullyQualifiedName~..."` does not exist here.

```bash
rtk dotnet build --no-restore
rtk dotnet test --project tests/{{PRODUCT}}.UnitTests/{{PRODUCT}}.UnitTests.csproj --no-build --no-restore
rtk dotnet test --project tests/{{PRODUCT}}.UnitTests/{{PRODUCT}}.UnitTests.csproj --no-build --no-restore --filter-class "*CreateProductTests"
```

RTK compacts logs, it never replaces an exit code. No suite is green without exit `0`. Distinguish a test not run, skipped, and failed.

**A suite run from the main agent writes its output to a file, never to the context.** The orchestrator's global green loop (`/implement-tdd` §3) and any audit re-run go through this form:

```bash
rtk dotnet test --project tests/{{PRODUCT}}.<Suite>/{{PRODUCT}}.<Suite>.csproj \
  --no-build --no-restore > "$SCRATCH/test-<Suite>.txt" 2>&1; echo "exit=$?"; tail -15 "$SCRATCH/test-<Suite>.txt"
```

`$SCRATCH` is the session scratchpad directory. On exit `0`, the tail is the whole evidence needed — stop there. On failure only, open the file and take at most six useful lines. A green suite's full log is carried by every later turn of the session for nothing: measured on 2026-09-08, `Bash` alone weighs $22.76 across the day, on 21 to 33 `rtk` calls per orchestrator session. This does **not** apply to the subagents: they run one filtered test in their own context, which is discarded when they return.

## 1. Which test level to write

| The behaviour is about… | Skill | Project |
|---|---|---|
| Command/Query + Handler | `/tests-unit-tests` | `tests/{{PRODUCT}}.UnitTests/` |
| Repository method | `/tests-integration-tests` | `tests/{{PRODUCT}}.IntegrationTests/` |
| API endpoint | `/tests-contract-tests` | `tests/{{PRODUCT}}.ContractTests/` |

**Touching `src/{{PRODUCT}}.Infrastructure/` mandates an integration test.** As soon as a hunk of the batch modifies that project — repository, EF mapper, entity configuration, query, persistence-exception translation — the behaviour carries a test in `tests/{{PRODUCT}}.IntegrationTests/`, on top of the handler test. The handler unit test works on a double: it proves nothing about the generated SQL, the join, the filter pushed to the database, nor the index violation translated into a domain exception.

Three cases, only one is a waiver:

| Situation | Expected |
|---|---|
| Repository method new or modified | Integration test mandatory on that method |
| EF configuration, mapping or entity modified | Integration test mandatory on a persistence behaviour crossing the touched mapping |
| Infrastructure hunk with no effect on persistence (DI registration, adapter of an already-doubled external service) | No integration test required — **say so explicitly** in the sheet and the summary, with the reason |

A batch touching Infrastructure with no integration test and no written waiver is a **Blocking** deviation at audit.

## 2. Which scope to run

Always `--project <csproj> --no-build --no-restore`.

| Suite | Scope | Condition |
|---|---|---|
| `UnitTests` | **whole** | always — fast, and the only suite covering handlers across the whole repo |
| `ArchitectureTests` | **whole** | as soon as a handler, endpoint, repository, layer boundary or DI registration changes. Locks naming, CQRS, dependencies and registration better than a re-read |
| `ContractTests` | **whole** | as soon as an endpoint, an HTTP contract or an `Abstractions.Models` type changes |
| `IntegrationTests` | **filtered** | as soon as the diff touches `src/{{PRODUCT}}.Infrastructure/`. **Never the whole suite**, `full` mode included |

**Scope is decided, not endured.** A suite run whole where a filter would have done proves nothing more and costs several minutes.

## 3. Filtering integration tests

A whole integration suite rebuilds every fixture and re-seeds the database: cost is proportional to the number of tests, not just to container startup. On this repo the full suite exceeds 4 minutes where the impacted context fits in one.

Build the filter from the **production folders touched**, not from the batch:

```bash
APP_TEST_MODE=true rtk dotnet test --project tests/{{PRODUCT}}.IntegrationTests/{{PRODUCT}}.IntegrationTests.csproj \
  --no-build --no-restore \
  --filter-class "*.Studio.Diagrams.*" \
  --filter-class "*.Studio.ModuleDiagrams.Save.*" \
  --filter-class "*.Studio.Templates.Save.*"
```

Namespace roots under `{{PRODUCT}}.IntegrationTests`: `Licensing`, `Catalog`, `Database`, `Dsl`, `Studio`, `Files`, `Http`, `Import`, `Performance`.

**Selection rule**: a modified repository → its aggregate's namespace **and** that of any aggregate whose persistence test builds it. Go one level deeper (`*.Keyrings.ProvisionKey.*` rather than `*.Keyrings.*`) as soon as the touched method is identified; go one level up only when a shared signature changes. A doubt about scope is settled by widening one level, never by running everything.

## 4. Reporting scope

**State the scope chosen and what it leaves out.** A filtered suite presented as "tests green" without saying what did not run reads as full coverage, which it is not.

Format expected everywhere — batch sheet, `/implement-tdd` summary, `Validations` line of a verdict:

```
[command] — exit N, scope [filter applied or "whole suite"], [n] tests
Non exécuté : [suite] — [raison]
```

## 5. Handler test policy

Absolute, shared by writing (`/implement-tdd`) and audit (`/verify-ddd-tdd`).

- **Never test an aggregate directly.** A Domain behaviour (factory `Create()`, method `SetDefault()`, …) is tested through the handler/service that calls it; domain events are side effects observed at handler level. No handler exists yet for that behaviour → the test is not written. No orphan test on an aggregate.
- **Query handler**: the double supplies the data, the test asserts on the returned result.
- **Command handler**: the test asserts the type and the payload of `SavedEvents`.
- **Never an interaction**: no spy, counter, `CallCount`, `Called`, `Received`, `Verify`, no assertion on a call count — not even to observe cost.

A deviation on any of these four is **Blocking**, axis `Test`.

## 6. Approval-testing snapshots

A test asserting through an approval library (Verify, ApprovalTests, …) writes a received file on its first run and fails.

- The GREEN contract hands the agent the approved-file path and the **literal** expected values, taken from the seed fixture. Not "the expected representation of the resource" — the values themselves. Anything less makes acceptance a judgement call the agent is not equipped to make.
- The agent reads the received file, compares, then promotes it to the approved file. Any mismatch — a wrong status code, a validation problem, a field that should not be there — is `## BLOCKED`, never an accepted snapshot.
- This is the **only** write allowed under `tests/` during GREEN. It is not a test modification.
