# Sourced, never run: `graphify_bin VAR` sets VAR to the graphify executable the kit
# calls — $GRAPHIFY_BIN when set, else the first `graphify` on the PATH (a pip install
# on Windows lands in Python3xx/Scripts), else ~/.local/bin/graphify. None executable:
# VAR empty, GRAPHIFY_NOT_FOUND names what was tried, return 1.
# Shared by hooks/graphify-autosync.sh and tools/doctor, so both resolve the same binary.
graphify_bin() {
  local c
  if [ -n "${GRAPHIFY_BIN:-}" ]; then
    c=$GRAPHIFY_BIN
    GRAPHIFY_NOT_FOUND="graphify not found (GRAPHIFY_BIN=$GRAPHIFY_BIN is not executable)"
  else
    c=$(command -v graphify 2>/dev/null) || c="$HOME/.local/bin/graphify"
    GRAPHIFY_NOT_FOUND="graphify not found (GRAPHIFY_BIN unset, not on PATH, not in ~/.local/bin)"
  fi
  if [ -x "$c" ]; then printf -v "$1" '%s' "$c"; return 0; fi
  printf -v "$1" '%s' ""
  return 1
}
