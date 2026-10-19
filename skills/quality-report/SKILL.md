---
name: quality-report
disable-model-invocation: true
description: "Produces the periodic quality report of the main branch (.NET): asks the Stryker mode, launches the run-audit workflow, relays the report."
model: sonnet
---

# Quality report

A snapshot of the main branch at one commit — monthly, or before a release: tests, coverage, SonarQube, hotspots, rule traceability, suppressions, dependency vulnerabilities, Infrastructure calls in loops, Stryker on demand. Written to `docs/metrics/quality-report-YYYY-MM-DD.md` and `.json`.

The `docs/metrics/quality-report-*` file names are frozen: the whole report history and any viewer built on top of it depend on them.

The measuring is the `run-audit` workflow (`workflows/run-audit.js`, shipped by the plugin), in a throwaway worktree of the main branch: the working checkout is never touched, a `run-lot` can run beside it. The script holds the sequence; this file holds the launch and the rules of the report, which the workflow's agents read (§ Report rules). Commands: `commands-dotnet.md`. Structure: `report-template.md`. JSON: `references/json-schema.md`.

## Launch

1. Ask the Stryker mode through `AskUserQuestion` — "Which Stryker mode for this report?":
   - **Off (Recommended)** — no mutation testing. The report says `Skipped` for Stryker and names it among the blind spots.
   - **Full (~2h)** — mutate every file. Scores comparable between reports.
   - **Since (~45 min)** — Stryker .NET only: mutate the files changed since the last report's commit. Scores not comparable across reports.
2. In one message: `date +%F` and `git rev-parse --show-toplevel`.
3. Skill `cctoolkit:run-audit`, argument as text: `--stryker off|full|since --date <date> --checkout <top level>`.

The run never asks anything: a tool that fails gives `missing` and the run goes on. It takes 15-30 min without Stryker, Stryker's time on top (the run stops it past 4 h in full, 1 h 30 in since). An interrupted run leaves its worktree: the next one prunes it (`cctoolkit audit-worktree prune` by hand).

## End

Relay the workflow result: the report path, the §1 summary (`summary`, `atAGlance`), the priority actions (`attention`), the verdict, the duration (`minutes`), the `check` lines still red, the coherence `remaining`. `BLOCKED` → the reason and the temp folder kept for the diagnosis (`temp`). `leftover` → say it.

---

## Report rules

Read by the workflow's report, repair and coherence agents. The report is produced text: prose in `language.docs` of `kit.config.json`, the template's structure and tables verbatim.

### `docs/` is out of scope

`docs/` never analysed: not by SonarQube, not by git activity figures, not by any file or line count — the reports live there. Every repo-walking command carries the exclusion (`':(exclude)docs'` on git pathspecs, `docs/**` in `sonar.exclusions`); new commands carry it too.

### Evidence status — missing never looks clean

Every measured block has one of four statuses. Tests, coverage, SonarQube and Stryker record theirs in `metadata.evidence`; `activity.hotspots` and each `codebase.*` block of `cctoolkit audit-collect` and `risk-cross` carry their own `{status, reason, commit}`:

- **measured** — the tool ran on the report commit and its result was read. Clean or with findings.
- **not_configured** — the project has no such tool. The section says so (`Stryker is not configured on this project.`); §1 shows `—`, not ✅.
- **skipped** — the tool exists, this run chose not to run it (Stryker off). The section says `Skipped — Stryker off for this run.`; §1 shows `—`; §9 names it among the blind spots: never measured is never clean.
- **missing** — the tool exists but gave no usable result: run failed or timed out, no network, output unreadable, or the result read belongs to another commit (a SonarQube analysis whose `revision` is not the report commit). The section says `Missing — <reason>`, §1 shows 🔴, §9 counts it.

A value not measured is `null` in the JSON, never `0` and never last month's figure. Results from a CI run count only when the run's head SHA is the report commit; record the run ID as the source.

The report commit is the main branch's, stored as `metadata.commit`; the workflow measures a clean worktree of it, so uncommitted work never enters a report.

### Sections

**Structure, tables, expected detail → `report-template.md`, copied verbatim.** Nine sections, `1. Executive summary` to `9. Conclusion`. Adapt the layers to the repo:

- §2 `Hotspots` — `hotspots.md` of the run (the `cctoolkit hotspots` output), pasted as is: ranked on the last 365 days, the whole history beside it; one table on the total complexity, one on the worst function. Then 1 sentence per listed file: why it is there (one handler grown by every feature, a mapping table edited each release…). A file with many `fix:` commits is a bug nest, not only a busy file: say so. `fixes` absent → the repo does not use `fix:` subjects, say the churn cannot be told from bugs. Mass commits it lists stay in the churn unless the user names them; say so. No git history → `Data unavailable — the project is not a git repository.`
- §3 `Rule traceability` — `codebase.rules_coverage`: rules with and without a test (handlers named), dead references, tests carrying no rule tag — inside a class that carries some (the unbound tests: a rule missing from the table, or a misplaced test) and in classes carrying none (out of the mechanism, counted per suite, not a defect by itself).
- §4 — `API endpoint coverage` (X endpoints — Y active + Z [Skip]).
- §5 — Stryker skipped → `Skipped — Stryker off for this run.`; absent → `Stryker is not configured on this project.`; since mode → say the scores are not comparable with a full run.
- §6 `Static quality` — SonarQube first (absent → `SonarQube is not configured on this project.` in place of its tables only), then `Suppressions` (`codebase.suppressions`: per kind, per layer, top files — each one hides an issue SonarQube and the compiler no longer count), `Dependency vulnerabilities` (`codebase.vulnerabilities`: per severity, every high and critical package named, direct or transitive) and `Infrastructure calls in loops` (`codebase.loop_calls`: awaited Infrastructure calls inside a loop or a lambda, in-memory filters on an awaited result — an N+1 no test sees).
- §7 `Risk zones` — opens on the Danger Zone × coverage × survivors table (`codebase.hotspot_risk`): a file complex, often changed, little covered and with survivors is the first risk of the report. Every Danger Zone file appears there or in a §7 row, or §2 says why it is no risk (a planned migration churning it). High and critical vulnerabilities are §7 rows too.
- §8 `Actions` — each action names its file or block, the figure it moves and the skill that carries it when one does (`/business-spec`, `/plan-implementation` for a refactoring of a Danger Zone file).
- §9 `What the measures cannot see` — the blind spots of this run, concrete: every block `missing` or `skipped`, `since`-mode Stryker, coverage that executes a line without asserting it, issues hidden by suppressions, churn from a planned migration read as instability, complexity reset when code moves between files, cyclomatic complexity blind to type-level logic.
- Any section whose evidence is `missing` → `Missing — <reason>.` in place of its tables.

### JSON

Schema version `2.0`, field by field, and the traps → `references/json-schema.md`. The workflow assembles it from the fragments its agents write (`cctoolkit report-assemble`): no figure is copied twice, `tests.total` is summed, an unknown first-level key is refused. Two traps cost a whole report: issue counts come from `api/issues/search` with `&resolved=false`; `coverage.lines`/`branches` are whole-project SonarQube numbers, not ReportGenerator or Jest ones.

### No trending in the report

A report is a snapshot at instant T: no "Trend" column, deltas or comparisons with the previous report. Comparing reports is the job of whatever reads the JSON history; the Markdown holds today's raw values only.

### Writing tone

Partial, non-complacent. Goal: an honest, precise view of how solid the codebase really is — not a celebration of the work done.

- Good numbers are facts, not achievements: "4,383 tests pass".
- Fragile zones, blind spots and insufficient scores get more space than the positives; "What works well" stays short, "What must improve" is long and precise. Stryker at 61% overall is insufficient, not "correct"; branch coverage at 65% is not ✅.
- Avoid reassuring phrasing ("the base is healthy", "the infrastructure is mature") — confidence without information.
- ✅ is for zones with zero known problem. Any doubt → ⚠️.
- Every metric gets a real interpretation, not just a value. Example: "65.7% branches — one `if` in three is never tested both ways."

### Coherence checks

Arithmetic first, then judgement.

1. **Arithmetic, by script** — `cctoolkit quality-report-check <report.json>`: per-type sums against totals, `active + skip = total` on endpoints, recomputed coverage and detection percentages, severity sum vs `issues_open_total`, duration thresholds, evidence statuses (a block not measured holds no number, a measured one belongs to the report commit), hotspot counts, and the `codebase.*` blocks: rules with and without a test summing to the rules, suppressions and vulnerabilities summing per kind, layer and severity, the cross holding every Danger Zone file and no mutant figure when Stryker is not measured. 🔴 → fix the fragment and the Markdown section it feeds, re-assemble, re-run. ⚠️ → carry into the report as ⚠️.
2. **Markdown ↔ JSON** — every figure of §1 matches its detailed section and the JSON exactly. `endpoints_skip > 0` is not uncovered: test exists, disabled.
3. **Parameterised tests** — `contract_executed > contract_methods` is normal: add the note `(including parameterised tests)`.
4. **Skipped tests, §3 ↔ §4** — skipped ContractTests match §4's `[Skip]` endpoints.
5. **Coverage, §1 ↔ §3 ↔ §6** — §1 reference figure = ReportGenerator (combined coverage), SonarQube beside it. Present both without contradiction.
6. **Code size, §2 ↔ JSON** — `Code size` tables = `codebase.size` exactly; shares recomputed from the lines, not estimated. A heavy layer with low coverage or a thin test project facing it is a §7 risk, not a footnote.
7. **Status icons** — ✅ in §1 never described as a problem in §7 or §9; ⚠️ in §9 has a matching entry in §7. Correct in favour of the most precise description.
8. **Evidence** — no ✅ on a block whose status is not `measured`; every `missing` and `skipped` block named in §9 `What the measures cannot see`.
9. **Hotspots, §2 ↔ §7** — every file of `activity.hotspots.danger_zone_top` and `worst_function_top` in the §7 cross table or explained in §2.
10. **Hotspots, by hand** — two listed files, checked against git and the tool: `git log --follow --no-merges --numstat --since=<window_from> -- <file>` gives the window's commits (minus creation, pure renames, ignored revisions), `lizard <file>` the worst function's score. A gap means a rename lost or a parser that lost function boundaries: say it in §9, never correct the figures by hand.
