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
# choice and past any bound on the report. Two checks now, in cost order:
#
#   1. every Agent call carries a `description`     (CLAUDE.md, delegation rule)
#   2. the model is chosen, never inherited         (no parameter == Opus)
#
# Widened again on 2026-09-17, to every type and to the typeless spawn: check 2
# now covers a custom agent whose file pins no `model:`, and a call with no
# subagent_type at all, which is where the Opus leak actually sat.
#
# and, when both pass, the report contract is appended to the prompt itself.
#
# A third check — "the prompt mentions graphify" — sat between them until
# 2026-09-13. A keyword test: 12 denials over 60 sessions, each a lost round trip
# after which the model added the word and relaunched. The advice itself stays in
# the appended contract, where it costs no turn.
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

# A scoped spawn is a delegation: restart the window lib/delegation-nudge.sh
# counts direct reads in. Every subagent type counts — the TDD agents delegate as
# much as an Explore does — which is why this sits before the type filter below.
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"
IFS=$'\x1f' read -r session_id agent_id <<<"$(echo "$input" | jq -j '[(.session_id // "unknown"), (.agent_id // "")] | join("\u001f")')"
HOOK_SESSION_ID="$session_id" HOOK_AGENT_ID="$agent_id" bash "$LIB/delegation-nudge.sh" reset

subagent=$(echo "$input" | jq -r '.tool_input.subagent_type // ""')
model=$(echo "$input" | jq -r '.tool_input.model // ""')

# An Agent call that omits subagent_type starts general-purpose (Agent tool
# description). Until 2026-09-17 the case below matched "" against nothing and
# exited: a typeless spawn walked past the model check and inherited Opus. That
# was the whole leak — 83 subagent transcripts on Opus over 14 days, among them
# the mechanical CA1002 refactors of 2026-09-12, each carrying its own list of
# files and the rule to apply. Default the type here, before the filter.
[ -n "$subagent" ] || subagent="general-purpose"

case "$subagent" in
  Explore|general-purpose|Plan) ;;
  *)
    # A custom agent (.claude/agents/<type>.md) that pins `model:` in its
    # frontmatter needs no parameter — the frontmatter wins, which is how the
    # two TDD agents have run on sonnet since 2026-09-12. One that pins nothing
    # inherits Opus like anything else, so it is asked for the parameter.
    if grep -qE '^model:[[:space:]]*[^[:space:]]' "$LIB/../agents/$subagent.md" 2>/dev/null; then
      exit 0
    fi
    [ -n "$model" ] || deny "$subagent blocked: pass an explicit model, or pin \`model:\` in .claude/agents/$subagent.md. Without either the agent inherits Opus."
    exit 0
    ;;
esac

prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""')

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
