#!/bin/bash
# bash-dispatch module — the batch auditor spends its turns judging, not waiting.
#
# Measured on a 27-cycle batch on 2026-10-14: the audit took 24 min, 8.4 of them
# in tools of one auditor alone. Two habits made that time, each against an
# instruction the auditor already had:
#   - a recursive grep over the source and test roots without --include read
#     every bin/ and obj/ binary: 121 s, where the same `git grep` answered in 3 s;
#   - suites the global green had just run green were run again, filtered
#     differently, about 6 min, one of them in the background and then polled
#     for 181 s;
# So, for the auditor only (agent_type ending in ddd-tdd-auditor):
#   1. run_in_background is refused: the auditor has nothing else to do meanwhile;
#   2. a recursive grep is refused, `git grep` skips ignored build output;
#   3. a test command on a suite listed in the newest `suites-green` marker is
#      refused while no file of the source or test roots changed after it.
#      `cctoolkit audit-capture --suites-green` writes the marker beside the
#      capture; an audit fix touches code after it, so the resume audit that
#      must rerun suites is let through. No marker (a manual /verify-ddd-tdd)
#      never denies.
#
# Contract: reads $HOOK_CMD, $HOOK_AGENT_TYPE, $HOOK_BACKGROUND, prints the hook
# JSON when it decides, nothing when it passes. A deny is terminal in the chain.
set -u

case "${HOOK_AGENT_TYPE:-}" in *ddd-tdd-auditor) ;; *) exit 0 ;; esac
cmd="${HOOK_CMD:-}"
[ -n "$cmd" ] || exit 0

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

if [ "${HOOK_BACKGROUND:-}" = "true" ]; then
  deny "Background command refused in the audit: run it in the foreground, the audit has nothing else to do while it runs, and polling its output costs turns (181 s measured)."
fi

grep_re='(^|[;&|(]|[[:space:]])(rtk[[:space:]]+(proxy[[:space:]]+)?)?e?grep[[:space:]]+(-[A-Za-z]*[rR][A-Za-z]*|--recursive|--dereference-recursive)([[:space:]]|$)'
if [[ "$cmd" =~ $grep_re ]]; then
  deny "Recursive grep refused in the audit: it reads every bin/ and obj/ file (121 s measured against 3 s). Use \`git grep -n -e <pattern> -- <paths>\`, same patterns, ignored build output skipped."
fi

. "$(dirname "${BASH_SOURCE[0]}")/project-root.sh"
root="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P)" || exit 0
# HOOK_SUITES_MARKER: the evals point at a fixture marker.
marker="${HOOK_SUITES_MARKER:-}"
if [ -z "$marker" ]; then
  tmp="${TMPDIR:-/tmp}"
  tmp="${tmp%/}"
  base="$tmp/cctoolkit-run/$(basename "$root")-$(printf '%s' "$root" | { shasum 2>/dev/null || sha1sum; } | cut -c1-8)"
  marker="$(ls -t "$base"/*/suites-green 2>/dev/null | head -1)"
fi
[ -n "$marker" ] && [ -f "$marker" ] || exit 0

verb="$(sed -n 's/^verb: //p' "$marker" | head -1)"
[ -n "$verb" ] || exit 0
case "$cmd" in *"$verb"*) ;; *) exit 0 ;; esac

suite=""
while IFS= read -r s; do
  [ -n "$s" ] || continue
  if [[ "$cmd" =~ (^|[^A-Za-z0-9])"$s"([^A-Za-z0-9]|$) ]]; then suite="$s"; break; fi
done < <(sed -n 's/^suite: //p' "$marker")
[ -n "$suite" ] || exit 0

roots="$(sed -n 's/^roots: //p' "$marker" | head -1)"
cd "$root" || exit 0
while IFS= read -r line; do
  path="${line:3}"
  path="${path#\"}"; path="${path%\"}"
  for r in $roots; do
    case "$path" in "$r"/*|"$r")
      [ -e "$path" ] && [ "$path" -nt "$marker" ] && exit 0 ;;
    esac
  done
done < <(git status --porcelain --untracked-files=all 2>/dev/null)

deny "$suite already ran green in the global green, and no source or test file changed since: read its exit code in the prompt, never rerun it. A scope you judge too narrow is a Test gap carrying the filtered command to run, the fix round runs it."
