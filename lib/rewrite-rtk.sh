#!/bin/bash
# bash-dispatch module — RTK rewrite, with absolute paths normalized first.
# Reads $HOOK_INPUT (full payload, for `rtk hook claude`) and $HOOK_CMD. Last stage
# of the chain: whatever it prints is the answer. When rtk answers nothing on a
# command we rewrote, the fallback below emits the rewrite without a decision: the
# user's permission rules judge the rewritten command, as they judge rtk's own rewrite.
set -u

input="${HOOK_INPUT:-}"
cmd="${HOOK_CMD:-}"
[ -n "$input" ] || exit 0
# Without rtk, a `rtk dotnet test` prefix would turn a working command into a missing one.
command -v rtk >/dev/null 2>&1 || exit 0

# In a linked git worktree (an isolated agent's), a command running git is left as
# written: Claude Code's isolation check refuses `rtk git …`, whose text no longer shows
# that git stays in the worktree. A linked worktree's top level holds a `.git` file.
case " $cmd " in
  *[\ \;\&\|\(]git\ *)
    d=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)
    [ -n "$d" ] || d=$PWD
    kit_path d
    while [ -n "$d" ]; do
      [ -f "$d/.git" ] && exit 0
      [ -d "$d/.git" ] && break
      case "$d" in */*) d=${d%/*} ;; *) break ;; esac
    done ;;
esac

# Every expression fires in command position only (line start or after `; & | (`,
# optionally behind VAR=value assignments): in `ls /usr/bin/grep` the path is an
# argument. An existing `rtk dotnet` / `proxy dotnet` is parked behind a placeholder so
# it is never prefixed twice. A command carrying `<<` is left whole: sed works per line
# and would rewrite a heredoc body.
# Opt-in CLAUDE_DOTNET_TEST_TIMEOUT=<duration> (Microsoft Testing Platform): inserts
# `--timeout <duration>` right behind `test` when absent; runs before the parking.
sed_args=(-E)
case "$cmd" in
  *'<<'*) ;;
  *) sed_args+=(-e 's#(^|[;&|(])([[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*)/(usr/local/bin|usr/bin|bin)/(grep|rg|find|egrep|fgrep)([[:space:]]|$)#\1\2\5\6#g') ;;
esac
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
  jq -cn --arg c "$normalized" '{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: {command: $c}}}'
fi
