---
name: quiz
description: "Use to check that the user understands what will happen or how something works: a short open-question quiz on an implementation plan (offered at the end of /plan-implementation, before any run) or on a feature, context, use case or handler (from the knowledge base). Grades each answer, points to what to re-read, writes nothing."
argument-hint: "<plan path> | <feature, context, use case, id or handler>"
---

# Comprehension quiz

Generating is cheap, understanding is not. A plan run by `run-plan` takes choices without the user; a feature known only through an agent's summary is not known. This quiz checks, in a few open questions, that the user can say what will happen and why — before it happens, or before they change it.

$ARGUMENTS

Argument a global plan (`todo/<code>/<CODE>-PLAN.md`) or one of its sheets (`…-PLAN-FX.md`) → **plan mode**. Anything else — a feature, a bounded context, a use case, an id (`CAT-RM-003`), a handler name → **subject mode**. No argument → AskUserQuestion: the plan just written in this session (recommended, when there is one) or a subject.

## 1. Sources

Read once, never again during the quiz.

- **Plan mode.** Plan already in this session's context (called from `/plan-implementation`) → read nothing. Otherwise: the global plan whole, then for each sheet only its `## Intent`, `## Decisions` and `## Assumptions` (`grep -nE '^## '` for the line ranges, bounded `Read`). Never the `## Code elements` nor `## Cycles` blocks: the quiz is not about names and paths.
- **Subject mode.** The knowledge base by levels, as `/cctoolkit:ask` does: `cctoolkit ask --context <C>`, then `cctoolkit ask "<subject>" --context <C>`, then `cctoolkit ask --id <id>[,<id>]` for the two to five objects that carry the subject. An id or handler as argument → `--id` / `--handler` at once. No base, or the base does not cover it → the handler's `CLAUDE.md` rule sheet and a bounded `Read` of the handler; say the quiz rests on the code, not on validated knowledge. An object marked `observed`: a question on it says so.

## 2. Questions

Three to five, written before asking the first; each holds back its expected answer and its source (plan section and batch, or object id). Ask about what the user must own, never about what a reader looks up:

| Plan mode | Subject mode |
|---|---|
| what changes for a user of the product once the plan is delivered | what the use case does, from trigger to outcome |
| which batch carries the riskiest change, and why | a business rule and what happens when it is broken |
| a decision of a sheet: the choice and the alternative it rejected | why a decision was taken, the alternative it rejected |
| what is out of scope, or an existing behaviour that must survive | a neighbour context it depends on, or that depends on it |
| an assumption the run will take without asking | an edge case the rules settle |

Pick the rows the sources actually feed; never a question whose answer is not in them. No class, file, path or id to recall, no yes/no, no multiple choice: an option to pick shows recognition, not understanding.

## 3. Asking

One question per message, in plain text, in the user's language, numbered (`1/4`). Wait for the answer. The user says skip, stop, or answers "I don't know" → that question is `missed` without comment, next one; "stop" ends the quiz at the summary.

Grade each answer as soon as it comes, in two lines at most:

- `understood` — the substance is there, whatever the wording.
- `partial` — the point missing, in one sentence, with its source.
- `missed` — the expected answer in one or two sentences, with its source.

Never argue a grade twice: the user disagrees → state the source, move on.

## 4. Summary

One line: `n/N understood`, then one line per `partial` or `missed`: what to re-read, by section or id.

**Plan mode** — a wrong answer may be the plan's fault, not the reader's:

- The answer matches the plan but the user meant otherwise → a decision to change: name the sheet and decision, and propose to fix the plan before any run.
- The plan says it, but ambiguously, or only in a sheet's `## Code elements` → propose one sentence to add or reword, with its section.
- Nothing missed → `run-plan` can start.

Every fix to the plan is applied only on the user's word, in the plan and sheets only; then the usual next step of `/plan-implementation` stands. Nothing else is ever written: no file, no memory, no knowledge base.

**Subject mode** — the code contradicts an object, or an object is missing → say it with `path:line` and propose `/cctoolkit:knowledge-sync <Context>`, as `/cctoolkit:ask` does.
