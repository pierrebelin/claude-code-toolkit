#!/bin/bash
# hook-timing — median wall time of the hot hooks on typical payloads. Maintainer tool, not shipped.
#
# Usage: bash dev/hook-timing.sh [-n N] [--kit DIR] [--preset NAME] [--out DIR] [--only REGEX] [spec.json ...]
#   -n N          runs per payload (20); the median is printed, in ms
#   --kit DIR     the kit copy whose hooks run (default: this checkout) — an old copy, to compare
#   --preset NAME preset of the fixture repo (clean-architecture)
#   --out DIR     also writes each payload's first output to DIR/<hook>--<payload>--<agent>.out, and any
#                 later run answering otherwise (the first run writes the scope cache, the next read it):
#                 two runs on two kit copies, then `diff -r`, is the byte-identical check of CLAUDE.md
#   --only REGEX  only the rows whose label matches
# Specs: dev/hook-timing/*.json — `hooks` run on every `payloads` entry (its tool_input) crossed with
# every `agents` entry (merged into the payload), on the `shape` payload. `{{ROOT}}`: the fixture repo,
# built fresh under /tmp (`git init`, nothing committed, `.claude/kit.config.json`, a handler, its rule sheet, a test, a
# 600-line source file, a transcript). Each run carries its own session id: the seen-files of the
# bound guards never turn a deny into a forced pass between runs.
set -u
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="$(cd "$HERE/.." && pwd)"
N=20 PRESET=clean-architecture OUT="" ONLY="" specs=()
while [ $# -gt 0 ]; do
  case "$1" in
    -n) N=$2; shift 2 ;;
    --kit) KIT="$(cd "$2" && pwd)"; shift 2 ;;
    --preset) PRESET=$2; shift 2 ;;
    --out) OUT=$2; mkdir -p "$OUT"; shift 2 ;;
    --only) ONLY=$2; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0" | sed -e 's/^# \{0,1\}//'; exit 0 ;;
    *) specs+=("$1"); shift ;;
  esac
done
[ "${#specs[@]}" -gt 0 ] || specs=("$HERE"/hook-timing/*.json)

TAG="ht-$$"
ROOT="/tmp/cctoolkit-$TAG"
trap 'rm -rf "$ROOT"; rm -f /tmp/claude-*"$TAG"* /tmp/cctoolkit-scope-*"$TAG"* 2>/dev/null' EXIT

# The fixture repo.
A="$ROOT/src/Acme.Application/Catalog/CreateProduct"
T="$ROOT/tests/Acme.UnitTests/Catalog"
mkdir -p "$ROOT/.claude" "$A" "$T"
printf '{"preset": "%s", "product": "Acme"}\n' "$PRESET" >"$ROOT/.claude/kit.config.json"
# Older than 2 s: the first run's Python writes the scope cache (lib/scope-cache.sh), the next ones read it.
perl -e 'utime(time - 60, time - 60, @ARGV)' "$ROOT/.claude/kit.config.json"
printf '# Fixture\n\nreadme\n' >"$ROOT/README.md"
printf 'public sealed class CreateProductCommandHandler { }\n' >"$A/CreateProductCommandHandler.cs"
printf '# CreateProduct\n\n## Business rules <!-- kit:rules -->\n\n<!-- kit:cols id,rule,outcome -->\n| ID | Rule | Exception / Outcome |\n|----|------|---------------------|\n| RM-01 | The name is unique | ProductNameAlreadyUsed |\n' >"$A/CLAUDE.md"
printf 'public sealed class CreateProductCommandHandlerTests\n{\n    [Fact]\n    [Trait("RM", "CreateProduct/RM-01")]\n    public void Rejects() { }\n}\n' >"$T/CreateProductCommandHandlerTests.cs"
seq 1 600 | awk 'NR%40==1{print "public class C"$1" { }"; next}{print "    var v"$1" = "$1";"}' >"$ROOT/src/Big.cs"
for i in 1 2 3 4 5 6 7 8; do
  printf '{"type":"assistant","message":{"id":"m%s","content":[{"type":"tool_use","id":"t%s","name":"Bash","input":{}}]}}\n' "$i" "$i"
done >"$ROOT/.transcript.jsonl"
git -C "$ROOT" init -q
ROOTN=$ROOT
kit_path ROOTN

# Claude Code starts a hook from its own environment, not from a shell that already loaded platform.sh.
CLEAN=(env -u _KIT_PLATFORM -u CCTOOLKIT_PYTHON -u PYTHONPATH -u PYTHONUTF8 -u PYTHONIOENCODING
  -u 'BASH_FUNC_kit_path%%' -u 'BASH_FUNC_python3%%' -u 'BASH_FUNC_jq%%' -u CLAUDE_DOTNET_TEST_TIMEOUT)

now_us() { local t=$EPOCHREALTIME; t=${t/[.,]/}; printf '%s' "$((10#$t))"; }

printf '%-62s %8s\n' "hook / payload / agent" "median ms"
for spec in "${specs[@]}"; do
  hooks=$(jq -r '.hooks[]' "$spec")
  payloads=$(jq -r '.payloads | keys_unsorted[]' "$spec")
  agents=$(jq -r '.agents | keys_unsorted[]' "$spec")
  for hook in $hooks; do
    for p in $payloads; do
      for a in $agents; do
        label="$(basename "$hook" .sh) / $p / $a"
        [ -z "$ONLY" ] || [[ $label =~ $ONLY ]] || continue
        tpl=$(jq -c --arg p "$p" --arg a "$a" '.shape * {tool_input: .payloads[$p]} * .agents[$a]' "$spec" | sed "s|{{ROOT}}|$ROOTN|g")
        times=()
        for ((i = 0; i < N; i++)); do
          payload=$(printf '%s' "$tpl" | jq -c --arg s "$TAG-$p-$a-$i" '. + {session_id: $s}')
          t0=$(now_us)
          out=$(cd "$ROOT" && printf '%s' "$payload" | "${CLEAN[@]}" CLAUDE_PROJECT_DIR="$ROOTN" bash "$KIT/$hook" 2>/dev/null)
          t1=$(now_us)
          times+=($(((t1 - t0) / 1000)))
          if [ -n "$OUT" ]; then
            f="$OUT/$(basename "$hook" .sh)--$p--$a.out"
            if [ "$i" -eq 0 ]; then
              first=$out
              printf '%s\n' "${out//$ROOTN/<ROOT>}" >"$f"
            elif [ "$out" != "$first" ]; then
              printf 'run %s answers otherwise:\n%s\n' "$i" "${out//$ROOTN/<ROOT>}" >>"$f"
            fi
          fi
        done
        median=$(printf '%s\n' "${times[@]}" | sort -n | awk '{v[NR]=$1} END {print (NR % 2) ? v[(NR+1)/2] : int((v[NR/2] + v[NR/2+1]) / 2)}')
        printf '%-62s %8s\n' "$label" "$median"
      done
    done
  done
done
