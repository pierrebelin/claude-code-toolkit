# evals

`run.sh` + `cases/*.json`: recorded hook payloads replayed through the hooks, checking the decision, the rewritten command, the appended prompt or the injected context — or a script command (`cmd`) run on a fixture, checking its output and exit code. Run from this checkout with `bash evals/run.sh`, or anywhere with `cctoolkit evals`; CI replays them on every push, pull request and release tag (`.github/workflows/ci.yml`). `{{KIT}}`, `{{FIX}}`, `{{ROOT}}` and `{{SID}}` in a case: the header of `run.sh`.

A case needing a tool (`rtk`, `ast-grep`) names it in `requires`, on the case or the file: where the tool is missing, the case is skipped and counted apart (`N passed, M failed, K skipped`) instead of passing on an empty answer. CI sets `CCTOOLKIT_EVALS_STRICT=1`, under which a skipped case fails the run. A case whose `hook` does not exist fails.

Every hook case is also timed: `LATENCY_MAX_MS`, 80 ms by default; `LATENCY_SLOW_HOOKS` for the per-hook exceptions. Needs `perl` for the millisecond timer — without it, no latency budget.

Every defect found in production becomes a case; a hook or script change without a case is not finished.
