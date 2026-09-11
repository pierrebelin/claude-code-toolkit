#!/bin/bash
# PreToolUse Read|Agent hook — nudge towards delegation once direct reading piles up.
#
# The CLAUDE.md threshold ("3+ recherches incertaines → sous-agent Explore") is a
# written rule nobody applies: 163 Agent calls against 1305 Read over 180 sessions
# of transcripts. graphify affected was the same shape of problem — a capability
# that only ever fires when something fires it.
#
# The economics it is defending, measured on those transcripts:
#   Read   11.9 MB over 1305 calls -> 9091 bytes per call
#   Agent   0.3 MB over  163 calls -> 1639 bytes per call
# A subagent reads twenty files and hands back a conclusion. The same twenty files
# read directly stay in context until the session ends.
#
# It does not deny. Any single read is legitimate; only the accumulation is not,
# and a hook cannot tell which read is the wasteful one. So it states the count
# and gets out of the way — the shape that works in batching-nudge.sh, which
# nudges with "the last 6 turns each held a single call" rather than "remember to
# batch". A number
# the reader recognises is what makes a nudge land.
#
# Fires once per session. A nudge that repeats becomes furniture.
set -u

THRESHOLD=${CLAUDE_DELEGATION_NUDGE_THRESHOLD:-6}

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
agent_id=$(echo "$input" | jq -r '.agent_id // ""')
base="/tmp/claude-delegation-${session_id}${agent_id:+-$agent_id}"

# A subagent doing the reading is the outcome this hook wants, so its own reads
# must not be counted against it — and the main chain has no agent_id, which is
# what separates the two here.
[ -n "$agent_id" ] && exit 0

case "$tool_name" in
  Agent)
    # Delegation happened. Record it and never nudge this session again.
    touch "${base}.delegated"
    exit 0
    ;;
  Read) ;;
  *) exit 0 ;;
esac

[ -f "${base}.delegated" ] && exit 0
[ -f "${base}.nudged" ] && exit 0

file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')
case "$file_path" in *.cs) ;; *) exit 0 ;; esac

# Distinct files, not raw calls. Re-reading one aggregate while editing it is
# normal work; touching eight different files is exploration, and exploration is
# what delegates well. Measured: 14.8% of .cs reads are a second read of a file
# already read in the same session, so counting calls would fire on a single file.
seen="${base}.files"
grep -Fxq "$file_path" "$seen" 2>/dev/null || echo "$file_path" >> "$seen"
count=$(wc -l < "$seen" 2>/dev/null | tr -d ' ')
[ -n "$count" ] || exit 0
[ "$count" -lt "$THRESHOLD" ] 2>/dev/null && exit 0

touch "${base}.nudged"

ctx="Delegation: $count distinct .cs files read directly this session, no subagent.

Measured over 180 sessions: a Read returns 9,091 bytes on average, an Agent 1,639. The subagent reads, then hands back a conclusion; the files read here stay in context until the session ends.

If what is left to cover is exploration — locating, mapping, checking a convention across N files — send an Agent (\`model: haiku\`, report bounded in the prompt). If it is targeted reading on a path already known, stay with Read: it is the right tool."

jq -cn --arg c "$ctx" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $c}}'
exit 0
