# evals

`run.sh` + `cases/*.json`: recorded hook payloads replayed through the hooks, checking the decision, the rewritten command, the appended prompt or the injected context (~30 s). Run from this checkout with `bash evals/run.sh`, or anywhere with `cctoolkit evals`. `{{KIT}}` in a case is the kit directory.

Every hook case is also timed: `LATENCY_MAX_MS`, 80 ms by default; `LATENCY_SLOW_HOOKS` for the per-hook exceptions. Needs `perl` for the millisecond timer — without it, no latency budget.

Every defect found in production becomes a case; a hook change without a case is not finished.
