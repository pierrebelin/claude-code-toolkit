#!/bin/bash
# stdin filter for `graphify query` output, appended by rewrite-piped-filter.sh
# (profile `graphify-query`).
#
# Three passes, in order:
#   1. drop NODE lines with an empty `src=` — BCL and framework types (Task, Ulid,
#      CancellationToken, List, Dictionary, HashSet...) carry no location and no
#      answer. Measured 2026-09-10: 19 of the 61 nodes a 2000-token budget emits.
#   2. drop `community=X` — a clustering id, never used to reason about code.
#   3. collapse `[src=PATH loc=LNN]` to `PATH:NN`, the clickable form.
#
# graphify 0.9.58 (2026-09-11) renamed communities: `community=583` became
# `community={{PRODUCT}}.Catalog.Domain.Core`, `community=ModuleDiagram/CLAUDE.md`.
# The old `[0-9]+` pattern stopped matching, and because the community token sits
# between `loc=` and the closing bracket, pass 3 stopped matching with it — the
# filter silently degraded to a no-op on EVERY line. Hence the token class below:
# anything up to the bracket or a space, digits or not.
#
# Lowering `--budget` was the other candidate and is the wrong lever: the
# sourceless nodes come first, so budget 600 keeps 10 useful nodes out of 25 where
# budget 2000 keeps 42 out of 61. The budget truncates the tail, which is where the
# answer lives.
#
# Any line that does not match is passed through untouched, so a change in the
# graphify output format degrades this to a no-op rather than to data loss.
set -u

sed -E \
  -e '/^NODE .*\[src= /d' \
  -e 's/ community=[^][:space:]]*//' \
  -e 's/^NODE (.*) \[src=([^][:space:]]+) loc=L([0-9]+)\]$/NODE \1 \2:\3/' \
  -e 's/^NODE (.*) \[src=([^][:space:]]+) loc=\]$/NODE \1 \2/'
