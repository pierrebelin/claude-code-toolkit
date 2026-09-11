#!/bin/bash
# bash-dispatch module — RTK rewrite, with absolute paths normalized first.
#
# Strips the /usr/bin/, /bin/, /usr/local/bin/ prefix on grep/rg/find/egrep/fgrep
# so the RTK regex catches them: without it, `/usr/bin/grep ...` bypasses the
# rewrite (the word boundary fails on '/').
#
# Prefixes `dotnet test|restore|format` with `rtk` as well, while the `rtk dotnet`
# filter accepts all four — 80 unfiltered calls in the 2026-09-10 `rtk discover`
# report came from that gap. Because the rewrite is ours and not rtk's,
# `rtk hook claude` then sees an already-prefixed command and answers nothing:
# the fallback below emits the decision itself.
#
# Re-measured against rtk 0.48.0 on 2026-09-11 (was 0.42.4): upstream now covers
# `dotnet build` AND `dotnet format` natively, but still declines `dotnet test`
# and `dotnet restore` — confirmed on both entry points, `rtk hook claude` and the
# new `rtk rewrite`, which upstream documents as the single source of truth for
# hooks. So two of the four remain ours. `format` is now redundant and kept: our
# sed runs first, rtk sees `rtk dotnet format`, declines, the fallback answers —
# same output either way, and dropping it would only add a version dependency.
# Re-run the probe before trusting this on a later rtk.
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

# The `dotnet` expression only fires in command position — start of line, or after
# one of `; & | (` — optionally behind a run of VAR=value assignments, so
# `STID_TEST_MODE=true dotnet test` is covered. Anything else is left alone: a
# `dotnet test` quoted inside a heredoc, a doc string or an argument is text, not a
# command, and prefixing it there corrupts the payload. `dotnet` reached through a
# path (~/.dotnet/tools/...) fails the same way — no command boundary before it.
# An already-prefixed `rtk dotnet` / `proxy dotnet` is parked behind a placeholder
# so the expression cannot prefix it twice, `proxy` included since that spelling is
# the deliberate way to bypass the filter.
# One sed, four -e: the expressions apply to each line in order, exactly as the
# four-stage pipe did, for three spawns fewer (~8.5 ms measured 2026-09-11).
normalized=$(printf '%s' "$cmd" | sed -E \
  -e 's#(^|[[:space:]|;&(])/(usr/local/bin|usr/bin|bin)/(grep|rg|find|egrep|fgrep)([[:space:]]|$)#\1\3\4#g' \
  -e 's#(rtk|proxy)[[:space:]]+dotnet#\1 @@RTKDOTNET@@#g' \
  -e 's#(^|[;&|(])([[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*)dotnet[[:space:]]+(test|restore|format)([[:space:]]|$)#\1\2rtk dotnet \4\5#g' \
  -e 's#@@RTKDOTNET@@#dotnet#g')

if [ "$normalized" != "$cmd" ]; then
  input=$(printf '%s' "$input" | jq --arg c "$normalized" '.tool_input.command = $c')
fi

out=$(printf '%s' "$input" | rtk hook claude)

if [ -n "$out" ]; then
  printf '%s' "$out"
elif [ "$normalized" != "$cmd" ]; then
  jq -cn --arg c "$normalized" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "RTK auto-rewrite", updatedInput: {command: $c}}}'
fi
