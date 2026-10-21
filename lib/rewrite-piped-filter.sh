#!/bin/bash
# bash-dispatch module — append a local stdout filter to a command RTK does not
# know how to shrink. Profiles, tested in this order: `graphify query` (graphify-query-filter.sh),
# `git grep` (git-grep-filter.sh). Fires when the LAST segment of a line of the command is
# a bare match; any pipe, redirect or substitution leaves it alone (raw output: `| cat`).
# Reads HOOK_INPUT / HOOK_CMD, prints the hook JSON when it rewrites. No fork before it decides.
set -u

input="${HOOK_INPUT:-}"
cmd="${HOOK_CMD:-}"
[ -n "$input" ] || exit 0

# Already piped, redirected or substituted.
case "$cmd" in
  *'|'*|*'>'*|*'<'*|*'$('*|*'`'*) exit 0 ;;
esac

# True when the last segment (after the last `;`, `&&` or `&`) of one line of the command
# matches $1. Per line, as the sed and grep this replaces read it.
last_segment_matches() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    [[ ${line##*[;&]} =~ $1 ]] && return 0
  done <<<"$cmd"
  return 1
}

for profile in graphify-query git-grep; do
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
  esac
  # Already carrying this very filter.
  case "$cmd" in *"$filter"*) continue ;; esac
  last_segment_matches "$trigger" || continue

  LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  jq -cn --arg c "$cmd | bash $LIB/$filter" --arg l "$label" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: $l, updatedInput: {command: $c}}}'
  exit 0
done
exit 0
