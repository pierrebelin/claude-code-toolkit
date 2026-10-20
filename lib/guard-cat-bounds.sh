#!/bin/bash
# bash-dispatch module — require a bounded read when `cat` dumps a large file.
# Only a simple `cat`/`head`/`tail` (or the sed and awk forms that print a file) with
# no pipe or stdout redirect, past the line or byte threshold; head/tail count for the
# span they ask for. Re-issuing the identical
# command forces it (recorded per agent and file). Shared body: lib/bounds-common.sh.
set -u

cmd="${HOOK_CMD:-}"
[ -n "$cmd" ] || exit 0

# Fast bail-out before sourcing bounds-common.sh.
case "$cmd" in *cat*|*head*|*tail*|*sed*|*awk*) ;; *) exit 0 ;; esac

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bounds-common.sh
. "$LIB/bounds-common.sh"

# A subagent gets read-bounds' higher bar.
max_lines=$BOUNDS_THRESHOLD max_bytes=$BOUNDS_BYTES
if [ -n "${HOOK_AGENT_ID:-}" ]; then
  max_lines=$BOUNDS_SUBAGENT_THRESHOLD max_bytes=$BOUNDS_SUBAGENT_BYTES
fi

# The sed and awk forms that print a file, as the cat/head/tail they amount to:
# `sed -n 'A,Bp'` its span, `sed -n 'A,$p'` a tail from A, `sed Nq` a head, any other
# sed without -n and the awk identity the whole file. Fails on a form that filters.
as_cat() {
  local verb=$1 quiet="" script="" have="" a b span
  local files=()
  shift
  if [ "$verb" = awk ]; then
    case "${1:-}" in 1|"'1'"|'"1"'|"'{print}'"|"'{print") ;; *) return 1 ;; esac
    shift
    [ "${1:-}" = "\$0}'" ] && shift
    printf 'cat %s' "$*"
    return 0
  fi
  while [ $# -gt 0 ]; do
    a=$1
    shift
    case "$a" in
      -i*|--in-place*) return 1 ;;
      -n|--quiet|--silent) quiet=1 ;;
      -e) script=${1:-}; have=1; [ $# -gt 0 ] && shift ;;
      -E|-r|--regexp-extended) ;;
      -*) return 1 ;;
      *) if [ -z "$have" ]; then script=$a; have=1; else files+=("$a"); fi ;;
    esac
  done
  script=${script#[\'\"]}
  script=${script%[\'\"]}
  if [ -n "$quiet" ]; then
    [[ $script =~ ^([0-9]+)(,([0-9]+|\$))?p$ ]] || return 1
    a=${BASH_REMATCH[1]} b=${BASH_REMATCH[3]}
    if [ -z "${BASH_REMATCH[2]}" ]; then
      span=1
    elif [ "$b" = '$' ]; then
      printf 'tail -n +%s %s' "$a" "${files[*]-}"
      return 0
    else
      span=$(( b - a + 1 ))
      [ "$span" -ge 1 ] || span=1
    fi
    printf 'head -n %s %s' "$span" "${files[*]-}"
  elif [[ $script =~ ^([0-9]+)q$ ]]; then
    printf 'head -n %s %s' "${BASH_REMATCH[1]}" "${files[*]-}"
  else
    printf 'cat %s' "${files[*]-}"
  fi
}

# Redirecting stderr or duplicating a descriptor leaves stdout in the context: those
# are dropped before the redirect test, and `&>` read as the `>` it is.
cmd=$(printf '%s' "$cmd" | sed -E -e 's/[0-9]*>&[0-9-]+//g' -e 's/&>/>/g' \
  -e 's/(^|[[:space:]])2>>?[[:space:]]*[^[:space:];&|]+//g')

# Split on `;` and `&` so `cd x; cat big.md` is seen as a bare `cat`.
oversized=""
verb_of_hit=""
lines_of_hit=""
bytes_of_hit=""
knowledge=""
while IFS= read -r segment; do
  segment="${segment#"${segment%%[![:space:]]*}"}"
  case "$segment" in
    cat\ *|head\ *|tail\ *|sed\ *|awk\ *) ;;
    *) continue ;;
  esac
  # A pipe or a redirect means the output is filtered or never reaches context.
  case "$segment" in
    *\|*|*\>*) continue ;;
  esac

  set -- $segment
  shown=$1
  case "$shown" in
    sed|awk)
      segment=$(as_cat "$@") || continue
      set -- $segment ;;
  esac
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

    # A knowledge base's growing file, read whole: refused whatever its size.
    if [ "$eff_lines" -ge "$n" ] && bounds_knowledge_guarded "$arg" "${HOOK_AGENT_TYPE:-}"; then
      oversized="$arg"
      verb_of_hit="$shown"
      knowledge=1
      break
    fi

    if [ "$eff_lines" -le "$max_lines" ] 2>/dev/null && [ "$eff_bytes" -le "$max_bytes" ] 2>/dev/null; then
      continue
    fi
    # The whole file, past the bounds but flat — see bounds_is_flat in bounds-common.sh.
    if [ "$eff_lines" -ge "$n" ]; then
      bounds_is_flat "$arg" && continue
    fi
    oversized="$arg"
    verb_of_hit="$shown"
    lines_of_hit="$eff_lines"
    bytes_of_hit="$eff_bytes"
    break
  done
  [ -n "$oversized" ] && break
done <<< "$(printf '%s' "$cmd" | tr ';&' '\n\n')"

[ -n "$oversized" ] || exit 0

# Per agent: the main chain has no agent_id and falls back to the session.
seen_file="/tmp/claude-catbounds-seen-${HOOK_SESSION_ID:-unknown}${HOOK_AGENT_ID:+-$HOOK_AGENT_ID}"
if [ -f "$seen_file" ] && grep -Fxq "$oversized" "$seen_file" 2>/dev/null; then
  echo "$oversized" >> "${seen_file}.forced"
  exit 0
fi
echo "$oversized" >> "$seen_file"

if [ -n "$knowledge" ]; then
  reason=$(bounds_knowledge_reason "$verb_of_hit" "$oversized" "sed -n 'A,Bp' $oversized" "Re-issue this exact command to force the full dump.")
else
  reason=$(bounds_reason \
    "Unbounded $verb_of_hit on $oversized ($lines_of_hit lines, $bytes_of_hit bytes > $max_lines lines / $max_bytes bytes). Everything dumped stays in context until the session ends." \
    "$oversized" \
    "read the range you need with sed -n 'A,Bp' around one of them" \
    "Locate the range first (grep -n, graphify), then read it with sed -n 'A,Bp' or Read with offset/limit." \
    "Re-issue this exact command to force the full dump.")
fi

jq -n --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
