#!/bin/bash
# PreToolUse Edit|Write hook — attach the measured blast radius of a domain type.
#
# graphify affected is the one subcommand the graph exists for and the one nobody
# calls: 4 invocations against 56 explain and 54 query over 180 sessions of
# transcripts. Nothing ever triggered it, so nothing ever used it. This hook
# triggers it, on the only edits where the answer is not guessable — an aggregate
# or a value object in the Domain, where the reference count runs into the
# hundreds (ProductId 142 edges, DiagramNodeId 229) and the fan-out crosses
# every layer plus four test projects.
#
# It does not deny. The edit is legitimate; only the map is missing. The rollup
# rides along as additionalContext, same channel bash-dispatch.sh uses, so it
# costs no turn — unlike read-bounds.sh, where the read itself is the cost and a
# denial is the only lever.
#
# The raw output is never injected. `graphify affected ProductId` prints 421
# lines / 65 kB — roughly 16k tokens, more than the aggregate being edited and far
# more than the decision needs. Rolled up per project it is 8 lines: which
# assemblies move, and how hard. That is the whole signal; the file:line list is a
# follow-up the model can ask for by hand.
#
# Symbols the graph cannot disambiguate are dropped in silence. `Product`
# answers "No unique node match" (aggregate, entity, DTO and table all carry the
# name) while `ProductId` resolves clean. A hook that narrates its own
# misses trains the reader to skip it.
set -u

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
case "$tool_name" in Edit|Write) ;; *) exit 0 ;; esac

file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')
[ -n "$file_path" ] || exit 0

# Domain aggregates and value objects only. An Application handler or an EF
# mapper has a fan-out of one or two callers — the model already holds it.
#
# Matched on `*.Domain/` rather than a hardcoded assembly so the file is byte
# identical across repositories: {{PRODUCT}}.Catalog.Domain and {{PRODUCT}}.Studio.Domain
# both hit it, and the same copy ships from claude-code-toolkit/hooks/ to either.
case "$file_path" in
  */*.Domain/*/Aggregates/*.cs|*/*.Domain/*/ValueObjects/*.cs) ;;
  *) exit 0 ;;
esac

command -v graphify >/dev/null 2>&1 || exit 0

symbol=$(basename "$file_path" .cs)
[ -n "$symbol" ] || exit 0

# Once per (agent, symbol). A refactor touches the same value object across a
# dozen edits and the radius does not move between them; repeating it would cost
# more context than the first copy saved. Scoped to the agent, not the session,
# for the reason read-bounds.sh documents: subagents share the parent session_id,
# so a session key would let one agent's copy silence every other agent.
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
agent_id=$(echo "$input" | jq -r '.agent_id // ""')
seen_file="/tmp/claude-affected-seen-${session_id}${agent_id:+-$agent_id}"
if [ -f "$seen_file" ] && grep -Fxq "$symbol" "$seen_file" 2>/dev/null; then
  exit 0
fi
echo "$symbol" >> "$seen_file"

# graphify resolves its graph from the working directory, so the query must run
# from the repository that owns the edited file — not from wherever the session
# happens to sit. Without this the hook answers from the wrong graph in a
# worktree, and answers nothing at all when the file belongs to another
# repository than the current one.
repo_root=$(cd "$(dirname "$file_path")" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)
[ -n "$repo_root" ] || repo_root=$(dirname "$file_path")
[ -d "$repo_root/graphify-out" ] || exit 0

# graphify 0.9.58 path-qualifies node IDs (#1504), which fixes same-name-file
# collisions and breaks label lookup at the same time: `ProductId` now
# matches 7 nodes, so `affected ProductId` answers "No unique node match"
# and this hook went silent on every value object it exists for. `explain` prints
# the ambiguity as `<source file>` / `id: <node id>` pairs, and the edited file is
# its own disambiguator — its path picks the definition node out of that list.
# Falls back to the bare label, which still works on a symbol that is unique.
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
# Only claim the test projects break when the rollup actually names one. A radius
# confined to the Domain is the common case on a young value object, and a line
# about tests that are not there reads as boilerplate — which is how injected
# context stops being read at all.
case "$rollup" in
  *tests/*) ctx="$ctx
The test projects listed break just as the src ones do." ;;
esac
ctx="$ctx
File:line detail: \`graphify affected \"$target\"\`."

jq -cn --arg c "$ctx" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $c}}'
exit 0
