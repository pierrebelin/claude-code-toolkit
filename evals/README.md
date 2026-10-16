# evals

`run.sh` + `cases/*.json`: recorded hook payloads replayed through the hooks, checking the decision, the rewritten command, the appended prompt or the injected context — or a script command (`cmd`) run on a fixture, checking its output and exit code. Run from this checkout with `bash evals/run.sh`, or anywhere with `cctoolkit evals`. `{{KIT}}`, `{{FIX}}`, `{{ROOT}}` and `{{SID}}` in a case: the header of `run.sh`.

Every hook case is also timed: `LATENCY_MAX_MS`, 80 ms by default; `LATENCY_SLOW_HOOKS` for the per-hook exceptions. Needs `perl` for the millisecond timer — without it, no latency budget.

Every defect found in production becomes a case; a hook or script change without a case is not finished.
