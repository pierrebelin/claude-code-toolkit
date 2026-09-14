#!/bin/bash
# bash-dispatch module — the IntegrationTests suite never runs whole.
#
# `implement-tdd/references/test-scope.md` §2 says it since 2026-09-08: the
# whole suite rebuilds every fixture and re-seeds the database, more than four
# minutes where the impacted context fits in one. Advisory only, it was
# ignored twice on 2026-09-10 (sessions f3d96035 and 24978db7): 602 s each,
# the single longest tool call of both sessions. This module makes it a deny.
#
# Passes: any `dotnet test` on another project, and an IntegrationTests run
# carrying at least one `--filter-class` or `--filter-method`. `rtk` prefix,
# `cd … &&`, env assignments and `STID_TEST_MODE=true` in front are all fine —
# only the project and the presence of a filter are inspected.
#
# Contract: reads $HOOK_CMD, prints the hook JSON when it decides, nothing when
# it passes. A deny is terminal in the chain.
set -u

cmd="${HOOK_CMD:-}"
[ -n "$cmd" ] || exit 0

# Fast bail-out: two substrings, no subprocess.
case "$cmd" in *"dotnet test"*) ;; *) exit 0 ;; esac
case "$cmd" in *IntegrationTests*) ;; *) exit 0 ;; esac

case "$cmd" in
  *--filter-class*|*--filter-method*) exit 0 ;;
esac

jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "IntegrationTests suite entière refusée : plus de 4 minutes là où le contexte impacté tient en une (test-scope.md §2-3, mesuré 602 s le 2026-09-10). Ajouter au moins un --filter-class construit sur les dossiers de production touchés, par exemple --filter-class \"*.Editor.Templates.Save.*\" ; les options sont répétables. Un doute de portée se règle en élargissant d un niveau, jamais en lançant toute la suite."}}'
exit 0
