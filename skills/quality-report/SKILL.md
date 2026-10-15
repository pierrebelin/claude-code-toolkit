---
name: quality-report
disable-model-invocation: true
description: "Produces a monthly multi-stack (.NET/JS) quality report. Runs metrics, tests and coverage, generates a structured report."
model: sonnet
---

# Monthly quality report

Produce a monthly software quality report. Execute all steps in order, in parallel when possible, and write the real results into `docs/metrics/quality-report-YYYY-MM-DD.md`.

The `docs/metrics/quality-report-*` file names are frozen: the whole report history and any viewer built on top of it depend on them.

**Multi-stack skill.** Stack-specific commands:
- **.NET**: `commands-dotnet.md` for each step
- **JS/TS**: `commands-js.md` for each step

This file = common workflow, writing rules, report structure, JSON schema, coherence checks.

## `docs/` is out of scope

`docs/` never analysed: not by SonarQube, not by git activity figures, not by any file or line count — this skill's own reports live there. Every repo-walking command carries the exclusion (`':(exclude)docs'` on git pathspecs, `docs/**` in `sonar.exclusions`); new commands added here carry it too.

## Evidence status — missing never looks clean

Every measured block (tests, coverage, SonarQube, Stryker) has one of three statuses, recorded in `metadata.evidence` (`references/json-schema.md`); `cctoolkit hotspots` writes its own:

- **measured** — the tool ran on the report commit and its result was read. Clean or with findings.
- **not_configured** — the project has no such tool. The section says so (`Stryker is not configured on this project.`); §1 shows `—`, not ✅.
- **missing** — the tool exists but gave no usable result: run failed or timed out, output unreadable, or the result read belongs to another commit (a Stryker report older than this run, a SonarQube analysis whose `revision` is not the report commit). The section says `Missing — <reason>`, §1 shows 🔴, and §9 counts it as a blind spot.

A missing value is `null` in the JSON, never `0` and never last month's figure. Results from a CI run count only when the run's head SHA is the report commit; record the run ID as the source.

The report commit is `git rev-parse $MAIN_BRANCH`, stored as `metadata.commit`. A working tree on another commit, or with uncommitted changes, measures something else: check out the main branch clean before step 1, or state the gap in the report header.

## Preliminary step — choosing the Stryker mode

Before any execution, ask the user which Stryker mode through `AskUserQuestion`:

Question: "Which Stryker mode for this report?" with the options:

1. **Full (~2h)** — Mutate every file. Reliable scores, comparable between reports. Recommended for the monthly report.
2. **Since (~45 min)** — Mutate only the files changed since the last report. Faster, but the scores vary with the scope — not comparable across reports.

Per choice:
- **Full**: make sure `"since": { "enabled": false }` is set in the Stryker configs before launching.
- **Since**: set `"since": { "enabled": true, "target": "<commit>" }` in the configs. Read `since_target` from the last report's JSON:
  ```bash
  MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
  MAIN_BRANCH=${MAIN_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
  LAST_REPORT=$(ls -t docs/metrics/quality-report-*.json 2>/dev/null | head -1)
  SINCE_TARGET=$(python3 -c "import json; d=json.load(open('$LAST_REPORT')); print(d.get('stryker',{}).get('since_target',''))" 2>/dev/null)
  [ -z "$SINCE_TARGET" ] && SINCE_TARGET=$(git rev-list -1 "HEAD~50" "$MAIN_BRANCH")
  ```
  Update the configs with that target. State in the report that `since` mode was used — the scores are not comparable with a full run.

## Overview of the steps

0. Detect the project language (.NET or JS/TS)
1. Start Docker (if needed)
2. Run the tests with coverage
3. Launch SonarQube + aggregated coverage **in parallel**
4. Collect git data, hotspots, test inventory, page/endpoint coverage — **launch Stryker in the background**
5. Wait for SonarQube + Stryker, collect the results
6. Create or update the Markdown report file
7. Produce the JSON file
8. Check the report's coherence

---

## Step 0 — Detect the project language

Determine the project type first:

```bash
if [ -f package.json ] && ! ls *.sln 1>/dev/null 2>&1; then
  STACK="js"
elif ls *.sln 1>/dev/null 2>&1 || ls **/*.csproj 1>/dev/null 2>&1; then
  STACK="dotnet"
else
  echo "ERROR: cannot detect the project type" && exit 1
fi
echo "Detected stack: $STACK"
```

Then read the matching commands file (`commands-dotnet.md` or `commands-js.md`) for every following step.

---

## Steps 1 to 5 — Execution

Each step has the same structure:
1. **Docker** — start it if needed (see the stack commands)
2. **Build + tests** — measure the build time, run the tests with coverage (see the stack commands)
3. **SonarQube + aggregated coverage** — in parallel, background sub-agents (see the stack commands)
4. **Supplementary data + Stryker** — 4-5 parallel sub-agents for git, test inventory, page/endpoint coverage, codebase health and code size (src/tests, per layer), `cctoolkit hotspots` run directly (no sub-agent: one command, seconds), Stryker in the background (see the stack commands)
5. **Wait and collect** — wait for SonarQube + Stryker, collect the results

> **Common rule for every stack:** launch Stryker after the tests finish (step 2), not alongside them — it instruments the code and interferes with the test run.

---

## Step 6 — Create or update the report

File name: `docs/metrics/quality-report-YYYY-MM-DD.md` (today's date). Exists → update its sections with new data. Missing → create it.

**Structure, tables, expected detail → `report-template.md`, copied verbatim.** Nine sections, `1. Executive summary` to `9. Conclusion`. Adapt the section names and the layers to the detected stack:

- §4 — `.NET`: `API endpoint coverage` (X endpoints — Y active + Z [Skip]). `JS/TS`: `Page and hook coverage` (X pages — Y with tests, coverage of the business hooks).
- §2 — no git repo → `Data unavailable — the project is not a git repository.` No `Trend` column, no comparison with the previous report (§ No trending in the report).
- §5 — Stryker absent → `Stryker is not configured on this project.`
- §6 — SonarQube absent → `SonarQube is not configured on this project.`
- Any section whose evidence is **missing** → `Missing — <reason>.` in place of its tables (§ Evidence status).
- §2 `Hotspots` — the output of `cctoolkit hotspots`, pasted as is: ranked on the last 365 days, the whole history beside it; one table on the total complexity, one on the worst function (a short file holding one monster function). Then 1 sentence per listed file: why it is there (one handler grown by every feature, a mapping table edited each release…). A file with many `fix:` commits is a bug nest, not only a busy file: say so. `fixes` absent → the repo does not use `fix:` subjects, say the churn cannot be told from bugs. Mass commits it lists stay in the churn unless the user names them; say so. Every Danger Zone file appears in §7 with its score, or the sentence says why it is no risk (a planned migration churning it).
- §9 `What the measures cannot see` — the blind spots of this run, concrete: missing evidence, `since`-mode Stryker, coverage that executes a line without asserting it, issues hidden by suppressions (`#pragma warning disable`, `// NOSONAR`, `eslint-disable`), churn from a planned migration read as instability, complexity reset when code moves between files, cyclomatic complexity blind to type-level logic.

---

## Step 7 — Produce the JSON file

After the Markdown, write the JSON at the same location, `docs/metrics/quality-report-YYYY-MM-DD.json`.

**Schema (version `2.0`), field by field, and the traps → `references/json-schema.md`.** Read it before writing. Two traps cost a whole report: issue counts come from `api/issues/search` with `&resolved=false`; `coverage.lines`/`branches` are whole-project SonarQube numbers, not ReportGenerator or Jest ones.

---

## No trending in the report

A report is a snapshot at instant T: no "Trend" column, deltas or comparisons with the previous report. Comparing reports is the job of whatever reads the JSON history; the Markdown holds today's raw values only.

---

## Writing tone

Partial, non-complacent. Goal: an honest, precise view of how solid the codebase really is — not a celebration of the work done.

- Good numbers are facts, not achievements: "4,383 tests pass".
- Fragile zones, blind spots and insufficient scores get more space than the positives; "What works well" stays short, "What must improve" is long and precise. Stryker at 61% overall is insufficient, not "correct"; branch coverage at 65% is not ✅.
- Avoid reassuring phrasing ("the base is healthy", "the infrastructure is mature") — confidence without information.
- ✅ is for zones with zero known problem. Any doubt → ⚠️.
- Every metric gets a real interpretation, not just a value. Example: "65.7% branches — one `if` in three is never tested both ways."

---

## Step 8 — Check the report's coherence

Before delivering: arithmetic first, then judgement.

**8.1 — Arithmetic, by script.** Once the JSON is written:

```bash
cctoolkit quality-report-check docs/metrics/quality-report-YYYY-MM-DD.json
```

Checks per-type sums against totals (passed, failed, skipped, durations), `active + skip = total` on endpoints and pages, recomputed coverage and detection percentages, severity sum vs `issues_open_total`, duration thresholds per stack, evidence statuses, hotspot counts. 🔴 → fix the JSON **and** the Markdown section it comes from, re-run. ⚠️ → carry into the report as ⚠️.

**8.2 — Markdown ↔ JSON.** Every figure of executive summary §1 matches its detailed section and the JSON exactly. `endpoints_skip > 0` is not uncovered: test exists, disabled.

**8.3 — Parameterised tests.** `contract_executed > contract_methods` is normal: add note `(including parameterised tests)`.

**8.4 — Skipped tests, §3 ↔ §4.** `.NET`: skipped ContractTests match §4's `[Skip]` endpoints. `JS/TS`: `it.skip` / `test.skip` match Jest total.

**8.5 — Coverage, §1 ↔ §3 ↔ §6.** §1 reference figure = **SonarQube** coverage (every source file) for `JS/TS`, ReportGenerator (combined coverage) for `.NET`. Present both without contradiction.

**8.6 — Code size, §2 ↔ JSON.** `Code size` tables = `codebase.size` exactly; shares recomputed from the lines, not estimated. Interpretation cross-reads the layer weights with `coverage.by_layer` and churn — a heavy layer with low coverage or a thin test project facing it is a §7 risk, not a footnote.

**8.7 — Status icons.** ✅ in §1 never described as problem in §7 or §9; ⚠️ in §9 has matching entry in §7. Correct in favour of most precise description.

**8.8 — Evidence.** No ✅ on a block whose `metadata.evidence` status is not `measured`; every `missing` block named in §9 `What the measures cannot see`. The script checks the JSON side: values `null`, commit equal to `metadata.commit`.

**8.9 — Hotspots, §2 ↔ §7.** Every file of `activity.hotspots.danger_zone_top` and `worst_function_top` in §7 or explained in §2.

**8.10 — Hotspots, by hand.** Two listed files, checked against git and the tool: `git log --follow --no-merges --numstat --since=<window_from> -- <file>` gives the window's commits (minus creation, pure renames, ignored revisions), `lizard <file>` the worst function's score. A gap means a rename lost or a parser that lost function boundaries: say it in §9, never correct the figures by hand.

---

## Summary of what you produce

At end of run, give the user:
- Generated report path
- Executive summary (§1 table)
- Priority attention points
- Total execution duration
