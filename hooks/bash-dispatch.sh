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
#   1. guard-git       deny / ask   -> terminal, nothing else runs
#   2. guard-graphify  substitute   -> terminal, rtk must not rewrap it
#   3. rewrite-rtk     rewrite      -> the default path
#
# Module contract: reads HOOK_* from the environment, prints the hook JSON on
# stdout when it decides, prints nothing when it passes.
set -u

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)"

HOOK_INPUT=$(cat)

# Single parse for the whole chain.
read -r HOOK_TOOL_NAME HOOK_SESSION_ID HOOK_AGENT_ID <<<"$(
  printf '%s' "$HOOK_INPUT" | jq -r '[(.tool_name // ""), (.session_id // "unknown"), (.agent_id // "")] | @tsv'
)"
HOOK_CMD=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.command // ""')

[ "$HOOK_TOOL_NAME" = "Bash" ] || exit 0
[ -n "$HOOK_CMD" ] || exit 0

export HOOK_INPUT HOOK_CMD HOOK_SESSION_ID HOOK_AGENT_ID

for module in guard-git.sh guard-graphify-grep.sh rewrite-rtk.sh; do
  out=$(bash "$LIB/$module")
  if [ -n "$out" ]; then
    printf '%s\n' "$out"
    exit 0
  fi
done

exit 0
