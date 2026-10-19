#!/bin/bash
# SessionStart hook — Windows only: hands lib/platform.sh to the Bash tool.
#
# Why. The hooks source lib/platform.sh themselves, but the commands the skills
# and the stack references run through the Bash tool (`python3 -c …`, `jq …`)
# reach Git Bash bare: no `python3` on a python.org install, CRLF out of a native
# jq. Claude Code sources $CLAUDE_ENV_FILE before every Bash tool command; one
# line there gives those commands the same `python3`, `jq` and UTF-8 Python as
# the hooks. macOS and Linux: nothing to do, the hook exits at once.
set -u
case "${OSTYPE:-}" in msys* | cygwin* | win32*) ;; *) exit 0 ;; esac
[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
case "${BASH_SOURCE[0]}" in *\\*) exec "$BASH" "${BASH_SOURCE[0]//\\//}" "$@" ;; esac # Windows: lib/platform.sh
platform="${BASH_SOURCE[0]%/*}/../lib/platform.sh"
[ -f "$platform" ] || exit 0
line=". '$platform'"
grep -Fqx "$line" "$CLAUDE_ENV_FILE" 2>/dev/null || printf '%s\n' "$line" >>"$CLAUDE_ENV_FILE"
exit 0
