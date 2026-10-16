#!/bin/bash
# SessionStart hook — reset the per-session escape hatches, purge the leftovers.
#
# Replaces two inline `rm -f /tmp/claude-<x>-seen-$session_id` entries. The
# read-bounds one had stopped matching anything: read-bounds.sh keys its file on
# "${session_id}${agent_id:+-$agent_id}" since the per-agent scoping, so the exact
# name never existed. Measured on 2026-09-09: 20 files in /tmp, not one carrying a
# bare session id.
#
# Two jobs, because a fresh session_id cannot collide but a resumed one can:
#   - drop this session's files (glob, subagents included)
#   - purge anything older than 2 days, since nothing else ever cleans /tmp
set -u
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

sid=$(cat 2>/dev/null | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)

# Every family a hook or the statusline writes under claude-<prefix>-<session>.
PREFIXES="readbounds-seen catbounds-seen diffbounds-seen affected-seen knowledge-seen batching-nudge batching-tick clearnudge implement-tdd-guard implement-tdd-effort effort"

# Two directories, not one: implement-tdd-guard.sh and the effort state write to
# ${TMPDIR:-/tmp}, which on macOS is /var/folders/... and never /tmp. Deduplicated
# so a Linux session, where both resolve to /tmp, does not sweep twice.
DIRS="/tmp"
[ -n "${TMPDIR:-}" ] && [ "${TMPDIR%/}" != "/tmp" ] && DIRS="$DIRS ${TMPDIR%/}"

for dir in $DIRS; do
  for prefix in $PREFIXES; do
    rm -f "$dir/claude-${prefix}-$sid"* 2>/dev/null
  done
done

# -H, because on macOS /tmp is a symlink to private/tmp and find does not follow
# its own starting point: `find /tmp -maxdepth 1 -name ...` matches nothing at all.
find_args=""
for prefix in $PREFIXES; do
  [ -n "$find_args" ] && find_args="$find_args -o"
  find_args="$find_args -name claude-${prefix}-*"
done
# shellcheck disable=SC2086
for dir in $DIRS; do
  find -H "$dir" -maxdepth 1 \( $find_args \) -mtime +2 -delete 2>/dev/null
done

exit 0
