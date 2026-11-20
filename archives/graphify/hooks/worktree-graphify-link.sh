#!/bin/bash
# SessionStart hook — symlinks the main working tree's graphify-out/ into a linked
# worktree: graphify only reads <cwd>/graphify-out/graph.json. Fires only where the
# plugin is enabled in the committed .claude/settings.json.
# Do NOT run `graphify update` from a worktree: it would rewrite the shared graph.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

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

if [ "$_KIT_PLATFORM" = windows ]; then
  # Git Bash copies the tree when it cannot make a native symlink (Developer Mode
  # off): a stale copy is worse than no graph. A junction needs no privilege.
  MSYS=winsymlinks:nativestrict ln -s "$main/graphify-out" "$link" 2>/dev/null \
    || cmd //c mklink /J "$(cygpath -w "$link")" "$(cygpath -w "$main/graphify-out")" >/dev/null 2>&1
else
  ln -s "$main/graphify-out" "$link" 2>/dev/null
fi
exit 0
