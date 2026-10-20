#!/usr/bin/env bash
# build-lock — run a long build or a whole suite under one lock per checkout.
#
#   cctoolkit build-lock [--wait SECONDS] [--stale SECONDS] '<command>'
#
# Two batches of one checkout, each in its own worktree, overlap their agent phases; their
# solution builds and whole suites pass one at a time (measured downstream: four concurrent warm
# builds took 39-45 min each against 4-13 min alone). The lock is a directory in the git common
# dir, shared by every worktree of the checkout: `mkdir` is atomic on every disk, Git Bash
# included, where `flock` is absent. The command runs through `eval` in this shell and keeps its
# exit; the lock goes on any exit, a signal included.
#
# --wait   give up after that many seconds (default 3600): exit 75, `build-lock: timeout` on stderr
# --stale  a lock older than that is taken over (default 10800): its holder died without exit
#
# Exit = the command's, 75 on timeout, 2 on usage.
set -u
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

wait_max=3600
stale=10800
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) wait_max="${2:-}"; shift 2 ;;
    --stale) stale="${2:-}"; shift 2 ;;
    --) shift; break ;;
    -*) echo "build-lock: unknown option $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
case "$wait_max$stale" in *[!0-9]*|'') echo "build-lock: --wait and --stale take seconds" >&2; exit 2 ;; esac
[ $# -eq 1 ] && [ -n "$1" ] || { echo "usage: cctoolkit build-lock [--wait S] [--stale S] '<command>'" >&2; exit 2; }

common="$(git rev-parse --git-common-dir 2>/dev/null)" && common="$(cd "$common" && pwd)" || common="${TMPDIR:-/tmp}"
lock="$common/cctoolkit-build.lock"
kit_path lock

start=$(date +%s)
held=0
looped=0
release() { [ "$held" = 1 ] && rm -rf "$lock"; held=0; }
trap release EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

while ! mkdir "$lock" 2>/dev/null; do
  now=$(date +%s)
  since=$(cat "$lock/since" 2>/dev/null || echo "$now")
  case "$since" in *[!0-9]*|'') since=$now ;; esac
  if [ $((now - since)) -ge "$stale" ]; then
    echo "build-lock: stale lock taken over ($(cat "$lock/owner" 2>/dev/null || echo unknown owner), $((now - since)) s)" >&2
    rm -rf "$lock"
    continue
  fi
  if [ $((now - start)) -ge "$wait_max" ]; then
    echo "build-lock: timeout after $((now - start)) s, held by $(cat "$lock/owner" 2>/dev/null || echo unknown owner)" >&2
    exit 75
  fi
  looped=1
  sleep 2
done
held=1
date +%s > "$lock/since"
echo "$$ $(pwd)" > "$lock/owner"
waited=$(( $(date +%s) - start ))
[ "$looped" = 1 ] && echo "build-lock: waited $waited s" >&2

eval "$1"
