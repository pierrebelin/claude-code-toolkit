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

# All six families, not two. Measured 2026-09-11, /tmp held 37 orphaned
# claude-batching-nudge-*, 6 claude-catbounds-seen-*, plus delegation and affected
# leftovers that nothing ever removed: only graphify and readbounds were listed.
PREFIXES="graphify-seen readbounds-seen catbounds-seen affected-seen batching-nudge batching-tick delegation clearnudge implement-tdd-guard implement-tdd-effort effort"

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

# Third job: give the caveman flag back its pre-skill mode. caveman-skill-ultra.sh
# writes `ultra` into the global ~/.claude/.caveman-active and saves what was
# there beside it; this runs at the next session start — /clear included, which
# is where a batch ends. Restored only while the flag still reads `ultra`: a mode
# the user switched by hand in between is theirs. Empty saved value = no flag
# before the skill, so the plugin's default comes back by removing the file.
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
flag="$cfg/.caveman-active"
saved="$cfg/.caveman-active.before-skill"
if [ -f "$saved" ]; then
  if [ "$(cat "$flag" 2>/dev/null)" = "ultra" ]; then
    prev=$(cat "$saved" 2>/dev/null || true)
    if [ -n "$prev" ]; then printf '%s' "$prev" > "$flag"; else rm -f "$flag"; fi
  fi
  rm -f "$saved"
fi

exit 0
