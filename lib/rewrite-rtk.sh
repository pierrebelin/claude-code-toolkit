#!/bin/bash
# bash-dispatch module — RTK rewrite, with absolute paths normalized first.
# Reads $HOOK_INPUT (full payload, for `rtk hook claude`) and $HOOK_CMD. Last stage
# of the chain: whatever it prints is the answer. When rtk answers nothing on a
# command we prefixed, the fallback below emits the decision itself.
set -u

input="${HOOK_INPUT:-}"
cmd="${HOOK_CMD:-}"
[ -n "$input" ] || exit 0

# The `dotnet` expressions fire in command position only (line start or after
# `; & | (`, optionally behind VAR=value assignments). An existing `rtk dotnet` /
# `proxy dotnet` is parked behind a placeholder so it is never prefixed twice.
# A command carrying `<<` skips them: sed works per line and would rewrite a heredoc body.
# Opt-in CLAUDE_DOTNET_TEST_TIMEOUT=<duration> (Microsoft Testing Platform): inserts
# `--timeout <duration>` right behind `test` when absent; runs before the parking.
sed_args=(-E
  -e 's#(^|[[:space:]|;&(])/(usr/local/bin|usr/bin|bin)/(grep|rg|find|egrep|fgrep)([[:space:]]|$)#\1\3\4#g')
test_timeout="${CLAUDE_DOTNET_TEST_TIMEOUT:-}"
case "$test_timeout" in *[!0-9a-z.]*) test_timeout="" ;; esac
if [ -n "$test_timeout" ]; then
  case "$cmd" in
    *'<<'*|*--timeout*) ;;
    *) sed_args+=(-e 's#(^|[;&|(])([[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(rtk[[:space:]]+)?(proxy[[:space:]]+)?dotnet[[:space:]]+test)([[:space:]]|$)#\1\2 --timeout '"$test_timeout"'\6#g') ;;
  esac
fi
sed_args+=(-e 's#(rtk|proxy)[[:space:]]+dotnet#\1 @@RTKDOTNET@@#g')
case "$cmd" in
  *'<<'*) ;;
  *) sed_args+=(-e 's#(^|[;&|(])([[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*)dotnet[[:space:]]+(test|restore|format)([[:space:]]|$)#\1\2rtk dotnet \4\5#g') ;;
esac
sed_args+=(-e 's#@@RTKDOTNET@@#dotnet#g')
normalized=$(printf '%s' "$cmd" | sed "${sed_args[@]}")

if [ "$normalized" != "$cmd" ]; then
  input=$(printf '%s' "$input" | jq --arg c "$normalized" '.tool_input.command = $c')
fi

out=$(printf '%s' "$input" | rtk hook claude)

if [ -n "$out" ]; then
  printf '%s' "$out"
elif [ "$normalized" != "$cmd" ]; then
  jq -cn --arg c "$normalized" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "RTK auto-rewrite", updatedInput: {command: $c}}}'
fi
