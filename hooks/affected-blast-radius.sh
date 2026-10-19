#!/bin/bash
# PreToolUse Edit|Write hook — attach the measured blast radius of a domain type.
#
# Never denies: injects the per-project rollup (never the raw output) as
# additionalContext. Symbols the graph cannot disambiguate are dropped in silence.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

# Paused: CCTOOLKIT_BLAST_RADIUS=1 turns it back on.
[ "${CCTOOLKIT_BLAST_RADIUS:-0}" = "1" ] || exit 0

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
case "$tool_name" in Edit|Write) ;; *) exit 0 ;; esac

file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')
[ -n "$file_path" ] || exit 0
kit_path file_path

# Domain aggregates and value objects only (`layout.aggregate`). Missing python3, lib or config: exit 0.
kit_lib="$(dirname "${BASH_SOURCE[0]}")/../lib"
python3 "$kit_lib/kit_config.py" match aggregate "$file_path" 2>/dev/null || exit 0

command -v graphify >/dev/null 2>&1 || exit 0

symbol=$(basename "$file_path"); symbol=${symbol%.*}
[ -n "$symbol" ] || exit 0

# Once per (agent, symbol): subagents share the parent session_id.
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
agent_id=$(echo "$input" | jq -r '.agent_id // ""')
seen_file="/tmp/claude-affected-seen-${session_id}${agent_id:+-$agent_id}"
if [ -f "$seen_file" ] && grep -Fxq "$symbol" "$seen_file" 2>/dev/null; then
  exit 0
fi
echo "$symbol" >> "$seen_file"

# graphify resolves its graph from the cwd: run from the repo that owns the file.
repo_root=$(cd "$(dirname "$file_path")" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)
[ -n "$repo_root" ] || repo_root=$(dirname "$file_path")
[ -d "$repo_root/graphify-out" ] || exit 0

# Path-qualified node ids make a label ambiguous: `explain` lists `<source file>` /
# `id: <node id>` pairs and the edited file's path picks one. Falls back to the label.
rel=${file_path#"$repo_root"/}
target=$symbol
explained=$(cd "$repo_root" && graphify explain "$symbol" 2>/dev/null)
case "$explained" in
  *Ambiguous:*)
    resolved=$(printf '%s\n' "$explained" \
      | awk -v f="  $rel" '$0 == f { getline; sub(/^[[:space:]]*id:[[:space:]]*/, ""); print; exit }')
    [ -n "$resolved" ] && target=$resolved
    ;;
esac

raw=$(cd "$repo_root" && graphify affected "$target" 2>/dev/null)
[ -n "$raw" ] || exit 0
case "$raw" in *"No unique node match"*) exit 0 ;; esac

rollup=$(printf '%s' "$raw" \
  | grep -oE '(src|tests|externals)/[^/]+' \
  | sort | uniq -c | sort -rn \
  | awk '{printf "  %-42s %s\n", $2, $1}')
[ -n "$rollup" ] || exit 0

total=$(printf '%s' "$raw" | grep -c '^- ' 2>/dev/null || echo 0)

ctx="graphify affected \"$symbol\" — measured blast radius, $total references (depth 2), grouped by project:

$rollup
"
# Only claim the test projects break when the rollup names one.
case "$rollup" in
  *tests/*) ctx="$ctx
The test projects listed break just as the src ones do." ;;
esac
ctx="$ctx
File:line detail: \`graphify affected \"$target\"\`."

jq -cn --arg c "$ctx" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $c}}'
exit 0
