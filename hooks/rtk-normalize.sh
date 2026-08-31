#!/bin/bash
# PreToolUse Bash hook — normalize absolute paths to bare names so RTK rewrite catches them.
# Wraps `rtk hook claude`: strips /usr/bin/, /bin/, /usr/local/bin/ prefix on grep/rg/find/egrep/fgrep.
# Without this, `/usr/bin/grep ...` bypasses RTK regex (word boundary fails on '/').
set -u
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

normalized=$(echo "$cmd" | sed -E 's#(^|[[:space:]|;&(])/(usr/local/bin|usr/bin|bin)/(grep|rg|find|egrep|fgrep)([[:space:]]|$)#\1\3\4#g')

if [ "$normalized" != "$cmd" ]; then
  input=$(echo "$input" | jq --arg c "$normalized" '.tool_input.command = $c')
fi

echo "$input" | rtk hook claude
