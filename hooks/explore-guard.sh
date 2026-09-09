#!/bin/bash
# PreToolUse Agent hook — no Explore subagent without graphify considered first.
#
# Split out of graphify-enforce.sh on 2026-09-09. It used to share a file with the
# grep substitution, which forced the same script to be registered on two matchers
# and to re-dispatch on tool_name internally. Different tool, different saving: an
# Explore spawn costs ~55k startup tokens, a grep costs ~300.
set -u
input=$(cat)

[[ "$(echo "$input" | jq -r '.tool_name // ""')" != "Agent" ]] && exit 0
[[ "$(echo "$input" | jq -r '.tool_input.subagent_type // ""')" != "Explore" ]] && exit 0

prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""' | tr '[:upper:]' '[:lower:]')
if ! echo "$prompt" | grep -q 'graphify'; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Explore blocked: use graphify query/explain/path before spawning Explore. Mention graphify in the prompt if you already did."}}'
fi
exit 0
