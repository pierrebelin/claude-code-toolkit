#!/bin/bash
# UserPromptSubmit hook — one line when the replayed context crosses a step.
# Prompt size of the previous turn = input + cache_creation + cache_read of the last
# assistant `usage`. Once per step of CLAUDE_CLEAR_NUDGE_STEP tokens (default 150k).
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

STEP=${CLAUDE_CLEAR_NUDGE_STEP:-150000}

input=$(cat)
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // ""')
session=$(printf '%s' "$input" | jq -r '.session_id // "unknown"')
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

# The tail is enough: the last assistant entry carries the previous request's usage.
ctx=$(tail -n 200 "$transcript" 2>/dev/null \
  | jq -r 'select(.type == "assistant") | .message.usage // empty
           | ((.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0))' 2>/dev/null \
  | tail -1)
case "$ctx" in ''|*[!0-9]*) exit 0 ;; esac

step=$(( ctx / STEP ))
[ "$step" -ge 1 ] || exit 0

marker="/tmp/claude-clearnudge-${session}"
last=0
[ -f "$marker" ] && read -r last < "$marker" 2>/dev/null
case "$last" in ''|*[!0-9]*) last=0 ;; esac
[ "$step" -gt "$last" ] || exit 0
printf '%s' "$step" > "$marker"

k=$(( ctx / 1000 ))
msg="Context: ~${k}k tokens replayed on every turn (usage of the last assistant message). If the current phase is finished, tell the user at the end of the answer: \`/clear\` with a ten-line brief costs less than carrying on, and \`/compact\` is never an option (~60k tokens injected). If the phase goes on, go on: this is only a number."

jq -cn --arg c "$msg" \
  '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $c}}'
exit 0
