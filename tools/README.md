# tools

Run as `cctoolkit <name>`.

| Tool | Role |
|------|------|
| `doctor` | read-only readiness check: binaries, plugin enablement, hook wiring, manual-copy leftovers, rules, config, git hook, graph, `/tmp` leftovers, `/learn` backlog as a `NOTE`. Runs `--quiet` on `SessionStart`, silent when healthy save for that `NOTE`. Validates `kit.config.json`: JSON, keys, preset, regexes, `testTag`, and whether each root matches a directory — a hook never reports a broken config, the doctor is where that shows |

Needs `perl`.
