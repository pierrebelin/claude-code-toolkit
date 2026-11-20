# run-replay — archived in 2.17.0

The kit no longer ships the `run-replay` workflow. These files are kept for the record only:
nothing wires, calls or tests them, and they are not maintained — the script commands they call
are gone (below), so they would not run as they are.

## Why

Measured on two installed .NET repos over 60 days of transcripts (2026-11-20): 0 runs.

## What was here

| File | Was |
|------|-----|
| `workflows/run-replay.js` | the workflow: a batch (or every batch ✅ DONE of a plan) already delivered, replayed read-only — its commits found by their `Kit-Batch` trailer, each cycle's tests and the suites its commits reach rerun, `--red` re-observing each RED without the batch's production code, its audit; report `run/batches/FX-replay.md` (`## REPLAY — PASSED`/`FAILED`) |
| `evals/run-replay-flow.js` | its flow test against stubbed agents |
| `evals/run-replay.json` | the cases that ran the flow test |

Also removed in the same change: `/implement-tdd replay …`, `cctoolkit batch-baseline replay` and
`red` (and the `replay` branch of its `diff` and `base`), the `replay` line of the run work file
(`lib/work_file.py`, `run-work purge`, `audit-capture`), `cctoolkit sheet-cycles --tests`, their
eval cases, and the README and frozen-literal entries describing them. The history is in
`CHANGELOG.md` § 2.17.0 and in git.
