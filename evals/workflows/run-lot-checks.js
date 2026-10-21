// Checks of run-lot.js the orchestrator applies without any agent: a behaviour already on disk, a flagged cost
// line (never a rejection), the hook's RED reason, the retry of a step (once, never on opus outside a cycle),
// the global green repair's test writes.
// The preamble before phase('Design') only declares; it runs here with stubbed globals.
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
// Usage: node run-lot-checks.js <run-lot.js>
const head = src.slice(0, src.indexOf("phase('Design')"))
const tests = `
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1 } else console.log('ok  ', m) }
const green = (testsDiff, cost = 'Cost: 1 read + 0 write outside loop; Infrastructure in loop or in-memory filter: none') => ({ status: 'GREEN', exit: 0, command: 'x', production: [], testsDiff, cost })
const flaggedCost = 'Cost: … ; Infrastructure in loop or in-memory filter: 1 — design to revisit'
assert(checkGreen(green([{ path: 'tests/A.cs', why: 'fixture' }])) === null, 'a test changed at GREEN is no rejection: the hook records it for the audit')
assert(checkGreen(green([], flaggedCost)) === null && costFlagged(green([], flaggedCost)), 'flagged cost accepted, marked for the audit')
assert(!costFlagged(green([], 'Coût : 0 lecture + 0 écriture hors boucle ; Infrastructure en boucle ou filtre mémoire : aucun')), 'French cost line clear')
assert(checkGreen({ ...green([]), exit: 1 }).startsWith('GREEN not observed'), 'GREEN exit 1 rejected')
assert(checkGreen(null).includes('GREEN missing'), 'GREEN missing from the cycle output rejected')
assert(cycleLabel({ id: 'C2', wave: 3, behaviour: 'One' }) === 'RED C2 w3 One +GREEN' && cycleLabel({ id: 'C2', wave: 3, behaviour: 'One' }, 'opus') === 'RED C2 w3 One +GREEN opus', 'cycle label carries cycle id, wave and model')
const c = { id: 'C1', wave: 1, behaviour: 'One', rmcu: 'RM-01', steps: [], refactor: false, guard: false, methods: ['A.B'] }
const red = (status, exit, extra = {}) => ({ status, exit, command: 'x', tests: [], stubs: [], productionDiff: [], table: [{ test: 'A.B', case: '' }], removed: [], expectedFailure: '', ...extra })
assert(checkRed(c, red('ALREADY_GREEN', 0)) === null, 'already green accepted')
assert(checkRed(c, red('ALREADY_GREEN', 0, { stubs: ['src/X.cs'] })) !== null, 'already green with stubs refused')
assert(checkRed(c, red('RED', 1, { productionDiff: ['src/Y.cs'] })) === null, 'productionDiff is display only: the hook checks the tree')
assert(checkRed(c, red('BLOCKED', 1, { diagnostic: RED_ON_STUB + 'NotImplementedException in A.B' })) === RED_ON_STUB + 'NotImplementedException in A.B', 'RED on stub: hook reason is the retry reason, not a BLOCKED')
assert(checkRed(c, red('RED', 0)).includes('ALREADY_GREEN'), 'RED exit 0 points to ALREADY_GREEN')
assert(checkRed({ ...c, guard: true }, red('RED', 0)) === null && checkRed({ ...c, refactor: true }, red('RED', 0)) === null, 'guard and refactor RED green at once accepted')
const two = { ...c, methods: ['A.B', 'A.Dead'] }
assert(checkRed(two, red('RED', 1)).includes('A.Dead'), 'contract method missing from the table refused')
assert(checkRed(two, red('RED', 1, { unreachable: [{ method: 'A.Dead', site: 'src/X.cs:3', why: 'w' }] })) === null, 'unreachable contract method accepted, no retry loop')
assert(checkRed(two, red('RED', 1, { table: [], unreachable: [{ method: 'A.B', site: 's', why: 'w' }, { method: 'A.Dead', site: 's', why: 'w' }] })) === null, 'every method unreachable: no test, no GREEN')
assert(!needsGreen(c, red('ALREADY_GREEN', 0)) && needsGreen(c, red('ALREADY_GREEN', 0, { pendingRipple: ['src/R.cs'] })) && !needsGreen({ ...c, guard: true }, red('RED', 0)), 'GREEN only for a ripple left, never for a guard')
assert(contractCommand({ id: 'X1' }, '--red') === 'cctoolkit sheet-cycles todo/x/X-PLAN-F3.md --cycle X1 --red', 'RED reads its contract from the sheet block')
assert(workFile === 'todo/x/run/.work.jsonl' && reportPath === 'todo/x/run/batches/F3.md' && commitAtEnd, 'one work file run/.work.jsonl, report in run/batches/FX.md, standalone batch commits itself')
const tree = changed => ({ read: true, changed })
const snap = { path: 'tests/C/B.verified.txt', kind: 'snapshot-promoted', why: 'F3, Decisions line 2' }
assert(testWrites(tree([{ path: 'tests/C/B.verified.txt', shared: false }]), [snap]) === null, 'declared snapshot promotion quoting the sheet accepted')
assert(testWrites(tree([{ path: 'tests/C/B.verified.txt', shared: false }]), [{ ...snap, path: '/Users/x/repo/tests/C/B.verified.txt' }]) === null, 'declared path matched once absolute path normalised')
assert(testWrites(tree([{ path: 'tests/C/B.verified.txt', shared: false }]), [{ ...snap, why: ' ' }]).startsWith('snapshot promoted without the sheet line'), 'snapshot promoted without its sheet line rejected')
assert(testWrites(tree([{ path: 'tests/Core/MockX.cs', shared: true }]), []).startsWith('files written under the test roots without a \`testEdits\` entry'), 'undeclared write under the test roots rejected')
assert(testWrites(tree([{ path: 'tests/Core/MockX.cs', shared: true }]), [{ path: 'tests/Core/MockX.cs', kind: 'test-double', why: 'permission X' }]) === null, 'shared double declared accepted')
assert(testWrites(tree([{ path: 'tests/U/Mock.cs', shared: false }]), [{ path: 'tests/U/Mock.cs', kind: 'test-double', why: 'x' }]).startsWith('BLOCKED'), 'double outside layout.tests.shared is a BLOCKED')
assert(testWrites(tree([{ path: 'tests/U/ATests.cs', shared: false }]), [{ path: 'tests/U/ATests.cs', kind: 'test-code', why: 'x' }]).startsWith('BLOCKED'), 'test-code write is a BLOCKED')
assert(testWrites({ read: false, changed: [] }, []) === null && testWrites(null, []) === null, 'test tree unread: nothing checked here')
const run = async () => {
  lotIndex = { declaratives: [] }
  const contract = cycleContract(c)
  assert(contract.includes("cctoolkit tdd-scope red <<'RED_JSON'") && contract.includes('--cycle C1 --red') && contract.includes('--cycle C1 --green') && contract.includes('\`decisions\`'), 'one cycle contract: RED, checkpoint, GREEN, ambiguity decided by the agent')
  const rearm = cycleContract(c, red('RED', 1))
  assert(rearm.includes('its RED was accepted earlier') && rearm.includes(JSON.stringify(red('RED', 1))) && rearm.includes('Run no test before the checkpoint'), 'an accepted RED is re-armed verbatim, no test run before')
  assert(!cycleContract({ ...c, guard: true }).includes('--cycle C1 --green'), 'a guard has no GREEN contract')
  const calls = []
  const out = await withRetry('Design', (suffix, options) => (calls.push({ suffix, options }), Promise.resolve(null)), r => (r ? null : 'design agent without result'))
  assert(out.reason && calls.length === 2 && calls.every(x => !x.options.model), 'a step outside the cycles is retried once, never on opus')
  assert(calls[1].suffix.includes('Before anything else, one call: \`cctoolkit run-work append') && calls[1].suffix.includes('without structured output'), 'the retry writes its attempt line and says why')
}
await run()
`
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', head + tests)
fn('todo/x/X-PLAN-F3.md', async () => null, () => {}, () => {}, async () => [], async () => null).catch(e => { console.log('ERR', e.message); process.exitCode = 1 })
