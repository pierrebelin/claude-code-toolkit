#!/bin/bash
# stdin filter for `git grep -n` output, appended by rewrite-piped-filter.sh
# (profile `git-grep`).
#
# Groups matches under a per-file header instead of repeating the path on every
# line. Nothing is dropped: every match and every full line survives, which is what
# "aucune limite de grep" in CLAUDE.md requires — the saving is pure path
# repetition. Measured 2026-09-10: `git grep -n MacroBlock` 2063 kB -> -48 %,
# VfsRelease 145 kB -> -33 %, KeyProfileRegistryId 52 kB -> -32 %. Paths in this
# repo run ~130 characters against ~100 for the matched content, hence the ratio.
#
# The tradeoff, chosen deliberately: the header path is clickable, the individual
# matches are not. Truncating long lines was the alternative and buys only 8-10 %.
#
# A line that is not `path:NN:content` — `Binary file X matches`, or a `git grep`
# without -n — is printed untouched and resets the grouping, so the filter degrades
# to a no-op rather than mangling the output.
set -u

awk '
  {
    if (match($0, /^[^:]+:[0-9]+:/)) {
      head = substr($0, 1, RLENGTH)
      sep = index(head, ":")
      path = substr(head, 1, sep - 1)
      line = substr(head, sep + 1, RLENGTH - sep - 1)
      body = substr($0, RLENGTH + 1)
      if (path != last) {
        if (NR > 1) print ""
        print path
        last = path
      }
      printf "%6s: %s\n", line, body
    } else {
      print
      last = ""
    }
  }
'
