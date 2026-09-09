# Correction mode — `batch FX — correction: [manual finding]`

Read this file **only** when the argument carries `— correction:`. A plain `batch FX` never opens it.

1. Read the global plan, the batch sheet and the finding — **in a single message**. Locate the behaviour, the RM/CU and the scenario it concerns.
2. If the finding changes the scope, an RM/CU or a design decision absent from the plan, stop and route to `/business-spec` or `/plan-implementation` before coding.
3. Otherwise, add under the affected behaviour a sub-step `Correction Cn — [finding]` with `TDD: RED ⬜ · GREEN ⬜ · COST ⬜`. Keep the previous ✅ evidence: do not erase it and do not skip this correction.
4. Resume the RED → GREEN → REFACTOR → COST loop for that correction, then the batch's final audit.

The rest of the workflow is unchanged: same delegation contracts, same `## RED` relay, same
delegated audit, same closing through `closing.md`.
