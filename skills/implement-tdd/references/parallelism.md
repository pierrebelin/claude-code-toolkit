# Waves — parallel REDs

Read by the `run-lot` design. The workflow runs a wave's REDs in parallel, its GREENs one after the other, and starts wave n+1's REDs beside wave n's first GREEN.

- **Same wave** = cycles whose tests touch neither the same test file nor the same production code — typically one Application + one Infrastructure or WebAPI. Check on the sheet: shared fixture, shared builder under `layout.tests.shared`, or one test class carrying both scenarios → successive waves. `cctoolkit sheet-cycles <sheet> --index` refuses two cycles of one wave sharing a `full` test file or a `production` file.
- **Wave n+1 beside GREEN(n)** is safe while its test files stay disjoint from wave n's and no signature stub its RED needs lands in a file a GREEN of wave n fills. Shared stub → move that cycle one wave later.

**One cycle = one homogeneous pattern, one test project, at most 4 test files rewritten and 8 production files.** Every RED and every GREEN costs a fixed spawn, build and read; eleven small cycles for one repeated change cost three times four grouped ones. Group what the same reasoning settles — the same change applied to several exceptions, handlers or endpoints — into one cycle, as long as one test project carries it and the caps hold; `cctoolkit sheet-cycles <sheet> --index` enforces them (test files under `layout.tests.shared` of `kit.config.json` excepted). Past a cap, split by test class or by production folder, each sub-cycle carrying the same step title and its own methods. A sub-cycle with no production of its own (its tests only observe what another sub-cycle's GREEN writes) is not a cycle: keep its tests in the cycle that drives that code.

**A `file in use` / locked-output build error in an agent = build collision**, not a design fault: two agents building the same output directory at once. Have it re-issue its filtered command; don't re-delegate.

**Turn budget.** `tdd-test-author` stops writing past about 26 turns and reports what it wrote; a cycle with more methods than one agent writes in that budget comes back partial and is retried. Keep a cycle's methods to what one agent writes in a sitting — about a dozen of the same shape, fewer when each needs its own fixture.
