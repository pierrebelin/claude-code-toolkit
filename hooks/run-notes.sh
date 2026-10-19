#!/bin/bash
# PostToolUse hook, every tool — a note the user leaves for a batch in the run-lot-pane mod reaches
# each agent of that batch at its next tool call (lib/run_notes.py holds the why).
# The main thread leaves at the string match; an agent outside a run, at its cached state.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
INPUT=$(cat)
case "$INPUT" in *'"agent_id"'*) ;; *) exit 0 ;; esac
command -v jq >/dev/null 2>&1 || exit 0
IFS=$'\x1f' read -r sid aid <<<"$(printf '%s' "$INPUT" | jq -j '[(.session_id // "unknown"), (.agent_id // "")] | join("\u001f")' 2>/dev/null)"
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
