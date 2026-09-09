#!/bin/bash
# bash-dispatch module — RTK rewrite, with absolute paths normalized first.
#
# Strips the /usr/bin/, /bin/, /usr/local/bin/ prefix on grep/rg/find/egrep/fgrep
# so the RTK regex catches them: without it, `/usr/bin/grep ...` bypasses the
# rewrite (the word boundary fails on '/').
#
# This is the only place `rtk hook claude` is invoked. The user-level
# ~/.claude/settings.json used to register a second, bare `rtk hook claude` on
# PreToolUse:Bash — it ran on every command in parallel with this one and raced
# the graphify substitution with a competing `updatedInput`. Removed 2026-09-09.
#
# Contract: reads $HOOK_INPUT (full payload, `rtk hook claude` wants the JSON) and
# $HOOK_CMD. Last stage of the chain: whatever it prints is the answer.
set -u

input="${HOOK_INPUT:-}"
cmd="${HOOK_CMD:-}"
[ -n "$input" ] || exit 0

normalized=$(printf '%s' "$cmd" | sed -E 's#(^|[[:space:]|;&(])/(usr/local/bin|usr/bin|bin)/(grep|rg|find|egrep|fgrep)([[:space:]]|$)#\1\3\4#g')

if [ "$normalized" != "$cmd" ]; then
  input=$(printf '%s' "$input" | jq --arg c "$normalized" '.tool_input.command = $c')
fi

printf '%s' "$input" | rtk hook claude
