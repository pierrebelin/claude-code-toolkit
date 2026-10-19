#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): the knowledge base may be behind the handler just edited.
#
# A batch keeps the base aligned through its plan's merge; an edit made outside one — a
# hotfix asked in the main session — does not. When the main chain edits a file of a
# use-case folder (`layout.useCase`), this hook names the use case it falls in, or a new
# one; an aggregate (`layout.aggregate`), the use cases whose handlers name it. Then
# the command that realigns them:
#   knowledge base possibly behind: CAT-CU-02 ← GetProductQueryHandler.cs — /cctoolkit:knowledge-sync Catalog
# The line comes from `scripts/knowledge-scan.py --reminder`, the one the optional
# pre-commit hook prints (`cctoolkit install-git-hooks --pre-commit`).
#
# Subagents are skipped: the TDD agents of a batch are the kit's own flow. Once per file
# and session. Silent without a knowledge base, python3, jq or a readable config.
# Warning only, exit 0. Speaks through additionalContext: on PostToolUse plain stdout
# never reaches the model.

case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
input=$(cat)
case "$input" in *'"file_path"'*) ;; *) exit 0 ;; esac
command -v jq >/dev/null 2>&1 || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

IFS=$'\x1f' read -r session_id agent_id file_path <<<"$(printf '%s' "$input" | jq -j '[(.session_id // "unknown"), (.agent_id // ""), (.tool_input.file_path // "")] | join("\u001f")' 2>/dev/null)"
[ -z "$agent_id" ] || exit 0
[ -n "$file_path" ] || exit 0
kit_path file_path

seen_file="/tmp/claude-knowledge-seen-${session_id}"
if [ -f "$seen_file" ] && grep -Fxq "$file_path" "$seen_file" 2>/dev/null; then
  exit 0
fi

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
line=$(python3 "$KIT/scripts/knowledge-scan.py" --reminder "$file_path" 2>/dev/null | head -1)
[ -n "$line" ] || exit 0
echo "$file_path" >> "$seen_file"

jq -n --arg c "$line. Edited outside a batch: say so to the user when the task ends." \
  '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $c}}'
exit 0
