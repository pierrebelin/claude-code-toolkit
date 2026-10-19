#!/bin/bash
# stdin filter for `git grep -n` output, appended by rewrite-piped-filter.sh
# (profile `git-grep`).
# Groups matches under a per-file header instead of repeating the path; lossless.
# A line that is not `path:NN:content` is printed untouched and resets the grouping.
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
