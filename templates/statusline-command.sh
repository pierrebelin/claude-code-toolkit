#!/bin/bash
# Claude Code statusLine script — installed by /cctoolkit:kit-init into
# <repo>/.claude/statusline-command.sh: a plugin cannot set `statusLine`.

input=$(cat)

# Git Bash on Windows: a native jq writes CRLF unless given -b, and the `\r`
# would land in every field below.
case "${OSTYPE:-}" in msys* | cygwin*) jq() { command jq -b "$@"; } ;; esac

# Git branch (skip optional locks)
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
[ -z "$cwd" ] && cwd=$(pwd)
git_branch=""
if git -C "$cwd" rev-parse --is-inside-work-tree --no-optional-locks 2>/dev/null | grep -q true; then
  git_branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
fi

# --- Claude Code elements ---
model=$(echo "$input" | jq -r '.model.display_name // empty')
effort=$(echo "$input" | jq -r '.effort.level // empty')
# Current effort: the statusline is the only channel that receives .effort.level,
# and implement-tdd-guard.sh needs it to refuse a batch launched at effort high.
# Two files: the session one is authoritative, `last` is the fallback for a guard
# that runs before the session's first render.
if [ -n "$effort" ]; then
  sid=$(echo "$input" | jq -r '.session_id // empty')
  state_dir="${TMPDIR:-/tmp}"
  printf '%s' "$effort" > "$state_dir/claude-effort-${sid:-last}" 2>/dev/null
  [ -n "$sid" ] && printf '%s' "$effort" > "$state_dir/claude-effort-last" 2>/dev/null
fi


# --- Caveman badge ---
caveman_badge=""
FLAG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.caveman-active"
if [ ! -L "$FLAG" ] && [ -f "$FLAG" ]; then
  MODE=$(head -c 64 "$FLAG" 2>/dev/null | tr -d '\n\r' | tr '[:upper:]' '[:lower:]')
  MODE=$(printf '%s' "$MODE" | tr -cd 'a-z0-9-')
  case "$MODE" in
    off|lite|full|ultra|wenyan-lite|wenyan|wenyan-full|wenyan-ultra|commit|review|compress)
      if [ -z "$MODE" ] || [ "$MODE" = "full" ]; then
        caveman_badge=$(printf '\033[38;5;172m[CAVEMAN]\033[0m')
      else
        SUFFIX=$(printf '%s' "$MODE" | tr '[:lower:]' '[:upper:]')
        caveman_badge=$(printf '\033[38;5;172m[CAVEMAN:%s]\033[0m' "$SUFFIX")
      fi
      ;;
  esac
fi

# --- Line 1: git branch | model | caveman badge ---
line1=""
if [ -n "$git_branch" ]; then
  line1=$(printf '(%s)' "$git_branch")
fi
if [ -n "$model" ]; then
  line1="${line1} $(printf '| %s' "$model")"
fi
if [ -n "$effort" ]; then
  line1="${line1} $(printf '| %s' "$effort")"
fi
if [ -n "$caveman_badge" ]; then
  line1="${line1} ${caveman_badge}"
fi
printf '%s' "$line1"
