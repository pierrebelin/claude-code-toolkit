# scripts

Repo-wide scanners and one-shots — never a hook: a hook fires per edit, a scan reads the whole repo. Every script needs `python3`.

## `bin/cctoolkit`

On the Bash tool's `PATH` while the plugin is enabled. `cctoolkit <script>` runs `scripts/<script>`, `cctoolkit doctor` and `cctoolkit bulk-read` the [tools](../tools/README.md), `cctoolkit context-report` `lib/context-report.sh`, `cctoolkit evals` the [evals](../evals/README.md), `cctoolkit list` every command, `cctoolkit root` the plugin directory. Skills, agents and references call scripts only through it, never by path.

## Scripts

| Command | Role |
|---------|------|
| `detect-stack` | stack, test framework, product, and how many use-case folders each preset recognises — the model-free half of `/cctoolkit:kit-init` |
| `rules-coverage` | rules ↔ tags, repo-wide (a rule sheet without anchors is read by its `Business rules` / `Règles métier` title); `--ids <sheet>` lists the DDD/APP/PERF ids the sheet never cites; `--json` for the quality report |
| `untagged-tests` | tests carrying no rule tag; `--json`: counts per category and suite |
| `migrate-anchors` | one-shot: appends the `<!-- kit:… -->` anchors to documents written before them — dry run by default, `--apply` writes |
| `turn-batching-check` | tool-call batching, context fill per tool, `read-bounds` denials and forcings followed by an edit — main chain, then subagents (`<session>/subagents/`); `--save-baseline` / `--compare` |
| `quality-report-check` | checks a `docs/metrics/quality-report-*` pair: arithmetic, evidence statuses (`measured`, `not_configured`, `skipped`, `missing`: a block not measured holds no number, a measured one belongs to the report commit), hotspot counts, the `codebase.*` blocks of `audit-collect` and `risk-cross` |
| `audit-worktree` | the quality report's throwaway worktree: `create` (detached at the main branch's commit, in the system temp, the untracked kit config copied, leftovers pruned first), `remove`, `prune` |
| `audit-collect` | the quality report's model-free measures in one JSON: `hotspots`, `rules-coverage` + `untagged-tests` as one traceability block, suppressions counted at the commit, dependency vulnerabilities (`dotnet list package --vulnerable` / `npm audit`), `access-cost --all`; each block `{status, reason, commit}`, `missing` rather than a guess |
| `risk-cross` | Danger Zone × per-file coverage (SonarQube generic, Cobertura or lcov) × Stryker survivors (`mutation-report.json`), for §7; a side not measured stays `null` |
| `report-assemble` | merges the audit's fragments into the report JSON: later wins, `tests.total` summed, an unknown first-level key refused |
| `bg` | detached jobs a Workflow agent waits for in bounded calls: `start <name> -- <cmd>`, `wait <name> --seconds N` (0 done, 1 failed, 3 running), `status`, `stop`, `log` — Stryker and SonarQube outlast a Bash call |
| `hotspots` | churn × complexity per source file (`layout.sources`), renames followed, creations, pure renames, merges and `.git-blame-ignore-revs` left out, ranked over a window ending at the commit date (`--days`, 365) with the whole history beside it, `fix:` commits counted; cyclomatic complexity by lizard, `missing` without it; Danger Zone ranked on the total complexity, then on the worst function — Markdown, or `--json` for `activity.hotspots` of the quality report |
| `audit-capture` | the deterministic audit material in one file, so `/verify-ddd-tdd` opens it once; `--base <work>` (the run work file) limits the diff to the batch's own files; `--suites-green <S1,S2>` writes the `suites-green` marker beside the output, read by `lib/guard-auditor.sh` |
| `pre-audit` | the mechanical gate before `/verify-ddd-tdd` — red means no fork. Gate 8 (opt-in, `layout.sources.languageGuard`) lists French sentences added to production literals; gate 9 (opt-in, `layout.integrationGuard`) asks for a changed integration test or a waiver when persistence code changes |
| `access-cost` | awaited Infrastructure calls read off the syntax tree with ast-grep; C# only; `--base <work> FX` flags only the lines the batch added against `HEAD`; `--all --json` scans every source file for the quality report |
| `install-git-hooks` | links `settings.local.json` into new worktrees, for a plugin enabled at local scope |
| `plan-next-batch` | `run-plan`'s scheduler: next runnable batch of a plan's `### Batch execution` table, `--check`, `--next`, `--outside`, `--exclude`, `--skip FX,FY` (batches set aside by the run — read as not done, never launched, nor their dependents; `--next` lists them as `held`), `--context` |
| `sheet-cycles` | the `## Cycles` json block of a batch sheet: `--index` validates it (names, paths, one test project, 4 test / 8 production files per cycle, disjoint waves; exit 2 = no block), `--cycle ID --red\|--green` prints one cycle's contract, `--done`/`--methods`/`--summary` read the cycle states for `pre-audit` and `audit-capture` |
| `run-question` | questions a running `run-lot`/`run-plan` asks, as lines of `run/.work.jsonl`: `ask`/`wait` (workflow side), `watch`/`pending`/`answer` (session side) |
| `run-work` | the run work file `run/.work.jsonl`: `append`, `journal`, `drop`, `tmp` (temp folder for logs, never under `run/`), `purge` (every run: lines no run needs dropped, 3 runs kept) and `migrate` (older `.work/`, `.travail/`, `lots/` layouts folded in once) |
| `batch-baseline` | the files of one batch against `HEAD`, the files the user had already modified at batch start left out (a `preexisting` line of hashes in `run/.work.jsonl`, no content): `snapshot <work> FX`, `diff <work> FX [--code] [--name-only]`, `base <work> FX <path>`, `restore <work> FX [--save <patch>]` sets a blocked batch aside, `commit <work> FX --sheet <sheet>` is the batch commit, the kit's only one |
| `batch-wallclock` | wall clock of an `/implement-tdd` batch |
| `kit-diff <repo>` | a manual copy against the kit: MISSING / ADDED / DRIFT / MERGED, plus anonymisation alerts — the migration's first step |
| `remove-copy` | the migration's deletion: DELETE the files the kit ships, KEEP the repo's own skills and scripts, MOVE a file added inside a kit skill, ORPHAN the repo's eval cases — dry run, `--apply` deletes |
| `learn-candidates` | the model-free half of `/learn`: the `## Audit gaps` of the `run-lot` reports (`todo/*/run/batches/FX.md`, kept after the transcripts are cleaned up), then the auditor sub-transcripts, a gap found in both counted once; reads French verdicts (`## Verdict — ECARTS`) and a `learn-state.json` written with French keys, saves it back in English |

## Adapting

| File | What to change |
|------|----------------|
| `access-cost.py`, `access-cost/` | `.cs` and the ast-grep rules — C# only |
| `pre-audit.sh` § 7 | `Assert.…(_fixture.…Repository…)`, `Received/CallCount/Called`: the spy and double-state idioms of the test framework; the suites it reads are `layout.tests.interaction` |
| `pre-audit.sh` § 8 | the French function words that mark a sentence; the guard test and its exclusions are `layout.sources.languageGuard` |

Paths, markers and commands come from `kit.config.json` through `lib/kit_config.py` — never a constant in a script.
