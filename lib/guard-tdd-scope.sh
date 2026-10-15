#!/bin/bash
# bash-dispatch module — the TDD agents write through Edit and Write only.
#
# For `tdd-implementer` and `tdd-test-author` (agent_type), a command writing under a source
# or test root (redirection, tee, sed -i, rm, mv, cp, git checkout/restore/stash, a formatter,
# inline interpreter code) is denied: the Edit/Write log of hooks/tdd-scope-guard.sh is then
# the whole story of what the agent wrote. The test command it runs is logged for the rerun
# of the RED check. Why and checks: lib/tdd_scope.py.
#
# Contract: reads $HOOK_INPUT, $HOOK_CMD, $HOOK_AGENT_TYPE, prints the hook JSON when it
# denies, nothing when it passes. A deny is terminal in the chain.
set -u

case "${HOOK_AGENT_TYPE:-}" in *tdd-implementer|*tdd-test-author) ;; *) exit 0 ;; esac
[ -n "${HOOK_CMD:-}" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0
python3 "$(dirname "${BASH_SOURCE[0]}")/tdd_scope.py" bash 2>/dev/null
