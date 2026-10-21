#!/bin/bash
# Hook evals — replay recorded tool payloads through the hooks, check the decision.
#
# Usage:
#   cctoolkit evals                              # every cases/*.json
#   bash evals/run.sh -v cases/guard-git.json      # from the toolkit checkout
#   LATENCY_MAX_MS=200 cctoolkit evals             # looser latency budget
#   cctoolkit evals --profile                      # + the slowest files and cases
#   cctoolkit evals -j 1                           # one file at a time (default: CPUs, up to 6)
#   bash evals/run.sh --changed                    # only the case files the working tree's changes reach
#   bash evals/run.sh --changed --list             # which ones, nothing run
#
# Case file shape:
#   { "fixtures": [ {"path": "big.cs", "lines": 300, "kind": "sparse|flat|md|transcript|text", "ctx": N, "content": "..." } ],
#     "requires": ["rtk"],                         # commands the file's cases need
#     "cases": [ { "name": "...",
#                  "requires": ["ast-grep"],       # the same, for one case
#                  "hook": "hooks/x.sh"  |  "cmd": "bash {{KIT}}/tools/x ...",
#                  "pre": [payload, ...],          # replayed first, output ignored
#                  "input": payload,               # hook payload on stdin; session_id
#                                                  # ({{SID}}), agent_id and transcript_path ("")
#                                                  # default when absent
#                  "env": {"VAR": "value"},
#                  "expect": { "decision": "deny|allow|ask|block|none|not_deny",
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
#
# A case whose `requires` names a command absent from the PATH is skipped and counted
# apart; CCTOOLKIT_EVALS_STRICT=1 fails the run on any skip (CI). A `hook` that does not
# exist fails its case. `decision` reads a PreToolUse `permissionDecision` or, from a
# Stop-style answer, its top-level `decision` (`reason` the same).
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
RUN="eval-$$-$(date +%s)"
# One fixtures folder per run: two runs at once (two sessions, a run left behind) never
# delete each other's files.
FIX="$HERE/.fixtures/$RUN"
ERRF="/tmp/claude-evalerr-$RUN"
LATF="/tmp/claude-evallat-$RUN"
# Duration of every case (ms, file, name), and of every file in PROF.files.
PROF="/tmp/claude-evalprof-$RUN"
# Median latency budget per hook, in ms: about twice the measure, so a regression that
# doubles a hot-path hook fails the run.
LATENCY_MAX_MS="${LATENCY_MAX_MS:-80}"
LATENCY_SLOW_HOOKS="hooks/handler-claude-md-check.sh:300"
VERBOSE=0
PROFILE=0
# Set by the parent of a parallel run, read once: a case running a runner of its own must not
# hand its counts to this one's parent.
SHARE_OUT="${EVALS_SHARE:-}"; SHARE_INDEX="${EVALS_INDEX:-0}"
unset EVALS_SHARE EVALS_INDEX
# Case files run in parallel, one runner per file: -j N, else EVALS_JOBS, else the CPU count
# capped at 6. `wait -n` needs bash 4.3: an older bash runs them one by one.
JOBS="${EVALS_JOBS:-}"
files=()
while [ $# -gt 0 ]; do
  case "$1" in
    -v|--verbose) VERBOSE=1 ;;
    --profile) PROFILE=1 ;;
    -j) JOBS="${2:-}"; shift ;;
    -j*) JOBS="${1#-j}" ;;
    --changed) CHANGED=1 ;;
    --list) LIST=1 ;;
    *) files+=("$1") ;;
  esac
  shift
done

# --changed: the case files the working tree's changes can reach. A changed file is named by
# its basename — by its stem for a Python module (as imported) and for a script or tool (as
# `cctoolkit <name>` calls it); every kit source (.sh, .py, .js, bin/cctoolkit) citing a name
# adds its own, until none is new; the case files citing one of them run. The runner, the hook
# wiring or a case file changed: everything, or that file. Prose, JSON wiring and maintainer
# files cite everything and reach nothing.
name_of() {
  local n=${1##*/}
  case "$1" in *.py|scripts/*|tools/*|bin/*) n=${n%.*} ;; esac
  NAME=$n
}
# The names of the paths listed in $1 not seen yet: appended to names, and listed in ADDED.
add_names() {
  local p
  ADDED=()
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    name_of "$p"
    case " ${names[*]} " in *" $NAME "*) ;; *) names+=("$NAME"); ADDED+=("$NAME") ;; esac
  done <<EOF
$1
EOF
}
changed_cases() {
  local changed p n names=() all=0 round new=() hits pats=()
  changed=$(cd "$KIT_DIR" && { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null) || return 1
  CHANGED_FILES=()
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "$p" in
      evals/run.sh|hooks/hooks.json) all=1 ;;
      evals/cases/*.json) CHANGED_FILES+=("$HERE/cases/${p##*/}") ;;
      *.md|docs/*|dev/*|.github/*|mods/*|examples/*|.claude-plugin/*|evals/.fixtures/*) ;;
      *) name_of "$p"; names+=("$NAME") ;;
    esac
  done <<EOF
$changed
EOF
  if [ "$all" -eq 1 ]; then CHANGED_FILES=("$HERE"/cases/*.json); return 0; fi
  [ "${#names[@]}" -gt 0 ] || return 0
  # One hop through the entry points citing a changed name: a hook, script, tool or workflow
  # that calls it. A lib/ module citing one is not followed — its mentions are mostly prose,
  # and kit_config would then pull in every case.
  pats=(); for n in "${names[@]}"; do pats+=(-e "$n"); done
  add_names "$(cd "$KIT_DIR" && grep -rlF --include='*.sh' --include='*.py' --include='*.js' --include=doctor \
    "${pats[@]}" hooks scripts tools workflows evals/workflows 2>/dev/null)"
  # Then every file sourcing or importing a lib/ module reached, until none is new.
  new=(); for n in "${names[@]}"; do new+=("$n"); done
  round=0
  while [ "${#new[@]}" -gt 0 ] && [ "$round" -lt 8 ]; do
    pats=()
    for n in "${new[@]}"; do
      pats+=(-e "^[[:space:]]*(\.|source)[[:space:]].*/$n" -e "^[[:space:]]*(from|import)[[:space:]]+$n([[:space:]]|,|$)")
    done
    add_names "$(cd "$KIT_DIR" && grep -rlE --include='*.sh' --include='*.py' --include=doctor \
      "${pats[@]}" hooks lib scripts tools 2>/dev/null)"
    new=("${ADDED[@]+"${ADDED[@]}"}")
    round=$((round + 1))
  done
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case " ${CHANGED_FILES[*]} " in *" $p "*) ;; *) CHANGED_FILES+=("$p") ;; esac
  done <<EOF
$(pats=(); for n in "${names[@]}"; do pats+=(-e "$n"); done; grep -lF "${pats[@]}" "$HERE"/cases/*.json 2>/dev/null)
EOF
}
if [ "${CHANGED:-0}" -eq 1 ] && [ "${#files[@]}" -eq 0 ]; then
  if ! changed_cases; then
    echo "--changed: $KIT_DIR is not a git checkout — every case file runs"
  elif [ "${#CHANGED_FILES[@]}" -eq 0 ]; then
    echo "--changed: no case file reached by the changes"
    exit 0
  else
    files=("${CHANGED_FILES[@]}")
    total=("$HERE"/cases/*.json)
    echo "--changed: ${#files[@]} of ${#total[@]} case files"
  fi
fi
[ "${#files[@]}" -gt 0 ] || files=("$HERE"/cases/*.json)
# --list: the case files that would run, nothing run.
if [ "${LIST:-0}" -eq 1 ]; then
  for f in "${files[@]}"; do echo "  ${f##*/}"; done
  exit 0
fi
if [ -z "$JOBS" ]; then
  JOBS=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)
  [ "$JOBS" -le 6 ] 2>/dev/null || JOBS=6
fi
case "$JOBS" in ''|*[!0-9]*|0) echo "-j wants a number of jobs, got: $JOBS"; exit 2 ;; esac
if [ "${BASH_VERSINFO[0]}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 3 ]; }; then
  JOBS=1
fi
[ "${#files[@]}" -gt 0 ] || files=("$HERE"/cases/*.json)
# A repo's own case (`cctoolkit evals .claude/evals/cases/<f>.json`) checks that repo:
# its hooks and commands run from the folder holding the case's `.claude/`, not the kit.
for f in "${files[@]}"; do
  case "$f" in "$HERE"/cases/*) continue ;; esac
  d="$(cd "$(dirname "$f")" 2>/dev/null && pwd)" || continue
  case "$d/" in "$KIT_DIR"/*) continue ;; esac
  while [ "$d" != / ] && [ ! -d "$d/.claude" ]; do d="$(dirname "$d")"; done
  [ -d "$d/.claude" ] && ROOT="$d"
done

PASSED=0
FAILED=0
SKIPPED=0

cleanup() {
  rm -rf "$FIX"
  rmdir "$HERE/.fixtures" 2>/dev/null
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

# Placeholders replaced in bash, into EXP: a sed per field — or a $(...) — forks, and a fork
# costs ~100 ms under Git Bash.
shopt -u patsub_replacement 2>/dev/null
expand() {
  local s="$1"
  s=${s//'{{FIX}}'/"$FIX"}; s=${s//'{{ROOT}}'/"$ROOT"}; s=${s//'{{KIT}}'/"$KIT_DIR"}; s=${s//'{{SID}}'/"$2"}
  EXP=$s
}

ENVARGS=()
# One jq per case file reads every case: 8 NUL-terminated fields per case, in this order —
# name, hook, cmd, requires, env (one VAR=value per line), pre (one payload per line),
# input, expect. A payload's defaults apply here; an empty payload ({}) stays empty. Trailing
# newlines are dropped from every field, as a $(...) would: a fixture's content ends on its
# last character, so a line a case appends keeps its number.
CASES_JQ='def r: if type == "string" then . else tojson end | sub("\n+$"; "");
def d(p): if p == {} then p else {session_id: "{{SID}}", agent_id: "", transcript_path: ""} + p end;
.cases[] | (
  (.name | r), (.hook // "" | r), (.cmd // "" | r), (.requires // [] | join(" ")),
  (.env // {} | to_entries | map("\(.key)=\(.value)") | join("\n")),
  ([(.pre // [])[] as $p | d($p) | tojson] | join("\n")),
  (d(.input) | tojson), (.expect // {} | tojson)
) + "\u0000"'
FIXTURES_JQ='def r: if type == "string" then . else tojson end | sub("\n+$"; "");
.fixtures // [] | .[] | ((.path | r), (.lines // 0 | r), (.kind // "sparse" | r), (.ctx // 0 | r), (.content // "" | r)) + "\u0000"'

# /bin/bash is 3.2 on macOS: no $EPOCHREALTIME, and BSD date has no %N — perl there.
# EPOCHREALTIME carries the locale's decimal separator. Sets NOW (ms) rather than printing
# it: a $(...) is a fork.
if [ -n "${EPOCHREALTIME:-}" ]; then
  stamp() { local t=${EPOCHREALTIME//[.,]/}; NOW=$((10#$t / 1000)); }
else
  stamp() { NOW=$(perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'); }
fi

run_payload() {
  (cd "$ROOT" && printf '%s' "$2" | env ${ENVARGS[@]+"${ENVARGS[@]}"} bash "$KIT_DIR/$1" 2>"$ERRF")
}

# The whole verdict in one jq: expect, stdout and stderr arrive NUL-separated on stdin (no
# command-line limit on a long output), the failures come back as one string, empty when the
# case passes. Trailing newlines are dropped from every value, as a $(...) would.
CHECK_JQ='def r: if type == "string" then . else tojson end;
def s: sub("\n+$"; "");
split("\u0000") as [$e, $out, $err]
| ($e | fromjson) as $x
| def want(k): $x[k] // empty | r | s;
  (if $out != "" then (try ($out | fromjson) catch null) else null end) as $o
| (if ($o | type) == "object" then $o else {} end) as $j
| ($j.hookSpecificOutput // {}) as $h
| { decision: ($h.permissionDecision // $j.decision // "none" | r | s),
    reason: ($h.permissionDecisionReason // $j.reason // "" | r | s),
    command: ($h.updatedInput.command // "" | r | s),
    prompt: ($h.updatedInput.prompt // "" | r | s),
    context: ($h.additionalContext // "" | r | s),
    stdout: ($out | s), stderr: ($err // "" | s) } as $v
| [ (want("decision") as $w
      | if $w == "not_deny" then (if $v.decision == "deny" then " decision=deny" else empty end)
        elif $w != "" and $v.decision != $w then " decision=\($v.decision)(want:\($w))"
        else empty end),
    # expect key that must be contained in the value of the same name
    (("reason", "command", "prompt", "context", "stdout", "stderr") as $k
      | want($k) as $w | select($w != "" and ($v[$k] | contains($w) | not)) | " \($k)!~[\($w)]"),
    # expect key: the value that must not contain it
    ((["command_absent", "command"], ["prompt_absent", "prompt"]) as [$k, $f]
      | want($k) as $w | select($w != "" and ($v[$f] | contains($w))) | " \($f)~[\($w)]"),
    (if ($x.no_context // false | r) == "true" and $v.context != "" then " context-present" else empty end),
    (want("exit") as $w | select($w != "" and $rc != $w) | " exit=\($rc)(want:\($w))")
  ] | join("")'

check() {
  printf '%s\0%s\0%s' "$1" "$2" "$3" | jq -R -s -j --arg rc "$4" "$CHECK_JQ"
}

stamp; run_t0=$NOW

# Parallel run: one child runner per case file (its own run id, fixtures and /tmp files),
# its output buffered and printed in the files' order as soon as the files before it are
# done; the counts, latencies and durations it leaves in SHARE are summed here, and the
# loop below is left with no file.
PARALLEL=0
if [ "$JOBS" -gt 1 ] && [ "${#files[@]}" -gt 1 ]; then
  PARALLEL=1
  SHARE="/tmp/claude-evalshare-$RUN"
  mkdir -p "$SHARE"
  # A file declaring `"serial": true` (cases timing a hook against the clock) runs last and
  # alone, the others done.
  serial=$(grep -lE '"serial"[[:space:]]*:[[:space:]]*true' "${files[@]}" 2>/dev/null)
  ordered=(); later=()
  for f in "${files[@]}"; do
    case $'\n'"$serial"$'\n' in *$'\n'"$f"$'\n'*) later+=("$f") ;; *) ordered+=("$f") ;; esac
  done
  files=("${ordered[@]+"${ordered[@]}"}" "${later[@]+"${later[@]}"}")
  nfiles=${#files[@]}; next=0; running=0; k=0
  first_serial=$((nfiles - ${#later[@]}))
  childargs=()
  [ "$VERBOSE" -eq 1 ] && childargs+=(-v)
  flush() {
    while [ "$next" -lt "$nfiles" ] && [ -f "$SHARE/$next.done" ]; do
      cat "$SHARE/$next.log"; next=$((next + 1))
    done
  }
  for f in "${files[@]}"; do
    cap=$JOBS; [ "$k" -lt "$first_serial" ] || cap=1
    while [ "$running" -ge "$cap" ]; do wait -n; running=$((running - 1)); flush; done
    EVALS_SHARE="$SHARE" EVALS_INDEX=$k EVALS_JOBS=1 \
      bash "$HERE/run.sh" ${childargs[@]+"${childargs[@]}"} "$f" > "$SHARE/$k.log" 2>&1 &
    running=$((running + 1)); k=$((k + 1))
  done
  while [ "$running" -gt 0 ]; do wait -n; running=$((running - 1)); flush; done
  k=0
  while [ "$k" -lt "$nfiles" ]; do
    if [ ! -f "$SHARE/$k.done" ]; then
      # A child that died before its end: what it printed, and a failure in its name.
      [ "$k" -lt "$next" ] || cat "$SHARE/$k.log" 2>/dev/null
      printf '  FAIL  %s — the runner stopped before the end of the file\n' "${files[$k]##*/}"
      FAILED=$((FAILED + 1))
    else
      [ "$k" -lt "$next" ] || cat "$SHARE/$k.log"
      read -r p fl s < "$SHARE/$k.counts"
      PASSED=$((PASSED + p)); FAILED=$((FAILED + fl)); SKIPPED=$((SKIPPED + s))
    fi
    k=$((k + 1))
  done
  cat "$SHARE"/*.lat > "$LATF" 2>/dev/null
  cat "$SHARE"/*.prof > "$PROF" 2>/dev/null
  cat "$SHARE"/*.files > "$PROF.files" 2>/dev/null
  rm -rf "$SHARE"
  files=()
fi
for f in "${files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "no such case file: $f"
    FAILED=$((FAILED + 1))
    continue
  fi
  label=${f##*/}; label=${label%.json}
  printf '\n%s\n' "$label"
  stamp; file_t0=$NOW

  while IFS= read -r -d '' fpath && IFS= read -r -d '' flines && IFS= read -r -d '' fkind \
    && IFS= read -r -d '' fctx && IFS= read -r -d '' fcontent; do
    make_fixture "$fpath" "$flines" "$fkind" "$fctx" "$fcontent"
  done < <(jq -j "$FIXTURES_JQ" "$f")

  file_requires=$(jq -r '.requires // [] | join(" ")' "$f")
  i=0
  # fd 3: a case's own command may read stdin.
  while IFS= read -r -u 3 -d '' name && IFS= read -r -u 3 -d '' hook && IFS= read -r -u 3 -d '' cmd \
    && IFS= read -r -u 3 -d '' requires && IFS= read -r -u 3 -d '' envs && IFS= read -r -u 3 -d '' pres \
    && IFS= read -r -u 3 -d '' input && IFS= read -r -u 3 -d '' expect; do
    sid="$RUN-$label-$i"
    stamp; case_t0=$NOW

    missing=""
    for r in $file_requires $requires; do
      command -v "$r" >/dev/null 2>&1 || missing="$missing $r"
    done
    if [ -n "$missing" ]; then
      SKIPPED=$((SKIPPED + 1))
      printf '  SKIP  %s — missing:%s\n' "$name" "$missing"
      i=$((i + 1))
      continue
    fi

    ENVARGS=()
    while IFS= read -r kv; do
      [ -n "$kv" ] && { expand "$kv" "$sid"; ENVARGS+=("$EXP"); }
    done <<EOF
$envs
EOF

    : > "$ERRF"
    nohook=""
    if [ -n "$hook" ] && [ ! -f "$KIT_DIR/$hook" ]; then
      # A hook that does not exist answers nothing, which `none` or `not_deny` would pass.
      out=""; rc=127; nohook=" hook-missing"
    elif [ -n "$hook" ]; then
      while IFS= read -r pre; do
        [ -n "$pre" ] || continue
        expand "$pre" "$sid"
        run_payload "$hook" "$EXP" >/dev/null 2>&1
      done <<EOF
$pres
EOF
      expand "$input" "$sid"; payload=$EXP
      stamp; t0=$NOW
      out=$(run_payload "$hook" "$payload"); rc=$?
      stamp
      printf '%s\t%s\n' "$hook" "$((NOW - t0))" >> "$LATF"
    else
      expand "$cmd" "$sid"
      out=$(cd "$ROOT" && env ${ENVARGS[@]+"${ENVARGS[@]}"} bash -c "$EXP" 2>"$ERRF"); rc=$?
    fi
    err=""
    IFS= read -r -d '' err < "$ERRF"
    while [ "${err%$'\n'}" != "$err" ]; do err=${err%$'\n'}; done

    fails=$(check "$expect" "$out" "$err" "$rc")$nohook
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
    stamp
    printf '%s\t%s\t%s\n' "$((NOW - case_t0))" "$label" "$name" >> "$PROF"
    i=$((i + 1))
  done 3< <(jq -j "$CASES_JQ" "$f")
  stamp
  printf '%s\t%s\t%s\n' "$((NOW - file_t0))" "$label" "$i" >> "$PROF.files"
done

# A child of a parallel run hands its counts and measures to its parent, which prints the rest.
if [ -n "$SHARE_OUT" ]; then
  printf '%d %d %d\n' "$PASSED" "$FAILED" "$SKIPPED" > "$SHARE_OUT/$SHARE_INDEX.counts"
  [ ! -f "$LATF" ] || cp "$LATF" "$SHARE_OUT/$SHARE_INDEX.lat"
  [ ! -f "$PROF" ] || cp "$PROF" "$SHARE_OUT/$SHARE_INDEX.prof"
  [ ! -f "$PROF.files" ] || cp "$PROF.files" "$SHARE_OUT/$SHARE_INDEX.files"
  : > "$SHARE_OUT/$SHARE_INDEX.done"
  exit 0
fi

# Before the summary line: a caller reading the run's last lines finds the summary there.
if [ "$PROFILE" -eq 1 ] && [ -s "$PROF" ]; then
  printf '\nslowest files (s)                         cases\n'
  sort -t$'\t' -k1,1nr "$PROF.files" | head -15 | awk -F'\t' '{ printf "  %-38s %5d %7.1f\n", $2, $3, $1 / 1000 }'
  printf '\nslowest cases (s)\n'
  sort -t$'\t' -k1,1nr "$PROF" | head -15 | awk -F'\t' '{ printf "  %6.1f  %s: %s\n", $1 / 1000, $2, substr($3, 1, 90) }'
fi
stamp
printf '\nduration: %d s\n' "$(( (NOW - run_t0) / 1000 ))"

printf '\n%d passed, %d failed' "$PASSED" "$FAILED"
[ "$SKIPPED" -eq 0 ] || printf ', %d skipped' "$SKIPPED"
printf '\n'
if [ "$SKIPPED" -gt 0 ] && [ "${CCTOOLKIT_EVALS_STRICT:-0}" = 1 ]; then
  printf 'CCTOOLKIT_EVALS_STRICT=1: a skipped case fails the run\n'
  FAILED=$((FAILED + SKIPPED))
fi

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
  if [ "$PARALLEL" -eq 1 ]; then
    # Hooks timed beside other runners: the medians are inflated, the budget is only shown.
    [ "$SLOW" -eq 0 ] || printf '%d hook(s) over budget in a parallel run — not enforced, -j 1 enforces it\n' "$SLOW"
    SLOW=0
  else
    [ "$SLOW" -eq 0 ] || printf '%d hook(s) over their median latency budget\n' "$SLOW"
  fi
fi

[ "$FAILED" -eq 0 ] && [ "${SLOW:-0}" -eq 0 ]
