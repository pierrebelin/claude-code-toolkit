# Correction mode — `batch FX — correction: [manual finding]`

Read **only** when the argument carries `— correction:`. A plain `batch FX` never opens it.

1. Read global plan, batch sheet and finding — **in a single message**. Locate the behaviour, the RM/CU and the scenario concerned.
2. Finding changes scope, an RM/CU or a design decision absent from the plan → stop, route to `/business-spec` or `/plan-implementation` before coding.
3. Otherwise add under the affected behaviour a sub-step `Correction Cn — [finding]` with `TDD: RED ⬜ · GREEN ⬜ · COST ⬜`. Keep the previous ✅ evidence: don't erase it, don't skip this correction.
4. Resume the RED → GREEN → REFACTOR → COST loop for that correction, then the batch's final audit.

Rest of the workflow unchanged: same delegation contracts, same `## RED` relay, same delegated audit, same closing through `closing.md`.
