#!/bin/bash
# Stop hook — rebuilds the graphify graph when the working tree fingerprint moved
# (lib/graphify-freshness.sh). The staleness check runs in the foreground; the
# rebuild re-executes this script detached (`--sync`) under a mkdir lock.
# A write is proven by graph.json's mtime: `graphify update` exits 0 without writing.
# A node-shrink refusal is replayed with --force when the extraction is complete and
# the drop is ≤ MAX_SHRINK_PCT. GRAPHIFY_BIN, GRAPHIFY_HOOK_LOG, GRAPHIFY_AUTOSYNC_LOCK: evals.

case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh

# Repo resolved by lib/project-root.sh, never hardcoded.
. "$(dirname "${BASH_SOURCE[0]}")/../lib/project-root.sh"
REPO="${GRAPHIFY_REPO:-$PROJECT_ROOT}"
GRAPHIFY="${GRAPHIFY_BIN:-$HOME/.local/bin/graphify}"
GRAPH="$REPO/graphify-out/graph.json"
# The helper sits beside this script, never under $REPO (GRAPHIFY_REPO may point elsewhere).
FRESHNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/graphify-freshness.sh"
export GRAPHIFY_REPO="$REPO"   # freshness must target the same repo
LOG="${GRAPHIFY_HOOK_LOG:-/tmp/graphify-hook.log}"
LOCK="${GRAPHIFY_AUTOSYNC_LOCK:-/tmp/graphify-autosync.lock}"
MAX_SHRINK_PCT=2
MODE="${1:-}"

if [ "$MODE" = "--sync" ]; then
  SID="${GRAPHIFY_AUTOSYNC_SID:-unknown}"
else
  SID=$(cat 2>/dev/null | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
fi
say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1 (session=$SID)" >> "$LOG"; }
mtime() { stat -c %Y "$GRAPH" 2>/dev/null || stat -f %m "$GRAPH" 2>/dev/null || echo 0; }

[ -x "$GRAPHIFY" ] || { say "graphify not found, skip"; exit 0; }

STALE=$("$FRESHNESS" --refresh 2>/dev/null)
case "$STALE" in
  ""|*[!0-9-]*) say "ALERT freshness unreadable ('$STALE'), no rebuild"; exit 0 ;;
esac
if [ "$STALE" = "0" ]; then
  say "skip, graph up to date"
  exit 0
fi
if [ "$STALE" = "-1" ]; then
  say "ALERT graph.json missing, run an initial build"
  exit 0
fi

if [ "$MODE" != "--sync" ]; then
  if [ -d "$LOCK" ]; then
    say "skip, another autosync holds the lock"
    exit 0
  fi
  GRAPHIFY_AUTOSYNC_SID="$SID" GRAPHIFY_BIN="$GRAPHIFY" GRAPHIFY_HOOK_LOG="$LOG" \
  GRAPHIFY_AUTOSYNC_LOCK="$LOCK" \
    nohup bash "${BASH_SOURCE[0]}" --sync </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
  say "rebuild detached, $STALE stale files (pid $!)"
  exit 0
fi

# Atomic lock: two sessions stopping together would race on graph.json.
if ! mkdir "$LOCK" 2>/dev/null; then
  say "skip, another autosync holds the lock"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

BEFORE=$(mtime)
OUT=$("$GRAPHIFY" update "$REPO" 2>&1)

if [ "$(mtime)" != "$BEFORE" ]; then
  say "update OK, $STALE files caught up"
  "$FRESHNESS" --refresh >/dev/null
  exit 0
fi

# Nothing written. Only the node-shrink refusal is recoverable.
if ! grep -qF 'Refusing to overwrite' <<<"$OUT"; then
  say "ALERT update wrote nothing and did not invoke the guard. Last line: $(tail -1 <<<"$OUT")"
  exit 0
fi

NEW=$(sed -n 's/.*new graph has \([0-9]*\) nodes.*/\1/p' <<<"$OUT" | head -1)
OLD=$(sed -n 's/.*existing graph.json has \([0-9]*\).*/\1/p' <<<"$OUT" | head -1)
# Literal search: grep may be ugrep, which rejects BRE back-references.
COMPLETE=$(grep -cF '(100%)' <<<"$OUT")

if [ -z "$NEW" ] || [ -z "$OLD" ] || [ "$OLD" -le 0 ]; then
  say "ALERT update refused, node count unreadable, graph unchanged"
  exit 0
fi

SHRINK=$(( (OLD - NEW) * 100 / OLD ))
if [ "$COMPLETE" -eq 0 ] || [ "$SHRINK" -gt "$MAX_SHRINK_PCT" ]; then
  say "ALERT update refused, $OLD->$NEW nodes (-${SHRINK}%), complete extraction=$COMPLETE. Graph unchanged, check by hand"
  exit 0
fi

FOUT=$("$GRAPHIFY" update "$REPO" --force 2>&1)
if [ "$(mtime)" != "$BEFORE" ]; then
  say "update --force OK, $OLD->$NEW nodes (-${SHRINK}%, code deleted), $STALE files caught up"
  "$FRESHNESS" --refresh >/dev/null
else
  say "ALERT update --force wrote nothing. Last line: $(tail -1 <<<"$FOUT")"
fi
