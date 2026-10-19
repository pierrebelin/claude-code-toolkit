#!/bin/bash
# bash-dispatch module — the IntegrationTests suite never runs whole.
# Passes another project, or a run carrying `--filter-class` / `--filter-method`.
# Reads $HOOK_CMD, prints the hook JSON when it decides.
set -u

cmd="${HOOK_CMD:-}"
[ -n "$cmd" ] || exit 0

# Fast bail-out: two substrings, no subprocess.
case "$cmd" in *"dotnet test"*) ;; *) exit 0 ;; esac
case "$cmd" in *IntegrationTests*) ;; *) exit 0 ;; esac

case "$cmd" in
  *--filter-class*|*--filter-method*) exit 0 ;;
esac

# run-plan's final check: the only whole run allowed, carried by its marker.
case "$cmd" in
  *KIT_FINAL_CHECK=1*) exit 0 ;;
esac

jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Whole IntegrationTests suite refused: over 4 minutes where the impacted context fits in one (test-scope.md §2-3, measured 602 s on 2026-09-10). Add at least one --filter-class built on the production folders touched, for example --filter-class \"*.Studio.Templates.Save.*\"; the option is repeatable. A doubt about scope is settled by widening one level, never by running the whole suite."}}'
exit 0
