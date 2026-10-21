#!/bin/bash
# PreToolUse Read hook — require offset/limit on large files.
# Escape hatch: re-issuing the identical Read forces it (recorded per agent and file).
# Shared body with lib/guard-cat-bounds.sh: lib/bounds-common.sh.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
input=$(cat)
# Already bounded: a numeric offset or limit leaves before lib/platform.sh and jq. Anything else
# (null, a string) goes through jq as before.
[[ $input =~ \"(offset|limit)\"[[:space:]]*:[[:space:]]*-?[0-9] ]] && exit 0
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

LIB="${BASH_SOURCE[0]%/*}/../lib"
# shellcheck source=../lib/bounds-common.sh
. "$LIB/bounds-common.sh"

# US (\x1f) separator, not a tab: bash collapses IFS-whitespace runs, so an empty field would shift the rest.
PARSED=$(printf '%s' "$input" | jq -j '[(.tool_name // ""), (.session_id // "unknown"), (.agent_id // ""), (.tool_input.file_path // ""), ((.tool_input.offset // "") | tostring), ((.tool_input.limit // "") | tostring), (.agent_type // "")] | join("\u001f")')
IFS=$'\x1f' read -r tool_name session_id agent_id file_path has_offset has_limit agent_type <<<"$PARSED"

[ "$tool_name" = "Read" ] || exit 0
[ -n "$file_path" ] || exit 0
kit_path file_path
[ -f "$file_path" ] || exit 0

pass() { exit 0; }

# Already bounded → nothing to guard.
[ -n "$has_offset" ] && pass
[ -n "$has_limit" ] && pass

bounds_skip "$file_path" && pass

# Per agent, not per session: subagents share the parent's session_id. The main
# chain has no agent_id and falls back to the session.
seen_file="/tmp/claude-readbounds-seen-${session_id}${agent_id:+-$agent_id}"

# Second identical attempt, same agent → let it through and record it in .forced
# (lib/context-report.sh prints the forced/denied ratio).
forced() {
  if [ -f "$seen_file" ] && grep -Fxq "$file_path" "$seen_file" 2>/dev/null; then
    echo "$file_path" >> "${seen_file}.forced"
    return 0
  fi
  echo "$file_path" >> "$seen_file"
  return 1
}

deny() {
  jq -n --arg r "$1" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

# The knowledge base's rules.md, decisions.md and HISTORY.md: bounds_knowledge_guarded.
if bounds_knowledge_guarded "$file_path" "$agent_type"; then
  forced && pass
  deny "$(bounds_knowledge_reason Read "$file_path" "Read with offset/limit" "Re-issue this exact Read to force the full read.")"
fi

# One wc for both counts (lines then bytes, whatever the option order).
read -r lines bytes <<<"$(wc -lc < "$file_path" 2>/dev/null)"
[ -n "$lines" ] || pass
# Lines and bytes, as in lib/guard-cat-bounds.sh; a subagent gets the higher bar.
max_lines=$BOUNDS_THRESHOLD max_bytes=$BOUNDS_BYTES
if [ -n "$agent_id" ]; then
  max_lines=$BOUNDS_SUBAGENT_THRESHOLD max_bytes=$BOUNDS_SUBAGENT_BYTES
fi
if [ "$lines" -le "$max_lines" ] 2>/dev/null && [ "${bytes:-0}" -le "$max_bytes" ] 2>/dev/null; then
  pass
fi

# Past the threshold but flat: bounds_is_flat.
bounds_is_flat "$file_path" && pass

forced && pass

reason=$(bounds_reason \
  "Unbounded Read on $file_path ($lines lines, ${bytes:-0} bytes > $max_lines lines / $max_bytes bytes). The whole file stays in context until the session ends." \
  "$file_path" \
  "Read the range you need around one of them" \
  "Locate the range first (graphify explain/query, grep -n), then Read with offset/limit." \
  "Re-issue this exact Read to force the full read.")

deny "$reason"
