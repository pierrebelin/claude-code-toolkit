#!/bin/bash
# stdin filter for `graphify query` output, appended by rewrite-piped-filter.sh
# (profile `graphify-query`).
#
# Three passes, in order:
#   1. drop NODE lines with an empty `src=`;
#   2. drop `community=X` — any token up to the bracket or a space, not only digits:
#      pass 3 depends on it;
#   3. collapse `[src=PATH loc=LNN]` to `PATH:NN`, the clickable form.
# A line that does not match passes through untouched.
set -u

sed -E \
  -e '/^NODE .*\[src= /d' \
  -e 's/ community=[^][:space:]]*//' \
  -e 's/^NODE (.*) \[src=([^][:space:]]+) loc=L([0-9]+)\]$/NODE \1 \2:\3/' \
  -e 's/^NODE (.*) \[src=([^][:space:]]+) loc=\]$/NODE \1 \2/'
