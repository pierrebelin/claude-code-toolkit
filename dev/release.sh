#!/bin/bash
# release — tag every plugin of the marketplace and publish the GitHub release of the
# committed version. Maintainer tool: not shipped as a `cctoolkit` command.
#
#   bash dev/release.sh            tags, push, wait for CI on the kit tag, GitHub release
#   bash dev/release.sh --no-wait  tags and push only; rerun later to publish the release
#
# Why not `claude plugin tag`. It names the tag after the plugin.json of the working tree,
# not of the commit: a version bumped and not yet committed (another session's) names the
# tag of HEAD wrongly (2.23.1, tagged `cctoolkit--v2.24.0`). Everything here reads HEAD:
# the version, the CHANGELOG section, the commit tagged. Local changes are never looked at.
#
# Stops before tagging when: HEAD's plugin.json versions differ, CHANGELOG.md at HEAD has no
# section for the version, HEAD is not on its upstream branch (push first), or a tag of that
# version already points at another commit. A tag already on HEAD is kept (the script reruns).
# The release is created once the CI run of the tag's commit is green (`.github/workflows/ci.yml`),
# never on red; its notes are the version's CHANGELOG section. Steps 3 and 4 of CLAUDE.md
# § Releasing.
set -eu
# Native Windows (Git Bash outside Claude Code): `jq -b` writes no CRLF, `python3` is a real Python.
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"
cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
command -v jq >/dev/null || { echo "jq missing" >&2; exit 2; }
command -v gh >/dev/null && gh auth status >/dev/null 2>&1 || { echo "gh missing or not authenticated" >&2; exit 2; }
wait_ci=1
case "${1:-}" in
  --no-wait) wait_ci=0 ;;
  "") ;;
  *) echo "usage: bash dev/release.sh [--no-wait]" >&2; exit 2 ;;
esac

sha=$(git rev-parse HEAD)
plugins=$(git show HEAD:.claude-plugin/marketplace.json | jq -r '.plugins[] | [.name, .source] | @tsv')

# One version at HEAD, every plugin.json alike.
ver=""
while IFS=$'\t' read -r name source; do
  dir=${source#./}; [ "$dir" = . ] && dir=""
  v=$(git show "HEAD:${dir:+$dir/}.claude-plugin/plugin.json" | jq -r '.version // empty')
  [ -n "$v" ] || { echo "$name: no version in its plugin.json at HEAD" >&2; exit 1; }
  [ -z "$ver" ] || [ "$v" = "$ver" ] || { echo "versions differ at HEAD: $name $v, others $ver — bash dev/bump.sh, commit" >&2; exit 1; }
  ver=$v
done <<<"$plugins"

notes=$(git show HEAD:CHANGELOG.md | awk -v h="## $ver " 'index($0, h) == 1 {p = 1; next} /^## / {p = 0} p' | sed '/./,$!d')
[ -n "$notes" ] || { echo "no '## $ver — …' section in CHANGELOG.md at HEAD" >&2; exit 1; }

# The tagged commit is on the remote branch: a tag never carries unpushed work alone.
git fetch -q origin
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null) || { echo "no upstream branch: push first" >&2; exit 1; }
git merge-base --is-ancestor HEAD "$upstream" || { echo "HEAD ${sha:0:12} not on $upstream: push first" >&2; exit 1; }

echo "release $ver at ${sha:0:12} — $(git log -1 --format=%s HEAD | cut -c1-80)"
# Every tag checked before any is created: a refusal leaves no tag behind.
while IFS=$'\t' read -r name _; do
  tag="$name--v$ver"
  at=$(git rev-parse -q --verify "refs/tags/$tag^{commit}" || git ls-remote origin "refs/tags/$tag^{}" | cut -f1)
  if [ -n "$at" ] && [ "$at" != "$sha" ]; then
    echo "$tag already points at ${at:0:12}, not HEAD: bump to a new version" >&2; exit 1
  fi
done <<<"$plugins"
tags=()
while IFS=$'\t' read -r name _; do
  tag="$name--v$ver"
  if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    git tag -a "$tag" -m "$name $ver" "$sha"
    echo "  tagged $tag"
  fi
  tags+=("refs/tags/$tag")
done <<<"$plugins"
git push -q origin "${tags[@]}"
echo "  pushed ${#tags[@]} tag(s)"

kit_tag="cctoolkit--v$ver"
if gh release view "$kit_tag" >/dev/null 2>&1; then echo "  GitHub release $kit_tag exists"; exit 0; fi
[ "$wait_ci" = 1 ] || { echo "  no GitHub release yet: rerun once CI is green on ${sha:0:12}"; exit 0; }

# CI of the tag's commit: a green run of the branch push counts as well as the tag's own.
state=none
for _ in $(seq 1 60); do
  runs=$(gh run list --workflow ci.yml --commit "$sha" --json status,conclusion -L 20 2>/dev/null || echo '[]')
  state=$(jq -r 'if any(.[]; .conclusion == "success") then "success"
    elif any(.[]; .status != "completed") or length == 0 then "pending" else "failure" end' <<<"$runs")
  [ "$state" = pending ] || break
  sleep 30
done
case $state in
  success) ;;
  failure) echo "  CI red on ${sha:0:12}: no release — fix, bump, release again" >&2; exit 1 ;;
  *) echo "  CI not finished after 30 min on ${sha:0:12}: rerun later" >&2; exit 1 ;;
esac
gh release create "$kit_tag" --verify-tag --title "cctoolkit $ver" --notes "$notes" >/dev/null
echo "  GitHub release $kit_tag created"
