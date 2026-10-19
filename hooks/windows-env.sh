#!/bin/bash
# SessionStart hook — Windows only: hands lib/platform.sh to the Bash tool.
# One line in $CLAUDE_ENV_FILE, sourced before every Bash tool command.
set -u
case "${OSTYPE:-}" in msys* | cygwin* | win32*) ;; *) exit 0 ;; esac
[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
platform="${BASH_SOURCE[0]%/*}/../lib/platform.sh"
[ -f "$platform" ] || exit 0
line=". '$platform'"
grep -Fqx "$line" "$CLAUDE_ENV_FILE" 2>/dev/null || printf '%s\n' "$line" >>"$CLAUDE_ENV_FILE"
exit 0
