#!/bin/bash
# bash-dispatch module — require a bounded read when `cat` dumps a large file.
#
# read-bounds.sh guards the Read tool. It has no reach over Bash, and the volume
# simply moved: measured on session 4d3ad4e4 (2026-09-09), Read fell to 1% of the
# context fill while Bash rose to 85% — 221 kB over 124 calls, with 21 bare `cat`
# on top. The single largest addition of the whole session was one `cat` of a
# 18.3 kB plan. A file dumped this way is carried to the end of the session
# exactly like an unbounded Read, and pays no hook.
#
# Scope is deliberately narrow, to keep false positives at zero:
#   - only a simple `cat` command, no pipe (`cat f | grep x` is already bounded
#     by grep) and no redirect (`cat f > out` never enters the context),
#   - only files past THRESHOLD lines, the same 120 as read-bounds.sh, or past
#     BYTES_THRESHOLD bytes. The second trigger exists because Markdown wraps at
#     the paragraph, not at 80 columns: a report of 18.3 kB in 119 lines is
#     waved through by a line count alone. 8 kB is roughly 2.5k tokens, the
#     point where one dump is worth locating first.
#   - binary/rendered formats are left alone.
#
# Escape hatch, same shape as read-bounds.sh and lib/guard-graphify-grep.sh: the
# denial is recorded per (agent, file), so re-issuing the identical `cat` passes
# through. That is how you force a full dump when you genuinely want one, and it
# is scoped to the agent that asked — never handed to its siblings.
set -u

THRESHOLD=${CLAUDE_READ_BOUNDS_THRESHOLD:-120}
BYTES_THRESHOLD=${CLAUDE_CAT_BOUNDS_BYTES:-8000}

cmd="${HOOK_CMD:-}"
[ -n "$cmd" ] || exit 0

# Split on the separators that start a new simple command. A `cd x; cat big.md`
# must be seen as a bare `cat`, not as a `cd`.
oversized=""
lines_of_hit=""
bytes_of_hit=""
while IFS= read -r segment; do
  segment="${segment#"${segment%%[![:space:]]*}"}"
  case "$segment" in
    cat\ *) ;;
    *) continue ;;
  esac
  # A pipe or a redirect means the output is filtered or never reaches context.
  case "$segment" in
    *\|*|*\>*) continue ;;
  esac

  set -- $segment
  shift
  for arg in "$@"; do
    case "$arg" in
      -*) continue ;;
    esac
    [ -f "$arg" ] || continue
    lower=$(printf '%s' "$arg" | tr '[:upper:]' '[:lower:]')
    case "$lower" in
      *.png|*.jpg|*.jpeg|*.gif|*.webp|*.bmp|*.svg|*.pdf|*.ipynb|*.zip|*.nupkg) continue ;;
    esac
    n=$(wc -l < "$arg" 2>/dev/null | tr -d ' ')
    bytes=$(wc -c < "$arg" 2>/dev/null | tr -d ' ')
    [ -n "$n" ] || continue
    if [ "$n" -le "$THRESHOLD" ] 2>/dev/null && [ "${bytes:-0}" -le "$BYTES_THRESHOLD" ] 2>/dev/null; then
      continue
    fi
    oversized="$arg"
    lines_of_hit="$n"
    bytes_of_hit="$bytes"
    break
  done
  [ -n "$oversized" ] && break
done <<< "$(printf '%s' "$cmd" | tr ';&' '\n\n')"

[ -n "$oversized" ] || exit 0

# Same per-agent scoping as read-bounds.sh: agent_id is the only per-agent field,
# the main chain has none and falls back to the session.
seen_file="/tmp/claude-catbounds-seen-${HOOK_SESSION_ID:-unknown}${HOOK_AGENT_ID:+-$HOOK_AGENT_ID}"
if [ -f "$seen_file" ] && grep -Fxq "$oversized" "$seen_file" 2>/dev/null; then
  exit 0
fi
echo "$oversized" >> "$seen_file"

jq -n --arg f "$oversized" --arg l "$lines_of_hit" --arg b "$bytes_of_hit" --arg t "$THRESHOLD" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: ("Unbounded cat on \($f) (\($l) lines, \($b) bytes > \($t) lines / 8000 bytes). Locate the range first (grep -n, graphify), then read it with sed -n '"'"'A,Bp'"'"' or Read with offset/limit. The whole file stays in context until the session ends. Re-issue this exact command to force the full dump.")}}'
exit 0
