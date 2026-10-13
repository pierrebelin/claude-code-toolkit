// Whole run-lot body driven by schema-shaped fake agents: a sheet with a valid `## Cycles` block runs no
// design, a sheet without it runs the design once, a resumed cycle carrying `green` is not redone, an
// unreachable method is listed for review instead of retried, the audit is handed the run's decisions,
// the next sheet is reviewed beside the audit, never designed by this batch.
// Usage: node run-lot-flow.js <run-lot.js> block|nodesign|resume
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'block'
const labels = []
const cyc = (id, wave, b) => ({ id, wave, behaviour: b, rmcu: 'RM-01', steps: ['1. Step'], refactor: false, guard: false, methods: ['A.ShouldX_WhenY', 'A.ShouldDead_WhenZ'], decisions: '' })
const idx = { ok: true, missing: false, errors: [], declaratives: variant === 'block' ? ['src/X.cs — mirrors Y'] : [], cycles: [cyc('C1', 1, 'One'), cyc('C2', 2, 'Two')] }
const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (l === 'resume state' && !prompt.includes('cctoolkit batch-baseline snapshot todo/x/run/.work.jsonl F3')) console.log('WARN no batch snapshot')
  if (l === 'resume state' && !prompt.includes('--states todo/x/run/.work.jsonl')) console.log('WARN saved states not read through sheet-cycles --states')
  if (l === 'resume state') return { cycles: variant === 'resume' ? [{ behaviour: 'One', rmcu: 'RM-01', steps: [], red: { status: 'RED', exit: 1, table: [{ test: 'A.ShouldX_WhenY', case: '' }], tests: [], stubs: [], productionDiff: [], removed: [], expectedFailure: '', command: 'x' }, green: { status: 'GREEN', exit: 0 } }] : [], index: variant === 'nodesign' ? { ok: false, missing: true, errors: ['no block'], declaratives: [], cycles: [] } : idx, nextSheet: 'todo/x/X-PLAN-F4.md' }
  if (l.startsWith('index')) return idx
  if (l === 'design') return { blocked: false, reason: '', review: ['choice x'] }
  if (l === 'declaratives') return { ok: true }
  if (l.startsWith('RED')) return { status: 'RED', exit: 1, command: 'x', tests: ['t.cs'], stubs: [], productionDiff: [], table: [{ test: 'A.ShouldX_WhenY', case: '' }], removed: [], unreachable: [{ method: 'A.ShouldDead_WhenZ', site: 'src/X.cs:3', why: 'never reached' }], expectedFailure: '' }
  if (l.startsWith('GREEN')) return { status: 'GREEN', exit: 0, command: 'x', production: ['src/X.cs'], testsDiff: [], cost: 'Cost: 0 read + 0 write outside loop; Infrastructure in loop or in-memory filter: none', independentOf: 'x', removed: '', flagged: '' }
  if (l === 'suites') return { green: true, suites: [{ name: 'UnitTests', exit: 0, scope: 'whole suite', count: 1 }], fixes: [] }
  if (l === 'pre-audit') return { ok: true, files: [], preauditGreen: true, failures: [] }
  if (l.startsWith('audit')) { if (!prompt.includes('--base todo/x/run/.work.jsonl')) console.log('WARN audit capture without base'); if (!prompt.includes('Decisions the run took')) console.log('WARN audit without decisions'); return { verdict: 'VALID', gaps: [], minors: [], validations: [], hypotheses: [], block: '## Verdict — VALID' } }
  if (l === 'next batch review') return { result: 'GAPS', questions: [{ severity: 'Major', question: 'q', evidence: 'e', decidedBy: 'x', answer: 'a', options: [] }] }
  if (l === 'next sheet') return { ok: true }
  if (l === 'report') { if (!prompt.includes('## To validate')) console.log('WARN report without To validate'); if (!prompt.includes('cctoolkit batch-baseline commit todo/x/run/.work.jsonl F3 --sheet todo/x/X-PLAN-F3.md') || !prompt.includes('--kind preexisting,question,answer')) console.log('WARN batch not committed nor its lines reduced'); if (!prompt.includes('run/batches/F3.md')) console.log('WARN report not under run/batches'); return { path: 'todo/x/run/batches/F3.md' } }
  console.log('UNHANDLED', l); return null
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', src)
fn('todo/x/X-PLAN-F3.md', agent, m => console.log('log:', m), () => {}, async ts => Promise.all(ts.map(t => t())), async () => null)
  .then(r => { console.log('STATUS', r.status, '| toReview', r.toReview.length, r.toReview.map(x => x.step).join(',')); console.log('AGENTS', labels.join(' | ')) })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
