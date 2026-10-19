#!/bin/bash
# bash-dispatch module — append a local stdout filter to a command RTK does not
# know how to shrink. One profile per filter, passed as $1.
# Profiles: graphify-query, git-grep. Fires when the LAST segment of the command is
# a bare match; any pipe, redirect or substitution leaves it alone (raw output: `| cat`).
# Reads HOOK_INPUT / HOOK_CMD, prints the hook JSON when it rewrites.
set -u

profile="${1:-}"
case "$profile" in
  graphify-query)
    trigger='^[[:space:]]*graphify[[:space:]]+query[[:space:]]'
    filter=graphify-query-filter.sh
    label="graphify query filter"
    ;;
  git-grep)
    trigger='^[[:space:]]*git[[:space:]]+grep[[:space:]]'
    filter=git-grep-filter.sh
    label="git grep filter"
    ;;
  *) exit 0 ;;
esac

input="${HOOK_INPUT:-}"
cmd="${HOOK_CMD:-}"
[ -n "$input" ] || exit 0

# Already piped, redirected, substituted — or already carrying this very filter.
case "$cmd" in
  *'|'*|*'>'*|*'<'*|*'$('*|*'`'*|*"$filter"*) exit 0 ;;
esac

last_segment=$(printf '%s' "$cmd" | sed -E 's#^.*(;|&&|&)[[:space:]]*##')
printf '%s' "$last_segment" | grep -Eq "$trigger" || exit 0

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

jq -cn --arg c "$cmd | bash $LIB/$filter" --arg l "$label" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: $l, updatedInput: {command: $c}}}'
