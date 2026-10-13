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
assert(checkGreen(green([f1])).startsWith(TESTS_AT_GREEN), 'test touched without grant refused')
assert(checkGreen(green([f1])).includes('granted: none'), 'refusal lists the grants')
const g = grantsFrom('allow-test: ' + f1 + ' allow-test: \`/Users/x/repo/' + f2 + '\`')
assert(checkGreen(green([f1, f2]), g) === null, 'granted tests accepted, absolute path normalised')
assert(checkGreen(green(['M ' + f1 + ' (modified)']), g) === null, 'annotated testsDiff line accepted')
assert(checkGreen(green([], 'Cost: … ; Infrastructure in loop or in-memory filter: 1 — design to revisit')) !== null, 'flagged cost refused')
assert(checkGreen(green([], 'Cost: … ; Infrastructure in loop or in-memory filter: 1 — design to revisit'), grantsFrom('accept-cost: pre-existing')) === null, 'accepted cost passes')
assert(checkGreen(green([], 'Coût : 0 lecture + 0 écriture hors boucle ; Infrastructure en boucle ou filtre mémoire : aucun')) === null, 'French cost line accepted')
assert(redLabel({ id: 'C2', wave: 3, behaviour: 'One' }) === 'RED C2 w3 One' && greenLabel({ id: 'C2', behaviour: 'One' }, 'opus') === 'GREEN C2 One opus', 'RED/GREEN labels carry cycle id and wave')
const c = { refactor: false, guard: false, methods: ['A.B'] }
const red = (status, exit, extra = {}) => ({ status, exit, command: 'x', tests: [], stubs: [], productionDiff: [], table: [{ test: 'A.B', case: '' }], removed: [], expectedFailure: '', ...extra })
assert(checkRed(c, red('ALREADY_GREEN', 0), () => new Set()) === null, 'already green accepted')
assert(checkRed(c, red('ALREADY_GREEN', 0, { productionDiff: ['src/X.cs'] }), () => new Set()) !== null, 'already green with code refused')
assert(checkRed(c, red('RED', 0), () => new Set()).includes('ALREADY_GREEN'), 'RED exit 0 points to ALREADY_GREEN')
const two = { ...c, methods: ['A.B', 'A.Dead'] }
assert(checkRed(two, red('RED', 1), () => new Set()).includes('A.Dead'), 'contract method missing from the table refused')
assert(checkRed(two, red('RED', 1, { unreachable: [{ method: 'A.Dead', site: 'src/X.cs:3', why: 'w' }] }), () => new Set()) === null, 'unreachable contract method accepted, no retry loop')
assert(checkRed(two, red('RED', 1, { table: [], unreachable: [{ method: 'A.B', site: 's', why: 'w' }, { method: 'A.Dead', site: 's', why: 'w' }] }), () => new Set()) === null, 'every method unreachable: no test, no GREEN')
assert(contractCommand({ id: 'X1' }, '--red') === 'cctoolkit sheet-cycles todo/x/X-PLAN-F3.md --cycle X1 --red', 'RED reads its contract from the sheet block')
assert(workDir === 'todo/x/run/.work/F3' && reportPath === 'todo/x/run/batches/F3.md' && baseline.startsWith(workDir), 'scratch under run/.work/FX, report in run/batches/FX.md')
const loading = null
const run = async () => {
  let waits = 0
  agent = async (prompt, o) => (o.label.startsWith('wait') ? (waits++, { answered: false, answers: [] }) : o.label.startsWith('question') ? { ok: true } : null)
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
