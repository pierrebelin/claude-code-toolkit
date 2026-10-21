#!/bin/bash
# Shared body of the two bound guards: hooks/read-bounds.sh (Read) and
# lib/guard-cat-bounds.sh (bare `cat` via the Bash dispatcher). Sourced, not executed.
# Callers keep the tool named in the refusal and the range/force sentences.
set -u

BOUNDS_THRESHOLD=${CLAUDE_READ_BOUNDS_THRESHOLD:-120}
BOUNDS_BYTES=${CLAUDE_CAT_BOUNDS_BYTES:-8000}
BOUNDS_OUTLINE_MAX=${CLAUDE_READ_BOUNDS_OUTLINE:-40}
BOUNDS_FLAT_PCT=${CLAUDE_BOUNDS_FLAT_PCT:-33}

# A subagent gets a higher bar; the main chain keeps 120.
BOUNDS_SUBAGENT_THRESHOLD=${CLAUDE_READ_BOUNDS_SUBAGENT_THRESHOLD:-400}
BOUNDS_SUBAGENT_BYTES=${CLAUDE_READ_BOUNDS_SUBAGENT_BYTES:-24000}

# Third way out after the bounded read and the forcing: ask the one-shot worker.
BOUNDS_BULK_READ="A question about the file rather than an edit (what it does, which rules, which dependencies): cctoolkit bulk-read --question \"...\" --paths <file> — one-shot haiku worker, ~500 fixed tokens, the file never enters this context."

# Extensions match case-insensitively without a fork: nocasematch around the `case`, restored after.
bounds_nocase() { shopt -q nocasematch && _bounds_nc=1 || _bounds_nc=""; shopt -s nocasematch; }
bounds_case() { [ -n "$_bounds_nc" ] || shopt -u nocasematch; }

# Binary or rendered: the tool reads them natively and an outline of one is noise.
bounds_is_binary() {
  local r=1
  bounds_nocase
  case "$1" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.bmp|*.svg|*.pdf|*.ipynb|*.zip|*.nupkg) r=0 ;;
  esac
  bounds_case
  return $r
}

# Instruction files (skill, agent, rule, CLAUDE.md) are read whole or not at all.
# Matched on the directory name: `cat` usually gets a relative path, `Read` an absolute one.
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

# The declarations of a file, line-numbered, shipped with the refusal.
bounds_outline() {
  local file=$1 outline_re
  bounds_nocase
  case "$file" in
    *.cs)   outline_re='^[[:space:]]*(public|internal|protected|private|\[Fact|\[Theory|namespace |.*(class|record|interface|enum) )' ;;
    *.ts|*.tsx|*.js|*.jsx) outline_re='^[[:space:]]*(export|function |class |const [A-Za-z_]+ = |describe\(|it\(|test\()' ;;
    *.md)   outline_re='^#{1,4} ' ;;
    *.json) outline_re='^[[:space:]]{0,4}"[^"]+"[[:space:]]*:' ;;
    *)      outline_re='^[^[:space:]#]' ;;
  esac
  bounds_case
  grep -nE "$outline_re" "$file" 2>/dev/null | head -"$BOUNDS_OUTLINE_MAX" | cut -c1-160
}

# A flat file: its declarations alone weigh BOUNDS_FLAT_PCT % of it, so a bounded
# read saves nothing. Called after the size test, not from bounds_skip: it runs a grep.
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
    printf '%s Its declarations, line-numbered — %s:\n\n%s\n\n%s\n%s\n' \
      "$header" "$with_map" "$outline" "$force" "$BOUNDS_BULK_READ"
  else
    printf '%s %s\n\n%s\n%s\n' "$header" "$without_map" "$force" "$BOUNDS_BULK_READ"
  fi
}

# The knowledge base's rules.md, decisions.md and HISTORY.md: read through `cctoolkit ask`
# whatever their size. Basename filtered first so python3 runs for those names only.
# knowledge-extractor rewrites them in its staging: exempt.
#   $1 path        absolute (Read) or relative to the cwd (cat)
#   $2 agent_type  the payload's, empty on the main chain
bounds_knowledge_guarded() {
  case "$1" in
    */rules.md|*/decisions.md|*/HISTORY.md|rules.md|decisions.md|HISTORY.md) ;;
    *) return 1 ;;
  esac
  case "${2:-}" in *knowledge-extractor) return 1 ;; esac
  python3 "${BASH_SOURCE[0]%/*}/knowledge.py" guarded "$1" 2>/dev/null
}

# The refusal of a whole read of one of those files.
#   $1 verb   "Read" or "cat", named in the refusal
#   $2 path   the file
#   $3 range  how to read the lines around one id ("Read with offset/limit")
#   $4 force  how to force the full read
bounds_knowledge_reason() {
  local verb=$1 file=$2 range=$3 force=$4 ctx
  ctx=$(cd "$(dirname "$file")" 2>/dev/null && basename "$PWD")
  printf '%s' "Whole $verb of $file refused: the knowledge base's rules.md, decisions.md and HISTORY.md are read through cctoolkit ask, whatever their size. cctoolkit ask \"<question>\" --context $ctx (ranked cards), --id <id> (one object whole), --context $ctx alone (the context's summary), --history --context $ctx (its HISTORY.md rows). A range around one id: grep -n '<id>' $file, then $range. $force"
}
