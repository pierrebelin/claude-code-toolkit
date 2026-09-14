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
#   - only a simple `cat`, `head` or `tail` command, no pipe (`cat f | grep x` is
#     already bounded by grep) and no redirect (`cat f > out` never enters the
#     context). `head`/`tail` count for the span they ask for: `head -20 f` is a
#     bounded read and passes, `head -n 5000 f` or `tail -n +1 f` is a dump in
#     disguise and is measured like a `cat`. Added 2026-09-12 after Spotify's
#     shunt hook, which covers the same five verbs (minus the span arithmetic:
#     it blocks `head -20` on a big file, which is exactly the read we want),
#   - only files past the line threshold, or past the byte one. The second
#     trigger exists because Markdown wraps at the paragraph, not at 80 columns:
#     measured here, `02-configurator-injection.md` is 18.3 kB in 119 lines and a
#     line count alone waves it through. 8 kB is roughly 2.5k tokens, the point
#     where one dump is worth locating first.
#   - binary/rendered formats and instruction files are left alone.
#
# Escape hatch, same shape as read-bounds.sh (and lib/guard-graphify-grep.sh, removed 2026-09-13): the
# denial is recorded per (agent, file), so re-issuing the identical `cat` passes
# through. That is how you force a full dump when you genuinely want one, and it
# is scoped to the agent that asked — never handed to its siblings.
#
# Thresholds, skip lists, outline and refusal layout are shared with
# hooks/read-bounds.sh through lib/bounds-common.sh.
set -u

cmd="${HOOK_CMD:-}"
[ -n "$cmd" ] || exit 0

# Fast bail-out before sourcing bounds-common.sh: the loop below only ever looks
# at segments starting with `cat `, `head ` or `tail `, so a command with none of
# those substrings cannot produce a hit, and the source is pure cost.
case "$cmd" in *cat*|*head*|*tail*) ;; *) exit 0 ;; esac

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bounds-common.sh
. "$LIB/bounds-common.sh"

# Split on the separators that start a new simple command. A `cd x; cat big.md`
# must be seen as a bare `cat`, not as a `cd`.
oversized=""
verb_of_hit=""
lines_of_hit=""
bytes_of_hit=""
while IFS= read -r segment; do
  segment="${segment#"${segment%%[![:space:]]*}"}"
  case "$segment" in
    cat\ *|head\ *|tail\ *) ;;
    *) continue ;;
  esac
  # A pipe or a redirect means the output is filtered or never reaches context.
  case "$segment" in
    *\|*|*\>*) continue ;;
  esac

  set -- $segment
  verb=$1
  shift

  # The span head/tail ask for: -n N, -nN, -N, --lines=N, -c N, -cN, --bytes=N,
  # and `-n +K` (tail: from line K to the end). Anything unparseable falls back to
  # the verb's default of 10 lines. `cat` has no span: the whole file.
  span=""
  from=""
  span_bytes=""
  files=()
  while [ $# -gt 0 ]; do
    arg=$1
    shift
    v=""
    case "$arg" in
      -n|--lines) v=${1:-}; [ $# -gt 0 ] && shift ;;
      -c|--bytes) span_bytes=${1:-}; [ $# -gt 0 ] && shift; continue ;;
      --lines=*) v=${arg#--lines=} ;;
      --bytes=*) span_bytes=${arg#--bytes=}; continue ;;
      -n*) v=${arg#-n} ;;
      -c*) span_bytes=${arg#-c}; continue ;;
      -[0-9]*) v=${arg#-} ;;
      -*) continue ;;
      *) files+=("$arg"); continue ;;
    esac
    case "$v" in
      +*) from=${v#+} ;;
      *) span=$v ;;
    esac
  done
  case "$span" in ''|*[!0-9]*) span="" ;; esac
  case "$from" in ''|*[!0-9]*) from="" ;; esac
  case "$span_bytes" in ''|*[!0-9]*) span_bytes="" ;; esac

  for arg in ${files[@]+"${files[@]}"}; do
    [ -f "$arg" ] || continue
    bounds_skip "$arg" && continue
    n=$(wc -l < "$arg" 2>/dev/null | tr -d ' ')
    bytes=$(wc -c < "$arg" 2>/dev/null | tr -d ' ')
    [ -n "$n" ] || continue
    bytes=${bytes:-0}

    # What actually reaches the context: the whole file for cat, the span for
    # head/tail, clipped to the file. Bytes of a line span are prorated.
    eff_lines=$n
    eff_bytes=$bytes
    case "$verb" in
      head|tail)
        if [ "$verb" = tail ] && [ -n "$from" ]; then
          eff_lines=$(( n - from + 1 ))
          [ "$eff_lines" -lt 0 ] && eff_lines=0
        elif [ -n "$span" ]; then
          eff_lines=$span
          [ "$eff_lines" -gt "$n" ] && eff_lines=$n
        elif [ -n "$span_bytes" ]; then
          eff_lines=0
        else
          eff_lines=10
        fi
        if [ -n "$span_bytes" ] && [ -z "$span" ] && [ -z "$from" ]; then
          eff_bytes=$span_bytes
          [ "$eff_bytes" -gt "$bytes" ] && eff_bytes=$bytes
        elif [ "$n" -gt 0 ]; then
          eff_bytes=$(( bytes * eff_lines / n ))
        else
          eff_bytes=0
        fi ;;
    esac

    if [ "$eff_lines" -le "$BOUNDS_THRESHOLD" ] 2>/dev/null && [ "$eff_bytes" -le "$BOUNDS_BYTES" ] 2>/dev/null; then
      continue
    fi
    # The whole file, past the bounds but flat — see bounds_is_flat in bounds-common.sh.
    if [ "$eff_lines" -ge "$n" ]; then
      bounds_is_flat "$arg" && continue
    fi
    oversized="$arg"
    verb_of_hit="$verb"
    lines_of_hit="$eff_lines"
    bytes_of_hit="$eff_bytes"
    break
  done
  [ -n "$oversized" ] && break
done <<< "$(printf '%s' "$cmd" | tr ';&' '\n\n')"

[ -n "$oversized" ] || exit 0

# Same per-agent scoping as read-bounds.sh: agent_id is the only per-agent field,
# the main chain has none and falls back to the session.
seen_file="/tmp/claude-catbounds-seen-${HOOK_SESSION_ID:-unknown}${HOOK_AGENT_ID:+-$HOOK_AGENT_ID}"
if [ -f "$seen_file" ] && grep -Fxq "$oversized" "$seen_file" 2>/dev/null; then
  echo "$oversized" >> "${seen_file}.forced"
  exit 0
fi
echo "$oversized" >> "$seen_file"

reason=$(bounds_reason \
  "Unbounded $verb_of_hit on $oversized ($lines_of_hit lines, $bytes_of_hit bytes > $BOUNDS_THRESHOLD lines / $BOUNDS_BYTES bytes). Everything dumped stays in context until the session ends." \
  "$oversized" \
  "read the range you need with sed -n 'A,Bp' around one of them" \
  "Locate the range first (grep -n, graphify), then read it with sed -n 'A,Bp' or Read with offset/limit." \
  "Re-issue this exact command to force the full dump.")

jq -n --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
