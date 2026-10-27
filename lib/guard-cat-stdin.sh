#!/bin/bash
# bash-dispatch module — deny a `cat` with nothing to read.
# A `cat` whose only words are redirections (`cat > f;`, `cat > /dev/null 2>&1 &&`), neither
# fed by a pipe nor by `<`, `<<` or `<<<`, reads the Bash call's stdin: it never closes, the
# call hangs to its 120 s timeout and lands in the background (run-plan 2026-10-26: one cycle
# then waited 20 min on that background output). Reads $HOOK_CMD, prints the hook JSON when it decides.
set -u

cmd="${HOOK_CMD:-}"
[ -n "$cmd" ] || exit 0

# Fast bail-out: no `cat` word.
case "$cmd" in *cat*) ;; *) exit 0 ;; esac

# Segment start (command start, `;`, `&`, `&&`, `||`, `(`, a newline — never a single pipe),
# `cat`, one redirection or more and nothing else, segment end. A redirection operand never
# holds `<`, so `cat > f <<'EOF'` and `cat > f < g` fail the pattern. A bare `cat` (`$(cat)`)
# passes: inside a group a pipe may feed it.
nl=$'\n'
start="(^|[;&(${nl}]|[|][|])[[:space:]]*"
redir="[[:space:]]+([0-9]?>>?|&>)[[:space:]]*[^[:space:];&|<()]+"
end="[[:space:]]*(\$|[;&)${nl}])"
re="${start}cat(${redir})+${end}"
[[ $cmd =~ $re ]] || exit 0

jq -n --arg seg "${BASH_REMATCH[0]}" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ("`cat` with nothing to read refused (" + ($seg | gsub("^[\\s;&(|]+|[\\s;&)]+$"; "")) + "): it reads the Bash call'\''s stdin, which never closes, so the call hangs to its timeout. Writing a file: a heredoc, `cat > <file> <<'\''EOF'\''` then the lines then `EOF`, or the Write tool. Nothing to write: drop the `cat`.")}}'
exit 0
