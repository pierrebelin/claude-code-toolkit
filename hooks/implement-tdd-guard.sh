#!/bin/bash
# UserPromptSubmit + PreToolUse:Skill hook — one batch, one session.
# Denies a second /implement-tdd in a session that already closed a batch, and a
# launch at effort high or above. A closed batch = the skill's closing literal in the
# transcript (frozen). The launch's id is its first F<n>.
# Escape hatch: re-issuing the identical launch passes (a marker, consumed).
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
input=$(cat)

event=$(echo "$input" | jq -r '.hook_event_name // ""')

case "$event" in
  UserPromptSubmit)
    launch=$(echo "$input" | jq -r '.prompt // ""')
    echo "$launch" | grep -qiE '(^|[[:space:]])/?(cctoolkit:)?implement-tdd([[:space:]]|$)' || exit 0
    ;;
  PreToolUse)
    [[ "$(echo "$input" | jq -r '.tool_name // ""')" == "Skill" ]] || exit 0
    # The bare name is a copy predating the plugin.
    case "$(echo "$input" | jq -r '.tool_input.skill // ""')" in
      implement-tdd|cctoolkit:implement-tdd) ;;
      *) exit 0 ;;
    esac
    launch=$(echo "$input" | jq -r '.tool_input.args // ""')
    ;;
  *) exit 0 ;;
esac

session=$(echo "$input" | jq -r '.session_id // "nosession"')

# --- Orchestrator effort ---
# The statusline drops .effort.level in $TMPDIR; no file = unknown = let through.
# CLAUDE_EFFORT_LEVEL forces the value (evals, troubleshooting).
state_dir="${CLAUDE_EFFORT_STATE_DIR:-${TMPDIR:-/tmp}}"
effort="${CLAUDE_EFFORT_LEVEL:-}"
if [[ -z "$effort" ]]; then
  for f in "$state_dir/claude-effort-$session" "$state_dir/claude-effort-last"; do
    [[ -f "$f" ]] || continue
    effort=$(head -c 16 "$f" 2>/dev/null | tr -cd 'a-z')
    [[ -n "$effort" ]] && break
  done
fi

case "$effort" in
  high|xhigh|max)
    effort_marker="${TMPDIR:-/tmp}/claude-implement-tdd-effort-${session}"
    if [[ -f "$effort_marker" ]]; then
      rm -f "$effort_marker"
    else
      touch "$effort_marker"
      effort_reason="Effort \"${effort}\" — switch to /effort medium before the batch.
The loop runs 100 to 180 orchestrator turns at 8.6 s of latency each, measured at effort high over ten batches; the auditor and the writing agents keep their own, fixed in their frontmatter.
Type /effort medium, then relaunch /cctoolkit:implement-tdd batch FX.
Force: re-issue the identical launch a second time."
      if [[ "$event" == "PreToolUse" ]]; then
        jq -n --arg r "$effort_reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
        exit 0
      fi
      echo "$effort_reason" >&2
      exit 2
    fi
    ;;
esac

# Correction mode reopens the batch that is already closed — that is its purpose.
echo "$launch" | grep -qiE 'correction' && exit 0

transcript=$(echo "$input" | jq -r '.transcript_path // ""')
# Inside a subagent the payload's transcript is the main chain's: the agent's own
# sits beside it, <dir>/<session>/subagents/agent-<id>.jsonl. Absent, nothing is judged.
agent=$(echo "$input" | jq -r '.agent_id // ""')
[[ -n "$agent" && -n "$transcript" ]] && transcript="${transcript%.jsonl}/subagents/agent-${agent}.jsonl"
[[ -n "$transcript" && -f "$transcript" ]] || exit 0

# Cheap prefilter before paying jq on a large JSONL.
grep -qE 'Batch F[0-9]+ complete' "$transcript" 2>/dev/null || exit 0

closed=$(jq -rs '
  [ .[]
    | select(.type == "assistant")
    | (.message.content // [])[]
    | select(.type == "text")
    | .text
    | scan("Batch (F[0-9]+) complete — manual validation required")[]
  ] | last // ""' "$transcript" 2>/dev/null)

[[ -n "$closed" ]] || exit 0

lot=$(echo "$launch" | grep -oiE '\bF[0-9]+\b' | head -1 | tr '[:lower:]' '[:upper:]')

marker="${TMPDIR:-/tmp}/claude-implement-tdd-guard-${session}-${closed}-${lot:-next}"

if [[ -f "$marker" ]]; then
  rm -f "$marker"
  exit 0
fi
touch "$marker"

reason="Batch ${closed} already closed in this session — /clear before batch ${lot:-next}.
The next batch would pay the accumulated context of the previous one on every turn (measured: 1.9x the input at equal request count).
Read nothing, delegate nothing, write nothing. Relaunch /cctoolkit:implement-tdd batch ${lot:-FX} after the /clear.
Force: re-issue the identical launch a second time."

if [[ "$event" == "PreToolUse" ]]; then
  jq -n --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
fi

echo "$reason" >&2
exit 2
