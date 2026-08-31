#!/bin/bash
# PreToolUse hook — interdiction dure des commandes Git mutantes.
#
# CLAUDE.md enonce « Jamais de commit Git », mais une instruction est
# advisory : rien ne l'execute. Ce hook la rend deterministe.
#
# Couvre les formes que `permissions.deny` rate, parce qu'il matche par
# prefixe litteral :
#   rtk git commit ...            (le hook rtk-normalize route tout via rtk)
#   git -C /autre/repo commit ... (option globale avant le verbe)
#   cd /ailleurs && git push      (prefixe cd)
#   env FOO=1 git add .
set -u
input=$(cat)

[[ "$(echo "$input" | jq -r '.tool_name // ""')" != "Bash" ]] && exit 0
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Normalisation : on retire ce qui s'intercale entre le debut de commande
# et le verbe git, pour ramener toutes les formes a « git <verbe> ».
norm=$(printf '%s' "$cmd" \
  | sed -E 's/(^|[;&|][[:space:]]*)cd[[:space:]]+[^&;|]+&&[[:space:]]*/\1/g' \
  | sed -E 's/(^|[;&|][[:space:]]*)(rtk|command|sudo)[[:space:]]+/\1/g' \
  | sed -E 's/(^|[;&|][[:space:]]*)(env[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*/\1/g' \
  | sed -E 's/(^|[[:space:]])git[[:space:]]+((-C|-c|--git-dir|--work-tree|--namespace|--exec-path)[[:space:]]*=?[[:space:]]*[^[:space:]]+[[:space:]]+)*/\1git /g')

# --- Exception : rapatriement d'un worktree vers la branche locale ---
#
# ExitWorktree ne transfere rien (keep ou remove, jamais de merge). Le flux
# sans commit est : capturer le diff du worktree, l'appliquer ici.
#
#   git -C <worktree> add -N .          # rend les nouveaux fichiers visibles au diff
#   git -C <worktree> diff HEAD > p     # lecture, deja autorisee
#   git apply p                         # applique dans le working tree, sans commit
#
# Ces deux verbes passent en "ask" : l'utilisateur voit la commande et tranche.
# `add -N` (--intent-to-add) enregistre le chemin sans le contenu — il ne stage
# rien de commitable, et `commit` reste refuse de toute facon.
ASK_REASON="Rapatriement de worktree : cette commande modifie le working tree local sans creer de commit. Verifie la cible avant d approuver."

if printf '%s' "$norm" | grep -qE "(^|[;&|][[:space:]]*)git[[:space:]]+add[[:space:]]+([^|;&]*[[:space:]])?(-N|--intent-to-add)([[:space:]]|$)"; then
  jq -n --arg r "$ASK_REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
fi

if printf '%s' "$norm" | grep -qE "(^|[;&|][[:space:]]*)git[[:space:]]+apply([[:space:]]|$)"; then
  jq -n --arg r "$ASK_REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
fi

# --- Sous-commandes de lecture d'un verbe par ailleurs mutant ---
#
# `worktree`, `branch`, `remote`, `stash`, `tag`, `reflog` portent a la fois de
# la lecture et de la mutation. Seule la forme de lecture passe, et la regex
# doit couvrir la commande jusqu'au bout : `git branch -a` passe, `git branch
# feat/x` (creation) ne passe pas.
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

# `am` reste refuse : il applique ET commite.
MUTATING='add|am|branch|checkout|cherry-pick|clean|commit|filter-branch|merge|mv|pull|push|rebase|reflog|remote|reset|restore|revert|rm|stash|switch|tag|update-ref|worktree'

if printf '%s' "$norm" | grep -qE "(^|[;&|][[:space:]]*)git[[:space:]]+($MUTATING)([[:space:]]|$)"; then
  verb=$(printf '%s' "$norm" | grep -oE "git[[:space:]]+($MUTATING)([[:space:]]|$)" | head -1 | awk '{print $2}')
  jq -n --arg v "$verb" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ("git " + $v + " bloque : ce repo interdit toute mutation Git par un agent. L utilisateur decide quand commiter, creer une branche ou pousser. Lecture autorisee (status, log, diff, show). Si la commande est vraiment necessaire, demande-la a l utilisateur pour qu il la lance lui-meme avec le prefixe ! .")}}'
  exit 0
fi
exit 0
