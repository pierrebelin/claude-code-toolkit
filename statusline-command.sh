#!/bin/bash
# Claude Code statusLine script

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
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
duration_ms=$(echo "$input" | jq -r '.cost.total_duration_ms // empty')
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // empty')
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // empty')
effort=$(echo "$input" | jq -r '.effort.level // empty')
rate_used=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
rate_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')

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
FRESH_SCRIPT="$cwd/.claude/lib/graphify-freshness.sh"
if [ -x "$FRESH_SCRIPT" ]; then
  stale=$("$FRESH_SCRIPT" --count 2>/dev/null)
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
printf '%s\n' "$line1"

# --- Line 2: context bar | duration | rate limit ---
line2=""
if [ -n "$used" ]; then
  used_int=$(printf '%.0f' "$used")
  bar_width=10
  filled=$(( used_int * bar_width / 100 ))
  [ "$filled" -gt "$bar_width" ] && filled=$bar_width
  empty=$(( bar_width - filled ))
  bar_filled=$(printf '%0.s█' $(seq 1 $filled 2>/dev/null))
  bar_empty=$(printf '%0.s░' $(seq 1 $empty 2>/dev/null))
  if [ "$used_int" -ge 85 ]; then
    color='\033[31m'
  elif [ "$used_int" -ge 60 ]; then
    color='\033[33m'
  else
    color='\033[32m'
  fi
  line2=$(printf "Context ${color}${bar_filled}${bar_empty}\033[0m %s%%" "$used_int")
fi
if [ -n "$duration_ms" ] && [ "$duration_ms" != "null" ]; then
  duration_s=$(( ${duration_ms%.*} / 1000 ))
  if [ "$duration_s" -ge 60 ]; then
    mins=$(( duration_s / 60 ))
    secs=$(( duration_s % 60 ))
    line2="${line2} $(printf '| \033[2m%dm%ds\033[0m' "$mins" "$secs")"
  else
    line2="${line2} $(printf '| \033[2m%ds\033[0m' "$duration_s")"
  fi
fi
if [ -n "$lines_added" ] && [ "$lines_added" != "null" ] && [ "$lines_added" != "0" ]; then
  line2="${line2} $(printf '| \033[32m+%s\033[0m' "$lines_added")"
  if [ -n "$lines_removed" ] && [ "$lines_removed" != "null" ] && [ "$lines_removed" != "0" ]; then
    line2="${line2}$(printf '/\033[31m-%s\033[0m' "$lines_removed")"
  fi
elif [ -n "$lines_removed" ] && [ "$lines_removed" != "null" ] && [ "$lines_removed" != "0" ]; then
  line2="${line2} $(printf '| \033[31m-%s\033[0m' "$lines_removed")"
fi
if [ -n "$rate_used" ] && [ "$rate_used" != "null" ]; then
  rate_int=$(printf '%.0f' "$rate_used")
  rbar_width=10
  rfilled=$(( rate_int * rbar_width / 100 ))
  [ "$rfilled" -gt "$rbar_width" ] && rfilled=$rbar_width
  rempty=$(( rbar_width - rfilled ))
  rbar_filled=$(printf '%0.s█' $(seq 1 $rfilled 2>/dev/null))
  rbar_empty=$(printf '%0.s░' $(seq 1 $rempty 2>/dev/null))
  if [ "$rate_int" -ge 85 ]; then
    rcolor='\033[31m'
  elif [ "$rate_int" -ge 60 ]; then
    rcolor='\033[33m'
  else
    rcolor='\033[32m'
  fi
  reset_str=""
  if [ -n "$rate_resets" ] && [ "$rate_resets" != "null" ]; then
    reset_epoch="$rate_resets"
    now_epoch=$(date +%s)
    if [ -n "$reset_epoch" ] && [ "$reset_epoch" -gt "$now_epoch" ]; then
      diff_s=$(( reset_epoch - now_epoch ))
      diff_m=$(( diff_s / 60 ))
      if [ "$diff_m" -ge 60 ]; then
        reset_str=$(printf ' \033[2m%dh%dm\033[0m' $(( diff_m / 60 )) $(( diff_m % 60 )))
      else
        reset_str=$(printf ' \033[2m%dm\033[0m' "$diff_m")
      fi
    fi
  fi
  line2="${line2} $(printf "| Limit 5h ${rcolor}${rbar_filled}${rbar_empty}\033[0m %s%%${reset_str}" "$rate_int")"
fi
printf '%s' "$line2"
