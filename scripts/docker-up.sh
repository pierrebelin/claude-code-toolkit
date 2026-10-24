#!/usr/bin/env bash
# docker-up — the Docker engine a suite needs, reachable before the suite starts.
#
#   cctoolkit docker-up [--wait SECONDS]
#
# A Testcontainers suite started with the engine down hangs until the Bash call's 10-minute
# timeout (measured downstream: runs of 588-661 s, the engine stopped mid-plan). Engine up →
# `docker=ready`. Down → Docker Desktop started (macOS `open -a Docker`; Windows the
# `Docker Desktop.exe` next to the `docker` CLI, under Program Files or under
# %LOCALAPPDATA%\Programs), then the engine polled every 3 s for --wait seconds (default 180):
# `docker=ready (started, <n> s)`, or `docker=down — <why>` and exit 1. --wait 0 starts it and
# returns at once: `docker=starting`. No `docker` CLI: `docker=absent`, exit 0 — the stack runs
# without it.
#
# DOCKER_BIN overrides the CLI, DOCKER_DESKTOP the launcher (a command run detached).
#
# Exit 0 ready, absent or starting; 1 down; 2 on usage.
set -u
. "${BASH_SOURCE[0]%/*}/../lib/platform.sh"

wait_max=180
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) wait_max="${2:-}"; shift 2 ;;
    *) echo "usage: cctoolkit docker-up [--wait SECONDS]" >&2; exit 2 ;;
  esac
done
case "$wait_max" in *[!0-9]*|'') echo "docker-up: --wait takes seconds" >&2; exit 2 ;; esac

docker=${DOCKER_BIN:-docker}
command -v "$docker" >/dev/null 2>&1 || { echo "docker=absent"; exit 0; }

# `docker info` can hang on an engine half up: bounded when `timeout` exists.
up() {
  if command -v timeout >/dev/null 2>&1; then timeout 15 "$docker" info >/dev/null 2>&1; else "$docker" info >/dev/null 2>&1; fi
}
up && { echo "docker=ready"; exit 0; }

launcher() {
  [ -n "${DOCKER_DESKTOP:-}" ] && { printf '%s\n' "$DOCKER_DESKTOP"; return 0; }
  case "$(uname -s)" in
    Darwin) command -v open >/dev/null 2>&1 && printf '%s\n' "open -a Docker" ;;
    MINGW*|MSYS*|CYGWIN*)
      local cli local_app exe
      cli=$(command -v "$docker")
      local_app=$(cygpath -u "${LOCALAPPDATA:-}" 2>/dev/null)
      for exe in "${cli%/*}/../../Docker Desktop.exe" "/c/Program Files/Docker/Docker/Docker Desktop.exe" \
                 ${local_app:+"$local_app/Programs/DockerDesktop/Docker Desktop.exe"}; do
        [ -f "$exe" ] && { printf '%s\n' "$exe"; return 0; }
      done ;;
  esac
  return 1
}

start=$(launcher) || { echo "docker=down — engine unreachable, no Docker Desktop to start"; exit 1; }
case "$start" in
  "open -a Docker") (open -a Docker >/dev/null 2>&1 &) ;;
  *) ("$start" >/dev/null 2>&1 &) ;;
esac
[ "$wait_max" = 0 ] && { echo "docker=starting"; exit 0; }

began=$(date +%s)
while :; do
  up && { echo "docker=ready (started, $(( $(date +%s) - began )) s)"; exit 0; }
  [ $(( $(date +%s) - began )) -ge "$wait_max" ] && break
  sleep 3
done
why=$({ "$docker" info 2>&1 >/dev/null || true; } | grep -m1 -iE 'error|cannot|failed' | cut -c1-160)
echo "docker=down — engine unreachable ${wait_max} s after starting Docker Desktop${why:+ ($why)}"
exit 1
