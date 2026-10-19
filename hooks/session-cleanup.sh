#!/bin/bash
# SessionStart hook — reset the per-session escape hatches, purge the leftovers.
# Drops this session's files (glob: per-agent names carry a suffix) and purges
# anything older than 2 days.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

sid=$(cat 2>/dev/null | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)

# Every family a hook or the statusline writes under claude-<prefix>-<session>.
PREFIXES="readbounds-seen catbounds-seen diffbounds-seen knowledge-seen batching-nudge batching-tick clearnudge runnotes implement-tdd-guard implement-tdd-effort effort"

# Also ${TMPDIR} (macOS: /var/folders/...), where the effort state is written; deduplicated.
DIRS="/tmp"
[ -n "${TMPDIR:-}" ] && [ "${TMPDIR%/}" != "/tmp" ] && DIRS="$DIRS ${TMPDIR%/}"

for dir in $DIRS; do
  for prefix in $PREFIXES; do
    rm -f "$dir/claude-${prefix}-$sid"* 2>/dev/null
  done
done

# -H: on macOS /tmp is a symlink, and find does not follow its starting point otherwise.
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
