#!/bin/bash
# PreToolUse hook — enforce graphify-first for file discovery.
# Covers: Bash grep/find commands AND Explore subagents.
set -u
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // ""')

# --- Explore subagent: block if graphify not mentioned in prompt ---
if [[ "$tool_name" == "Agent" ]]; then
  subagent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // ""')
  [[ "$subagent_type" != "Explore" ]] && exit 0

  prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""' | tr '[:upper:]' '[:lower:]')
  if ! echo "$prompt" | grep -q 'graphify'; then
    jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Explore blocked: use graphify query/explain/path before spawning Explore. Mention graphify in the prompt if you already did."}}'
  fi
  exit 0
fi

# --- Bash: count grep/find usage, block after limit ---
[[ "$tool_name" != "Bash" ]] && exit 0

cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Only count source-code DISCOVERY, not filtering.
#
# Filtering = grep downstream of a pipe (`dotnet build | grep error`), on a
# here-string (`grep -q X <<<"$OUT"`), or on a path outside the sources (logs,
# /tmp, .claude/, graphify-out/). None of those can be replaced by graphify:
# counting them drained the quota during tooling work.
#
# Only the first stage of the pipeline can be discovery.
first_stage="${cmd%%|*}"

if ! echo "$first_stage" | grep -qE '(^|[[:space:]|;&])(rtk[[:space:]]+|command[[:space:]]+|/(usr/(local/)?bin|bin)/)?(grep|rg|find|egrep|fgrep)([[:space:]]|$)'; then
  exit 0
fi

# Non-code target: graphify only indexes the AST of the C# sources. Searching a
# CLAUDE.md, a .md, a .json or a project file has no graphify equivalent —
# counting it drained the quota during configuration measurement work.
non_code_ext='md|markdown|json|props|targets|csproj|sln|ya?ml|sh|ps1|editorconfig|txt'
if echo "$first_stage" | grep -qE "[-]{1,2}(name|iname|path|ipath|include|glob)[[:space:]]*=?[[:space:]]*[\"']?[^[:space:]]*\.($non_code_ext)[\"']?"; then
  exit 0
fi

# Here-string / heredoc: reads a variable, never the file tree.
if echo "$first_stage" | grep -qE '<<'; then
  exit 0
fi

# Target outside the sources, unless src/ or tests/ shows up too.
non_source='(/private)?/tmp|\.claude|graphify-out|node_modules|/\.git|[^[:space:]]*\.log'
if echo "$first_stage" | grep -qE "(^|[[:space:]])[^[:space:]]*($non_source)(/[^[:space:]]*)?([[:space:]]|$)" \
   && ! echo "$first_stage" | grep -qE '(^|[[:space:]])(\./)?(src|tests|externals|dsl)(/|[[:space:]]|$)'; then
  exit 0
fi

session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
counter_file="/tmp/claude-grep-count-${session_id}"
count=$(cat "$counter_file" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$counter_file"

if [ "$count" -gt 3 ]; then
  jq -n --arg c "$count" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ("3 grep/find limit exceeded (count=" + $c + "). Use: graphify query \"<question>\", graphify explain \"<symbol>\", graphify path \"<A>\" \"<B>\". Reset: rm " + "/tmp/claude-grep-count-'$session_id'")}}'
  exit 0
fi

# Soft reminder on first grep uses
# Repo root derived from the script (the hook cwd is not guaranteed to be the repo root)
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [ -f "$repo_root/graphify-out/graph.json" ]; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: "Reminder: graphify-out/ available. Prefer graphify query/explain/path over grep."}}'
fi
