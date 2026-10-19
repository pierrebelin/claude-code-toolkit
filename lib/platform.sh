# Sourced, never run: lets the rest of the kit run unchanged under Git Bash on
# native Windows. On macOS and Linux it defines `kit_path` as a no-op and returns.
# Windows: `python3` → the first interpreter running Python >= 3.10 (cached in /tmp;
# the Store stub exits 9009); Python in UTF-8 writing LF (windows/sitecustomize.py);
# `jq -b` (no CRLF); `kit_path VAR` rewrites a path in place to `C:/x/repo` form
# (no fork: `printf -v`), CLAUDE_PROJECT_DIR and CLAUDE_PLUGIN_ROOT on load.
# Functions are exported; a bash started by a native program may lose them, hence `declare -F`.
[ -n "${_KIT_PLATFORM:-}" ] && declare -F kit_path >/dev/null && return 0

case "${OSTYPE:-}" in
  msys* | cygwin* | win32*) _KIT_PLATFORM=windows ;;
  *)
    _KIT_PLATFORM=posix
    kit_path() { :; }
    return 0
    ;;
esac
export _KIT_PLATFORM

kit_path() {
  local p=${!1//\\//} low=abcdefghijklmnopqrstuvwxyz up=ABCDEFGHIJKLMNOPQRSTUVWXYZ before
  case "$p" in
    /[a-zA-Z]) p="${p:1:1}:/" ;;
    /[a-zA-Z]/*) p="${p:1:1}:${p:2}" ;;
    /*) p=$(cygpath -m "$p" 2>/dev/null || printf '%s' "$p") ;;
  esac
  case "$p" in
    [abcdefghijklmnopqrstuvwxyz]:*) before=${low%%"${p:0:1}"*}; p="${up:${#before}:1}${p:1}" ;;
  esac
  printf -v "$1" '%s' "$p"
}

if [ -z "${CCTOOLKIT_PYTHON:-}" ]; then
  _kit_py_cache="/tmp/cctoolkit-python"
  [ -r "$_kit_py_cache" ] && read -r CCTOOLKIT_PYTHON <"$_kit_py_cache"
  if [ -z "${CCTOOLKIT_PYTHON:-}" ] || ! command -v "$CCTOOLKIT_PYTHON" >/dev/null 2>&1; then
    CCTOOLKIT_PYTHON=
    for _kit_py in python3 python py; do
      if "$_kit_py" -c 'import sys; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1; then
        CCTOOLKIT_PYTHON=$_kit_py
        printf '%s\n' "$_kit_py" >"$_kit_py_cache" 2>/dev/null
        break
      fi
    done
  fi
  unset _kit_py _kit_py_cache
fi
export CCTOOLKIT_PYTHON

if [ -n "$CCTOOLKIT_PYTHON" ]; then
  # A stub `python3` that cannot run Python is shadowed too: the function wins.
  python3() { command "$CCTOOLKIT_PYTHON" "$@"; }
  export -f python3
  _kit_site="${BASH_SOURCE[0]%/*}/windows"
  kit_path _kit_site
  export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
  case ";${PYTHONPATH:-};" in
    *";$_kit_site;"*) ;;
    *) export PYTHONPATH="$_kit_site${PYTHONPATH:+;$PYTHONPATH}" ;;
  esac
  unset _kit_site
fi

jq() { command jq -b "$@"; }
export -f jq kit_path

for _kit_var in CLAUDE_PROJECT_DIR CLAUDE_PLUGIN_ROOT; do
  if [ -n "${!_kit_var:-}" ]; then
    kit_path "$_kit_var"
    export "$_kit_var"
  fi
done
unset _kit_var
