#!/bin/bash
# PostToolUse hook, every tool — a note the user leaves for a batch in the run-lot-pane mod reaches
# each agent of that batch at its next tool call (lib/run_notes.py holds the why).
# The main thread leaves at the string match, before lib/platform.sh; an agent outside a run, at its
# cached state. The two ids are read by a bash regex, jq only when the payload holds either key twice.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
INPUT=$(cat)
case "$INPUT" in *'"agent_id"'*) ;; *) exit 0 ;; esac
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
command -v jq >/dev/null 2>&1 || exit 0
once() { local rest=${INPUT#*"\"$1\""}; case "$rest" in *"\"$1\""*) return 1 ;; esac; }
re_aid='"agent_id"[[:space:]]*:[[:space:]]*"([A-Za-z0-9_.-]+)"'
re_sid='"session_id"[[:space:]]*:[[:space:]]*"([A-Za-z0-9_.-]+)"'
if once agent_id && once session_id && [[ $INPUT =~ $re_aid ]] && aid=${BASH_REMATCH[1]} && [[ $INPUT =~ $re_sid ]]; then
  sid=${BASH_REMATCH[1]}
else
  IFS=$'\x1f' read -r sid aid <<<"$(printf '%s' "$INPUT" | jq -j '[(.session_id // "unknown"), (.agent_id // "")] | join("\u001f")' 2>/dev/null)"
fi
[ -n "${aid:-}" ] || exit 0
state="/tmp/claude-runnotes-$sid-$aid"
if [ -f "$state" ]; then
  IFS=$'\t' read -r batch work <"$state"
  [ "$batch" = - ] && exit 0
  pane="${work%/*}/.pane.jsonl"
  [ -f "$pane" ] && grep -q '"note"' "$pane" || exit 0
fi
command -v python3 >/dev/null 2>&1 || exit 0
HOOK_INPUT="$INPUT" HOOK_STATE="$state" python3 "$(dirname "${BASH_SOURCE[0]}")/../lib/run_notes.py" 2>/dev/null
exit 0
