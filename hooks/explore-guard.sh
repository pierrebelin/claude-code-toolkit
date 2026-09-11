#!/bin/bash
# PreToolUse Agent hook — delegation guard for every subagent spawn.
#
# Split out of graphify-enforce.sh on 2026-09-09. It used to share a file with the
# grep substitution, which forced the same script to be registered on two matchers
# and to re-dispatch on tool_name internally. Different tool, different saving: an
# Explore spawn costs ~55k startup tokens, a grep costs ~300.
#
# Widened on 2026-09-11. It only ever matched `subagent_type == "Explore"`, so
# `general-purpose` and `Plan` — the two other spawns that read the repo and hand
# back a free-form report — walked past the graphify requirement, past the model
# choice and past any bound on the report. Three checks now, in cost order:
#
#   1. every Agent call carries a `description`     (CLAUDE.md, delegation rule)
#   2. graphify considered before a read-only spawn (a spawn costs ~55k, a query ~300)
#   3. the model is chosen, never inherited         (no parameter == Opus)
#
# and, when all three pass, the report contract is appended to the prompt itself.
# `additionalContext` would land in the *caller's* context, not the subagent's;
# only `updatedInput.prompt` reaches the agent being spawned. The final report of
# an agent is re-injected whole into the main conversation, so the contract is the
# only thing standing between a 20-line table and a pasted build log.
set -u
input=$(cat)

[[ "$(echo "$input" | jq -r '.tool_name // ""')" != "Agent" ]] && exit 0

deny() {
  jq -n --arg r "$1" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

description=$(echo "$input" | jq -r '.tool_input.description // ""')
[ -z "$description" ] && deny "Agent spawn blocked: every Agent call carries a description (CLAUDE.md). A delegation with no name is a delegation that was never scoped."

subagent=$(echo "$input" | jq -r '.tool_input.subagent_type // ""')
case "$subagent" in
  Explore|general-purpose|Plan) ;;
  *) exit 0 ;;
esac

prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""')
model=$(echo "$input" | jq -r '.tool_input.model // ""')

if ! echo "$prompt" | tr '[:upper:]' '[:lower:]' | grep -q 'graphify'; then
  deny "$subagent blocked: use graphify query/explain/path before spawning it. Mention graphify in the prompt if you already did."
fi

# Explore is read-only by definition: haiku, always. `general-purpose` also writes
# sometimes, so the model is not forced there — only made explicit, because an
# omitted parameter silently inherits Opus. `Plan` is a design agent: left alone.
case "$subagent" in
  Explore)
    [ "$model" = "haiku" ] || deny "Explore blocked: pass model: \"haiku\" (CLAUDE.md). Without the parameter the agent inherits Opus."
    ;;
  general-purpose)
    [ -n "$model" ] || deny "general-purpose blocked: pass an explicit model — \"haiku\" for a read-only search (CLAUDE.md), the default model for writing. Without the parameter the agent inherits Opus."
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

contract=$(printf '%s\n' \
  '' \
  '--- Report contract (explore-guard) ---' \
  'Style: caveman-ultra, in French — the report is read by the user, who works in French. Drop articles, pleasantries, hedging, tool narration. Fragments are fine. State each fact once. No prose abbreviations (impl/req/cfg), no arrows. Paths, symbols, commands and error messages: verbatim, in backticks.' \
  "$bound" \
  'Locate with `graphify explain|path|query` before reaching for grep; grep is for text, the graph is for symbols and relations.' \
  'Your final report is re-injected whole into the main conversation. Everything it carries is paid for there.')

echo "$input" | jq -c --arg c "$contract" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "delegation contract appended", updatedInput: (.tool_input | .prompt = (.prompt + $c))}}'
exit 0
