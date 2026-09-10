#!/bin/bash
# Batching nudge — reminds the main chain to group independent tool calls.
#
# Measured on session 1a39aeca (lot F5, 2026-09-09): 110 of 124 tool-carrying
# turns held a single call, mean 1.23. A turn is one billed round trip that
# resends the whole accumulation, so a run of mono-call turns pays the same
# context N times for N calls that could have shipped in one message. The three
# largest lines of that session — replayed output 19%, Bash 18%, Read 17% — are
# all proportional to the turn count, not to the calls.
#
# The hook never blocks and never rewrites. It appends one line of
# additionalContext when the recent history shows a run of mono-call turns.
#
# Trigger vs. scope. It is wired on Bash only (the dispatcher is the single Bash
# entry point) but it reads the transcript, so it counts every tool — a
# Read/Read/Read run is caught by the next Bash call. Batching is a property of
# the turn, not of the tool.
#
# Main chain only. A subagent carries its context for 30 turns then drops it;
# the same run costs 32x less there (measured: $0.049/kB main against $0.0015/kB
# subagent). Nudging it would spend tokens to fix what is not a problem.
#
# Contract: reads HOOK_* from the environment, prints the nudge text on stdout
# (not JSON — the dispatcher merges it), prints nothing when it passes.
set -u

WINDOW=${CLAUDE_BATCHING_WINDOW:-6}   # consecutive mono-call turns before nudging
COOLDOWN=${CLAUDE_BATCHING_COOLDOWN:-6} # tool-carrying turns before nudging again

[ -z "${HOOK_AGENT_ID:-}" ] || exit 0   # subagent → out of scope

transcript="${HOOK_TRANSCRIPT_PATH:-}"
[ -n "$transcript" ] || exit 0
[ -f "$transcript" ] || exit 0

session="${HOOK_SESSION_ID:-unknown}"
state="/tmp/claude-batching-nudge-${session}"
last_alert=0
[ -f "$state" ] && last_alert=$(cat "$state" 2>/dev/null || echo 0)

python3 - "$transcript" "$WINDOW" "$COOLDOWN" "$last_alert" "$state" <<'PY'
import sys, json

transcript, window, cooldown, last_alert, state = sys.argv[1:6]
window, cooldown, last_alert = int(window), int(cooldown), int(last_alert)

# One entry per assistant message that carried at least one tool call.
# Claude Code rewrites each assistant message several times (streaming deltas):
# dedupe on message.id, and dedupe tool_use on its own id, or the same call is
# counted twice and every turn looks batched.
seen_msg, seen_tu, turns = {}, set(), []
with open(transcript, encoding="utf-8", errors="replace") as fh:
    for line in fh:
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

if total < window or total - last_alert < cooldown:
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
