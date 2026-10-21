#!/bin/bash
# PreToolUse Bash hook — single entry point for every Bash guard.
# Payload parsed once; modules run in MODULES order and the first that answers wins.
# Module contract: reads HOOK_* from the environment, prints the hook JSON when it
# decides, nothing when it passes. Sourced inside the command substitution, so a
# module's `exit` and `set -u` stay in that subshell.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

LIB="${BASH_SOURCE[0]%/*}/../lib"

HOOK_INPUT=$(cat)

# One jq. US (\x1f) separator, not a tab: bash collapses IFS-whitespace runs, so an
# empty field would shift the rest. The command follows an RS (\x1e), split on the
# FIRST one. -j, not -r: no trailing newline injected into the command.
PARSED=$(printf '%s' "$HOOK_INPUT" | jq -j '([(.tool_name // ""), (.session_id // "unknown"), (.agent_id // ""), (.transcript_path // ""), (.agent_type // ""), (.tool_input.run_in_background // false | tostring)] | join("\u001f")) + "\u001e" + (.tool_input.command // "")')

IFS=$'\x1f' read -r HOOK_TOOL_NAME HOOK_SESSION_ID HOOK_AGENT_ID HOOK_TRANSCRIPT_PATH HOOK_AGENT_TYPE HOOK_BACKGROUND <<<"${PARSED%%$'\x1e'*}"
HOOK_CMD="${PARSED#*$'\x1e'}"

[ "$HOOK_TOOL_NAME" = "Bash" ] || exit 0
[ -n "$HOOK_CMD" ] || exit 0

export HOOK_INPUT HOOK_CMD HOOK_SESSION_ID HOOK_AGENT_ID HOOK_TRANSCRIPT_PATH HOOK_AGENT_TYPE HOOK_BACKGROUND

# Advisory, outside the chain: merged into whatever the chain answers. Main chain with a
# transcript only — the module's own first two exits, tested here so a subagent pays no fork.
NUDGE=""
if [ -z "$HOOK_AGENT_ID" ] && [ -n "$HOOK_TRANSCRIPT_PATH" ]; then
  NUDGE=$(. "$LIB/batching-nudge.sh" 2>/dev/null || true)
fi

emit() {
  # $1 = the module's JSON, or empty when no module decided.
  if [ -z "$NUDGE" ]; then
    [ -n "${1:-}" ] && printf '%s\n' "$1"
    return
  fi
  if [ -z "${1:-}" ]; then
    jq -n --arg c "$NUDGE" \
      '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $c}}'
    return
  fi
  # Graft the nudge onto the decision; an answer without hookSpecificOutput passes untouched.
  merged=$(printf '%s' "$1" | jq --arg c "$NUDGE" \
    'if type == "object" and has("hookSpecificOutput")
     then .hookSpecificOutput.additionalContext =
       (((.hookSpecificOutput.additionalContext // "") | if . == "" then "" else . + "\n" end) + $c)
     else . end' 2>/dev/null) || merged=""
  printf '%s\n' "${merged:-$1}"
}

# Each entry: the module, then the filter it needs to run — `cmd=<ERE>` on the command,
# `agent=<ERE>` on agent_type, `-` always. A module whose filter fails is never forked (a
# subshell costs ~20 ms on Windows). The filter is the module's own bail-out, written once
# here; the module keeps its own copy for a run alone (an eval).
MODULES=(
  "guard-git.sh                 cmd=git"
  "guard-tdd-scope.sh           agent=(tdd-implementer|tdd-test-author|tdd-cycle)$"
  "guard-cat-bounds.sh          cmd=cat|head|tail|sed|awk"
  "guard-diff-bounds.sh         cmd=git"
  "guard-integration-filter.sh  cmd=dotnet test|IntegrationTests[.](dll|exe)"
  "guard-auditor.sh             agent=ddd-tdd-auditor$"
  "rewrite-piped-filter.sh      cmd=graphify|git.*grep"
  "rewrite-rtk.sh               -"
)

for entry in "${MODULES[@]}"; do
  module=${entry%% *}
  filter=${entry#"$module"}
  filter=${filter#"${filter%%[! ]*}"}
  case "$filter" in
    cmd=*) [[ $HOOK_CMD =~ ${filter#cmd=} ]] || continue ;;
    agent=*) [[ $HOOK_AGENT_TYPE =~ ${filter#agent=} ]] || continue ;;
  esac
  out=$(. "$LIB/$module")
  if [ -n "$out" ]; then
    emit "$out"
    exit 0
  fi
done

emit ""
exit 0
