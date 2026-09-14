---
name: bulk-read
description: "Answer a question over files you can already name without reading them into this context: one-shot haiku worker, no tools, ~500 fixed tokens, 8 s. Use for 'what does X do', 'which rules', 'which dependencies', 'compare these two' across 1-10 files. Never for an edit (no exact content back), a search (worker reads only what it is given) or a debug (summary is not evidence; worker missed a thread-safety bug the main model caught at once)."
---

```bash
bash .claude/tools/bulk-read --question "<question>" --paths <file1> [<file2> ...] [--model sonnet]
```

Each call standalone. Follow-up resends same `--paths`: files go to worker, never this context — resend costs nothing here.

`haiku` (default): inventories, summaries. `--model sonnet`: judgment needed (design, cross-file consistency). Before edit, Read exact range with `offset`/`limit`: answer carries line numbers, not content. Debugging, architecture, safety-critical analysis stay here: worker summary = lead, never proof.
