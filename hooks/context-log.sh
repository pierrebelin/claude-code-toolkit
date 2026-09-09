#!/usr/bin/env bash
# InstructionsLoaded hook — logs what enters the context, as the session goes.
#
# Fires at startup AND on every lazy load (sub-folder CLAUDE.md, path-scoped rule,
# import, reload after /compact). The exit code is ignored by the harness: this
# hook has no blocking power, it observes.
#
# Log:    .claude/context-log.tsv   (timestamp, reason, bytes, ~tokens, path)
# Report: bash .claude/lib/context-report.sh
set -u
LOG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$LOG_DIR/context-log.tsv"
RAW="$LOG_DIR/context-log.raw.json"

INPUT=$(cat)

# The exact schema is not documented: keep the first raw payload so the extraction
# can be refined if the field names differ.
[ -s "$RAW" ] || printf '%s\n' "$INPUT" > "$RAW"

printf '%s' "$INPUT" | LOG="$LOG" python3 -c '
import json, sys, os, datetime

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

def pick(*names):
    for n in names:
        v = d.get(n)
        if isinstance(v, str) and v:
            return v
    return ""

reason = pick("reason", "load_reason", "matcher", "trigger") or "?"
sid    = (pick("session_id") or "?")[:8]

# a load may carry one file or a list
paths = []
for key in ("file_path", "path", "file"):
    v = d.get(key)
    if isinstance(v, str) and v: paths.append(v)
for key in ("files", "paths", "instruction_files"):
    v = d.get(key)
    if isinstance(v, list):
        paths += [x if isinstance(x, str) else (x.get("path") or x.get("file_path") or "")
                  for x in v]

ts = datetime.datetime.now().isoformat(timespec="seconds")
log = os.environ["LOG"]
with open(log, "a", encoding="utf-8") as f:
    if not paths:
        f.write(f"{ts}\t{reason}\t0\t0\t(no path in the payload — see context-log.raw.json)\t{sid}\n")
    for p in paths:
        if not p: continue
        try:    n = os.path.getsize(p)
        except OSError: n = 0
        f.write(f"{ts}\t{reason}\t{n}\t{n//4}\t{p}\t{sid}\n")
' 2>/dev/null || true
exit 0
