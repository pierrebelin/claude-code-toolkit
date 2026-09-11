#!/bin/sh
# Install the git-level hooks this toolkit relies on. Run once per clone.
#
#   bash scripts/install-git-hooks.sh [repo-root]
#
# Why a git hook and not a Claude hook. Every script under `.claude/hooks` and
# `.claude/lib` is tracked, but their REGISTRATION lives in
# `.claude/settings.local.json`, which `.claude/.gitignore` excludes. A worktree is
# a checkout: it carries the scripts and none of the registrations, so without help
# not one project hook fires there — no git guard, no read bounds, no traceability
# check. Committing the registration would fix the worktree and hand the whole
# setup to the team, which is usually not wanted.
#
# `.git/hooks` is the third way: it lives in the common git dir, so every worktree
# of the repo shares it, and it is never committed. Which is also why it cannot
# ship with a clone, and why this installer exists.

set -u

root=${1:-.}
cd "$root" 2>/dev/null || { echo "install-git-hooks: $root not found" >&2; exit 1; }

hooks_dir=$(git rev-parse --git-common-dir 2>/dev/null)/hooks
[ -d "$hooks_dir" ] || { echo "install-git-hooks: not a git repository ($root)" >&2; exit 1; }

target="$hooks_dir/post-checkout"

if [ -e "$target" ]; then
  echo "install-git-hooks: $target already exists — inspect it before overwriting." >&2
  exit 1
fi

cat > "$target" <<'HOOK'
#!/bin/sh
# Link the gitignored Claude config into a freshly created worktree.
#
# Installed by scripts/install-git-hooks.sh — see that file for the rationale.
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
ln -sfn "$main_worktree/$CONFIG" "$here/$CONFIG" 2>/dev/null \
  && echo "[claude] $CONFIG linked from $main_worktree"

exit 0
HOOK

chmod +x "$target"
echo "install-git-hooks: $target installed"
