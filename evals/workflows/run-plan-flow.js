// Whole run-plan body driven by schema-shaped fake agents: F1 and F2 are set aside, F3 would run.
// common: the breaker finds a cause shared by F1 and F2 — the plan stops before F3, a `breaker` line
// written, the report given its common-cause section. distinct: the plan goes on and runs F3.
// paused: the scheduler answers PAUSED after F1 — the plan stops cleanly, reason `paused by user`.
// Usage: node run-plan-flow.js <run-plan.js> common|distinct|paused
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'common'
const labels = []
const order = ['F1', 'F2', 'F3']
let next = 0
const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (l === 'preflight') return { ok: true, failure: '', plan: '/r/todo/x/X-PLAN.md', root: '/r', kit: '/k', runRoot: '/r/todo/x/run', stamp: '2026-10-15-1000' }
  if (l === 'next batch') {
    if (variant === 'paused' && next === 1) return { kind: 'PAUSED', line: 'paused by user', batches: [], held: [], outsideBatch: '', outsidePaths: [] }
    const b = order[next++]
    return b ? { kind: 'BATCHES', line: '', batches: [{ batch: b, repo: '/r', sheet: `todo/x/X-PLAN-${b}.md` }], held: [], outsideBatch: '', outsidePaths: [] } : { kind: 'END', line: '', batches: [], held: [], outsideBatch: '', outsidePaths: [] }
  }
  if (l.startsWith('aside')) return { ok: true, detail: 'restored' }
  if (l === 'breaker line') { if (!prompt.includes(`"decision":"${variant === 'common' ? 'stop' : 'continue'}"`)) console.log('WARN breaker line without its decision'); return { ok: true } }
  if (l.startsWith('breaker ')) {
    if (!prompt.includes('F1 — BLOCKED — design ambiguity on archive date') || !prompt.includes('report `todo/x/run/batches/F2.md`')) console.log('WARN breaker without the reasons and reports')
    return variant === 'common' ? { commonCause: true, cause: 'archive date source ambiguous in the spec', batches: ['F1', 'F2'], fixBeforeRelaunch: 'state the archive date source' } : { commonCause: false, cause: 'unrelated', batches: [], fixBeforeRelaunch: '' }
  }
  if (l === 'journal') return { ok: true }
  if (l.startsWith('gate')) return { statusLine: '## STATUS — DONE', verdictLine: 'Verdict: VALID', planDone: true, build: 0 }
  if (l.startsWith('commit')) return { ok: true, commit: 'abc123: batch' }
  if (l === 'final check') return { suites: [] }
  if (l === 'report') { if (variant === 'common' && !prompt.includes('## Plan stopped — common cause')) console.log('WARN report without the common-cause section'); return { path: '/r/todo/x/run/2026-10-15-1000.md', lastLine: 'x' } }
  if (l === 'cleanup') return { ok: true }
  console.log('UNHANDLED', l); return null
}
const workflow = async (name, a) => {
  const b = /-(F\d+)\.md$/.exec(a.sheet)[1]
  labels.push(`run-lot ${b}`)
  return b === 'F3' || (variant === 'paused' && b === 'F1')
    ? { status: 'DONE', reason: '—', report: `todo/x/run/batches/${b}.md`, toReview: [], hypotheses: [], minors: [] }
    : { status: 'BLOCKED', reason: b === 'F1' ? 'design ambiguity on archive date' : 'archive date read from the request', report: `todo/x/run/batches/${b}.md`, toReview: [], hypotheses: [], minors: [] }
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', src)
fn('todo/x/X-PLAN.md', agent, m => console.log('log:', m), () => {}, async ts => Promise.all(ts.map(t => t())), workflow)
  .then(r => { console.log('STATUS', r.status, '|', r.reason); console.log('AGENTS', labels.join(' | ')) })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
