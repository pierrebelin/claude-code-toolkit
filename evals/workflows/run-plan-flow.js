// Whole run-plan body driven by schema-shaped fake agents: F1 and F2 are set aside, F3 would run.
// common: the breaker finds a cause shared by F1 and F2 — the plan stops before F3, a `breaker` line
// written, the report given its common-cause section. distinct: the plan goes on and runs F3.
// merge: every batch DONE — the merge is prepared, drafted by knowledge-merger and staged, the report
// given its knowledge-base section, the result its `merge`. nomerge: every batch DONE, nothing to merge.
// A security pass reads the batch commits after the final check; its findings (merge) go to `## To validate`.
// Usage: node run-plan-flow.js <run-plan.js> common|distinct|merge|nomerge
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
  if (l.startsWith('gate') && (!prompt.includes('`cctoolkit config command build` prints the solution build') || prompt.includes('test-scope.md'))) console.log('WARN gate without the build command, or sent to test-scope.md')
  if (l.startsWith('gate')) return { statusLine: '## STATUS — DONE', verdictLine: 'Verdict: VALID', planDone: true, build: 0 }
  if (l.startsWith('commit')) return { ok: true, commit: `committed abc12${labels.length % 10}f: 3 file(s)` }
  if (l === 'final check') return { suites: [] }
  if (l === 'security') {
    if (!/Batch commits of the plan: abc12\df( abc12\df)*\./.test(prompt)) console.log('WARN security pass without the batch commits')
    return { findings: variant === 'merge' ? [{ severity: 'Major', finding: 'archive reachable from another organisation', evidence: 'src/A.cs:12', fix: 'check the organisation link' }] : [] }
  }
  if (l === 'merge prepare') {
    if (!prompt.includes('cctoolkit knowledge-merge prepare /r/todo/x/X-PLAN.md')) console.log('WARN merge prepare without the plan')
    return variant === 'merge' ? { exit: 0, nothing: '', refused: [] } : { exit: 0, nothing: 'nothing to merge: the spec carries no delta anchor', refused: [] }
  }
  if (l === 'merge draft') {
    if (o.agentType !== 'cctoolkit:knowledge-merger' || !prompt.includes('plan: /r/todo/x/X-PLAN.md · partial: no') || !prompt.includes('never `cctoolkit knowledge-write`')) console.log('WARN merge draft without its agent or its contract')
    return { staged: true, stagedLine: 'staged: 2 file(s) — cctoolkit knowledge-write apply --merge X', files: ['+3 −0 docs/business/Catalog/rules.md'], warnings: [], blocked: '' }
  }
  if (l === 'report') {
    if (variant === 'common' && !prompt.includes('## Plan stopped — common cause')) console.log('WARN report without the common-cause section')
    if (variant === 'merge' && (!prompt.includes('## Knowledge base') || !prompt.includes('"state": "staged"'))) console.log('WARN report without the knowledge-base merge')
    if (variant === 'merge' && (!prompt.includes('### Security') || !prompt.includes('"step": "Security"'))) console.log('WARN report without the security findings')
    return { path: '/r/todo/x/run/2026-10-15-1000.md', lastLine: 'x' } }
  if (l === 'cleanup') return { ok: true }
  console.log('UNHANDLED', l); return null
}
const workflow = async (name, a) => {
  const b = /-(F\d+)\.md$/.exec(a.sheet)[1]
  labels.push(`run-lot ${b}`)
  return b === 'F3' || variant === 'merge' || variant === 'nomerge'
    ? { status: 'DONE', reason: '—', report: `todo/x/run/batches/${b}.md`, toReview: [], hypotheses: [], minors: [] }
    : { status: 'BLOCKED', reason: b === 'F1' ? 'design ambiguity on archive date' : 'archive date read from the request', report: `todo/x/run/batches/${b}.md`, toReview: [], hypotheses: [], minors: [] }
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', src)
fn('todo/x/X-PLAN.md', agent, m => console.log('log:', m), () => {}, async ts => Promise.all(ts.map(t => t())), workflow)
  .then(r => { console.log('STATUS', r.status, '|', r.reason); console.log('AGENTS', labels.join(' | ')); if (r.merge) console.log('MERGE', r.merge.state, '|', r.merge.next) })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
