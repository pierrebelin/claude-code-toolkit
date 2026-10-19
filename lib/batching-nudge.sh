#!/bin/bash
# Batching nudge — reminds the main chain to group independent tool calls.
# Main chain only, once per session. Wired on Bash but reads the transcript, so it
# counts every tool. Reads HOOK_* from the environment, prints the nudge as plain
# text (not JSON — the dispatcher merges it), nothing when it passes.
set -u

WINDOW=${CLAUDE_BATCHING_WINDOW:-6}   # consecutive mono-call turns before nudging

[ -z "${HOOK_AGENT_ID:-}" ] || exit 0   # subagent → out of scope

transcript="${HOOK_TRANSCRIPT_PATH:-}"
[ -n "$transcript" ] || exit 0
[ -f "$transcript" ] || exit 0

session="${HOOK_SESSION_ID:-unknown}"
# Sampling gate before the python spawn: one call in SAMPLE is evaluated.
SAMPLE=${CLAUDE_BATCHING_SAMPLE:-3}
tick_file="/tmp/claude-batching-tick-${session}"
tick=0
[ -f "$tick_file" ] && read -r tick < "$tick_file" 2>/dev/null
case "$tick" in ''|*[!0-9]*) tick=0 ;; esac
tick=$(( (tick + 1) % SAMPLE ))
printf '%s' "$tick" > "$tick_file"
[ "$tick" -eq 0 ] || exit 0

# One reminder per session: the state file marks it sent.
state="/tmp/claude-batching-nudge-${session}"
[ -f "$state" ] && exit 0

python3 - "$transcript" "$WINDOW" "$state" <<'PY'
import sys, json

transcript, window, state = sys.argv[1:4]
window = int(window)

# One entry per assistant message with a tool call. Streaming rewrites a message
# several times: dedupe on message.id and on tool_use id.
seen_msg, seen_tu, turns = {}, set(), []
with open(transcript, encoding="utf-8", errors="replace") as fh:
    for line in fh:
        # Substring pre-filter before the parse.
        if '"tool_use"' not in line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("isSidechain") or d.get("type") != "assistant":
            continue
        mid = d.get("message", {}).get("id")
        new = [
            c["id"]
            for c in d["message"].get("content", [])
            if isinstance(c, dict) and c.get("type") == "tool_use" and c["id"] not in seen_tu
        ]
        seen_tu.update(new)
        if not new:
            continue
        if mid in seen_msg:
            seen_msg[mid] += len(new)
        else:
            seen_msg[mid] = len(new)
            turns.append(mid)

counts = [seen_msg[m] for m in turns]
total = len(counts)

if total < window:
    sys.exit(0)
if any(c != 1 for c in counts[-window:]):
    sys.exit(0)

with open(state, "w") as fh:
    fh.write(str(total))

print(
    f"Batching: the last {window} tool-carrying turns each held a single call "
    f"({total} such turns so far this session). Every turn resends the whole "
    "context, so independent calls belong in one message. Before the next call, "
    "check whether the following ones depend on its result — if not, send them "
    "together."
)
PY
exit 0
