#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): the knowledge base may be behind the handler just edited.
# The line comes from `knowledge-scan.py --reminder`. Main chain only, once per file and
# session; silent without a knowledge base, python3, jq or a readable config. Warning
# only, through additionalContext: plain stdout on PostToolUse never reaches the model.

case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
input=$(cat)
case "$input" in *'"file_path"'*) ;; *) exit 0 ;; esac
command -v jq >/dev/null 2>&1 || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

IFS=$'\x1f' read -r session_id agent_id file_path <<<"$(printf '%s' "$input" | jq -j '[(.session_id // "unknown"), (.agent_id // ""), (.tool_input.file_path // "")] | join("\u001f")' 2>/dev/null)"
[ -z "$agent_id" ] || exit 0
[ -n "$file_path" ] || exit 0
kit_path file_path

seen_file="/tmp/claude-knowledge-seen-${session_id}"
if [ -f "$seen_file" ] && grep -Fxq "$file_path" "$seen_file" 2>/dev/null; then
  exit 0
fi

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
line=$(python3 "$KIT/scripts/knowledge-scan.py" --reminder "$file_path" 2>/dev/null | head -1)
[ -n "$line" ] || exit 0
echo "$file_path" >> "$seen_file"

jq -n --arg c "$line. Edited outside a batch: say so to the user when the task ends." \
  '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $c}}'
exit 0
