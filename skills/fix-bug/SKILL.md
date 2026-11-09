---
name: fix-bug
description: "Use when the user brings a bug (ticket, failing behaviour) to fix: checks it is not already fixed, diagnoses the cause in a read-only subagent, settles with the user whether it is a bug or a spec gap, writes a one-batch fix plan, then launches the run-fix workflow (RED, GREEN, diff audit, knowledge base updated)."
argument-hint: "<ticket text or id> [--code <code>]"
---

# Fix a bug — cause, one decision, then the workflow

One stop only: the user validates the cause and the verdict (§2). Everything after it is the `run-fix` workflow (`workflows/run-fix.js`): no plan mode, no estimate turn, no full suite, no manual test writing.

$ARGUMENTS

Code: `--code <code>` when given, else the ticket id lowercased (`fix-1234`), else `fix-<short-slug>`. Folder `todo/<code>/`, `<CODE>` = the code uppercased.

## 0. Already fixed?

Before any diagnosis, one message: `git log --oneline -15 -- <folders the ticket names>` and `git log -S '<distinctive literal or symbol of the ticket>' --oneline -10`. A commit naming the behaviour → read its diff, run the existing test that covers it (narrowest filter). Green and covering the ticket's scenario → say so, stop: nothing to fix. Green but no test observes the scenario → write that regression test here, through the repo's test skill of its level (`tests-unit-tests` …), run it filtered, and stop: no plan, no workflow — a test green at its first run is no TDD cycle, `run-lot` would refuse it. The fixing commit's message names the ticket.

## 1. Diagnosis — delegated, read-only

One `Agent`, `subagent_type: Explore`, `model: sonnet`. Brief: the ticket verbatim; the suspected handler(s) when the ticket names them; ask for, under 40 lines:

- **Cause** — root cause in two sentences, `path:line` of the faulty decision.
- **Handler** — the use-case handler carrying it, and `cctoolkit ask --handler <Name>` output's rule ids that bind it (id + one-line statement).
- **Reproduction** — the input and state that trigger it, observed result vs expected.
- **Test contract** — level (`UT` unless the faulty line is in Infrastructure → `IT`, or in a WebAPI mapping → contract test), the existing test class and fixture paths for that handler (or `(to create)`), production files to change (at most 8).
- **Rule reading** — does a documented rule already say the expected behaviour (code departs from it), say the opposite or nothing (the rule itself must change), or is the expected behaviour a new capability?

Never diagnose in the main context beyond reading the agent's `path:line` citations, bounded.

## 2. The decision — the one stop

Show the cause, `path:line`, the reproduction and the rule reading in ≤ 10 lines. Then one AskUserQuestion, up to four questions:

1. **Verdict** — the options, the agent's reading first, marked Recommended:
   - **Bug** — a documented rule says the expected behaviour, the code departs from it. The base is right: no delta.
   - **Rule to correct** — an existing rule (id in the base) says the wrong thing or too little; the fix rewrites it. Delta `kit:modified` on that id.
   - **Spec gap** — the expected behaviour needs a new rule, use case or decision (no id to modify). Stop here: route to `/cctoolkit:business-spec` with the diagnosis as its input. The merge refuses a provisional id, and a new rule deserves its spec.
   - **Not a bug** — the code does what the base says and the base is what the business wants: stop, give the user the answer for the ticket.
2. **Up to three closed business questions** the fix forces (what happens to existing data, which callers keep the old behaviour, an edge case the ticket leaves open), each with 2-4 options. None when the diagnosis leaves nothing open.

The answers are the intent the workflow carries: nothing is asked after this point.

## 3. Write the fix plan

From `references/fix-template.md`, three files under `todo/<code>/`, one `Write` each, in one message: `SPEC-<code>.md`, `<CODE>-PLAN.md`, `<CODE>-PLAN-F1.md`. Fill them from the diagnosis and the answers:

- `SPEC` — verdict **Bug**: no delta heading (the merge prints `nothing to merge`). **Rule to correct**: one `### <ID> — <title> <!-- kit:modified -->` per rule rewritten, its statement whole as corrected — the base text is replaced by it — and `**Applies to**` its use case. A decision the answers overturned: its `<PFX>-D-nnn` heading `kit:modified` too, stating the new decision and why.
- `## Cycles` — one cycle per observable behaviour the fix changes (usually one, at most three), fields per `skills/implement-tdd/references/design.md`; `rmcu` cites the rule id; `methods` named `Should<Result>_When<Condition>`; `closing` `light`.
- Every business answer of §2 lands in the SPEC statement or a cycle `observation`, never only in chat.

Then, one message: `cctoolkit sheet-cycles todo/<code>/<CODE>-PLAN-F1.md --index` and `cctoolkit plan-next-batch todo/<code>/<CODE>-PLAN.md --check`. A failure → fix the file it names, rerun; never launch on a red check.

## 4. Launch

`/effort medium` (`hooks/implement-tdd-guard.sh`). Skill `cctoolkit:run-fix`, argument = `todo/<code>/<CODE>-PLAN.md` as text. Do not watch it: the notification brings the result.

## 5. Relay

From the result, ≤ 15 lines: status, audit verdict and minors, `toReview` entries (decisions the run took alone), knowledge base from `merge` (`written` with its files; absent = nothing to merge, the base already states the rule; otherwise its lines and `next`), and `next`. `BLOCKED` → its reason and `report` path; the plan stays under `todo/<code>/`, a new `/cctoolkit:run-fix` resumes from the saved cycles.

Then the commit message for the knowledge-base diff left in the tree, in the repo's commit language: subject `docs(<context>): <rule> — <one line>`, body = the cause and the decision taken in §2.
