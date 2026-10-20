#!/bin/bash
# PreToolUse Agent hook — delegation guard for every subagent spawn.
# Checks a `description`, then an explicit model (no parameter == Opus). When both
# pass, appends the report contract to the prompt: `additionalContext` would land in
# the caller's context, only `updatedInput.prompt` reaches the agent.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
input=$(cat)

[[ "$(echo "$input" | jq -r '.tool_name // ""')" != "Agent" ]] && exit 0

deny() {
  jq -n --arg r "$1" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

description=$(echo "$input" | jq -r '.tool_input.description // ""')
[ -z "$description" ] && deny "Agent spawn blocked: every Agent call carries a description. A delegation with no name is a delegation that was never scoped."

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"

subagent=$(echo "$input" | jq -r '.tool_input.subagent_type // ""')
model=$(echo "$input" | jq -r '.tool_input.model // ""')

# A call without subagent_type starts general-purpose: default it before the filter.
[ -n "$subagent" ] || subagent="general-purpose"

case "$subagent" in
  Explore|general-purpose|Plan) ;;
  # A fork runs on the caller's model whatever the parameter, and carries its context.
  fork) exit 0 ;;
  *)
    # A custom agent pinning `model:` in its frontmatter needs no parameter.
    # Plugin agents arrive namespaced (`cctoolkit:x` → agents/x.md of the kit).
    if grep -qE '^model:[[:space:]]*[^[:space:]]' "$LIB/../agents/${subagent#cctoolkit:}.md" 2>/dev/null; then
      exit 0
    fi
    [ -n "$model" ] || deny "$subagent blocked: pass an explicit model, or pin \`model:\` in its agent file. Without either the agent inherits Opus."
    exit 0
    ;;
esac

prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""')

# The model is made explicit, never forced. `Plan` is left alone.
case "$subagent" in
  Explore|general-purpose)
    [ -n "$model" ] || deny "$subagent blocked: pass an explicit model — \"haiku\" by default for a read-only search, \"sonnet\" when it takes judgment or writes (context-discipline.md). Without the parameter the agent inherits Opus."
    ;;
esac

# Idempotent: a retried spawn must not stack the contract twice.
case "$prompt" in
  *"Report contract (explore-guard)"*) exit 0 ;;
esac

case "$subagent" in
  Plan)  bound="Hard cap: 40 lines. No raw log, no pasted build output, no code excerpt that was not asked for." ;;
  *)     bound="Hard cap: 20 lines. Prefer a \`file:line — fact\` table. No code excerpt unless explicitly asked, no raw log, no restating of the prompt or of the plan." ;;
esac

# A prompt stating its own size keeps it; the no-log, no-excerpt half still applies.
if printf '%s' "$prompt" | grep -qiE '[0-9]+ lines? max|max(imum)? [0-9]+ lines|at most [0-9]+ lines'; then
  bound="Size: the one stated above. No raw log, no pasted build output, no code excerpt that was not asked for."
fi

contract=$(printf '%s\n' \
  '' \
  '--- Report contract (explore-guard) ---' \
  'Style: caveman-ultra, in English (the main chain answers the user in their language). Drop articles, pleasantries, hedging, tool narration. Fragments are fine. State each fact once. No prose abbreviations (impl/req/cfg), no arrows. Paths, symbols, commands and error messages: verbatim, in backticks.' \
  "$bound" \
  'Locate with `graphify explain|path|query` before reaching for grep; grep is for text, the graph is for symbols and relations.' \
  'Your final report is re-injected whole into the main conversation. Everything it carries is paid for there.')

echo "$input" | jq -c --arg c "$contract" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "delegation contract appended", updatedInput: (.tool_input | .prompt = (.prompt + $c))}}'
exit 0
