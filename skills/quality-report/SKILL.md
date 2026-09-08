---
name: quality-report
description: "Produces a monthly multi-stack (.NET/JS) quality report. Runs metrics, tests and coverage, generates a structured report."
model: sonnet
---

# Monthly quality report

Produce a monthly software quality report. Execute all steps in order, in parallel when possible, and write the real results into `docs/metrics/quality-report-YYYY-MM-DD.md`.

The `docs/metrics/quality-report-*` file names are frozen: the whole report history and any viewer built on top of it depend on them.

**Multi-stack skill.** Stack-specific commands live in dedicated files:
- **.NET**: see `commands-dotnet.md` for each step
- **JS/TS**: see `commands-js.md` for each step

This file = common workflow, writing rules, report structure, JSON schema, coherence checks.

## Absolute rule — `docs/` is out of scope

`docs/` is never analysed: not by SonarQube, not by the git activity figures, not by any file or line count. The reports this skill produces live in `docs/metrics/`, so counting them would make the codebase look busiest exactly where no code was written. Every command that walks the repository carries the exclusion (`':(exclude)docs'` on the git pathspecs, `docs/**` in `sonar.exclusions`); a new command added to this skill must carry it too.

## Preliminary step — choosing the Stryker mode

**Before any execution**, ask the user which Stryker mode through `AskUserQuestion`:

Question: "Which Stryker mode for this report?" with the options:

1. **Full (~2h)** — Mutate every file. Reliable scores, comparable between reports. Recommended for the monthly report.
2. **Since (~45 min)** — Mutate only the files changed since the last report. Faster, but the scores vary with the scope — not comparable across reports.

Adapt the execution to the choice:
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
4. Collect git data, test inventory, page/endpoint coverage — **launch Stryker in the background**
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
4. **Supplementary data + Stryker** — 4-5 parallel sub-agents for git, test inventory, page/endpoint coverage, codebase health, Stryker in the background (see the stack commands)
5. **Wait and collect** — wait for SonarQube + Stryker, collect the results

> **Common rule for every stack:** launch Stryker **after** the tests finish (step 2). Never launch it alongside them — Stryker instruments the code and interferes with the test run.

---

## Step 6 — Create or update the report

File name: `docs/metrics/quality-report-YYYY-MM-DD.md` (today's date). If the file exists, update its sections with the new data. If it is missing, create it.

**Structure, tables and expected level of detail → `report-template.md`, copied verbatim.** Nine sections, from `1. Executive summary` to `9. Conclusion`. Adapt the section names and the layers to the detected stack:

- §4 — `.NET`: `API endpoint coverage` (X endpoints — Y active + Z [Skip]). `JS/TS`: `Page and hook coverage` (X pages — Y with tests, coverage of the business hooks).
- §2 — no git repo → `Data unavailable — the project is not a git repository.` No `Trend` column and no comparison with the previous report (absolute rule below).
- §5 — Stryker absent → `Stryker is not configured on this project.`
- §6 — SonarQube absent → `SonarQube is not configured on this project.`

---

## Step 7 — Produce the JSON file

After updating the Markdown, **mandatory**: produce the JSON file at the same location, `docs/metrics/quality-report-YYYY-MM-DD.json`.

**Schema (version `2.0`), field by field, and the traps → `references/json-schema.md`.** Read it before writing the file. Two of its rules cost a whole report when missed: every issue count comes from `api/issues/search` with `&resolved=false`, and `coverage.lines`/`branches` are the **whole-project** SonarQube numbers, never the ReportGenerator or Jest ones.

---

## Absolute rule — no trending in the report

**A report is a snapshot at instant T.** Never include a "Trend" column, deltas, or comparisons with the previous report. Comparing reports is the job of whatever reads the JSON history; the Markdown report holds today's raw values only.

---

## Writing tone — absolute rule

**The report must be partial and non-complacent.** Its goal is an honest, precise view of how solid the codebase really is — not a celebration of the work done.

Concrete rules:
- **Never celebrate good numbers.** "4,383 tests pass" is a fact, not an achievement.
- **Emphasise what is wrong.** Fragile zones, blind spots and insufficient scores get more space than the positives.
- **Name the risks without minimising them.** Stryker at 61% overall is not "correct" — it is insufficient. Branch coverage at 65% is not ✅.
- **Avoid reassuring phrasing**: no "the base is healthy", "the infrastructure is mature", "the tests validate correctly". These give confidence without information.
- **✅ is reserved for zones with zero known problem.** Any doubt → ⚠️.
- **The "What works well" section stays short.** "What must improve" is long and precise.
- **Every metric needs a real interpretation**, not just a value. Example: "65.7% branches — one `if` in three is never tested both ways."

---

## Step 8 — Check the report's coherence

Before delivering, the arithmetic first, then the judgement.

**8.1 — Arithmetic, by script.** Once the JSON is written:

```bash
python3 scripts/quality-report-check.py docs/metrics/quality-report-YYYY-MM-DD.json
```

It checks the per-type sums against the totals (passed, failed, skipped, durations), `active + skip = total` on the endpoints and the pages, the recomputed coverage and detection percentages, the severity sum against `issues_open_total`, and the duration thresholds per stack. 🔴 → fix the JSON **and** the Markdown section it comes from, then re-run. ⚠️ → carry it into the report as a ⚠️, do not silence it.

**8.2 — Markdown ↔ JSON.** Every figure of the executive summary §1 must match its detailed section and the JSON exactly. `endpoints_skip > 0` is not uncovered: the test exists, it is disabled.

**8.3 — Parameterised tests.** `contract_executed > contract_methods` is normal: add the note `(including parameterised tests)`.

**8.4 — Skipped tests, §3 ↔ §4.** `.NET`: the skipped ContractTests match the `[Skip]` endpoints of §4. `JS/TS`: the `it.skip` / `test.skip` match the Jest total.

**8.5 — Coverage, §1 ↔ §3 ↔ §6.** The reference figure of §1 is the **SonarQube** coverage (every source file) for `JS/TS`, ReportGenerator (combined coverage) for `.NET`. Present both without contradiction.

**8.6 — Status icons.** A ✅ in §1 is not described as a problem in §7 or §9; a ⚠️ in §9 has a matching entry in §7. Correct in favour of the most precise description.

---

## Summary of what you produce

At the end of the run, give the user:
- The generated report path
- The executive summary (§1 table)
- The priority attention points
- The total execution duration
