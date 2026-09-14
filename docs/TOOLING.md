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
  `STID_TEST_MODE=true dotnet test ...` is covered. The expression is skipped entirely on a
  command carrying `<<`: sed matches `^` on every line, so a heredoc body was being rewritten
  until `evals/cases/rewrite-rtk.json` caught it on 2026-09-12. Since the rewrite is ours,
  `rtk hook claude` sees an already-prefixed command and answers nothing — the module emits the
  `updatedInput` decision itself. Do not prefix by hand.
- `rtk hook claude` emits its `updatedInput` **without** a `permissionDecision`; Claude Code
  applies it anyway. An eval on an rtk rewrite therefore checks the command, not the decision.
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

Since 2026-09-12 the registrations are written as `bash $CLAUDE_PROJECT_DIR/.claude/hooks/x.sh`,
not as absolute paths. Through the symlink a worktree therefore runs **its own** tracked copies of
the scripts — the ones of the checked-out branch — instead of the main worktree's, and the same
`settings.local.json` can be dropped into another clone of the repo unchanged. The statusline
keeps its absolute path: `CLAUDE_PROJECT_DIR` is not guaranteed there.

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

## Guard details

**`guard-cat-bounds.sh`** denies a bare `cat` on a file past 120 lines or 8 kB
(`CLAUDE_CAT_BOUNDS_BYTES`). It never fires on a pipe (`cat f | grep x` is already filtered),
on a redirect (`cat f > out` never enters the context), on binary or rendered formats, or on a
second identical command from the same agent. `read-bounds.sh` applies the same two bounds since
2026-09-12 — it tested the line count alone before, so a 119-line, 18 kB plan passed a `Read` and
was denied a `cat`. Since the same day it also measures `head` and `tail` by the span they ask
for: `head -20 f` and `tail -n +250 f` on a 300-line file pass, `head -n 5000 f`, `head -200 f`
and `tail -n +1 f` are dumps in disguise and are denied as `Unbounded head on` / `Unbounded tail
on`. Spotify's hook covers the same verbs without the arithmetic and blocks `head -20` on a big
file, the one read we want.

**`guard-integration-filter.sh`** denies a `dotnet test` on the `IntegrationTests` project that
carries neither `--filter-class` nor `--filter-method`, subagents included. `rtk` prefix,
`cd … &&`, env assignments and output redirections are all fine — only the project and the
presence of a filter are inspected; a `dotnet build` of that project passes. The rule lived in
`implement-tdd/references/test-scope.md` §2 since 2026-09-08 and was ignored twice on 2026-09-10
(sessions `f3d96035`, `24978db7`): 602 s each, the longest tool call of both sessions. No escape
hatch: a doubt about scope is settled by widening the filter one level, never by running everything.

## bulk-read — the one-shot worker

`.claude/tools/bulk-read --question "..." --paths f1 [f2 ...] [--model haiku|sonnet]` sends the
files and one question to `claude -p --tools "" --setting-sources "" --system-prompt ...` and
prints the answer; the files never enter the calling context. The shape is Spotify's shunt
plugin (`spotify/portal-ai-plugins`, `plugins/shunt`) on a local worker instead of an internal
Gemini mode. Measured 2026-09-12:

| Path | Fixed cost | Latency |
|---|---|---|
| `bulk-read`, `--system-prompt` replacing the default | ~500 tokens (1 585 in total with a 3.9 kB file) | 8 s |
| same with `--append-system-prompt` | ~6.6k tokens (7 582 in total) | 8 s |
| `Explore` spawn | ~55k tokens | minutes |
| direct `Read` of the same file | ~1k tokens, carried to the end of the session | 0 |

Real run on a handler and its `CLAUDE.md` (17 kB, 2 files): 7 210 tokens in, 5 415 out, $0.048 —
the output dominates, so keep the question tight and the bullet cap in the system prompt.

Refusals from `read-bounds.sh` and `guard-cat-bounds.sh`, the `delegation-nudge` text and the
`explore-guard` refusal all name it as the third way out. `--bare` is not used: it skips the
keychain and fails with `Not logged in`. Lives in `.claude/tools/`, not `.claude/bin/`: the
permission rule `Read(./bin/**)` matches any `bin/` segment and blocks writes there.
`CLAUDE_BULK_READ_BIN` points the evals at a stub. `CLAUDE_BULK_READ_TIMEOUT` (180 s) kills a
hung worker — `timeout`, else `gtimeout`, else a perl `alarm` that survives the exec — because
`--max-budget-usd` bounds the spend, not the wait. Not for editing (line numbers, no content),
not for searching (no tools), not for debugging (a summary is a lead, never a proof).

## clear-nudge — the step on replayed context

`UserPromptSubmit` hook (`hooks/clear-nudge.sh`). Reads the last assistant `usage` in the
transcript — `input + cache_creation + cache_read` is what the next turn replays — and appends
one line of `additionalContext` at every step of `CLAUDE_CLEAR_NUDGE_STEP` tokens (150k), once
per step, asking the model to tell the user that `/clear` is due if the phase is done. Marker
`/tmp/claude-clearnudge-<session>`, purged by `session-cleanup.sh`. Cache reads are ~60 % of
the 30-day bill and nothing else guards them → `.claude/docs/CONTEXT-COST.md`.

## doctor — the read-only readiness check

`bash .claude/tools/doctor [--quiet] [--evals]`. One line per check, `ok` / `WARN` / `FAIL`, every
non-ok line naming the command that repairs; it never repairs itself (Spotify's rule for its own
`doctor`). Checks: the binaries the hooks need (`jq`, `python3`, `perl`, `rtk` and its identity
through `rtk gain`, `graphify`, `claude`, `ast-grep`); `settings.local.json` present, valid,
symlinked in a worktree; every registered hook command pointing at an existing script and every
`.claude/hooks/*.sh` registered somewhere (a tracked script nobody registered is a dead hook);
the dispatcher's `MODULES` present in `lib/`; the git `post-checkout` hook that links the config
into new worktrees; `graphify-out/graph.json` present, its lag through `graphify-freshness.sh`,
the last autosync refusal in `/tmp/graphify-hook.log`; the keychain entry `bulk-read` needs;
`+x` on tools and evals; rules without `paths:`; `/tmp` leftovers older than two days.
`--evals` also runs the hook evals and reports their summary line.

Registered on `SessionStart` as `doctor --quiet || true`, after `session-cleanup.sh`: silent when
healthy, so it costs the context nothing; a WARN or FAIL line reaches the model at startup, and
the `|| true` keeps a broken setup from blocking the session. `CLAUDE_DOCTOR_ROOT` points it at
another checkout (the evals use it).

## Injection-channel probes

An eval proves the script emits the right bytes; it never proves the model reads them. The two
are independent: `handler-claude-md-check.sh` emitted its report on plain stdout at exit 0 — a
PostToolUse channel that reaches the transcript only, never the model (231 emissions, 0 read,
2026-09-13). Green evals throughout. Fixed on 2026-09-13 by switching to
`hookSpecificOutput.additionalContext`.

So every injecting mechanism carries a manual probe, to be replayed after each Claude Code
update:

| Mechanism | Probe | Expected |
|---|---|---|
| `handler-claude-md-check` (PostToolUse) | one `Write` on a file under `src/**.Application/**` | the traceability report appears in the session |
| `delegation-nudge` via `read-bounds` (PreToolUse:Read) | six distinct `Read` on `.cs` files with no spawn in between | the delegation line appears at the sixth |
| `batching-nudge` via `bash-dispatch` (PreToolUse:Bash) | three tool-carrying turns holding a single call | the batching line appears |
| `clear-nudge` (UserPromptSubmit) | a session past 150 k tokens | the step line appears on the next prompt |
| `explore-guard` (PreToolUse:Agent) | one spawn, then read the subagent transcript | the 20-line report contract sits in the received prompt |
| `subagent-report-shape` (SubagentStop) | one `tdd-test-author` run whose `## RED` drops its table | the agent re-emits a complete report on its own |
| deny guards (`read-bounds`, `cat-bounds`, `guard-git`, `guard-integration`) | one refused call | the reason appears |

## Hook evals

`bash .claude/evals/run.sh [-v] [cases/x.json]` replays recorded payloads through the hooks and
checks the decision, the rewritten command, the appended prompt or the injected context. 135
cases in `evals/cases/*.json`, ~6 s, fixtures generated in `evals/.fixtures/` (ignored) and
`/tmp` state keyed by a run id and removed. Each defect found in production before 2026-09-12 is
a case; the first run found two more — the heredoc rewrite above, and a byte-limit message in
`bulk-read`. Shape borrowed from `plugins/shunt/evals/run.sh`. A hook change without a case is
not finished.
