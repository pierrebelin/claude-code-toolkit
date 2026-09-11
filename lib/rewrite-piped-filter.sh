#!/bin/bash
# bash-dispatch module — append a local stdout filter to a command RTK does not
# know how to shrink. One profile per filter, passed as $1.
#
# Merged 2026-09-11 from rewrite-graphify.sh and rewrite-git-grep.sh. The two were
# the same module: same bail-out on pipe/redirect/substitution, same last-segment
# extraction through the same sed, same anchored match, same jq emission. They
# differed by a trigger regex and a filter path. A third filter now costs one line
# in the case below instead of a thirty-line copy that drifts from its sibling.
#
# Why these filters are local and not rtk's. `rtk hook claude` knows neither
# `graphify` nor `git grep`; `rtk git grep` is a plain passthrough and `rtk grep`
# would mangle the output. An upstream filter for tools this local has no reason
# to exist.
#
# Profiles:
#   graphify-query  measured 2026-09-10 on `graphify query "SES SDK client firmware"`:
#                   6102 B raw, 4282 B filtered (-30%), same source-carrying nodes on
#                   both sides. Re-measured against graphify 0.9.58 on 2026-09-11:
#                   -29.2%. `explain` is left alone — it emits 37-500 B and has
#                   nothing to trim.
#   git-grep        groups matches under a per-file header instead of repeating the
#                   path on every line. Measured 2026-09-10: `git grep -n MacroBlock`
#                   -48%, VfsRelease -33%, KeyProfileRegistryId -32%. Nothing is
#                   dropped, which is what "aucune limite de grep" in CLAUDE.md
#                   requires: the saving is pure path repetition.
#
# Firing rule: the LAST segment of the command must be a bare match, so
# `cd x && git grep -n "y"` counts and the appended pipe binds to that command
# only. Any pipe, redirect or substitution anywhere leaves the command untouched —
# which is also the escape hatch for raw output: append `| cat`.
#
# Ordering. Runs after guard-git.sh, which stays the authority on what a git
# command may do (`grep` is a read and guard-git lets it through silently), and
# before rewrite-rtk.sh, which has no rewrite of its own to contribute here.
#
# Contract: reads HOOK_INPUT / HOOK_CMD, prints the hook JSON when it rewrites,
# nothing when it passes.
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
