#!/bin/bash
# bash-dispatch module — the TDD agents write through Edit and Write only.
# Denies a Bash write under a source or test root and logs the test command for the RED
# rerun (lib/tdd_scope.py); adds its agent id to a cycle agent's RED checkpoint.
# Reads $HOOK_INPUT, $HOOK_CMD, $HOOK_AGENT_TYPE.
set -u

case "${HOOK_AGENT_TYPE:-}" in *tdd-implementer|*tdd-test-author|*tdd-cycle) ;; *) exit 0 ;; esac
[ -n "${HOOK_CMD:-}" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0
python3 "$(dirname "${BASH_SOURCE[0]}")/tdd_scope.py" bash 2>/dev/null
