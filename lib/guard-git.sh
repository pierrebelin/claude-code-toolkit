#!/bin/bash
# bash-dispatch module — hard ban on mutating Git commands.
# Covers what a `permissions.deny` prefix misses: `rtk git`, `git -C x`, `git --no-pager`,
# `cd x && git`, `env FOO=1 git`, `(git …)`, `bash -c 'git …'`, `/usr/bin/git`.
# Reads $HOOK_CMD, prints the hook JSON when it decides.
set -u

cmd="${HOOK_CMD:-}"
[ -n "$cmd" ] || exit 0

# Fast bail-out: no `git` anywhere, nothing to judge.
case "$cmd" in *git*) ;; *) exit 0 ;; esac

# One segment per line: every command of a chain is judged on its own, so a read-only
# segment never lets a mutating one through. `2>&1` and `&>` go first, they are no separator.
s=${cmd//[0-9]>&[0-9]/}
s=${s//&>/>}
s=${s//'&&'/$'\n'}
s=${s//'||'/$'\n'}
s=${s//;/$'\n'}
s=${s//|/$'\n'}
s=${s//&/$'\n'}

# Normalisation, per line: strip whatever sits before the git verb (subshell, keyword,
# wrapper, assignment, `sh -c`, a path to git), then git's global options, then output
# redirections — so every form collapses to "git <verb> <args>".
norm=$(printf '%s\n' "$s" | sed -E \
  -e ':a' \
  -e 's/^[[:space:]]+//' \
  -e 's/^([({!`]|\$\()[[:space:]]*//;ta' \
  -e 's/^(if|then|else|elif|do|while|until|time|nohup|exec|command|builtin|rtk|proxy|bypass|env)[[:space:]]+//;ta' \
  -e 's/^sudo([[:space:]]+(-[ugCDhpRrT][[:space:]]+[^[:space:]]+|-[^[:space:]]+))*[[:space:]]+//;ta' \
  -e 's/^(timeout|nice|stdbuf)([[:space:]]+-[^[:space:]]+)*([[:space:]]+[0-9][^[:space:]]*)?[[:space:]]+//;ta' \
  -e 's/^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+//;ta' \
  -e "s/^[a-z]*sh[[:space:]]+-c[[:space:]]+['\"]?//;ta" \
  -e 's#^[^[:space:]]*/git([[:space:]]|$)#git\1#;ta' \
  -e ':b' \
  -e 's/^git[[:space:]]+((-C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)([[:space:]]+|=)[^[:space:]]+|-C[^[:space:]]+|--no-pager|-P|-p|--paginate|--bare|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-lazy-fetch|--exec-path(=[^[:space:]]+)?)([[:space:]]+|$)/git /;tb' \
  -e 's/[[:space:]]+[0-9]*>>?[[:space:]]*[^[:space:]]+//g' \
  -e "s/[[:space:]\\)}'\"\`]+\$//")

# Read-only forms of a mutating verb; the regex covers the segment to its end.
READONLY="^git[[:space:]]+(\
(worktree[[:space:]]+list([[:space:]]+(--porcelain|-v|--verbose))*)|\
(branch([[:space:]]+(-l|--list|-a|--all|-r|--remotes|-v|-vv|--show-current|--merged|--no-merged))*)|\
(remote([[:space:]]+(-v|--verbose|show|get-url([[:space:]]+[^[:space:]]+)?))*)|\
(stash[[:space:]]+(list|show)([[:space:]]+[^[:space:]]+)*)|\
(tag[[:space:]]+(-l|--list)([[:space:]]+[^[:space:]]+)*)|\
(reflog([[:space:]]+show)?([[:space:]]+[^[:space:]-][^[:space:]]*)*)\
)$"
# Worktree hand-back (`add -N` then `diff HEAD`, `git apply` here): it modifies the local
# working tree without creating a commit, so it asks even where the repo denies mutations.
HANDBACK='^git[[:space:]]+(add[[:space:]]+([^[:space:]]+[[:space:]]+)*(-N|--intent-to-add)([[:space:]]|$)|apply([[:space:]]|$))'
# `am` stays denied: it applies AND commits.
MUTATING='^git[[:space:]]+(add|am|branch|checkout|cherry-pick|clean|commit|filter-branch|merge|mv|pull|push|rebase|reflog|remote|reset|restore|revert|rm|stash|switch|tag|update-ref|worktree)([[:space:]]|$)'

verb=""
handback=0
while IFS= read -r seg; do
  [[ $seg =~ ^git[[:space:]] ]] || continue
  [[ $seg =~ $READONLY ]] && continue
  if [[ $seg =~ $HANDBACK ]]; then handback=1; continue; fi
  if [[ $seg =~ $MUTATING ]]; then verb=${BASH_REMATCH[1]}; break; fi
done <<<"$norm"

[ -n "$verb" ] || [ "$handback" = 1 ] || exit 0

# `git.mutations` of the repo's kit.config.json: "deny" (default), "ask" or "allow". Read with jq
# on this path only, never on a passing command. A worktree without its own config
# (kit.config.json left unversioned) falls back on the main checkout's.
. "${BASH_SOURCE[0]%/*}/project-root.sh"
cfg="$PROJECT_ROOT/.claude/kit.config.json"
if [ ! -f "$cfg" ]; then
  common=$(git -C "$PROJECT_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=""
  [ -z "$common" ] || cfg="${common%/.git}/.claude/kit.config.json"
fi
mode=$(jq -r '.git.mutations // "deny"' "$cfg" 2>/dev/null) || mode=deny

# "allow": the agent may run any Git command, the guard answers nothing — hand-back included.
[ "$mode" != allow ] || exit 0

if [ -z "$verb" ]; then
  jq -n --arg r "Worktree hand-back: this command modifies the local working tree without creating a commit. Check the target before approving." \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
fi
if [ "$mode" = ask ]; then
  jq -n --arg v "$verb" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: ("git " + $v + " modifies the repository: this repo sets git.mutations to ask in kit.config.json, so the user approves each mutating Git command. Check the target before approving.")}}'
  exit 0
fi
jq -n --arg v "$verb" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ("git " + $v + " blocked: this repo forbids any Git mutation by an agent. The user decides when to commit, branch or push. Reading is allowed (status, log, diff, show). If the command is genuinely needed, ask the user to run it themselves with the ! prefix.")}}'
exit 0
