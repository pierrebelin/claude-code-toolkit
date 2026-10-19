#!/bin/bash
# PreToolUse Bash hook — single entry point for every Bash guard.
# Payload parsed once; modules run in MODULES order and the first that answers wins.
# Module contract: reads HOOK_* from the environment, prints the hook JSON when it
# decides, nothing when it passes. Sourced inside the command substitution, so a
# module's `exit` and `set -u` stay in that subshell.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"

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

# Advisory, outside the chain: merged into whatever the chain answers.
NUDGE=$(. "$LIB/batching-nudge.sh" 2>/dev/null || true)

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

MODULES=(
  "guard-git.sh"
  "guard-tdd-scope.sh"
  "guard-cat-bounds.sh"
  "guard-diff-bounds.sh"
  "guard-integration-filter.sh"
  "guard-auditor.sh"
  "rewrite-piped-filter.sh graphify-query"
  "rewrite-piped-filter.sh git-grep"
  "rewrite-rtk.sh"
)

# An entry may carry an argument: the unquoted expansion below is deliberate.
for module in "${MODULES[@]}"; do
  # shellcheck disable=SC2086
  out=$(set -- $module; f=$1; shift; . "$LIB/$f" "$@")
  if [ -n "$out" ]; then
    emit "$out"
    exit 0
  fi
done

emit ""
exit 0
