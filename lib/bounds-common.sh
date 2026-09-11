#!/bin/bash
# Shared body of the two bound guards: hooks/read-bounds.sh (Read tool) and
# lib/guard-cat-bounds.sh (bare `cat` through the Bash dispatcher).
#
# Extracted 2026-09-11. The two hooks carried ~45 duplicated lines — the same
# threshold, the same skip lists, the same outline block (9 lines identical down
# to the regexes, differing only in the name of the variable holding the path) and
# the same refusal shape. Cost was never the point; divergence was, and it had
# already happened: guard-cat-bounds skipped `.zip` and `.nupkg`, read-bounds did
# not, so a `cat` of a package passed while a `Read` of the same file was denied
# and handed a text outline of a binary. Nothing compared the two files, so
# nothing reported it. The union is kept below — the wider list is the right one.
#
# Sourced, not executed. Callers keep what genuinely differs: the tool named in
# the refusal, the sentence that tells the caller how to read a range, and the
# sentence that tells it how to force. Everything a fix would have to be applied
# to twice lives here.
set -u

BOUNDS_THRESHOLD=${CLAUDE_READ_BOUNDS_THRESHOLD:-120}
BOUNDS_BYTES=${CLAUDE_CAT_BOUNDS_BYTES:-8000}
BOUNDS_OUTLINE_MAX=${CLAUDE_READ_BOUNDS_OUTLINE:-40}
BOUNDS_FLAT_PCT=${CLAUDE_BOUNDS_FLAT_PCT:-33}

bounds_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# Binary or rendered: the tool reads them natively and an outline of one is noise.
bounds_is_binary() {
  case "$(bounds_lower "$1")" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.bmp|*.svg|*.pdf|*.ipynb|*.zip|*.nupkg) return 0 ;;
  esac
  return 1
}

# Instruction files: read whole or not at all. A skill, an agent definition, a
# layer rule or a handler CLAUDE.md carries conventions that only hold as a set —
# half of one is worse than none, because nothing tells the reader which half it
# missed. The collision was structural, not occasional: a test skill runs past 130
# lines and implement-tdd/SKILL.md past 190. The files tdd-test-author and the
# orchestrator are *required* to read were denied on every run since the threshold
# moved to 120, then forced on the next turn. One turn burnt per run, zero context
# saved.
#
# Matched on the directory name rather than a `.claude/` prefix: this toolkit
# keeps its skills, agents and rules at the root, and `cat` is usually handed a
# relative path where `Read` is always handed an absolute one.
bounds_is_instruction() {
  case "$1" in
    */skills/*.md|*/agents/*.md|*/rules/*.md|*/CLAUDE.md|CLAUDE.md) return 0 ;;
  esac
  return 1
}

bounds_skip() {
  bounds_is_binary "$1" && return 0
  bounds_is_instruction "$1" && return 0
  return 1
}

# The declarations of a file, line-numbered. Shipped with the refusal because a
# denial that only names the alternative makes re-issuing the shortest path, so
# re-issuing is what happens — measured 2026-09-10, 6 denials for 6 verbatim
# re-issues and 1210 lines of context files loaded whole. With the map, the
# bounded read costs the same single turn as forcing.
bounds_outline() {
  local file=$1 outline_re
  case "$(bounds_lower "$file")" in
    *.cs)   outline_re='^[[:space:]]*(public|internal|protected|private|\[Fact|\[Theory|namespace |.*(class|record|interface|enum) )' ;;
    *.ts|*.tsx|*.js|*.jsx) outline_re='^[[:space:]]*(export|function |class |const [A-Za-z_]+ = |describe\(|it\(|test\()' ;;
    *.md)   outline_re='^#{1,4} ' ;;
    *.json) outline_re='^[[:space:]]{0,4}"[^"]+"[[:space:]]*:' ;;
    *)      outline_re='^[^[:space:]#]' ;;
  esac
  grep -nE "$outline_re" "$file" 2>/dev/null | head -"$BOUNDS_OUTLINE_MAX" | cut -c1-160
}

# A flat file: its declarations alone weigh a third of it. There is nothing to
# skip, so the bounded read takes almost all of it back and the outline is paid
# on top. Measured 2026-09-11 over the 73 denied files still on disk: 9 hits,
# every one a fixture, a builder or a mock under 13 kB. The episode that prompted
# it — TransferOwnershipKeysetFixture.cs, 131 lines / 5025 B — cost 1779 B of
# outline plus a 3355 B bounded read over two turns, against 5025 B in one.
#
# Density, not size and not the name. A byte floor was tried first and rejected
# on the same corpus: 8 kB would have lifted 23 denials, 17 of them on sparse
# files that did have ranges worth skipping. Exempting `*Fixture|*Builder|Mock*`
# by name was rejected too — the family runs from 5 kB to 30 kB, and the largest
# of them sits at 8 % density, exactly the case the guard exists for. The same
# fixture grown past ~15 kB falls back under 20 %: long method bodies reappear,
# ranges exist again, and the guard is worth its turn.
#
# Called from the two hooks *after* their size test, not from bounds_skip: this
# runs a grep, and the hot path is the small file that the size test already lets
# through.
bounds_is_flat() {
  local bytes outline_bytes
  bytes=$(wc -c < "$1" 2>/dev/null | tr -d ' ')
  [ "${bytes:-0}" -gt 0 ] || return 1
  outline_bytes=$(bounds_outline "$1" | wc -c | tr -d ' ')
  [ $(( ${outline_bytes:-0} * 100 )) -ge $(( bytes * BOUNDS_FLAT_PCT )) ]
}

# Builds the whole refusal.
#   $1 header       "Unbounded Read on <path> (N lines > T). ..."
#   $2 path         the file the outline is computed from
#   $3 with_map     what to do given the outline ("Read the range you need ...")
#   $4 without_map  what to do when no outline could be produced
#   $5 force        how to force the full read
bounds_reason() {
  local header=$1 file=$2 with_map=$3 without_map=$4 force=$5 outline
  outline=$(bounds_outline "$file")
  if [ -n "$outline" ]; then
    printf '%s Its declarations, line-numbered — %s:\n\n%s\n\n%s\n' \
      "$header" "$with_map" "$outline" "$force"
  else
    printf '%s %s\n\n%s\n' "$header" "$without_map" "$force"
  fi
}
