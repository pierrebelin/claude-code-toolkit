# /learn — archived in 2.17.0

The kit no longer ships `/learn`. These files are kept for the record only: nothing wires,
calls or tests them, and they are not maintained.

## Why

Measured on two installed .NET repos over 60 days of transcripts (2026-11-20): 0 invocations of
`/learn`, while the doctor printed its `NOTE learn` backlog at every session start (64 gaps across
24 batches on one repo) — a reminder never acted on, for a skill whose description sat in every
session's skill listing.

## What was here

| File | Was |
|------|-----|
| `skills/learn/` | the skill: grouped the gaps recurring in past verdicts (≥ 3 batches, at most 3 motifs per axis) into motifs, wrote each accepted one into a rule, an audit criterion or a mechanical check and retired the lines it made useless; `/learn memory` audited the auto-memory |
| `scripts/learn-candidates.py` | its model-free half: the `## Audit gaps` of the `run-lot` reports, then the auditor sub-transcripts, a gap found in both counted once; state in `.claude/learn-state.json`; `--count` fed the doctor's `NOTE learn` |
| `evals/learn-candidates.json` | the script's recorded cases |

Also removed in the same change: the doctor's `NOTE learn`, the `learn-state.json` lines of
`templates/claude.gitignore`, and `learn-candidates.py` among the parsers of the verdict literals
(`docs/FROZEN-LITERALS.md`). The history is in `CHANGELOG.md` § 2.17.0 and in git.
