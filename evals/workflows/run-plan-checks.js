// Checks of run-plan.js the supervisor applies without any agent: a failure already red on the
// starting tree never fails the gate, a new one does; the gate reads a batch report in either
// vocabulary (English `run/batches/FX.md`, French `run/lots/FX.md` history) and the plan heading.
// The final check's text and section come from one count, whatever a suite's log held.
// The preamble before phase('Preflight') only declares; it runs here with stubbed globals.
// Usage: node run-plan-checks.js <run-plan.js>
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const head = src.slice(0, src.indexOf("phase('Preflight')"))
const tests = `
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1 } else console.log('ok  ', m) }
assert(newFailures(3).join() === 'build=3' && newFailures(0).length === 0, 'the gate fails on a red build only, never on a test suite')
const en = { statusLine: '## STATUS — DONE', verdictLine: 'Verdict: GAPS carried', planDone: true, build: 0 }
const fr = { statusLine: '## STATUT — TERMINÉ', verdictLine: 'Verdict : ECARTS reportés', planDone: true, build: 0 }
assert(gateFailure(en) === null, 'English report: finished batch with carried gaps passes')
assert(gateFailure(fr) === null, 'French report: finished batch with carried gaps passes')
assert(gateFailure({ ...en, verdictLine: 'Verdict: VALID' }) === null && gateFailure({ ...en, verdictLine: 'Verdict: to redo' }) === null, 'English report: VALID and audit to redo pass')
assert(gateFailure({ ...fr, verdictLine: 'Verdict : VALIDE' }) === null && gateFailure({ ...fr, verdictLine: 'Verdict : à refaire' }) === null, 'French report: VALIDE and audit à refaire pass')
assert(gateFailure({ ...en, verdictLine: 'Verdict: GAPS' }).startsWith('verdict'), 'English report: verdict GAPS fails')
assert(gateFailure({ ...fr, verdictLine: 'Verdict : ECARTS' }).startsWith('verdict'), 'French report: verdict ECARTS fails')
assert(gateFailure({ ...en, statusLine: '## STATUS — BLOCKED' }).startsWith('status'), 'English report: status BLOCKED fails')
assert(gateFailure({ ...fr, statusLine: '## STATUT — BLOQUÉ' }).startsWith('status'), 'French report: status BLOQUÉ fails')
assert(gateFailure({ ...en, planDone: false }) !== null, 'plan heading without DONE fails')
assert(dependentsOf('F2', [{ batch: 'F4', by: ['F2'] }, { batch: 'F5', by: ['F3'] }]).join() === 'F4', 'dependents of a batch set aside')
const setupOnly = { name: 'S', exit: 2, report: { failed: 2, total: 9, listed: 2, fromRunner: true, setup: [{ message: 'fixture threw', tests: ['T.A', 'T.B'] }], assertion: [] } }
assert(finalText(setupOnly, 'job').startsWith('S exit=2: 2 failed of 9') && finalText(setupOnly, 'job').includes('not validated') && finalText(setupOnly, 'job').includes('fixture threw') && !finalText(setupOnly, 'job').includes('not attributed'), 'final check: setup failures say the batches are not validated on them')
const onTest = { name: 'S', exit: 2, report: { failed: 1, total: 9, listed: 1, fromRunner: true, setup: [], assertion: [{ message: 'Assert', tests: ['T.A'] }] } }
assert(finalText(onTest, 'job').includes('1 failed on an assertion') && finalText(onTest, 'job').includes('not attributed') && !finalText(onTest, 'job').includes('not validated'), 'final check: assertion failures stay not attributed')
assert(finalSection([setupOnly, onTest]).includes('| S | 2 | 2 of 9 | 2 | 0 |') && finalSection([setupOnly]).includes('T.A') && finalSection([setupOnly]).includes('fixture threw'), 'final check: the table carries the number the text gives')
const shortNames = { name: 'S', exit: 2, report: { failed: 26, total: 492, listed: 16, fromRunner: true, setup: [{ message: 'm', tests: Array(16).fill('T') }], assertion: [] } }
assert(finalText(shortNames, 'job').includes('the log names 16 of them') && finalSection([shortNames]).includes('the log names 16 of them'), 'final check: a list shorter than the runner number is said')
const noResult = { name: 'S', exit: 124, stalled: true, last: ['x'] }
assert(finalText(noResult, 'job').includes('no test result read') && finalSection([noResult]).includes('| S | 124 | — | — | — |') && finalSection([{ name: 'U', exit: 0 }]).includes('| U | 0 | 0 | 0 | 0 |'), 'final check: a red suite with no test result says so')
`
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', head + tests)
fn('todo/x/X-PLAN.md', async () => null, () => {}, () => {}, async () => [], async () => null).catch(e => { console.log('ERR', e.message); process.exitCode = 1 })
