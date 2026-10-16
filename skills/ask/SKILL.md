---
name: ask
description: "Use when the user asks how the product behaves or why — a business rule, a use case, a decision, what a handler must guarantee — or before changing a handler outside the kit's flow. Answers from the business knowledge base through `cctoolkit ask`, each fact cited by its id, without reading the base's files whole."
argument-hint: "<question> | <id> | <Handler>"
---

# Ask the knowledge base

Answers from the knowledge base (`knowledge.root` of `.claude/kit.config.json`). Formats → `skills/knowledge-sync/references/knowledge-format.md`, opened only when an answer turns on one.

$ARGUMENTS

## Levels

Cheapest first; stop at the one that answers.

0. **Map** — `<root>/INDEX.md`, read whole: the contexts, their prefix and summary. Skipped when the question names its context.
1. **Context** — `cctoolkit ask --context <C>`: its use cases and rules, one line each; `<root>/<C>/OVERVIEW.md` for its vocabulary, lifecycle and neighbours.
2. **Objects** — `cctoolkit ask "<question>" [--context <C>] [--kind usecase|rule|decision|adr]`: ranked cards. Then `cctoolkit ask --id <id>[,<id>]` for the one to three that answer, whole. An id as the argument → `--id` at once; a handler name → `--handler <Name>`; how something changed → `--history [--context <C>] [--id <id>]`.
3. **Source** — the code an object names, or the `path:line` of its observed line: a bounded `Read` around that line. Only when the base leaves the question open.

Questions that do not depend on each other go in one message.

## Reading the output

- `shown N of M`, N below M: the budget cut — narrow with `--context`, `--kind` or `--id`, never a larger `--budget` first.
- `shown 0 of 0`: rephrase once with the other vocabulary — the base is written in `language.docs`, the code in its own names (`archive` / `ArchiveProductCommandHandler`). Still nothing: the base does not cover it; say so, offer to look in the code.
- An object marked `observed <level>` is deduced from the code, not validated: say so beside the fact, with its source.
- Exit 1 (no base): say so, propose `/cctoolkit:knowledge-sync`.

Never `Read` a context's `rules.md`, `decisions.md` or `HISTORY.md` whole: `read-bounds` refuses it, `ask --id` gives the object.

## Answer

The answer first, in the user's language; each fact followed by its id (`CAT-RM-003`), an `observed` one by its level and source. A rule, its outcome in code (`ProductNotPublishedException`). Several contexts involved: one line per context.

The base is never written here. The code contradicts an object, or an object is missing → say it, with `path:line`, and propose `/cctoolkit:knowledge-sync <Context>`.
