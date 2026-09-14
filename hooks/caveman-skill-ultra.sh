#!/usr/bin/env bash
# PreToolUse Skill hook — force caveman=ultra when entering the code and test skills.
#
# The flag is global: the caveman plugin reads ~/.claude/.caveman-active whatever
# the repo. Until 2026-09-12 this hook wrote `ultra` there and nothing ever wrote
# it back, so one /implement-tdd here put every other repo in ultra until someone
# typed /caveman full by hand. The mode in force before the skill is now saved
# beside the flag, once, and session-cleanup.sh restores it at the next session
# start — /clear included, which is where a batch ends — as long as the flag still
# reads `ultra`. A mode the user switched by hand in between is left alone.

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
    cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
    flag="$cfg/.caveman-active"
    saved="$cfg/.caveman-active.before-skill"
    if [ ! -f "$saved" ]; then
      # Empty when no flag existed: the plugin's default mode, restored by removal.
      printf '%s' "$(cat "$flag" 2>/dev/null || true)" > "$saved"
      chmod 600 "$saved" 2>/dev/null || true
    fi
    printf 'ultra' > "$flag"
    chmod 600 "$flag" 2>/dev/null || true
    ;;
esac

exit 0
