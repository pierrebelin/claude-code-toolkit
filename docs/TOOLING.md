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
- `rtk hook claude` rewrites `dotnet build` but **not** `dotnet test|restore|format`, although the
  `rtk dotnet` filter accepts all four. `rewrite-rtk.sh` closes that gap itself, in command
  position only (start of line or after `; & | (`, behind any `VAR=value` prefixes), so
  `STID_TEST_MODE=true dotnet test ...` is covered and a `dotnet test` quoted inside a heredoc or
  an argument is not. Since the rewrite is ours, `rtk hook claude` sees an already-prefixed command
  and answers nothing — the module emits the `updatedInput` decision itself. Do not prefix by hand.
- **`git grep` output is grouped** by `rewrite-piped-filter.sh git-grep` → `git-grep-filter.sh`: the path becomes
  a per-file header instead of being repeated on every line. `rtk git grep` is a passthrough and
  `rtk grep` would mangle this, hence a local filter. The gain follows path length against content
  length, so it scales with how deep the tree is: measured 2026-09-10, -32 to -48 % on .NET repos
  with ~130-character paths, only -6 % on this one. **Lossless** — rebuilding `path:NN:content` from
  the grouped form diffs byte-identical against the raw output. The header path stays clickable, the
  individual matches do not. Escape hatch: `| cat`.
- `rtk discover` counts commands **as emitted**, before the hook rewrites them. Its "missed
  savings" figures are largely already captured — do not act on them without measuring.

## graphify

AST knowledge graph in `graphify-out/`, binary `~/.local/bin/graphify`.

- Architecture/codebase question → read `graphify-out/GRAPH_REPORT.md` (god nodes, communities).
- `graphify update .` (AST only, no API cost).

**`query` output is filtered automatically** (`rewrite-piped-filter.sh graphify-query` in the Bash dispatch chain pipes
it through `graphify-query-filter.sh`): sourceless nodes dropped, `community=NNN` dropped,
`[src=PATH loc=LNN]` collapsed to the clickable `PATH:NN`. Measured 2026-09-10 across two .NET
repos: -14 to -30 %, every source-carrying node preserved. Fires when the last segment of the
command is a bare `graphify query` — `cd x && graphify query "y"` counts. Escape hatch for the raw
output: append `| cat`.

**Do not lower `--budget`** (default 2000 tokens) to save context. Sourceless nodes are emitted
first, so the budget truncates the tail, which is where the answer is: budget 600 keeps 10 useful
nodes out of 25 where budget 2000 keeps 42 out of 61. Filter the output, do not shrink the traversal.

`explain` is left unfiltered on purpose — it emits 37-500 B and has nothing to trim.

**`affected` fires by itself on a Domain edit** (`affected-blast-radius.sh`, `PreToolUse:Edit|Write`): editing
an aggregate or a value object attaches the blast radius of the edited type, rolled up per project.
The raw output is never injected — 421 lines / 65 kB on a central id, against 8 rolled-up lines. Call
`graphify affected "<symbol>"` by hand for the file:line detail. Since 0.9.58 node ids are
path-qualified, so a bare label can answer `No unique node match`; the hook disambiguates through
`explain` with the edited file's path, and stays silent when that fails.

**`update` refuses to write when the graph shrinks.** Missing-chunks guard:
`WARNING: new graph has N nodes but existing graph.json has M. Refusing to overwrite`. A drop is
normal after a refactor that deletes code — rerun with `--force`. Trap: **`update` exits 0 even
when it writes nothing** (guard refusal, "Nothing to update"). Neither the exit code nor stdout
proves the write — only the mtime of `graph.json` does.

**Auto-sync** (`Stop` hook → `.claude/hooks/graphify-autosync.sh`): triggered by a working-tree
fingerprint (`.claude/lib/graphify-freshness.sh`, source mtimes vs `graph.json`), not by an Edit/Write flag —
so it also catches IDE edits, merges, pulls and branch switches. Lock against concurrent
rebuilds. Log: `/tmp/graphify-hook.log`.

## Project hooks inside a worktree

Only concerns the setup where the hook REGISTRATION was moved out of the shipped, committed
`.claude/settings.json` into `.claude/settings.local.json` — the variant you pick when the hooks
must stay yours and not reach the team. With the shipped `settings.json`, there is nothing to fix:
it is tracked, so a worktree carries it.

In that variant the scripts under `.claude/hooks` and `.claude/lib` stay tracked, but
`.claude/.gitignore` excludes their registration. A worktree is a checkout: it carries the scripts
and none of the registrations, so not one project hook fires there — no git guard, no read bounds,
no traceability check.

The link is made by `.git/hooks/post-checkout`: it lives in the common git dir, so every worktree
of the repo shares it, and it is never committed. Worktree creation runs it with the new worktree
as the working directory, before any Claude session can start there, and it symlinks
`.claude/settings.local.json` back to the main worktree. No-op on a plain `git checkout`, on the
main worktree, and when the file is already there.

**A git hook cannot ship with a clone.** Install it per clone:

```bash
bash scripts/install-git-hooks.sh
```

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
