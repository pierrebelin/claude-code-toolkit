#!/bin/bash
# SessionStart hook, registered by the plugin (hooks/hooks.json). It fires in a
# worktree only if the plugin is enabled there: `enabledPlugins` belongs in the
# committed .claude/settings.json (templates/settings.json), never in
# settings.local.json — gitignored, so absent from every linked worktree. A copy
# predating the plugin registered it in settings.local.json and never fired there.
#
# graphify resolves its graph strictly at <cwd>/graphify-out/graph.json — no parent
# lookup, no env var, only the per-command --graph flag. A linked worktree has no
# graphify-out/, so every query|explain|path|affected fails there.
#
# Fix: symlink the main working tree's graphify-out into the worktree. graphify-out/
# is gitignored, so the link stays invisible to git.
#
# Do NOT run `graphify update` from a worktree: it would rewrite the shared graph
# from the worktree branch state.
set -u

command -v git >/dev/null 2>&1 || exit 0

gitdir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
common=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
[ "$gitdir" = "$common" ] && exit 0   # not a linked worktree

main=$(cd "$common/.." 2>/dev/null && pwd) || exit 0
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

[ -d "$main/graphify-out" ] || exit 0
link="$top/graphify-out"

# A dangling link survives a deleted/moved main tree: replace it, never a real dir.
if [ -L "$link" ] && [ ! -e "$link" ]; then
  rm -f "$link"
fi

[ -e "$link" ] || [ -L "$link" ] && exit 0

ln -s "$main/graphify-out" "$link" 2>/dev/null
exit 0
