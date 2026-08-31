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
    jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Explore bloqué: utilise graphify query/explain/path avant de spawn Explore. Mentionne graphify dans le prompt si déjà fait."}}'
  fi
  exit 0
fi

# --- Bash: count grep/find usage, block after limit ---
[[ "$tool_name" != "Bash" ]] && exit 0

cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Ne compter que la DECOUVERTE de code source, pas le filtrage.
#
# Filtrage = grep en aval d'un pipe (`dotnet build | grep error`), sur un
# here-string (`grep -q X <<<"$OUT"`), ou sur un chemin hors sources (logs,
# /tmp, .claude/, graphify-out/). Aucun de ces usages ne se remplace par
# graphify : le compter epuisait le quota pendant du travail d'outillage.
#
# Seul le premier etage du pipeline peut etre de la decouverte.
first_stage="${cmd%%|*}"

if ! echo "$first_stage" | grep -qE '(^|[[:space:]|;&])(rtk[[:space:]]+|command[[:space:]]+|/(usr/(local/)?bin|bin)/)?(grep|rg|find|egrep|fgrep)([[:space:]]|$)'; then
  exit 0
fi

# Cible non-code : graphify n'indexe que l'AST des sources C#. Chercher un
# CLAUDE.md, un .md, un .json ou un fichier projet ne se remplace par aucune
# commande graphify — le compter epuisait le quota pendant de la metrologie
# de configuration.
non_code_ext='md|markdown|json|props|targets|csproj|sln|ya?ml|sh|ps1|editorconfig|txt'
if echo "$first_stage" | grep -qE "[-]{1,2}(name|iname|path|ipath|include|glob)[[:space:]]*=?[[:space:]]*[\"']?[^[:space:]]*\.($non_code_ext)[\"']?"; then
  exit 0
fi

# Here-string / heredoc : lecture d'une variable, jamais de l'arborescence.
if echo "$first_stage" | grep -qE '<<'; then
  exit 0
fi

# Cible hors sources, sauf si src/ ou tests/ apparait aussi.
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
  jq -n --arg c "$count" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ("Limite 3 grep/find dépassée (count=" + $c + "). Utilise: graphify query \"<question>\", graphify explain \"<symbol>\", graphify path \"<A>\" \"<B>\". Reset: rm " + "/tmp/claude-grep-count-'$session_id'")}}'
  exit 0
fi

# Soft reminder on first grep uses
# Repo root derivé du script (cwd du hook non garanti = racine repo)
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [ -f "$repo_root/graphify-out/graph.json" ]; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: "Rappel: graphify-out/ disponible. Préfère graphify query/explain/path avant grep."}}'
fi
