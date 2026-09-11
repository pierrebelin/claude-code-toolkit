#!/bin/bash
# PreToolUse Bash hook — single entry point for every Bash guard.
#
# Why one dispatcher instead of four hooks. Measured on 2026-09-09, the previous
# chain cost ~75 ms per Bash call (git-guard 22, rtk-normalize 19,
# graphify-enforce 14, plus a dead graphify-usage logger at 20) and each stage
# re-ran its own `cat` + `jq` on the same payload.
#
# It also removes a real bug: rtk-normalize and graphify-enforce both returned an
# `updatedInput` for the same command (`grep -rn SesKey .` produced both
# `rtk grep -rn SesKey .` and `graphify explain "SesKey"`), with no defined
# winner — and graphify burned its per-session escape hatch even when rtk won.
# Here the order is explicit and only one stage ever answers.
#
# Order:
#   1. guard-git         deny / ask -> terminal, nothing else runs
#   2. guard-graphify    substitute -> terminal, rtk must not rewrap it
#   3. guard-cat-bounds  deny       -> terminal, an unbounded dump never reaches rtk
#   4. piped-filter x2   rewrite    -> terminal, rtk knows neither of these tools
#   5. rewrite-rtk       rewrite    -> the default path
#
# A module entry may carry an argument, which is why MODULES is an array and the
# expansion below is deliberately unquoted: the strings are ours, not the user's.
#
# Module contract: reads HOOK_* from the environment, prints the hook JSON on
# stdout when it decides, prints nothing when it passes.
set -u

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"

HOOK_INPUT=$(cat)

# Single parse for the whole chain.
# The separator is US (\x1f), not a tab: a tab is IFS-whitespace, and bash
# collapses runs of IFS-whitespace into one delimiter even when IFS holds
# nothing else. An empty agent_id — the main chain always has one — therefore
# shifted transcript_path into HOOK_AGENT_ID and made every caller look like a
# subagent. A non-whitespace separator keeps empty fields.
# One jq for the whole payload. Metadata and command were two spawns (~3.2 ms
# each); the command is appended behind an RS (\x1e) instead, and split off on
# the FIRST occurrence — the four metadata fields can hold neither separator.
# -j, not -r: no trailing newline to strip, and none to inject into the command.
PARSED=$(printf '%s' "$HOOK_INPUT" | jq -j '([(.tool_name // ""), (.session_id // "unknown"), (.agent_id // ""), (.transcript_path // "")] | join("\u001f")) + "\u001e" + (.tool_input.command // "")')

IFS=$'\x1f' read -r HOOK_TOOL_NAME HOOK_SESSION_ID HOOK_AGENT_ID HOOK_TRANSCRIPT_PATH <<<"${PARSED%%$'\x1e'*}"
HOOK_CMD="${PARSED#*$'\x1e'}"

[ "$HOOK_TOOL_NAME" = "Bash" ] || exit 0
[ -n "$HOOK_CMD" ] || exit 0

export HOOK_INPUT HOOK_CMD HOOK_SESSION_ID HOOK_AGENT_ID HOOK_TRANSCRIPT_PATH

# Advisory, not a decision: it never denies and never rewrites, so it runs
# outside the terminal chain and is merged into whatever that chain answers.
NUDGE=$(bash "$LIB/batching-nudge.sh" 2>/dev/null || true)

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
  # Graft the nudge onto the decision. A module answer that is not an object
  # carrying hookSpecificOutput is passed through untouched: the decision always
  # outranks the advice.
  merged=$(printf '%s' "$1" | jq --arg c "$NUDGE" \
    'if type == "object" and has("hookSpecificOutput")
     then .hookSpecificOutput.additionalContext =
       (((.hookSpecificOutput.additionalContext // "") | if . == "" then "" else . + "\n" end) + $c)
     else . end' 2>/dev/null) || merged=""
  printf '%s\n' "${merged:-$1}"
}

MODULES=(
  "guard-git.sh"
  "guard-graphify-grep.sh"
  "guard-cat-bounds.sh"
  "rewrite-piped-filter.sh graphify-query"
  "rewrite-piped-filter.sh git-grep"
  "rewrite-rtk.sh"
)

for module in "${MODULES[@]}"; do
  # shellcheck disable=SC2086
  out=$(bash "$LIB/"$module)
  if [ -n "$out" ]; then
    emit "$out"
    exit 0
  fi
done

emit ""
exit 0
