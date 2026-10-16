# Sourced, never run: lets the rest of the kit run unchanged under Git Bash on
# native Windows. On macOS and Linux it defines `kit_path` as a no-op and returns:
# nothing else changes there.
#
# Why. Claude Code runs hooks and the statusline in Git Bash on Windows, but the
# tools the kit calls are native Windows programs that differ from their POSIX
# selves in four ways, each fixed here once instead of in every hook:
#   - `python3` is missing (python.org installs `python` and `py`) or is the
#     Microsoft Store stub, which prints an install hint and exits 9009. The first
#     interpreter that really runs Python >= 3.10 is cached in /tmp and `python3`
#     becomes a function calling it.
#   - native Python writes CRLF on stdout and through open(), and encodes in the
#     ANSI code page: `$(python3 ...)` would keep a `\r`, and a `—` would crash a
#     print. PYTHONUTF8=1 plus lib/windows/sitecustomize.py (LF on stdout, stderr
#     and every text-mode write) make it behave as on POSIX.
#   - native jq writes CRLF unless given `-b`: `jq` becomes `jq -b`.
#   - paths arrive as `C:\x\repo\a.cs` (hook payload), `C:/x/repo` (git,
#     ${CLAUDE_PLUGIN_ROOT}) or `/c/x/repo` (pwd). `kit_path VAR` rewrites VAR in
#     place to the one form `C:/x/repo/a.cs`, which bash, git and Python all
#     accept; CLAUDE_PROJECT_DIR is rewritten on load. No fork: `printf -v`.
# The functions are exported (`export -f`), so a `bash child.sh` inherits them;
# a bash started by a native program may lose them, hence the `declare -F`.
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

if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  kit_path CLAUDE_PROJECT_DIR
  export CLAUDE_PROJECT_DIR
fi
