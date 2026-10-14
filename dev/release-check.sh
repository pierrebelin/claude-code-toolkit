#!/bin/bash
# release-check — run before pushing. Maintainer tool: not shipped as a
# `cctoolkit` command, never run in an installed repo.
#
# Why. Claude Code pins an installed plugin to the `version` of its plugin.json:
# a push that changes shipped files under the same version never reaches the
# users who already installed it. The kit and its mods share one version:
#   FAIL  a plugin.json whose version differs from the others (`bash dev/bump.sh`)
# Then, for each plugin of the marketplace:
#   FAIL  shipped files changed since the current version was released
#   FAIL  a pending version whose release changes rules, with no
#         "Rules changed" in its CHANGELOG section; same for the preset
#         skills and "Skills changed" (both copied into repos by kit-init)
#   TODO  a version committed but not tagged yet: `claude plugin tag --push <dir>`
#   TODO  the kit's tag without its GitHub release (one per version, the mods
#         share it): `gh release create cctoolkit--v<version>`; skipped without `gh`
#   OK    otherwise
# A version is released at its tag `<name>--v<version>`, or, before tags existed,
# at the commit that introduced it. Exit 1 on any FAIL.
set -u
cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || exit 2
command -v jq >/dev/null || { echo "FAIL  jq missing"; exit 2; }

# Shipped paths per plugin: what changes behaviour once installed.
KIT_PATHS="skills agents hooks lib scripts tools presets rules templates workflows bin"
RULE_PATHS="rules presets/*/rules"
SKILL_PATHS="presets/*/skills"

fail=0
versions=$(jq -r '.plugins[].source' .claude-plugin/marketplace.json | while read -r source; do
  dir=${source#./}; [ "$dir" = . ] && dir=""
  printf '%s\t%s\n' "$(jq -r '.version // empty' "${dir:+$dir/}.claude-plugin/plugin.json")" "${dir:-.}"
done)
if [ "$(cut -f1 <<<"$versions" | sort -u | wc -l)" -gt 1 ]; then
  echo "FAIL  versions differ — one version for every plugin: bash dev/bump.sh <version>"
  sed $'s/^/        /; s/\t/  /' <<<"$versions"
  fail=1
fi
changed_since() { # <ref> <paths…> — committed, staged, unstaged and untracked
  local ref=$1; shift
  { git diff --name-only "$ref" -- "$@"; git ls-files --others --exclude-standard -- "$@"; } | sort -u
}
release_ref() { # <name> <version> <manifest> — tag, else the commit introducing the version
  local tag="$1--v$2"
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then echo "$tag"; return; fi
  git log -1 --format=%H -S"\"version\": \"$2\"" -- "$3"
}

while IFS=$'\t' read -r name source; do
  dir=${source#./}; [ "$dir" = . ] && dir=""
  manifest="${dir:+$dir/}.claude-plugin/plugin.json"
  if [ -z "$dir" ]; then paths=$KIT_PATHS; else paths="$dir"; fi
  ver=$(jq -r '.version // empty' "$manifest")
  committed=$(git show "HEAD:$manifest" 2>/dev/null | jq -r '.version // empty')
  [ -n "$ver" ] || { echo "FAIL  $name: no version in $manifest"; fail=1; continue; }

  base=$(release_ref "$name" "$committed" "$manifest")
  # shellcheck disable=SC2086
  files=$(changed_since "$base" $paths | grep -v -e '/screenshots/' -e 'README.md$' -e '\.claude-plugin/plugin.json$')

  if [ "$ver" = "$committed" ]; then
    if [ -n "$files" ]; then
      echo "FAIL  $name $ver: shipped files changed since its release (${base:0:12}) — bump the version in $manifest"
      printf '        %s\n' $files | head -10
      fail=1
    elif ! git rev-parse -q --verify "refs/tags/$name--v$ver" >/dev/null; then
      echo "TODO  $name $ver: not tagged — claude plugin tag --push ${dir:-.}"
    elif [ -z "$dir" ] && command -v gh >/dev/null && gh auth status >/dev/null 2>&1 \
      && ! gh release view "$name--v$ver" >/dev/null 2>&1; then
      echo "TODO  $name $ver: no GitHub release — gh release create $name--v$ver --verify-tag --title \"$name $ver\" (notes: its CHANGELOG section)"
    else
      echo "OK    $name $ver"
    fi
    continue
  fi

  # Pending version: what its release changes.
  section=$(awk -v h="## $ver " 'index($0, h) == 1 {p = 1; next} /^## / {p = 0} p' CHANGELOG.md 2>/dev/null)
  [ -n "$section" ] || { echo "FAIL  $name $ver: no '## $ver — …' section in CHANGELOG.md"; fail=1; continue; }
  if [ -z "$dir" ]; then
    # shellcheck disable=SC2086
    rules=$(changed_since "$base" $RULE_PATHS)
    if [ -n "$rules" ] && ! grep -q 'Rules changed' <<<"$section"; then
      echo "FAIL  $name $ver: rules changed, CHANGELOG section has no 'Rules changed'"
      printf '        %s\n' $rules
      fail=1; continue
    fi
    # shellcheck disable=SC2086
    skills=$(changed_since "$base" $SKILL_PATHS)
    if [ -n "$skills" ] && ! grep -q 'Skills changed' <<<"$section"; then
      echo "FAIL  $name $ver: preset skills changed, CHANGELOG section has no 'Skills changed'"
      printf '        %s\n' $skills | head -10
      fail=1; continue
    fi
  fi
  next="claude plugin tag --push ${dir:-.}"; [ -z "$dir" ] && next="$next, then its GitHub release"
  echo "OK    $name $committed → $ver (pending: commit, then $next)"
done < <(jq -r '.plugins[] | [.name, .source] | @tsv' .claude-plugin/marketplace.json)

exit $fail
