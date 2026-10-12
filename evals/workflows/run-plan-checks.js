// Checks of run-plan.js the supervisor applies without any agent: a failure already red on the
// starting tree never fails the gate, a new one does; the gate reads a batch report in either
// vocabulary (English `run/batches/FX.md`, French `run/lots/FX.md` history) and the plan heading.
// The preamble before phase('Preflight') only declares; it runs here with stubbed globals.
// Usage: node run-plan-checks.js <run-plan.js>
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const head = src.slice(0, src.indexOf("phase('Preflight')"))
const tests = `
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1 } else console.log('ok  ', m) }
const start = [{ name: 'UnitTests', exit: 2, failed: ['failed Ns.A.B (12 ms)'] }, { name: 'ContractTests', exit: 7, failed: [] }]
const suite = (name, exit, failed = []) => ({ name, exit, failed })
assert(newFailures(0, [suite('UnitTests', 2, ['Ns.A.B']), suite('ContractTests', 7), suite('ArchitectureTests', 0)], start).length === 0, 'failures present at start never fail the gate')
assert(newFailures(0, [suite('UnitTests', 2, ['Ns.A.B', '[FAIL] Ns.A.C(x: 1)'])], start).join() === 'UnitTests Ns.A.C', 'a new failing test fails the gate, named')
assert(newFailures(0, [suite('ArchitectureTests', 1)], start).join() === 'ArchitectureTests exit=1', 'a suite red without named test and green at start fails the gate')
assert(newFailures(3, [], start).join() === 'build=3', 'a red build fails the gate')
const en = { statusLine: '## STATUS — DONE', verdictLine: 'Verdict: GAPS carried', planDone: true, build: 0, suites: [] }
const fr = { statusLine: '## STATUT — TERMINÉ', verdictLine: 'Verdict : ECARTS reportés', planDone: true, build: 0, suites: [] }
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
`
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', head + tests)
fn('todo/x/X-PLAN.md', async () => null, () => {}, () => {}, async () => [], async () => null).catch(e => { console.log('ERR', e.message); process.exitCode = 1 })
