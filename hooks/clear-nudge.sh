#!/bin/bash
# UserPromptSubmit hook — one line when the replayed context crosses a step.
#
# Why. Measured over 30 days on this project (cc-usage, list price, 2026-09-12):
# cache reads — the context replayed on every turn — are ~60 % of the bill,
# output ~15 %, and 18 % of requests went past 200k tokens of prompt. Nothing
# guards that term: read-bounds and cat-bounds shrink what enters, batching-nudge
# reduces the turns, but the only thing that discards the accumulated tail is
# `/clear`, and the 1M-context models removed the ceiling that used to force it.
#
# The hook reads the last assistant `usage` from the transcript: input +
# cache_creation + cache_read is the prompt size of the previous turn, i.e. what
# the next turn replays. It nudges once per step of CLAUDE_CLEAR_NUDGE_STEP tokens
# (default 150k), never twice for the same step. Advisory: the model cannot run
# /clear, so the nudge asks it to say so to the user at the end of the reply when
# the phase is done. Same shape as batching-nudge: a number the reader recognises.
set -u

STEP=${CLAUDE_CLEAR_NUDGE_STEP:-150000}

input=$(cat)
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // ""')
session=$(printf '%s' "$input" | jq -r '.session_id // "unknown"')
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

# The tail is enough: one turn is a handful of lines, and the last assistant
# entry carries the usage of the whole previous request.
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
msg="Contexte : ~${k}k tokens rejoués à chaque tour (usage du dernier message assistant). Si la phase en cours est terminée, le dire à l'utilisateur en fin de réponse : \`/clear\` avec un brief de dix lignes coûte moins que de continuer, et \`/compact\` n'est jamais une option (~60k tokens injectés). Si la phase continue, continuer : ce n'est qu'un nombre."

jq -cn --arg c "$msg" \
  '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $c}}'
exit 0
