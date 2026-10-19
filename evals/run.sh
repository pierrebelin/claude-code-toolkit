#!/bin/bash
# Hook evals — replay recorded tool payloads through the hooks, check the decision.
#
# Usage:
#   cctoolkit evals                              # every cases/*.json
#   bash evals/run.sh -v cases/guard-git.json      # from the toolkit checkout
#   LATENCY_MAX_MS=200 cctoolkit evals             # looser latency budget
#
# Case file shape:
#   { "fixtures": [ {"path": "big.cs", "lines": 300, "kind": "sparse|flat|md|transcript|text", "ctx": N, "content": "..." } ],
#     "cases": [ { "name": "...",
#                  "hook": "hooks/x.sh"  |  "cmd": "bash {{KIT}}/tools/x ...",
#                  "pre": [payload, ...],          # replayed first, output ignored
#                  "input": payload,               # hook payload on stdin; session_id
#                                                  # ({{SID}}), agent_id and transcript_path ("")
#                                                  # default when absent
#                  "env": {"VAR": "value"},
#                  "expect": { "decision": "deny|allow|ask|none|not_deny",
#                              "reason": "substring", "command": "substring",
#                              "command_absent": "substring", "prompt": "substring",
#                              "prompt_absent": "substring",
#                              "context": "substring", "no_context": true,
#                              "exit": N, "stdout": "substring", "stderr": "substring" } } ] }
#
# {{FIX}} expands to the fixtures directory, {{ROOT}} to the project root, {{KIT}}
# to the kit (the directory holding hooks/, lib/, scripts/), {{SID}}
# to a session id unique to the case — so escape hatches keyed on the session
# never leak between cases. Hooks run with the project root as cwd, as Claude Code
# runs them. Everything the run leaves in /tmp carries the run id and is removed.
set -u

# Claude Code exports the session's effort to Bash: a run launched from a session
# would hand it to every hook and decide the effort cases in its place.
unset CLAUDE_EFFORT
# The repo's opt-ins (`env` of its settings) reach Bash the same way and would decide
# the cases written for their absence.
unset CLAUDE_DOCTOR_BUDGET_LINES CLAUDE_DOTNET_TEST_TIMEOUT

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The runner sits in `evals/` of the kit: the toolkit checkout or the plugin cache.
# A bare `.claude/` there holds the runtime files the hooks write, not the kit.
ROOT="$(cd "$HERE/.." && pwd)"
KIT_DIR="$ROOT"
# A fixture repo is its own project: an inherited CLAUDE_PROJECT_DIR would point
# every hook and script at the repo the runner was launched from.
unset CLAUDE_PROJECT_DIR
FIX="$HERE/.fixtures"
RUN="eval-$$-$(date +%s)"
ERRF="/tmp/claude-evalerr-$RUN"
LATF="/tmp/claude-evallat-$RUN"
# Median latency budget per hook, in ms: about twice the measure, so a regression that
# doubles a hot-path hook fails the run.
LATENCY_MAX_MS="${LATENCY_MAX_MS:-80}"
LATENCY_SLOW_HOOKS="hooks/handler-claude-md-check.sh:300"
VERBOSE=0
files=()
for a in "$@"; do
  case "$a" in
    -v|--verbose) VERBOSE=1 ;;
    *) files+=("$a") ;;
  esac
done
[ "${#files[@]}" -gt 0 ] || files=("$HERE"/cases/*.json)
# A repo's own case (`cctoolkit evals .claude/evals/cases/<f>.json`) checks that repo:
# its hooks and commands run from the folder holding the case's `.claude/`, not the kit.
for f in "${files[@]}"; do
  d="$(cd "$(dirname "$f")" 2>/dev/null && pwd)" || continue
  case "$d/" in "$KIT_DIR"/*) continue ;; esac
  while [ "$d" != / ] && [ ! -d "$d/.claude" ]; do d="$(dirname "$d")"; done
  [ -d "$d/.claude" ] && ROOT="$d"
done

PASSED=0
FAILED=0

cleanup() {
  rm -rf "$FIX"
  rm -f /tmp/claude-*"$RUN"* 2>/dev/null
}
trap cleanup EXIT

make_fixture() {
  local path="$FIX/$1" lines="$2" kind="$3" ctx="$4" content="${5:-}"
  mkdir -p "$(dirname "$path")"
  case "$kind" in
    flat)
      # First 40 lines long, the rest short: the outline (capped at 40 lines)
      # weighs most of the file, which is what bounds_is_flat measures.
      { seq 1 40 | awk '{printf "public sealed record Declaration%03d(string Name, int Value, bool Enabled, string Description);\n", $1}'
        seq 41 "$lines" | awk '{print "class C"$1" {}"}'; } > "$path" ;;
    text)
      # Verbatim bytes, final newlines stripped; a script (`#!`) is made executable.
      printf '%s' "$content" > "$path"
      case "$content" in '#!'*) chmod +x "$path" ;; esac ;;
    md)
      seq 1 "$lines" | awk '{print "Paragraph "$1": markdown wraps at the paragraph rather than at eighty columns, so a line count alone waves a heavy file through and only the byte bound catches it."}' > "$path" ;;
    transcript)
      printf '{"type":"user","message":{"role":"user","content":"x"}}\n' > "$path"
      printf '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":32,"cache_creation_input_tokens":1000,"cache_read_input_tokens":%d,"output_tokens":10}}}\n' "$ctx" >> "$path" ;;
    *)
      # Sparse: one declaration every 40 lines, the rest statements.
      seq 1 "$lines" | awk 'NR%40==1{print "public class C"$1" { }"; next}{print "    var v"$1" = "$1";"}' > "$path" ;;
  esac
}

expand() {
  printf '%s' "$1" | sed -e "s|{{FIX}}|$FIX|g" -e "s|{{ROOT}}|$ROOT|g" -e "s|{{KIT}}|$KIT_DIR|g" -e "s|{{SID}}|$2|g"
}

jf() { printf '%s' "$1" | jq -r "$2"; }
jc() { printf '%s' "$1" | jq -c "$2"; }

ENVARGS=()
# A payload's defaults; an empty payload ({}) stays empty.
WITH_DEFAULTS='def d(p): if p == {} then p else {session_id: "{{SID}}", agent_id: "", transcript_path: ""} + p end; d'

# /bin/bash is 3.2 on macOS: no $EPOCHREALTIME, and BSD date has no %N.
now_ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'; }

run_payload() {
  (cd "$ROOT" && printf '%s' "$2" | env ${ENVARGS[@]+"${ENVARGS[@]}"} bash "$KIT_DIR/$1" 2>"$ERRF")
}

check() {
  local c="$1" out="$2" err="$3" rc="$4" fails=""
  local decision reason command prompt context want k v
  if [ -n "$out" ] && printf '%s' "$out" | jq -e 'type == "object"' >/dev/null 2>&1; then
    decision=$(jf "$out" '.hookSpecificOutput.permissionDecision // "none"')
    reason=$(jf "$out" '.hookSpecificOutput.permissionDecisionReason // ""')
    command=$(jf "$out" '.hookSpecificOutput.updatedInput.command // ""')
    prompt=$(jf "$out" '.hookSpecificOutput.updatedInput.prompt // ""')
    context=$(jf "$out" '.hookSpecificOutput.additionalContext // ""')
  else
    decision="none"; reason=""; command=""; prompt=""; context=""
  fi

  want=$(jf "$c" '.expect.decision // empty')
  if [ "$want" = "not_deny" ]; then
    [ "$decision" != "deny" ] || fails="$fails decision=deny"
  elif [ -n "$want" ]; then
    [ "$decision" = "$want" ] || fails="$fails decision=$decision(want:$want)"
  fi
  # expect key:variable that must contain it
  for k in reason:reason command:command prompt:prompt context:context stdout:out stderr:err; do
    want=$(jf "$c" ".expect.${k%%:*} // empty"); v=${k#*:}
    if [ -n "$want" ]; then case "${!v}" in *"$want"*) ;; *) fails="$fails ${k%%:*}!~[$want]" ;; esac; fi
  done
  # expect key:variable that must not contain it
  for k in command_absent:command prompt_absent:prompt; do
    want=$(jf "$c" ".expect.${k%%:*} // empty"); v=${k#*:}
    if [ -n "$want" ]; then case "${!v}" in *"$want"*) fails="$fails $v~[$want]" ;; esac; fi
  done
  if [ "$(jf "$c" '.expect.no_context // false')" = "true" ]; then
    [ -z "$context" ] || fails="$fails context-present"
  fi
  want=$(jf "$c" '.expect.exit // empty')
  if [ -n "$want" ]; then [ "$rc" = "$want" ] || fails="$fails exit=$rc(want:$want)"; fi
  printf '%s' "$fails"
}

for f in "${files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "no such case file: $f"
    FAILED=$((FAILED + 1))
    continue
  fi
  label=$(basename "$f" .json)
  printf '\n%s\n' "$label"

  nfix=$(jq '.fixtures // [] | length' "$f")
  i=0
  while [ "$i" -lt "$nfix" ]; do
    make_fixture \
      "$(jq -r ".fixtures[$i].path" "$f")" \
      "$(jq -r ".fixtures[$i].lines // 0" "$f")" \
      "$(jq -r ".fixtures[$i].kind // \"sparse\"" "$f")" \
      "$(jq -r ".fixtures[$i].ctx // 0" "$f")" \
      "$(jq -r ".fixtures[$i].content // \"\"" "$f")"
    i=$((i + 1))
  done

  ncase=$(jq '.cases | length' "$f")
  i=0
  while [ "$i" -lt "$ncase" ]; do
    c=$(jq -c ".cases[$i]" "$f")
    sid="$RUN-$label-$i"
    name=$(jf "$c" '.name')
    hook=$(jf "$c" '.hook // empty')
    cmd=$(jf "$c" '.cmd // empty')

    ENVARGS=()
    while IFS= read -r kv; do
      [ -n "$kv" ] && ENVARGS+=("$(expand "$kv" "$sid")")
    done <<EOF
$(jf "$c" '.env // {} | to_entries[] | "\(.key)=\(.value)"')
EOF

    : > "$ERRF"
    if [ -n "$hook" ]; then
      npre=$(jf "$c" '.pre // [] | length')
      p=0
      while [ "$p" -lt "$npre" ]; do
        run_payload "$hook" "$(expand "$(jc "$c" "$WITH_DEFAULTS(.pre[$p])")" "$sid")" >/dev/null 2>&1
        p=$((p + 1))
      done
      payload=$(expand "$(jc "$c" "$WITH_DEFAULTS(.input)")" "$sid")
      t0=$(now_ms)
      out=$(run_payload "$hook" "$payload"); rc=$?
      printf '%s\t%s\n' "$hook" "$(( $(now_ms) - t0 ))" >> "$LATF"
    else
      out=$(cd "$ROOT" && env ${ENVARGS[@]+"${ENVARGS[@]}"} bash -c "$(expand "$cmd" "$sid")" 2>"$ERRF"); rc=$?
    fi
    err=$(cat "$ERRF" 2>/dev/null)

    fails=$(check "$c" "$out" "$err" "$rc")
    if [ -z "$fails" ]; then
      PASSED=$((PASSED + 1))
      printf '  PASS  %s\n' "$name"
      if [ "$VERBOSE" -eq 1 ]; then
        printf '        %s\n' "$(printf '%s' "$out" | head -c 300)"
      fi
    else
      FAILED=$((FAILED + 1))
      printf '  FAIL  %s —%s\n' "$name" "$fails"
      printf '        out: %s\n' "$(printf '%s' "$out" | head -c 400)"
      [ -n "$err" ] && printf '        err: %s\n' "$(printf '%s' "$err" | head -c 300)"
    fi
    i=$((i + 1))
  done
done

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"

if [ -s "$LATF" ]; then
  printf '\nlatency (ms)                         cases  median    max\n'
  sort -t$'\t' -k1,1 -k2,2n "$LATF" | awk -F'\t' -v dflt="$LATENCY_MAX_MS" -v slow="$LATENCY_SLOW_HOOKS" '
    BEGIN { k = split(slow, kv, " "); for (j = 1; j <= k; j++) { split(kv[j], p, ":"); own[p[1]] = p[2] } }
    function flush() {
      if (n == 0) return
      med = v[int((n + 1) / 2)]
      cap = (h in own) ? own[h] : dflt
      printf "  %-34s %5d %7d %6d%s\n", h, n, med, v[n], (med > cap ? "  OVER BUDGET" : "")
    }
    $1 != h { flush(); h = $1; n = 0 }
    { v[++n] = $2 }
    END { flush() }' > "$LATF.table"
  cat "$LATF.table"
  SLOW=$(grep -c 'OVER BUDGET' "$LATF.table")
  [ "$SLOW" -eq 0 ] || printf '%d hook(s) over their median latency budget\n' "$SLOW"
fi

[ "$FAILED" -eq 0 ] && [ "${SLOW:-0}" -eq 0 ]
