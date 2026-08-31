#!/usr/bin/env bash
# Force caveman=ultra when entering specific skills.
# Revert manually with `/caveman full` once task is done.

set -e

input="$(cat)"
skill="$(printf '%s' "$input" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get("tool_input",{}).get("skill",""))
except Exception:
    pass' 2>/dev/null)"

case "$skill" in
  plan-implementation|implement-tdd|implement-js|tests-unit-tests|tests-integration-tests|tests-contract-tests)
    flag="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.caveman-active"
    printf 'ultra' > "$flag"
    chmod 600 "$flag" 2>/dev/null || true
    ;;
esac

exit 0
