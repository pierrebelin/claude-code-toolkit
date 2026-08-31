#!/bin/bash
# Fraicheur du graphe graphify, mesuree par empreinte du working tree.
#
# Compare les mtime des sources au mtime de graph.json. Contrairement a un flag
# pose par les hooks Edit/Write, cette mesure capte aussi les editions IDE, les
# merges, pulls et changements de branche.
#
# Usage:
#   graphify-freshness.sh --count     nombre de sources plus recentes que le graphe
#   graphify-freshness.sh --check     exit 0 si a jour, 1 si perime
#   graphify-freshness.sh --refresh   force le recalcul (ignore le cache)

# Repo derive de l'emplacement du script (.claude/hooks/ -> racine). Sans cela, un
# defaut en dur ferait mettre a jour le graphe d'un AUTRE repo depuis ce hook.
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
