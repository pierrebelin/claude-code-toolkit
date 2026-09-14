#!/bin/bash
# read-bounds module — nudge towards delegation once direct reading piles up.
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
# nudges with "6 tours à un seul appel" rather than "pense à grouper". A number
# the reader recognises is what makes a nudge land.
#
# Fires at the threshold, then at each doubling (6, 12, 24 files). Once per
# session was the first version: a single nudge at 6 said nothing about a session
# that went on to read 30 files directly. A doubling keeps it rare without
# letting it go silent.
#
# Window, not flag. Version 2 dropped a `.delegated` flag on the first Agent
# call and stayed silent for the rest of the session: one Explore at turn 2, then
# thirty direct reads, and the hook never spoke again. The count now restarts at
# every spawn — explore-guard.sh calls this module with `reset` — so a session
# that delegates once and then reads everything itself is nudged like any other.
#
# Lived in hooks/ as its own PreToolUse Read|Agent hook until 2026-09-12. Same
# matcher as read-bounds.sh, same payload, and each ran its own jq chain: the
# pair cost 31 ms per Read. Now a module of read-bounds.sh, which parses once
# and sources this after the bounds decision, on the reads that go through.
#
# Contract: HOOK_SESSION_ID, HOOK_AGENT_ID and HOOK_FILE_PATH from the
# environment; additionalContext JSON on stdout when it decides, nothing when it
# passes. `reset` as $1 clears the window for the caller's (session, agent).
set -u

THRESHOLD=${CLAUDE_DELEGATION_NUDGE_THRESHOLD:-6}
sid=${HOOK_SESSION_ID:-unknown}
agent=${HOOK_AGENT_ID:-}
base="/tmp/claude-delegation-${sid}${agent:+-$agent}"

if [ "${1:-}" = "reset" ]; then
  rm -f "${base}.files" "${base}.nudged"
  exit 0
fi

# Subagents are the delegation; their reads are what the nudge asks for.
[ -n "$agent" ] && exit 0

# Only source files count as exploration. A CLAUDE.md, a plan or a snapshot is
# read because it is the target, not because it is being searched.
file_path=${HOOK_FILE_PATH:-}
case "$file_path" in *.cs) ;; *) exit 0 ;; esac

last=0
[ -f "${base}.nudged" ] && read -r last < "${base}.nudged" 2>/dev/null
case "$last" in ''|*[!0-9]*) last=0 ;; esac

# Distinct files, not calls: re-reading the same file is a bounded read in
# progress, not a survey.
seen="${base}.files"
grep -Fxq "$file_path" "$seen" 2>/dev/null || echo "$file_path" >> "$seen"
count=$(wc -l < "$seen" 2>/dev/null | tr -d ' ')
[ -n "$count" ] || exit 0

[ "$count" -lt "$THRESHOLD" ] 2>/dev/null && exit 0
[ "$count" -ge $(( last * 2 )) ] 2>/dev/null || exit 0
printf '%s' "$count" > "${base}.nudged"

ctx="Delegation: $count distinct .cs files read directly since the last subagent.
Measured over 180 sessions: a Read returns 9,091 bytes on average, an Agent 1,639. The subagent reads, then hands back a conclusion; the files read here stay in context until the session ends.
If what is left to cover is exploration — locating, mapping, checking a convention across N files — send an Agent (\`model: haiku\`, report bounded in the prompt). If it is a question about files you can already name — what X does, which rules, which dependencies — \`bash .claude/tools/bulk-read --question \"...\" --paths f1 f2\`: one-shot haiku worker, ~500 fixed tokens, no spawn. If it is targeted reading on a path already known, stay with Read: it is the right tool."

jq -cn --arg c "$ctx" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $c}}'
exit 0
