# tools

Run as `cctoolkit <name>`.

| Tool | Role |
|------|------|
| `doctor` | read-only readiness check, one line per check (`ok` / `WARN` / `FAIL`, each non-ok naming the command that repairs — it never repairs itself): binaries, plugin enablement, hook wiring, manual-copy leftovers, rules, config, git hook, graph, a knowledge base `INDEX.md` behind the base, a knowledge-base merge staged and never written, `/tmp` leftovers, `/learn` backlog as a `NOTE`. Runs `--quiet` on `SessionStart`, silent when healthy save for that `NOTE`. Validates `kit.config.json`: JSON, keys, preset, regexes, `testTag`, `knowledge` (root, context prefixes — format, duplicates, a context folder without one —, budgets), and whether each root matches a directory — a hook never reports a broken config, the doctor is where that shows. `--evals` also runs the hook evals; `CLAUDE_DOCTOR_ROOT` points it at another checkout; `CLAUDE_DOCTOR_BUDGET_LINES=<n>` adds a `NOTE` when the repo's `.claude/` instruction folders hold more than `n` lines |
| `bulk-read` | one-shot question on named files to a tool-less `claude -p` worker (haiku by default); only the answer enters the caller's context. Named as the third way out of a bound denial. Not for editing or searching |

`doctor` needs `bash`, `jq`, `python3` and `perl`, and reports each as a `FAIL` when missing. `bulk-read` needs `jq` and `claude`.
