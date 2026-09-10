#!/bin/bash
# UserPromptSubmit + PreToolUse:Skill hook — one batch, one session.
#
# /implement-tdd relaunched without /clear makes the new batch pay the whole
# accumulated context of the previous one on every turn. The skill already says so
# (SKILL.md section 1 entry guard, "End of batch"), but a consigne addressed to the
# agent is not a barrier: the orchestrator reads it after the reads it was meant to
# prevent.
#
# Detection reads the transcript, not a state file: the closing literal emitted by
# /implement-tdd is emitted once per closed batch and by nothing else. Both wordings
# are matched, French repos and English toolkit alike, and the reply keeps the
# language of the literal it matched. F<n> requires a digit, so the skill sources and
# this file, which quote "Lot FX" / "Batch FX", never match.
#
# Escape hatch, same convention as read-bounds.sh and guard-graphify-grep.sh:
# re-issuing the identical launch lets it through. The first attempt drops a marker,
# the second consumes it.
set -u
input=$(cat)

event=$(echo "$input" | jq -r '.hook_event_name // ""')

case "$event" in
  UserPromptSubmit)
    launch=$(echo "$input" | jq -r '.prompt // ""')
    echo "$launch" | grep -qiE '(^|[[:space:]])/?implement-tdd([[:space:]]|$)' || exit 0
    ;;
  PreToolUse)
    [[ "$(echo "$input" | jq -r '.tool_name // ""')" == "Skill" ]] || exit 0
    [[ "$(echo "$input" | jq -r '.tool_input.skill // ""')" == "implement-tdd" ]] || exit 0
    launch=$(echo "$input" | jq -r '.tool_input.args // ""')
    ;;
  *) exit 0 ;;
esac

# Correction mode reopens the batch that is already closed — that is its purpose.
echo "$launch" | grep -qiE 'correction' && exit 0

transcript=$(echo "$input" | jq -r '.transcript_path // ""')
[[ -n "$transcript" && -f "$transcript" ]] || exit 0

# Cheap prefilter before paying jq on a large JSONL.
grep -qE '(Lot F[0-9]+ termin|Batch F[0-9]+ complete)' "$transcript" 2>/dev/null || exit 0

closed=$(jq -rs '
  [ .[]
    | select(.type == "assistant")
    | (.message.content // [])[]
    | select(.type == "text")
    | .text
    | scan("(?:Lot (F[0-9]+) terminé — validation manuelle requise)|(?:Batch (F[0-9]+) complete — manual validation required)")
    | map(select(. != null))[]
  ] | last // ""' "$transcript" 2>/dev/null)

[[ -n "$closed" ]] || exit 0

lang=fr
grep -qE "Batch $closed complete — manual validation required" "$transcript" 2>/dev/null && lang=en

lot=$(echo "$launch" | grep -oiE '\bF[0-9]+\b' | head -1 | tr '[:lower:]' '[:upper:]')

session=$(echo "$input" | jq -r '.session_id // "nosession"')
marker="${TMPDIR:-/tmp}/claude-implement-tdd-guard-${session}-${closed}-${lot:-next}"

if [[ -f "$marker" ]]; then
  rm -f "$marker"
  exit 0
fi
touch "$marker"

if [[ "$lang" == "fr" ]]; then
  reason="Lot ${closed} déjà terminé dans cette session — /clear avant le lot ${lot:-suivant}.
Le lot qui suit paierait le contexte accumulé du précédent à chaque tour (mesuré : 1,9x l'input à nombre de requêtes égal, cf. implement-tdd SKILL.md « End of batch »).
Ne rien lire, ne rien déléguer, ne rien écrire. Relancer /implement-tdd lot ${lot:-FX} après le /clear.
Forcer : relancer la commande à l'identique une seconde fois."
else
  reason="Batch ${closed} already closed in this session — /clear before batch ${lot:-next}.
The next batch would pay the accumulated context of the previous one on every turn (measured: 1.9x the input at equal request count, see implement-tdd SKILL.md \"End of batch\").
Read nothing, delegate nothing, write nothing. Relaunch /implement-tdd lot ${lot:-FX} after the /clear.
Force: re-issue the identical launch a second time."
fi

if [[ "$event" == "PreToolUse" ]]; then
  jq -n --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
fi

echo "$reason" >&2
exit 2
