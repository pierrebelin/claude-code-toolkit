# tools

Run as `cctoolkit <name>`.

| Tool | Role |
|------|------|
| `bulk-read` | one-shot, tool-less haiku worker answering a question over files you can already name — ~500 fixed tokens, the files never enter the calling context. Needs the `claude` CLI logged in; otherwise exits with a clear message (`claude not found`, `Not logged in`) and the caller falls back to a bounded read. Used by `/bulk-read` and named in the `read-bounds` refusals |
| `doctor` | read-only readiness check: binaries, plugin enablement, hook wiring, manual-copy leftovers, rules, config, git hook, graph, worker login, `/tmp` leftovers, `/learn` backlog as a `NOTE`. Runs `--quiet` on `SessionStart`, silent when healthy save for that `NOTE`. Validates `kit.config.json`: JSON, keys, preset, regexes, `testTag`, and whether each root matches a directory — a hook never reports a broken config, the doctor is where that shows |

Both need `perl`.
