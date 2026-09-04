#!/bin/bash
# PreToolUse hook — route C# symbol discovery towards graphify.
#
# History. Version 1: a counter, denying from the 4th grep of the session on.
# Measured over 135 transcripts — 471 denials, 203 workarounds through `rm` of the
# counter (a command the denial message printed itself), 5 actual switches to
# graphify. A wall you can climb with one command is a toll booth. Removed.
#
# Version 2: the hook checks, then substitutes. It runs `graphify explain` itself
# (~0.5 s, local, no API cost) and only replaces the command when the answer exists
# and answers the question asked. Otherwise it stays silent and the grep goes out.
#
# Three guardrails, computed over the 62 symbol-discovery commands found in the
# history:
#   - no node in the graph (16 cases / 26%): `SCREAMING_SNAKE` constants, NuGet
#     codes, unindexed members. The shape is right, the target does not exist.
#   - search scoped to a subpath: I want the occurrences inside a folder, not the
#     global neighbours of the node. Different question, different answer.
#   - symbol already substituted in this session: re-running the same search says
#     "I really did want the grep". That is the escape hatch, and it does not have
#     to be announced — so there is nothing to game.
# 27 substitutions out of 62 remain, correct by construction.
#
# Still blocking: spawning an Explore subagent without graphify in the prompt.
# Different saving — an action costing ~55k startup tokens, not a 300-token grep.
set -u
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // ""')

# --- Explore: require that graphify was considered ---
if [[ "$tool_name" == "Agent" ]]; then
  subagent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // ""')
  [[ "$subagent_type" != "Explore" ]] && exit 0

  prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""' | tr '[:upper:]' '[:lower:]')
  if ! echo "$prompt" | grep -q 'graphify'; then
    jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Explore blocked: use graphify query/explain/path before spawning Explore. Mention graphify in the prompt if you already did."}}'
  fi
  exit 0
fi

[[ "$tool_name" != "Bash" ]] && exit 0

cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Only target source-code DISCOVERY, not filtering.
#
# Filtering = grep downstream of a pipe (`dotnet build | grep error`), on a
# here-string (`grep -q X <<<"$OUT"`), or on a path outside the sources (logs,
# /tmp, .claude/, graphify-out/). None of those can be replaced by graphify.
#
# Only the first stage of the pipeline can be discovery.
first_stage="${cmd%%|*}"

if ! echo "$first_stage" | grep -qE '(^|[[:space:]|;&])(rtk[[:space:]]+|command[[:space:]]+|/(usr/(local/)?bin|bin)/)?(grep|rg|find|egrep|fgrep)([[:space:]]|$)'; then
  exit 0
fi

# Non-code target: graphify only indexes the AST. Searching a .md, a .json or a
# project file has no graphify equivalent.
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

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
[ -f "$repo_root/graphify-out/graph.json" ] || exit 0
command -v graphify >/dev/null 2>&1 || exit 0

session_id=$(echo "$input" | jq -r '.session_id // "unknown"')

FIRST_STAGE="$first_stage" SEEN_FILE="/tmp/claude-graphify-seen-${session_id}" python3 <<'PYEOF'
import json
import os
import re
import shlex
import subprocess
import sys

stage = os.environ["FIRST_STAGE"]
seen_file = os.environ["SEEN_FILE"]

try:
    tokens = shlex.split(stage)
except ValueError:
    sys.exit(0)

SKIP_FLAG = {"--include", "--exclude", "--glob", "-e", "--file-type", "-t", "--max", "-m"}
SKIP_WORD = {"grep", "rg", "find", "egrep", "fgrep", "command", "rtk"}

pattern, skip_next = None, False
for token in tokens[1:]:
    if skip_next:
        skip_next = False
        continue
    if token in SKIP_FLAG:
        skip_next = True
        continue
    if token.startswith("-") or token in SKIP_WORD:
        continue
    pattern = token
    break

if not pattern:
    sys.exit(0)

# A C# symbol: an identifier, no metacharacter, no space, carrying an uppercase
# letter. A literal, an error message, a regex fragment are not AST nodes: grep is
# the right tool and the hook stays quiet.
if not re.match(r"^[A-Za-z_][A-Za-z0-9_]{2,}$", pattern):
    sys.exit(0)
if not pattern[0].isupper() and not re.search(r"[A-Z]", pattern[1:]):
    sys.exit(0)

# Guardrail 1 — search scoped to a subpath. `grep X src/.../Infrastructure` asks for
# the occurrences inside a folder; `explain` returns the global neighbours of the node.
if re.search(r"(^|\s)(\./)?(src|tests|dsl|externals)/\S", stage):
    sys.exit(0)

# Guardrail 2 — already substituted in this session. Re-running the same search is
# the natural way of saying "I wanted the grep".
try:
    already = set(open(seen_file, encoding="utf-8").read().split())
except OSError:
    already = set()
if pattern in already:
    sys.exit(0)

# Guardrail 3 — does the node exist? Never substitute a grep with an empty answer.
try:
    explained = subprocess.run(
        ["graphify", "explain", pattern],
        capture_output=True, text=True, timeout=10,
    ).stdout
except (OSError, subprocess.SubprocessError):
    sys.exit(0)
if not explained or explained.startswith("No node matching"):
    sys.exit(0)

try:
    with open(seen_file, "a", encoding="utf-8") as handle:
        handle.write(pattern + "\n")
except OSError:
    pass

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecisionReason": (
            f"C# symbol search routed to the graph. "
            f"Re-running the same grep on '{pattern}' will let it through. "
            f"Occurrences inside a specific folder: scope the grep on a subpath. "
            f"Impact of a change: graphify affected \"{pattern}\"."
        ),
        "updatedInput": {"command": f'graphify explain "{pattern}"'},
    }
}))
PYEOF

exit 0
