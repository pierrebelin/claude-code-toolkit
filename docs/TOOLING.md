# Tooling details — RTK, graphify, worktrees, bootstrap

Opened on demand. `CLAUDE.md` keeps the standing rules and the traps; the measurements and the
procedures live here.

Adapt the bootstrap section to the repo: it is the only one that is not portable as is.

## RTK

Token-optimized CLI proxy (`~/.local/bin/rtk`, see `~/.claude/RTK.md`). **Rewriting is
automatic**: the `PreToolUse:Bash` hook (`bash-dispatch.sh`, module `.claude/lib/rewrite-rtk.sh`) routes every Bash command through
`rtk hook claude`, which rewrites `find`, `ls`, `cat`, `grep`, `git diff` and more. Do not prefix
by hand.

Measured savings on a .NET repo of this shape (not the advertised 60-90 %): `find` 98.7 % ·
`ls` 69 % · `git diff` 25 % · `read` 15 % · **`grep` 0 %**. Re-measure per repo before quoting
them — `rtk gain [--history]`.

- The rewrite is skipped when the output is captured or reshaped — `cmd | wc -c`, `$(cmd)` — and
  on `sed -n 'X,Yp'`. Deliberate: rewriting would change what the caller parses.
- **`rtk grep` mangles its output** (`6 matches in 0 files`, no file names). When the actual match
  text is needed, use `rtk proxy grep ...` — `proxy` runs the raw command unfiltered.
- `dotnet test` is **not** auto-prefixed: add `rtk` by hand.
- `rtk discover` counts commands **as emitted**, before the hook rewrites them. Its "missed
  savings" figures are largely already captured — do not act on them without measuring.

## graphify

AST knowledge graph in `graphify-out/`, binary `~/.local/bin/graphify`.

- Architecture/codebase question → read `graphify-out/GRAPH_REPORT.md` (god nodes, communities).
- `graphify update .` (AST only, no API cost).

**`update` refuses to write when the graph shrinks.** Missing-chunks guard:
`WARNING: new graph has N nodes but existing graph.json has M. Refusing to overwrite`. A drop is
normal after a refactor that deletes code — rerun with `--force`. Trap: **`update` exits 0 even
when it writes nothing** (guard refusal, "Nothing to update"). Neither the exit code nor stdout
proves the write — only the mtime of `graph.json` does.

**Auto-sync** (`Stop` hook → `.claude/hooks/graphify-autosync.sh`): triggered by a working-tree
fingerprint (`.claude/lib/graphify-freshness.sh`, source mtimes vs `graph.json`), not by an Edit/Write flag —
so it also catches IDE edits, merges, pulls and branch switches. Lock against concurrent
rebuilds. Log: `/tmp/graphify-hook.log`.

## Bringing a worktree back onto the local branch

`ExitWorktree` transfers nothing (`keep` or `remove` only). The transfer creates no commit, and
asks for the user's approval at the apply step:

```bash
git -C <worktree> add -N .            # makes new files visible to the diff (asks for approval)
git -C <worktree> diff HEAD > /tmp/wt.patch
git apply /tmp/wt.patch               # applies to the working tree, no commit (asks for approval)
```

## Bootstrap

Repo-specific — replace this section when installing the toolkit. What it must answer:

- the one-off restore command, if the feed is not reachable from every machine;
- whether `--no-restore` is mandatory on build/test/publish, and why;
- the purge to run when the restore fails or drags (`bin`/`obj` removal);
- per-OS SDK paths, when host and container share the workspace.
