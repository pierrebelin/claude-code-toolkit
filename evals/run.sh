#!/bin/bash
# Hook evals — replay recorded tool payloads through the hooks, check the decision.
#
# Why. 2 115 lines of hook bash guard every Read, Bash and Agent call of every
# session, and until 2026-09-12 nothing exercised them outside a live session.
# Six defects were found in production and documented in the hooks' own
# comments: a tab separator that shifted agent_id (bash-dispatch.sh), two skip
# lists that diverged (bounds-common.sh), cleanup patterns that matched nothing
# (session-cleanup.sh), two modules answering the same command (bash-dispatch.sh),
# an escape hatch leaking across agents (read-bounds.sh), /tmp never purged.
# Each one is a case under cases/. Spotify's shunt plugin ships 51 such cases
# for 2 hooks; the shape (JSON cases, jq runner) is borrowed from it.
#
# Usage:
#   bash .claude/evals/run.sh                    # every cases/*.json
#   bash .claude/evals/run.sh -v cases/guard-git.json
#
# Case file shape:
#   { "fixtures": [ {"path": "big.cs", "lines": 300, "kind": "sparse|flat|md|transcript|stub|stub-error|stub-slow|cs-flat|cs-loop|cs-filter|text", "ctx": N, "content": "..." } ],
#     "cases": [ { "name": "...",
#                  "hook": "hooks/x.sh"  |  "cmd": "bash .claude/tools/x ...",
#                  "pre": [payload, ...],          # replayed first, output ignored
#                  "input": payload,               # hook payload on stdin
#                  "env": {"VAR": "value"},
#                  "expect": { "decision": "deny|allow|ask|none|not_deny",
#                              "reason": "substring", "command": "substring",
#                              "command_absent": "substring", "prompt": "substring",
#                              "context": "substring", "no_context": true,
#                              "exit": N, "stdout": "substring", "stderr": "substring" } } ] }
#
# {{FIX}} expands to the fixtures directory, {{ROOT}} to the project root, {{SID}}
# to a session id unique to the case — so escape hatches keyed on the session
# never leak between cases. Hooks run with the project root as cwd, as Claude Code
# runs them. Everything the run leaves in /tmp carries the run id and is removed.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
FIX="$HERE/.fixtures"
RUN="eval-$$-$(date +%s)"
ERRF="/tmp/claude-evalerr-$RUN"
VERBOSE=0
files=()
for a in "$@"; do
  case "$a" in
    -v|--verbose) VERBOSE=1 ;;
    *) files+=("$a") ;;
  esac
done
[ "${#files[@]}" -gt 0 ] || files=("$HERE"/cases/*.json)

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
      # Verbatim bytes. A state file a hook reads is a fixture like any other:
      # implement-tdd-guard.sh reads the effort the statusline dropped in $TMPDIR.
      printf '%s' "$content" > "$path" ;;
    md)
      seq 1 "$lines" | awk '{print "Paragraph "$1": markdown wraps at the paragraph rather than at eighty columns, so a line count alone waves a heavy file through and only the byte bound catches it."}' > "$path" ;;
    transcript)
      printf '{"type":"user","message":{"role":"user","content":"x"}}\n' > "$path"
      printf '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":32,"cache_creation_input_tokens":1000,"cache_read_input_tokens":%d,"output_tokens":10}}}\n' "$ctx" >> "$path" ;;
    stub)
      cat > "$path" <<'STUB'
#!/bin/bash
cat >/dev/null
printf '%s\n' '{"type":"result","is_error":false,"result":"- stubbed answer","usage":{"input_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":5},"total_cost_usd":0.001}'
STUB
      chmod +x "$path" ;;
    stub-error)
      cat > "$path" <<'STUB'
#!/bin/bash
cat >/dev/null
printf '%s\n' '{"type":"result","is_error":true,"result":"stubbed failure","usage":{},"total_cost_usd":0}'
STUB
      chmod +x "$path" ;;
    stub-slow)
      cat > "$path" <<'STUB'
#!/bin/bash
cat >/dev/null
sleep 5
printf '%s\n' '{"type":"result","is_error":false,"result":"- too late","usage":{},"total_cost_usd":0}'
STUB
      chmod +x "$path" ;;
    cs-flat)
      # Handler with two repository reads, one save, one receiver the naming
      # heuristic of scripts/access-cost.py does not know (quotaChecker).
      cat > "$path" <<'CS'
public sealed class FlatHandler
{
    public async Task Handle(Command command, CancellationToken ct)
    {
        var configuration = await configurationRepository.GetConfiguration(command.Id, ct);
        var names = await configurationRepository.GetConfigurationNames(command.OrganizationId, ct);
        var allowed = await quotaChecker.HasAvailableQuota(command.OrganizationId, ct);
        configuration.Rename(command.Name, names, allowed);
        await configurationRepository.Save(configuration.DomainEvents, ct);
    }
}
CS
      ;;
    cs-loop)
      # One repository read per received identifier — the N+1 the COUT step must refuse.
      cat > "$path" <<'CS'
public sealed class LoopHandler
{
    public async Task Handle(Command command, CancellationToken ct)
    {
        var signatures = new List<Signature>();
        foreach (var id in command.SignatureIds)
        {
            signatures.Add(await signatureRepository.GetSignature(id, ct));
        }
        await signatureRepository.Save(signatures, ct);
    }
}
CS
      ;;
    cs-filter)
      # Whole table read, then filtered in memory.
      cat > "$path" <<'CS'
public sealed class FilterHandler
{
    public async Task<int> Handle(Query query, CancellationToken ct)
    {
        var open = (await configurationRepository.GetAll(ct)).Where(c => c.IsOpen).ToList();
        return open.Count;
    }
}
CS
      ;;
    *)
      # Sparse: one declaration every 40 lines, the rest statements.
      seq 1 "$lines" | awk 'NR%40==1{print "public class C"$1" { }"; next}{print "    var v"$1" = "$1";"}' > "$path" ;;
  esac
}

expand() {
  printf '%s' "$1" | sed -e "s|{{FIX}}|$FIX|g" -e "s|{{ROOT}}|$ROOT|g" -e "s|{{SID}}|$2|g"
}

jf() { printf '%s' "$1" | jq -r "$2"; }
jc() { printf '%s' "$1" | jq -c "$2"; }

ENVARGS=()

run_payload() {
  (cd "$ROOT" && printf '%s' "$2" | env ${ENVARGS[@]+"${ENVARGS[@]}"} bash "$ROOT/.claude/$1" 2>"$ERRF")
}

check() {
  local c="$1" out="$2" err="$3" rc="$4" fails=""
  local decision reason command prompt context want
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
  if [ -n "$want" ]; then
    if [ "$want" = "not_deny" ]; then
      [ "$decision" != "deny" ] || fails="$fails decision=deny"
    else
      [ "$decision" = "$want" ] || fails="$fails decision=$decision(want:$want)"
    fi
  fi
  want=$(jf "$c" '.expect.reason // empty')
  if [ -n "$want" ]; then case "$reason" in *"$want"*) ;; *) fails="$fails reason!~[$want]" ;; esac; fi
  want=$(jf "$c" '.expect.command // empty')
  if [ -n "$want" ]; then case "$command" in *"$want"*) ;; *) fails="$fails command!~[$want]" ;; esac; fi
  want=$(jf "$c" '.expect.command_absent // empty')
  if [ -n "$want" ]; then case "$command" in *"$want"*) fails="$fails command~[$want]" ;; esac; fi
  want=$(jf "$c" '.expect.prompt // empty')
  if [ -n "$want" ]; then case "$prompt" in *"$want"*) ;; *) fails="$fails prompt!~[$want]" ;; esac; fi
  want=$(jf "$c" '.expect.context // empty')
  if [ -n "$want" ]; then case "$context" in *"$want"*) ;; *) fails="$fails context!~[$want]" ;; esac; fi
  if [ "$(jf "$c" '.expect.no_context // false')" = "true" ]; then
    [ -z "$context" ] || fails="$fails context-present"
  fi
  want=$(jf "$c" '.expect.exit // empty')
  if [ -n "$want" ]; then [ "$rc" = "$want" ] || fails="$fails exit=$rc(want:$want)"; fi
  want=$(jf "$c" '.expect.stdout // empty')
  if [ -n "$want" ]; then case "$out" in *"$want"*) ;; *) fails="$fails stdout!~[$want]" ;; esac; fi
  want=$(jf "$c" '.expect.stderr // empty')
  if [ -n "$want" ]; then case "$err" in *"$want"*) ;; *) fails="$fails stderr!~[$want]" ;; esac; fi
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
        run_payload "$hook" "$(expand "$(jc "$c" ".pre[$p]")" "$sid")" >/dev/null 2>&1
        p=$((p + 1))
      done
      out=$(run_payload "$hook" "$(expand "$(jc "$c" '.input')" "$sid")"); rc=$?
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
[ "$FAILED" -eq 0 ]
