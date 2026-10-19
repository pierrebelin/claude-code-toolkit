#!/bin/bash
# bash-dispatch module — require a bounded diff.
# Denies `git diff`, `git show`, `git log -p` with no summary flag, pipe or redirect
# when the patch passes CLAUDE_DIFF_BOUNDS_LINES (size measured by re-running with
# `--numstat`). Re-issuing the identical command forces it (per agent and command).
set -u

cmd="$HOOK_CMD"

case "$cmd" in *git*) ;; *) exit 0 ;; esac
# A pipe or a redirect bounds what reaches the context, whatever the patch size.
case "$cmd" in *"|"*|*">"*) exit 0 ;; esac

THRESHOLD=${CLAUDE_DIFF_BOUNDS_LINES:-400}

hit=""
# Split on `;` and `&` so `cd x && git diff` is seen as a git command.
while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}"
  case "$seg" in
    git\ *) ;;
    *) continue ;;
  esac

  sub=$(printf '%s' "$seg" | awk '{for (i=2; i<=NF; i++) if ($i !~ /^-/) {print $i; exit}}')
  case "$sub" in
    diff|show|log) ;;
    *) continue ;;
  esac
  # `git log` only dumps a patch when asked for one.
  if [ "$sub" = "log" ]; then
    case " $seg " in *" -p "*|*" --patch "*|*" -u "*) ;; *) continue ;; esac
  fi

  case " $seg " in
    *" --stat"*|*" --numstat"*|*" --shortstat"*|*" --name-only"*|*" --name-status"*|*" --quiet"*) continue ;;
  esac

  # LC_ALL=C: BSD awk aborts on an invalid byte sequence, and an empty sum reads as small.
  changed=$(bash -c "$seg --numstat --no-color" 2>/dev/null \
    | LC_ALL=C awk -F'\t' '$1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {n += $1 + $2} END {print n + 0}')
  [ "${changed:-0}" -gt "$THRESHOLD" ] || continue

  hit="$seg"
  hit_lines="$changed"
  break
done <<< "$(printf '%s' "$cmd" | tr ';&' '\n\n')"

[ -n "$hit" ] || exit 0

seen_file="/tmp/claude-diffbounds-seen-${HOOK_SESSION_ID:-unknown}${HOOK_AGENT_ID:+-$HOOK_AGENT_ID}"
if [ -f "$seen_file" ] && grep -Fxq "$hit" "$seen_file" 2>/dev/null; then
  echo "$hit" >> "${seen_file}.forced"
  exit 0
fi
echo "$hit" >> "$seen_file"

reason="Unbounded patch: \`$hit\` prints ${hit_lines} changed lines (> $THRESHOLD). The whole patch stays in context until the session ends, and rtk does not compress it. Start with \`--stat\` or \`--name-only\`, then read the patch of the files that matter — \`$hit -- <path>\` — or pipe it. Re-issue this exact command to force the full patch."

jq -n --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
