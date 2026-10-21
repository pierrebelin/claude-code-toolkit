# evals

`run.sh` + `cases/*.json`: recorded hook payloads replayed through the hooks, checking the decision, the rewritten command, the appended prompt or the injected context — or a script command (`cmd`) run on a fixture, checking its output and exit code. Run from this checkout with `bash evals/run.sh`, or anywhere with `cctoolkit evals`; CI replays them on every push, pull request and release tag (`.github/workflows/ci.yml`). `{{KIT}}`, `{{FIX}}`, `{{ROOT}}` and `{{SID}}` in a case: the header of `run.sh`.

A case needing a tool (`rtk`, `ast-grep`) names it in `requires`, on the case or the file: where the tool is missing, the case is skipped and counted apart (`N passed, M failed, K skipped`) instead of passing on an empty answer. CI sets `CCTOOLKIT_EVALS_STRICT=1`, under which a skipped case fails the run. A case whose `hook` does not exist fails.

Every hook case is also timed: `LATENCY_MAX_MS`, 80 ms by default; `LATENCY_SLOW_HOOKS` for the per-hook exceptions. The timer is bash's `$EPOCHREALTIME`, `perl` under a bash older than 5 (macOS) — without either, no latency budget. The run ends on its duration; `--profile` adds the slowest files and cases.

The case files run side by side, one child runner per file (`-j N` or `EVALS_JOBS`, by default the CPU count up to 6; a bash older than 4.3 runs them one by one): each has its own run id, fixtures and `/tmp` files, its output is printed in the files' order, its counts summed. Hooks timed beside other runners read slower, so a parallel run shows the latency table without failing on it; `-j 1` enforces the budget, as CI does. A case file timing a hook against the clock declares `"serial": true`: it runs last, alone.

`--changed` runs only the case files the checkout's uncommitted changes reach (`--list` names them, runs nothing): a changed file's name, the hooks, scripts, tools and workflows citing it, then every file sourcing or importing a `lib/` module reached; a change to `evals/run.sh` or `hooks/hooks.json` runs everything, prose reaches nothing. A shortcut while working — the full run, which CI makes on every push, stays the reference.

The runner forks as little as it can — one `jq` per case file to read its cases, one per case to check it, placeholders expanded in bash: under Git Bash a fork costs ~100 ms, and a case is a few of them on top of its hook.

Every defect found in production becomes a case; a hook or script change without a case is not finished.
