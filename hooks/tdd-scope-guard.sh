#!/bin/bash
# SubagentStart, PreToolUse Edit|Write and PreToolUse StructuredOutput hook — what the three TDD
# agents may write, checked on the tree (lib/tdd_scope.py holds the why and the checks).
# Every other agent leaves at the string match below, before lib/platform.sh, jq or python.
set -u
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
INPUT=$(cat)
case "$INPUT" in *tdd-implementer*|*tdd-test-author*|*tdd-cycle*) ;; *) exit 0 ;; esac
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
command -v python3 >/dev/null 2>&1 || exit 0

case "$INPUT" in
  *'"SubagentStart"'*) event=start ;;
  *'"StructuredOutput"'*) event=final ;;
  *'"Edit"'*|*'"Write"'*|*'"NotebookEdit"'*) event=edit ;;
  *) exit 0 ;;
esac

HOOK_INPUT="$INPUT" python3 "$(dirname "${BASH_SOURCE[0]}")/../lib/tdd_scope.py" "$event" 2>/dev/null
exit 0
