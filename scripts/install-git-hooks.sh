#!/bin/sh
# Install the git-level hooks this toolkit relies on. Run once per clone.
#
#   cctoolkit install-git-hooks [repo-root]
#   cctoolkit install-git-hooks --pre-commit [repo-root]
#
# Default: `post-checkout`, below. `--pre-commit`, opt-in: a reminder that the knowledge
# base may lag behind the staged handlers, read off the staged diff by
# `knowledge-scan --reminder --staged`, and `INDEX.md stale` when a change by hand left
# it behind (`knowledge-index --check`) — no agent, never blocking, always exit 0. No
# sync runs in a git hook: it cannot ask for confirmation, it would slow every commit,
# and it would also fire during a rebase, a merge or in CI.
#
# Why a git hook and not a Claude hook. The hooks ship in the plugin, but a repo
# that enables the plugin at local scope keeps that enablement in
# `.claude/settings.local.json`, which `.claude/.gitignore` excludes. A worktree is
# a checkout: it carries none of it, so without help not one kit hook fires
# there — no git guard, no read bounds, no traceability check. Enabling the plugin
# in the committed settings.json fixes the worktree and hands the setup to the
# team, which is not always wanted.
#
# `.git/hooks` is the third way: it lives in the common git dir, so every worktree
# of the repo shares it, and it is never committed. Which is also why it cannot
# ship with a clone, and why this installer exists.

set -u
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

pre_commit=0
if [ "${1:-}" = "--pre-commit" ]; then
  pre_commit=1
  shift
fi
root=${1:-.}
kit=$(cd "$(dirname "$0")/.." && pwd)
cd "$root" 2>/dev/null || { echo "install-git-hooks: $root not found" >&2; exit 1; }

hooks_dir=$(git rev-parse --git-common-dir 2>/dev/null)/hooks
[ -d "$hooks_dir" ] || { echo "install-git-hooks: not a git repository ($root)" >&2; exit 1; }

if [ "$pre_commit" = 1 ]; then
  target="$hooks_dir/pre-commit"
  if [ -e "$target" ]; then
    echo "install-git-hooks: $target already exists — inspect it, then call knowledge-scan --reminder --staged from it." >&2
    exit 1
  fi
  sed "s|@KIT@|$kit|" > "$target" <<'HOOK'
#!/bin/sh
# Remind that the knowledge base may lag behind the staged handlers, and that a base
# edited by hand left INDEX.md behind. Never blocks.
#
# Installed by `cctoolkit install-git-hooks --pre-commit`. The kit sits in the plugin
# cache, whose directory changes with each update: the newest copy is looked up there
# first, then the kit the hook was installed from. Neither found: silent.
scan=$(ls -t "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/cctoolkit/*/scripts/knowledge-scan.py 2>/dev/null | head -1)
[ -n "$scan" ] || scan="@KIT@/scripts/knowledge-scan.py"
[ -f "$scan" ] || exit 0
# python3, else python or py: Windows has no python3, or only the Store stub.
for py in python3 python py ""; do
  [ -n "$py" ] && "$py" -c '' >/dev/null 2>&1 && break
done
[ -n "$py" ] || exit 0
export PYTHONUTF8=1
"$py" "$scan" --reminder --staged >&2 2>/dev/null
"$py" "${scan%/*}/knowledge-index.py" --check >&2 2>/dev/null
exit 0
HOOK
  chmod +x "$target"
  echo "install-git-hooks: $target installed"
  exit 0
fi

target="$hooks_dir/post-checkout"

if [ -e "$target" ]; then
  echo "install-git-hooks: $target already exists — inspect it before overwriting." >&2
  exit 1
fi

cat > "$target" <<'HOOK'
#!/bin/sh
# Link the gitignored Claude config into a freshly created worktree.
#
# Installed by `cctoolkit install-git-hooks` — see that script for the rationale.
# Lives in the common git dir: shared by every worktree, never committed.
#
# Timing: git runs post-checkout at the end of a worktree creation, with the new
# worktree as the working directory — before any Claude session can start there.
#
# Also fires on a plain `git checkout` in any worktree, hence the main-worktree
# test below and the "already there" test: both make this a no-op.
#
# A symlink, not a copy: one file, edited in either place, stays in sync. A dead
# link (main repo moved or removed) is visible immediately — a stale copy is not.
#
# Arguments: $1 prev_HEAD  $2 new_HEAD  $3 branch_checkout_flag

set -u

CONFIG='.claude/settings.local.json'

main_worktree=$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
here=$(git rev-parse --show-toplevel 2>/dev/null)

[ -n "$main_worktree" ] && [ -n "$here" ] || exit 0
[ "$here" != "$main_worktree" ] || exit 0          # main worktree: nothing to link
[ -e "$here/$CONFIG" ] && exit 0                   # already linked or already present
[ -f "$main_worktree/$CONFIG" ] || exit 0          # nothing to link to

mkdir -p "$here/.claude" 2>/dev/null || exit 0
# MSYS: Git Bash on Windows makes a native symlink when it may, a copy otherwise.
MSYS=winsymlinks:native ln -sfn "$main_worktree/$CONFIG" "$here/$CONFIG" 2>/dev/null \
  && echo "[claude] $CONFIG linked from $main_worktree"

exit 0
HOOK

chmod +x "$target"
echo "install-git-hooks: $target installed"
