#!/bin/bash
# Freshness of the graphify graph, measured from the working tree fingerprint.
#
# Not a hook: a helper called by .claude/hooks/graphify-autosync.sh and by
# .claude/statusline-command.sh. Lived in hooks/ until 2026-09-09, where it read
# like a dead hook.
#
# Compares source mtimes against the mtime of graph.json. Unlike a flag dropped
# by the Edit/Write hooks, this measure also catches IDE edits, merges, pulls
# and branch switches.
#
# Usage:
#   graphify-freshness.sh --count     number of sources newer than the graph
#   graphify-freshness.sh --check     exit 0 if up to date, 1 if stale
#   graphify-freshness.sh --refresh   force recomputation (bypass the cache)

# Repo derived from the script location (.claude/lib/ -> root). Without that, a
# hardcoded default would update the graph of ANOTHER repo from this hook.
REPO="${GRAPHIFY_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GRAPH="$REPO/graphify-out/graph.json"
CACHE="/tmp/graphify-fresh-$(echo "$REPO" | md5 -q 2>/dev/null || echo default)"
TTL=20

compute() {
  [ -f "$GRAPH" ] || { echo "-1"; return; }
  local dirs=()
  for d in src tests externals; do [ -d "$REPO/$d" ] && dirs+=("$REPO/$d"); done
  [ ${#dirs[@]} -eq 0 ] && { echo "0"; return; }
  find "${dirs[@]}" \
       \( -name bin -o -name obj -o -name node_modules -o -name dist \) -prune -o \
       \( -name '*.cs' -o -name '*.ts' \) -newer "$GRAPH" -print 2>/dev/null | wc -l | tr -d ' '
}

cached_count() {
  if [ "$1" != "--refresh" ] && [ -f "$CACHE" ]; then
    local age
    age=$(( $(date +%s) - $(stat -f %m "$CACHE" 2>/dev/null || echo 0) ))
    if [ "$age" -lt "$TTL" ]; then
      cat "$CACHE"
      return
    fi
  fi
  local n
  n=$(compute)
  printf '%s' "$n" > "$CACHE"
  printf '%s' "$n"
}

case "${1:---count}" in
  --count|--refresh)
    cached_count "$1"
    ;;
  --check)
    n=$(cached_count "$2")
    [ "$n" = "0" ] && exit 0 || exit 1
    ;;
  *)
    echo "usage: $0 [--count|--check|--refresh]" >&2
    exit 2
    ;;
esac
