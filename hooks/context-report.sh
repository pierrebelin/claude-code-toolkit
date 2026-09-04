#!/usr/bin/env bash
# Report on the context log. Usage: bash .claude/hooks/context-report.sh [--session]
set -u
LOG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/context-log.tsv"
[ -s "$LOG" ] || { echo "Empty log: $LOG"; echo "The InstructionsLoaded hook fires on the next session."; exit 0; }
python3 - "$LOG" "${1:-}" <<'PY'
import sys, collections
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
if len(sys.argv) > 2 and sys.argv[2] == "--session" and rows:
    last = rows[-1][5] if len(rows[-1]) > 5 else None
    rows = [l for l in rows if len(l) > 5 and l[5] == last]

per_file   = collections.defaultdict(lambda: [0, 0])   # path -> [loads, tokens]
per_reason = collections.Counter()
for l in rows:
    if len(l) < 5: continue
    _, reason, size, tk, path = l[0], l[1], int(l[2]), int(l[3]), l[4]
    per_file[path][0] += 1
    per_file[path][1]  = tk
    per_reason[reason] += tk

total = sum(v[1] for v in per_file.values())
print(f"{len(per_file)} distinct files, ~{total} tokens cumulated\n")
print("by load reason:")
for r, tk in per_reason.most_common():
    print(f"  {tk:>7} tk  {r}")
print("\nheaviest:")
for path, (n, tk) in sorted(per_file.items(), key=lambda kv: -kv[1][1])[:20]:
    rep = f" x{n}" if n > 1 else ""
    print(f"  {tk:>7} tk{rep:<4}  {path}")
PY
