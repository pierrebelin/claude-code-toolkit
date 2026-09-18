#!/bin/bash
# bash-dispatch module — require a bounded diff.
#
# Why. Measured 2026-09-17 over 14 days: Bash is 14 % of the bill, 1 691 calls
# for 1.5 M tokens added. `rtk gain` shows the dotnet side is already handled —
# `dotnet build` -59.5 %, `dotnet test` -95 to -100 % — but git patch output goes
# through rtk almost untouched (`rtk read` -4.6 %). A bare `git diff` on this
# repo's working tree was 109 kB, ~27k tokens, carried by every later turn of the
# session.
#
# What it denies: `git diff`, `git show`, `git log -p` when nothing bounds the
# output — no summary flag, no pipe, no redirect — AND the patch is actually
# large. The size is measured, not guessed: the same command is re-run with
# `--numstat`, which prints one `added<TAB>removed<TAB>path` line per file and no
# patch body. Two git calls instead of one (~50 ms); a threshold that fires on a
# three-line diff would cost more in denied round trips than it saves.
#
# What passes: `--stat`, `--numstat`, `--shortstat`, `--name-only`,
# `--name-status`, `--quiet` (the summary forms — that is the advice, so never
# block it), anything piped or redirected (already bounded downstream, the same
# rule guard-cat-bounds.sh applies to `cat f | grep x`), and a patch under the
# threshold.
#
# Escape hatch, same shape as guard-cat-bounds.sh and read-bounds.sh: the denial
# is recorded per (agent, command), so re-issuing the identical command passes.
# The model that genuinely needs the whole patch pays one round trip for it, and
# the file records that it was forced.
set -u

cmd="$HOOK_CMD"

case "$cmd" in *git*) ;; *) exit 0 ;; esac
# A pipe or a redirect bounds what reaches the context, whatever the patch size.
case "$cmd" in *"|"*|*">"*) exit 0 ;; esac

THRESHOLD=${CLAUDE_DIFF_BOUNDS_LINES:-400}

hit=""
# Same split as guard-cat-bounds.sh: `cd x && git diff` must be seen as a git
# command, not as a `cd`.
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

  # LC_ALL=C, because a patch is bytes, not text: BSD awk aborts with
  # "towc: multibyte conversion failure" on the first invalid sequence — a binary
  # file, a latin-1 asset — and the guard then read an empty sum as "small patch"
  # and let the dump through. Found on the SES repo, 2026-09-17.
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
