#!/bin/bash
# bash-dispatch module — hard ban on mutating Git commands.
#
# CLAUDE.md states "Never commit to Git", but an instruction is advisory:
# nothing enforces it. This module makes it deterministic.
#
# Covers the forms `permissions.deny` misses, because it matches on a
# literal prefix:
#   rtk git commit ...            (the rtk rewrite routes everything through rtk)
#   git -C /other/repo commit ... (global option before the verb)
#   cd /elsewhere && git push     (cd prefix)
#   env FOO=1 git add .
#
# Contract: reads $HOOK_CMD, prints the hook JSON when it decides, nothing when
# it passes. Runs first in the chain — a deny is terminal.
set -u

cmd="${HOOK_CMD:-}"
[ -n "$cmd" ] || exit 0

# Normalisation: strip whatever sits between the start of the command and the
# git verb, so every form collapses to "git <verb>".
norm=$(printf '%s' "$cmd" \
  | sed -E 's/(^|[;&|][[:space:]]*)cd[[:space:]]+[^&;|]+&&[[:space:]]*/\1/g' \
  | sed -E 's/(^|[;&|][[:space:]]*)(rtk|command|sudo)[[:space:]]+/\1/g' \
  | sed -E 's/(^|[;&|][[:space:]]*)(env[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*/\1/g' \
  | sed -E 's/(^|[[:space:]])git[[:space:]]+((-C|-c|--git-dir|--work-tree|--namespace|--exec-path)[[:space:]]*=?[[:space:]]*[^[:space:]]+[[:space:]]+)*/\1git /g')

# --- Exception: bringing a worktree back onto the local branch ---
#
# ExitWorktree transfers nothing (keep or remove, never a merge). The
# commit-free flow is: capture the worktree diff, apply it here.
#
#   git -C <worktree> add -N .          # makes new files visible to the diff
#   git -C <worktree> diff HEAD > p     # read, already allowed
#   git apply p                         # applies into the working tree, no commit
#
# Those two verbs fall through to "ask": the user sees the command and decides.
# `add -N` (--intent-to-add) records the path without the content — it stages
# nothing committable, and `commit` stays denied regardless.
ASK_REASON="Worktree hand-back: this command modifies the local working tree without creating a commit. Check the target before approving."

if printf '%s' "$norm" | grep -qE "(^|[;&|][[:space:]]*)git[[:space:]]+add[[:space:]]+([^|;&]*[[:space:]])?(-N|--intent-to-add)([[:space:]]|$)"; then
  jq -n --arg r "$ASK_REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
fi

if printf '%s' "$norm" | grep -qE "(^|[;&|][[:space:]]*)git[[:space:]]+apply([[:space:]]|$)"; then
  jq -n --arg r "$ASK_REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
fi

# --- Read-only subcommands of an otherwise mutating verb ---
#
# `worktree`, `branch`, `remote`, `stash`, `tag`, `reflog` carry both reads and
# mutations. Only the read form passes, and the regex must cover the command to
# its end: `git branch -a` passes, `git branch feat/x` (creation) does not.
END='[[:space:]]*($|[|;&])'
READONLY="\
(worktree[[:space:]]+list([[:space:]]+(--porcelain|-v|--verbose))*)|\
(branch([[:space:]]+(-l|--list|-a|--all|-r|--remotes|-v|-vv|--show-current|--merged|--no-merged))*)|\
(remote([[:space:]]+(-v|--verbose|show|get-url([[:space:]]+[^[:space:]]+)?))*)|\
(stash[[:space:]]+(list|show)([[:space:]]+[^[:space:]]+)*)|\
(tag[[:space:]]+(-l|--list)([[:space:]]+[^[:space:]]+)*)|\
(reflog([[:space:]]+show)?([[:space:]]+[^[:space:]-][^[:space:]]*)*)"

if printf '%s' "$norm" | grep -qE "(^|[;&|][[:space:]]*)git[[:space:]]+($READONLY)$END"; then
  exit 0
fi

# `am` stays denied: it applies AND commits.
MUTATING='add|am|branch|checkout|cherry-pick|clean|commit|filter-branch|merge|mv|pull|push|rebase|reflog|remote|reset|restore|revert|rm|stash|switch|tag|update-ref|worktree'

if printf '%s' "$norm" | grep -qE "(^|[;&|][[:space:]]*)git[[:space:]]+($MUTATING)([[:space:]]|$)"; then
  verb=$(printf '%s' "$norm" | grep -oE "git[[:space:]]+($MUTATING)([[:space:]]|$)" | head -1 | awk '{print $2}')
  jq -n --arg v "$verb" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ("git " + $v + " blocked: this repo forbids any Git mutation by an agent. The user decides when to commit, branch or push. Reading is allowed (status, log, diff, show). If the command is genuinely needed, ask the user to run it themselves with the ! prefix.")}}'
  exit 0
fi
exit 0
