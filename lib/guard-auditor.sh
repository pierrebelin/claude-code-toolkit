#!/bin/bash
# bash-dispatch module — the batch auditor (agent_type *ddd-tdd-auditor) spends its
# turns judging, not waiting. Denies run_in_background, a recursive grep, and a test
# command on a suite of the newest `suites-green` marker (audit-capture --suites-green)
# while no file of the roots changed after it. No marker never denies.
# Reads $HOOK_CMD, $HOOK_AGENT_TYPE, $HOOK_BACKGROUND.
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
