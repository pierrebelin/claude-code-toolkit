#!/bin/bash
# knowledge-pane-demo — the `/knowledge-pane demo` base is the kit example. Maintainer tool.
#
# Why. Installed, the mod cannot reach `examples/` of the kit: it ships its own copy
# under `mods/knowledge-pane/demo/` (a repo: `.claude/kit.config.json`, `docs/business/`
# with the index the example gives, and a staged merge `.merge/PRD-DUP/` of its own).
#   bash dev/knowledge-pane-demo.sh           copies the example again and rebuilds the index
#   bash dev/knowledge-pane-demo.sh --check   writes nothing: exit 1 and a FAIL line when the
#                                             copy or its index lags; run by dev/release-check.sh
set -u
# Native Windows (Git Bash outside Claude Code): `jq -b` writes no CRLF, `python3` is a real Python.
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || exit 2
src=examples/docs/business
demo=mods/knowledge-pane/demo
base=$demo/docs/business
check=${1:-}
[ "$check" = "" ] || [ "$check" = --check ] || { echo "usage: bash dev/knowledge-pane-demo.sh [--check]" >&2; exit 2; }
command -v python3 >/dev/null || { echo "FAIL  python3 missing: the demo index cannot be checked"; exit 2; }

index() { # <repo> — the index the example gives, in <repo>/docs/business/.index/
  rm -rf "$1/docs/business/.index"
  CLAUDE_PROJECT_DIR=$1 python3 scripts/knowledge-index.py >/dev/null || return 1
  rm -f "$1/docs/business/.index/files.json"
}

if [ "$check" = --check ]; then
  if ! diff -rq -x .index -x .merge "$src" "$base" >/dev/null 2>&1; then
    echo "FAIL  $base differs from $src — bash dev/knowledge-pane-demo.sh"
    exit 1
  fi
  tmp=$(mktemp -d)
  cp -R "$demo/." "$tmp/"
  if ! index "$tmp" || ! cmp -s "$tmp/docs/business/.index/knowledge.jsonl" "$base/.index/knowledge.jsonl"; then
    rm -rf "$tmp"
    echo "FAIL  $base/.index/knowledge.jsonl is not what $src gives — bash dev/knowledge-pane-demo.sh"
    exit 1
  fi
  rm -rf "$tmp"
  exit 0
fi

find "$base" -mindepth 1 -maxdepth 1 ! -name .merge -exec rm -rf {} + || exit 1
cp -R "$src/." "$base/" || { echo "FAIL  copy of $src into $base" >&2; exit 1; }
index "$demo" || { echo "FAIL  knowledge-index on $demo" >&2; exit 1; }
# knowledge-index rewrites INDEX.md when it lags: the example's own copy is then the one to fix.
if ! cmp -s "$src/INDEX.md" "$base/INDEX.md"; then
  echo "FAIL  $src/INDEX.md is not what knowledge-index gives — cp $base/INDEX.md $src/INDEX.md, then run this again" >&2
  exit 1
fi
echo "$base: copied from $src, index rebuilt"
