# Parallel REDs — waves

Measurements: `rationale.md` § 2, "Waves" and "RED(n+1) beside GREEN(n)".

Two behaviours with disjoint target test files → both `tdd-test-author` in one message. Check disjointness on the sheet first: shared fixture, shared `CoreTests/` builder, or one test class carrying both scenarios → sequential. GREEN serialised whatever happens: two implementers on one layer collide.

Wave = behaviours whose tests touch neither the same test file nor the same production code — typically one Application + one Infrastructure or WebAPI. A wave's REDs in one message, one `Agent` call each; its GREENs sequential.

**Next wave's REDs go in the same message as the current wave's first GREEN.** Safe while wave n+1 test files stay disjoint from wave n's and no signature stub RED(n+1) needs lands in a file GREEN(n) fills — check both on the sheet; shared stub → that RED back to sequential.

**`CS2012` / `file in use` in an agent = build collision**, not a design fault: two agents building the same `obj/`. Have it re-issue its filtered command, don't re-delegate.
