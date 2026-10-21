// Checks of run-lot.js the orchestrator applies without any agent: grants passed by value (a
// module-level Set lost them under workflow('run-lot')), a behaviour already on disk, the cost line, the
// 10 min answer timeout and the last attempt on another model.
// The preamble before phase('Design') only declares; it runs here with stubbed globals.
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
// Usage: node run-lot-checks.js <run-lot.js>
const head = src.slice(0, src.indexOf("phase('Design')"))
const tests = `
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1 } else console.log('ok  ', m) }
const green = (testsDiff, cost = 'Cost: 1 read + 0 write outside loop; Infrastructure in loop or in-memory filter: none') => ({ status: 'GREEN', exit: 0, command: 'x', production: [], testsDiff, cost })
const f1 = 'tests/Shop.UnitTests/Catalog/CreateProduct/CreateProductTests.Variants.cs'
const f2 = 'tests/Shop.UnitTests/Catalog/UpdateProduct/UpdateProductTestsFixture.cs'
const blocked = diagnostic => ({ status: 'BLOCKED', exit: 1, command: 'x', production: [], testsDiff: [], cost: '', diagnostic })
assert(checkGreen(green([f1])) === null, 'testsDiff is display only: the hook checks the tree')
assert(checkGreen(blocked(TESTS_AT_GREEN + f1 + GRANTED + 'none')) === TESTS_AT_GREEN + f1 + GRANTED + 'none', 'hook reason returned verbatim, the arbiter parses it')
const g = grantsFrom('allow-test: ' + f1 + ' allow-test: \`/Users/x/repo/' + f2 + '\`')
assert(decided('allow-test: ' + f1, g).includes(GRANT_LINE + f1 + ', ' + f2 + '.'), 'grants reach the prompt on the line the hook reads, absolute path normalised')
assert([...grantsFrom('Grant it: allow-test: ' + f1 + '. Then allow-test: ' + f2 + '.').tests].join(',') === f1 + ',' + f2, 'a path closing the sentence loses its period')
assert(checkGreen(green([], 'Cost: … ; Infrastructure in loop or in-memory filter: 1 — design to revisit')) !== null, 'flagged cost refused')
assert(checkGreen(green([], 'Cost: … ; Infrastructure in loop or in-memory filter: 1 — design to revisit'), grantsFrom('accept-cost: pre-existing')) === null, 'accepted cost passes')
assert(checkGreen(green([], 'Coût : 0 lecture + 0 écriture hors boucle ; Infrastructure en boucle ou filtre mémoire : aucun')) === null, 'French cost line accepted')
assert(redLabel({ id: 'C2', wave: 3, behaviour: 'One' }) === 'RED C2 w3 One' && greenLabel({ id: 'C2', behaviour: 'One' }, 'opus') === 'GREEN C2 One opus', 'RED/GREEN labels carry cycle id and wave')
const c = { refactor: false, guard: false, methods: ['A.B'] }
const red = (status, exit, extra = {}) => ({ status, exit, command: 'x', tests: [], stubs: [], productionDiff: [], table: [{ test: 'A.B', case: '' }], removed: [], expectedFailure: '', ...extra })
assert(checkRed(c, red('ALREADY_GREEN', 0)) === null, 'already green accepted')
assert(checkRed(c, red('ALREADY_GREEN', 0, { stubs: ['src/X.cs'] })) !== null, 'already green with stubs refused')
assert(checkRed(c, red('RED', 1, { productionDiff: ['src/Y.cs'] })) === null, 'productionDiff is display only: the hook checks the tree')
assert(checkRed(c, red('BLOCKED', 1, { diagnostic: RED_ON_STUB + 'NotImplementedException in A.B' })) === RED_ON_STUB + 'NotImplementedException in A.B', 'RED on stub: hook reason is the retry reason, not a BLOCKED')
assert(checkRed(c, red('RED', 0)).includes('ALREADY_GREEN'), 'RED exit 0 points to ALREADY_GREEN')
const two = { ...c, methods: ['A.B', 'A.Dead'] }
assert(checkRed(two, red('RED', 1)).includes('A.Dead'), 'contract method missing from the table refused')
assert(checkRed(two, red('RED', 1, { unreachable: [{ method: 'A.Dead', site: 'src/X.cs:3', why: 'w' }] })) === null, 'unreachable contract method accepted, no retry loop')
assert(checkRed(two, red('RED', 1, { table: [], unreachable: [{ method: 'A.B', site: 's', why: 'w' }, { method: 'A.Dead', site: 's', why: 'w' }] })) === null, 'every method unreachable: no test, no GREEN')
assert(contractCommand({ id: 'X1' }, '--red') === 'cctoolkit sheet-cycles todo/x/X-PLAN-F3.md --cycle X1 --red', 'RED reads its contract from the sheet block')
assert(workFile === 'todo/x/run/.work.jsonl' && reportPath === 'todo/x/run/batches/F3.md' && commitAtEnd, 'one work file run/.work.jsonl, report in run/batches/FX.md, standalone batch commits itself')
const tree = changed => ({ read: true, changed })
const snap = { path: 'tests/C/B.verified.txt', kind: 'snapshot-promoted', why: 'F3, Decisions line 2' }
assert(testWrites(tree([{ path: 'tests/C/B.verified.txt', shared: false }]), [snap]) === null, 'declared snapshot promotion quoting the sheet accepted')
assert(testWrites(tree([{ path: 'tests/C/B.verified.txt', shared: false }]), [{ ...snap, path: '/Users/x/repo/tests/C/B.verified.txt' }]) === null, 'declared path matched once absolute path normalised')
assert(testWrites(tree([{ path: 'tests/C/B.verified.txt', shared: false }]), [{ ...snap, why: ' ' }]).startsWith('snapshot promoted without the sheet line'), 'snapshot promoted without its sheet line rejected')
assert(testWrites(tree([{ path: 'tests/Core/MockX.cs', shared: true }]), []).startsWith('files written under the test roots without a `testEdits` entry'), 'undeclared write under the test roots rejected')
assert(testWrites(tree([{ path: 'tests/Core/MockX.cs', shared: true }]), [{ path: 'tests/Core/MockX.cs', kind: 'test-double', why: 'permission X' }]) === null, 'shared double declared accepted')
assert(testWrites(tree([{ path: 'tests/U/Mock.cs', shared: false }]), [{ path: 'tests/U/Mock.cs', kind: 'test-double', why: 'x' }]).startsWith('BLOCKED'), 'double outside layout.tests.shared is a BLOCKED')
assert(testWrites(tree([{ path: 'tests/U/ATests.cs', shared: false }]), [{ path: 'tests/U/ATests.cs', kind: 'test-code', why: 'x' }]).startsWith('BLOCKED'), 'test-code write is a BLOCKED')
assert(testWrites({ read: false, changed: [] }, []) === null && testWrites(null, []) === null, 'test tree unread: nothing checked here')
const loading = null
const run = async () => {
  let waits = 0
  agent = async (prompt, o) => (o.label.startsWith('wait') ? (waits++, { answered: false, answers: [] }) : o.label.startsWith('question') ? { ok: true, id: 'F3-1' } : null)
  const applied = await ask('stop', 'GREEN x', [{ severity: 'Blocking', question: 'q ?', evidence: 'e', options: [], recommendation: 'do X' }])
  assert(waits === WAIT_ROUNDS && WAIT_ROUNDS * WAIT_SECONDS <= 600, 'question waits 10 min at most')
  assert(applied && applied[0].text === 'do X' && applied[0].recommended, 'unanswered question takes its recommendation')
  assert(history.toReview.some(x => x.text.startsWith(UNANSWERED)), 'recommendation applied without answer listed for review')
  assert(await ask('stop', 'GREEN y', [{ severity: 'Blocking', question: 'q ?', evidence: 'e', options: [], recommendation: '' }]) === null, 'unanswered question without recommendation stays unanswered')
  agent = async (prompt, o) => (o.label.startsWith('arbiter') ? { decision: 'continue', text: 'redo Y', rationale: 'r' } : null)
  const calls = []
  const out = await withRetry('GREEN z', (suffix, options) => (calls.push({ suffix, options }), Promise.resolve(null)), r => (r ? null : 'GREEN agent without result'))
  const last = calls[calls.length - 1]
  assert(out.reason && calls.length === 5 && last.options.model === LAST_MODEL, 'GREEN stopped twice the same way after its decisions gets one last attempt on opus')
  assert(last.suffix.includes('redo Y') && last.suffix.includes('GREEN agent without result'), 'last attempt carries reasons and decisions')
  assert(calls.slice(0, -1).every(x => !x.options.model), 'earlier attempts keep the default model')
  const design = []
  await withRetry('Design', (suffix, options) => (design.push(options), Promise.resolve(null)), r => (r ? null : 'design agent without result'))
  assert(design.every(o => !o.model), 'no escalation outside RED and GREEN')
  agent = async (prompt, o) => (o.label.startsWith('arbiter') ? { decision: 'defer', text: 'later', rationale: 'r' } : null)
  const deferred = []
  const d = await withRetry('RED w', (suffix, options) => (deferred.push(options), Promise.resolve(null)), r => (r ? null : 'RED agent without result'))
  assert(d.deferred && deferred.every(o => !o.model), 'deferred step never escalates')
}
await run()
`
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', head + tests)
fn('todo/x/X-PLAN-F3.md', async () => null, () => {}, () => {}, async () => [], async () => null).catch(e => { console.log('ERR', e.message); process.exitCode = 1 })
