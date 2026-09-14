#!/bin/bash
# UserPromptSubmit + PreToolUse:Skill hook — one batch, one session.
#
# /implement-tdd relaunched without /clear makes the new batch pay the whole
# accumulated context of the previous one on every turn. The skill already says so
# (SKILL.md section 1 entry guard, "End of batch"), but a consigne addressed to the
# agent is not a barrier: the orchestrator reads it after the reads it was meant to
# prevent.
#
# Detection reads the transcript, not a state file: the closing literal emitted by
# /implement-tdd is emitted once per closed batch and by nothing else. Both wordings
# are matched — the skill emits the English one, the French alternative only catches
# a transcript started before the kit was translated — and the reply is English in
# either case. F<n> requires a digit, so the skill sources and this file, which quote
# "Lot FX" / "Batch FX", never match.
#
# Escape hatch, same convention as read-bounds.sh (and guard-graphify-grep.sh, removed 2026-09-13):
# re-issuing the identical launch lets it through. The first attempt drops a marker,
# the second consumes it.
set -u
input=$(cat)

event=$(echo "$input" | jq -r '.hook_event_name // ""')

case "$event" in
  UserPromptSubmit)
    launch=$(echo "$input" | jq -r '.prompt // ""')
    echo "$launch" | grep -qiE '(^|[[:space:]])/?implement-tdd([[:space:]]|$)' || exit 0
    ;;
  PreToolUse)
    [[ "$(echo "$input" | jq -r '.tool_name // ""')" == "Skill" ]] || exit 0
    [[ "$(echo "$input" | jq -r '.tool_input.skill // ""')" == "implement-tdd" ]] || exit 0
    launch=$(echo "$input" | jq -r '.tool_input.args // ""')
    ;;
  *) exit 0 ;;
esac

session=$(echo "$input" | jq -r '.session_id // "nosession"')

# --- Orchestrator effort ---
#
# Measured on ten batches (07-10/09/2026): 155 min of model latency out of 628 min,
# 8.6 s per turn over 1 087 turns, every one at effort high. Effort is settable
# neither by a hook nor by a skill frontmatter — only /effort changes it, and it
# holds for the whole session. So the harness can only refuse the launch, the way
# it already refuses a batch relaunched without /clear.
#
# Channel: the statusline is the only place that receives .effort.level; it drops
# the value in $TMPDIR (statusline-command.sh). Missing file = unknown effort = let
# it through: a batch must never be blocked by a statusline that has not run yet.
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
Type /effort medium, then relaunch /implement-tdd batch FX.
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
[[ -n "$transcript" && -f "$transcript" ]] || exit 0

# Cheap prefilter before paying jq on a large JSONL.
grep -qE '(Lot F[0-9]+ termin|Batch F[0-9]+ complete)' "$transcript" 2>/dev/null || exit 0

closed=$(jq -rs '
  [ .[]
    | select(.type == "assistant")
    | (.message.content // [])[]
    | select(.type == "text")
    | .text
    | scan("(?:Lot (F[0-9]+) terminé — validation manuelle requise)|(?:Batch (F[0-9]+) complete — manual validation required)")
    | map(select(. != null))[]
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
The next batch would pay the accumulated context of the previous one on every turn (measured: 1.9x the input at equal request count, see implement-tdd SKILL.md \"End of batch\").
Read nothing, delegate nothing, write nothing. Relaunch /implement-tdd batch ${lot:-FX} after the /clear.
Force: re-issue the identical launch a second time."

if [[ "$event" == "PreToolUse" ]]; then
  jq -n --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
fi

echo "$reason" >&2
exit 2
