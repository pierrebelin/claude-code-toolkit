#!/bin/bash
# bump — set one version on every plugin of the marketplace. Maintainer tool.
# The kit and its mods share a single version: `bash dev/bump.sh 1.7.0`.
set -eu
# Native Windows (Git Bash outside Claude Code): `jq -b` writes no CRLF, `python3` is a real Python.
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
ver=${1:?usage: bash dev/bump.sh <version>}
[[ $ver =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a version: $ver" >&2; exit 2; }
jq -r '.plugins[].source' .claude-plugin/marketplace.json | while read -r source; do
  dir=${source#./}; [ "$dir" = . ] && dir=""
  manifest="${dir:+$dir/}.claude-plugin/plugin.json"
  tmp=$(mktemp); jq --arg v "$ver" '.version = $v' "$manifest" >"$tmp" && mv "$tmp" "$manifest"
  echo "$manifest → $ver"
done
