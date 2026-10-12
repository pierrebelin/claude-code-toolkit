#!/usr/bin/env bash
# SubagentStop hook: checks the SHAPE of the `## RED` / `## GREEN` report a TDD subagent
# hands back, and makes the agent re-emit it when a required line is missing.
#
# Why here and not in the orchestrator: a report missing its `Production diff` line or its
# table costs the orchestrator a turn to notice plus a `SendMessage` to repair — 1 to 4 per
# batch (measured 2026-09-13). The agent still holds its context, so it re-emits for free.
#
# Form only, never content. A non-empty diff, a cost above zero, an unexpected exit code are
# deviations the ORCHESTRATOR settles (delete the production code, back to design): the hook
# must never push an agent to repair those on its own. It only demands a complete report.
#
# Channel: `decision: block` + `reason`, documented for Stop and SubagentStop. `stop_hook_active`
# closes the loop — a second pass never blocks again, whatever the report still lacks.
# A message carrying neither `## RED` nor `## GREEN` (`## BLOCKED`, or `## BLOQUÉ` of an
# agent written before the switch, Explore, auditor) passes untouched: the hook recognises
# the two contracts it knows, never polices the others.
#
# Each bullet label is read in English and in French (`Command` / `Commande`): an agent
# started before the switch answers in French labels and must not be sent back for them.
# The reason is always written in English, with the English labels.

# The heredoc is python's own stdin, so the payload travels through the environment.
INPUT=$(cat)

HOOK_INPUT="$INPUT" python3 <<'PYEOF'
import json, os, re, sys

try:
    d = json.loads(os.environ.get("HOOK_INPUT") or "{}")
except Exception:
    sys.exit(0)

# Second pass: the agent already answered a block. Never block twice, whatever is left.
if d.get("stop_hook_active"):
    sys.exit(0)

msg = d.get("last_assistant_message") or ""
if not isinstance(msg, str) or not msg.strip():
    sys.exit(0)

heading = re.search(r"^##\s+(RED|GREEN)\s*$", msg, re.M)
if not heading:
    sys.exit(0)
kind = heading.group(1)

# Bullet labels of `agents/tdd-test-author.md` and `agents/tdd-implementer.md`, as
# (English, French). Compared on the fold so casing and accents never decide whether a
# report is complete.
REQUIRED = {
    "RED": [("Tests", "Tests"), ("Command", "Commande"), ("Production diff", "Diff production"),
            ("Expected failure", "Échec attendu")],
    "GREEN": [("Production", "Production"), ("Command", "Commande"), ("Tests diff", "Diff tests"),
              ("Cost", "Coût"), ("Deleted at REFACTOR", "Supprimé au REFACTOR"),
              ("Reported without fixing", "Signalé sans correction")],
}
CASE_COVERED = ("Case covered", "Cas couvert")


def fold(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s.lower())
                   if unicodedata.category(c) != "Mn")


body = msg[heading.end():]
labels = {fold(m.group(1).strip()) for m in re.finditer(r"^\s*[-*]\s*([^:\n]+?)\s*:", body, re.M)}

missing = [names[0] for names in REQUIRED[kind] if not any(fold(n) in labels for n in names)]

issues = []
if missing:
    issues.append("missing lines: " + ", ".join(f"`- {lb}:`" for lb in missing))

# `exit N` sits on the `Command` line (`Commande`): without it the orchestrator cannot tick
# RED or GREEN on observed evidence, and asks for it every time. "commande" holds "command".
cmd_line = next((l for l in body.splitlines()
                 if re.match(r"^\s*[-*]\s*", l) and fold("Command") in fold(l)), "")
if cmd_line and not re.search(r"exit\s+\d+", cmd_line, re.I):
    issues.append("`- Command:` line without an observed exit code (`— exit N`)")

if kind == "RED":
    rows = [l for l in body.splitlines() if l.strip().startswith("|")]
    data = [l for l in rows if not re.match(r"^\s*\|[\s|:-]+\|\s*$", l)]
    header = any(fold(n) in fold(l) for l in rows for n in CASE_COVERED)
    if not header or len(data) < 2:
        issues.append("`| Test | Case covered |` table missing or holding no test row — "
                      "one row per method written, `ClassTests.Method`")

if not issues:
    sys.exit(0)

reason = ("Incomplete `## " + kind + "` report — " + "; ".join(issues) + ". "
          "Re-emit the whole report in your agent's format, without re-running a test or "
          "touching code: the values are already in your context.")
print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
PYEOF

exit 0
