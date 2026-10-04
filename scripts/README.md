# scripts

Repo-wide scanners and one-shots — never a hook: a hook fires per edit, a scan reads the whole repo. Every script needs `python3`.

## `bin/cctoolkit`

On the Bash tool's `PATH` while the plugin is enabled. `cctoolkit <script>` runs `scripts/<script>`, `cctoolkit doctor` / `bulk-read` the [tools](../tools/README.md), `cctoolkit evals` the [evals](../evals/README.md), `cctoolkit list` every command, `cctoolkit root` the plugin directory. Skills, agents and references call scripts only through it, never by path.

## Scripts

| Command | Role |
|---------|------|
| `detect-stack` | stack, test framework, product, and how many use-case folders each preset recognises — the model-free half of `/kit-init` |
| `rules-coverage` | rules ↔ tags, repo-wide; `--ids <sheet>` lists the DDD/APP/PERF ids the sheet never cites |
| `untagged-tests` | tests carrying no rule tag |
| `migrate-rm-traits` | one-shot: `Tests` column → tags |
| `migrate-anchors` | one-shot: appends the `<!-- kit:… -->` anchors to documents written before them — dry run by default, `--apply` writes |
| `turn-batching-check` | tool-call batching, context fill per tool, `read-bounds` denials; `--save-baseline` / `--compare` |
| `quality-report-check` | checks a `docs/metrics/quality-report-*` pair |
| `audit-capture` | the deterministic audit material in one file, so `/verify-ddd-tdd` opens it once |
| `pre-audit` | the mechanical gate before `/verify-ddd-tdd` — red means no fork |
| `access-cost` | awaited Infrastructure calls read off the syntax tree with ast-grep; C# only |
| `install-git-hooks` | links `settings.local.json` into new worktrees, for a plugin enabled at local scope |
| `batch-wallclock` | wall clock of an `/implement-tdd` batch |
| `kit-diff <repo>` | a manual copy against the kit: MISSING / ADDED / DRIFT / MERGED, plus anonymisation alerts — the migration's first step |
| `learn-candidates` | the model-free half of `/learn` |

## Adapting

| File | What to change |
|------|----------------|
| `access-cost.py`, `access-cost/` | `.cs` and the ast-grep rules — C# only |
| `pre-audit.sh` § 7 | `Assert.…(_fixture.…Repository…)`, `Received/CallCount/Called`: the spy and double-state idioms of the test framework; the suites it reads are `layout.tests.interaction` |

Paths, markers and commands come from `kit.config.json` through `lib/kit_config.py` — never a constant in a script.
