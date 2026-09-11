#!/bin/bash
# PreToolUse Read hook — require offset/limit on large files.
#
# Read is 30% of context fill (5.6 MB measured over 30 days) and only 34% of
# calls are bounded. A full aggregate read is ~24k characters carried to the end
# of the session. This hook denies an unbounded Read past the threshold and
# tells the model to locate first (graphify, grep) then read the range.
#
# The threshold is 120, not 300. At 300 the hook only ever caught the giant
# aggregates: measured on two sessions of 2026-09-08, 42 of 59 Reads were
# unbounded and every one of those files sat under the threshold (23 to 303
# lines). The cost was never one huge read, it was the count — 59 Reads plus 71
# Bash cat/grep in two sessions, each carried to the end. 120 catches the test
# fixtures and infrastructure files (160 to 500 lines) that made up that volume.
#
# Escape hatch, same shape as the graphify substitution (lib/guard-graphify-grep.sh):
# the denial is recorded per (agent, file). Re-issuing the identical unbounded
# Read passes through — that is how you force a full read when you genuinely want
# one.
#
# Thresholds, skip lists, outline and refusal layout are shared with
# lib/guard-cat-bounds.sh through lib/bounds-common.sh. Anything a fix would have
# to be applied to twice belongs there, not here.
set -u

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"
# shellcheck source=../lib/bounds-common.sh
. "$LIB/bounds-common.sh"

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
[[ "$tool_name" != "Read" ]] && exit 0

file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')
[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

# Already bounded → nothing to do.
has_offset=$(echo "$input" | jq -r '.tool_input.offset // empty')
has_limit=$(echo "$input" | jq -r '.tool_input.limit // empty')
[ -n "$has_offset" ] && exit 0
[ -n "$has_limit" ] && exit 0

bounds_skip "$file_path" && exit 0

lines=$(wc -l < "$file_path" 2>/dev/null | tr -d ' ')
[ -n "$lines" ] || exit 0
[ "$lines" -le "$BOUNDS_THRESHOLD" ] 2>/dev/null && exit 0

# Past the threshold but flat: denying it costs more than it saves. See
# bounds_is_flat in lib/bounds-common.sh.
bounds_is_flat "$file_path" && exit 0

# Scope the escape hatch to the agent, not the session. Subagents run under the
# parent's session_id *and* its transcript_path, so a per-session key let one
# agent's forcing hand a free unbounded read to every other agent — and to the
# main chain — none of which ever saw the denial or its advice. Measured on one
# session: 4 denials in one agent, then a 35 640-character unbounded read waved
# through in the next one. `agent_id` is the only per-agent field in the payload;
# the main chain has none, and falls back to the session.
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
agent_id=$(echo "$input" | jq -r '.agent_id // ""')
seen_file="/tmp/claude-readbounds-seen-${session_id}${agent_id:+-$agent_id}"

# Second identical attempt, same agent → let it through.
if [ -f "$seen_file" ] && grep -Fxq "$file_path" "$seen_file" 2>/dev/null; then
  echo "$file_path" >> "${seen_file}.forced"
  exit 0
fi
echo "$file_path" >> "$seen_file"

reason=$(bounds_reason \
  "Unbounded Read on $file_path ($lines lines > $BOUNDS_THRESHOLD). The whole file stays in context until the session ends." \
  "$file_path" \
  "Read the range you need around one of them" \
  "Locate the range first (graphify explain/query, grep -n), then Read with offset/limit." \
  "Re-issue this exact Read to force the full read.")

jq -n --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
