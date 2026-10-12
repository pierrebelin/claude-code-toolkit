# Sourced, never run: sets KIT_DIR (the kit: plugin cache directory, or the toolkit
# checkout) and PROJECT_ROOT (the repo the kit serves). Same order as
# kit_config.py project_root(): $CLAUDE_PROJECT_DIR, set by Claude Code for every
# hook; otherwise the kit copied into a repo's `.claude/` serves that repo (eval
# fixtures, a manual copy); otherwise the git top level of the working directory, which
# is how a script launched through `cctoolkit` from the Bash tool finds the repo.
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  PROJECT_ROOT="$CLAUDE_PROJECT_DIR"
else
  case "$KIT_DIR" in
    */.claude) PROJECT_ROOT="${KIT_DIR%/.claude}" ;;
    *) PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)" ;;
  esac
fi
