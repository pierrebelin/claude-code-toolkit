#!/bin/bash
# PreToolUse Read hook — require offset/limit on large files, then count the
# reads that go through towards the delegation nudge.
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
# Escape hatch, same shape as the graphify substitution (lib/guard-graphify-grep.sh, removed 2026-09-13):
# the denial is recorded per (agent, file). Re-issuing the identical unbounded
# Read passes through — that is how you force a full read when you genuinely want
# one.
#
# Thresholds, skip lists, outline and refusal layout are shared with
# lib/guard-cat-bounds.sh through lib/bounds-common.sh. Anything a fix would have
# to be applied to twice belongs there, not here.
#
# One jq for the whole payload, as in bash-dispatch.sh. Until 2026-09-12 this
# hook ran six jq spawns and a second hook on the same matcher, delegation-nudge,
# ran four more: 31 ms per Read for the pair. The nudge is now lib/delegation-nudge.sh,
# sourced here on the reads that go through — a denied read never entered the
# context, so it is not counted.
set -u

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"
# shellcheck source=../lib/bounds-common.sh
. "$LIB/bounds-common.sh"

input=$(cat)
# US (\x1f) separator, not a tab: bash collapses runs of IFS-whitespace, and an
# empty agent_id — the main chain always has one — would shift every later field.
PARSED=$(printf '%s' "$input" | jq -j '[(.tool_name // ""), (.session_id // "unknown"), (.agent_id // ""), (.tool_input.file_path // ""), ((.tool_input.offset // "") | tostring), ((.tool_input.limit // "") | tostring)] | join("\u001f")')
IFS=$'\x1f' read -r tool_name session_id agent_id file_path has_offset has_limit <<<"$PARSED"

[ "$tool_name" = "Read" ] || exit 0
[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

export HOOK_SESSION_ID="$session_id" HOOK_AGENT_ID="$agent_id" HOOK_FILE_PATH="$file_path"

# The read goes through: hand it to the delegation module, which answers with an
# additionalContext or with nothing. Sourced in the command substitution's own
# subshell, so its `exit` and `set -u` stay there.
pass() {
  out=$(. "$LIB/delegation-nudge.sh")
  [ -n "$out" ] && printf '%s\n' "$out"
  exit 0
}

# Already bounded → nothing to guard.
[ -n "$has_offset" ] && pass
[ -n "$has_limit" ] && pass

bounds_skip "$file_path" && pass

lines=$(wc -l < "$file_path" 2>/dev/null | tr -d ' ')
bytes=$(wc -c < "$file_path" 2>/dev/null | tr -d ' ')
[ -n "$lines" ] || pass
# Both bounds, as in lib/guard-cat-bounds.sh. Until 2026-09-12 this hook tested
# the line count alone, so an 18 kB plan wrapped at the paragraph (119 lines)
# passed a Read and was denied a cat — the two guards were meant to be one.
if [ "$lines" -le "$BOUNDS_THRESHOLD" ] 2>/dev/null && [ "${bytes:-0}" -le "$BOUNDS_BYTES" ] 2>/dev/null; then
  pass
fi

# Past the threshold but flat: denying it costs more than it saves. See
# bounds_is_flat in lib/bounds-common.sh.
bounds_is_flat "$file_path" && pass

# Scope the escape hatch to the agent, not the session. Subagents run under the
# parent's session_id *and* its transcript_path, so a per-session key let one
# agent's forcing hand a free unbounded read to every other agent — and to the
# main chain — none of which ever saw the denial or its advice. Measured on one
# session: 4 denials in one agent, then a 35 640-character unbounded read waved
# through in the next one. `agent_id` is the only per-agent field in the payload;
# the main chain has none, and falls back to the session.
seen_file="/tmp/claude-readbounds-seen-${session_id}${agent_id:+-$agent_id}"

# Second identical attempt, same agent → let it through, and record that it
# happened. The denial list alone cannot tell a guard that works from a guard that
# is merely a speed bump: only the ratio forced/denied can. lib/context-report.sh
# prints both.
if [ -f "$seen_file" ] && grep -Fxq "$file_path" "$seen_file" 2>/dev/null; then
  echo "$file_path" >> "${seen_file}.forced"
  pass
fi
echo "$file_path" >> "$seen_file"

reason=$(bounds_reason \
  "Unbounded Read on $file_path ($lines lines, ${bytes:-0} bytes > $BOUNDS_THRESHOLD lines / $BOUNDS_BYTES bytes). The whole file stays in context until the session ends." \
  "$file_path" \
  "Read the range you need around one of them" \
  "Locate the range first (graphify explain/query, grep -n), then Read with offset/limit." \
  "Re-issue this exact Read to force the full read.")

jq -n --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
