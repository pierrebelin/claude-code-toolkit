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

sid=$(cat 2>/dev/null | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)

rm -f "/tmp/claude-graphify-seen-$sid"* "/tmp/claude-readbounds-seen-$sid"* 2>/dev/null

# -H, because on macOS /tmp is a symlink to private/tmp and find does not follow
# its own starting point: `find /tmp -maxdepth 1 -name ...` matches nothing at all.
find -H /tmp -maxdepth 1 \( -name 'claude-graphify-seen-*' -o -name 'claude-readbounds-seen-*' \) \
     -mtime +2 -delete 2>/dev/null

exit 0
