#!/bin/bash
# Claude Code statusLine script — installed by /cctoolkit:kit-init into
# <repo>/.claude/statusline-command.sh: a plugin cannot set `statusLine`.

input=$(cat)

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

# --- Graphify freshness badge ---
# Cached read (20s TTL on the helper side), ~10ms warm.
graphify_badge=""
# The helper ships in the cctoolkit plugin, whose cache directory changes with each
# version: take the newest one. A copy predating the plugin kept it in .claude/lib/.
project=$(echo "$input" | jq -r '.workspace.project_dir // empty')
[ -n "$project" ] || project="$cwd"
FRESH_SCRIPT=$(ls -t "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/cctoolkit/*/lib/graphify-freshness.sh 2>/dev/null | head -1)
[ -n "$FRESH_SCRIPT" ] || FRESH_SCRIPT="$project/.claude/lib/graphify-freshness.sh"
if [ -f "$FRESH_SCRIPT" ]; then
  stale=$(GRAPHIFY_REPO="$project" bash "$FRESH_SCRIPT" --count 2>/dev/null)
  case "$stale" in
    ''|*[!0-9-]*) ;;
    -1) graphify_badge=$(printf '\033[31m[graph missing]\033[0m') ;;
    0)  ;;
    *)
      if [ "$stale" -ge 25 ]; then
        graphify_badge=$(printf '\033[31m[graph +%s]\033[0m' "$stale")
      else
        graphify_badge=$(printf '\033[33m[graph +%s]\033[0m' "$stale")
      fi
      ;;
  esac
fi

# --- Line 1: git branch | model | caveman badge | graphify badge ---
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
if [ -n "$graphify_badge" ]; then
  line1="${line1} ${graphify_badge}"
fi
printf '%s' "$line1"
