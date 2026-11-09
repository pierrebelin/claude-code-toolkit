// Whole run-fix body driven by schema-shaped fake agents and a fake run-lot.
// written: the batch DONE, the fix spec carries a delta — prepared, drafted by knowledge-merger, written by the run.
// nothing: the batch DONE, the fix restores a documented rule — nothing to merge, no `merge` in the result.
// blocked: run-lot BLOCKED — the run stops, no merge attempted.
// refused: the batch DONE, the apply refused — the merge stays staged, listed to validate with its skill.
// Usage: node run-fix-flow.js <run-fix.js> written|nothing|blocked|refused
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'written'
const labels = []
const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (l === 'merge prepare') {
    if (!prompt.includes('`cctoolkit knowledge-merge prepare todo/fix-1/FIX-1-PLAN.md 2>&1; echo "exit=$?"`')) console.log('WARN merge prepare without its command')
    return variant === 'nothing' ? { exit: 0, nothing: 'nothing to merge: the spec carries no delta anchor', refused: [] } : { exit: 0, nothing: '', refused: [] }
  }
  if (l === 'merge draft') {
    if (o.agentType !== 'cctoolkit:knowledge-merger' || !prompt.includes('plan: todo/fix-1/FIX-1-PLAN.md · partial: no') || !prompt.includes('never `cctoolkit knowledge-write`')) console.log('WARN merge draft without its agent or its contract')
    return { staged: true, stagedLine: 'staged: 1 file(s)', files: ['+1 −1 docs/business/Catalog/usecases/CAT-CU-02.md'], warnings: [], blocked: '' }
  }
  if (l === 'merge apply') {
    if (!prompt.includes('`cctoolkit knowledge-write apply --merge FIX-1 2>&1; echo "exit=$?"`')) console.log('WARN merge apply without its command')
    return variant === 'refused' ? { exit: 1, lines: ['refused: CAT-RM-003 belongs in Catalog/rules.md'] } : { exit: 0, lines: ['written: docs/business/Catalog/usecases/CAT-CU-02.md'] }
  }
  console.log('UNHANDLED', l)
  return null
}
const workflow = async (name, a) => {
  labels.push(`${name.replace(/^cctoolkit:/, '')} ${a.sheet}`)
  if (name !== 'cctoolkit:run-lot' || a.sheet !== 'todo/fix-1/FIX-1-PLAN-F1.md') console.log('WARN run-lot not launched on the fix sheet')
  return variant === 'blocked'
    ? { status: 'BLOCKED', reason: 'C1 RED rejected twice', report: 'todo/fix-1/run/batches/F1.md', toReview: [] }
    : { status: 'DONE', reason: '—', report: 'todo/fix-1/run/batches/F1.md', audit: 'VALID', minors: [], hypotheses: [], toReview: [{ step: 'Audit', text: 'Major — Scope — x' }] }
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'workflow', src)
fn('todo/fix-1/FIX-1-PLAN.md', agent, m => console.log('log:', m), () => {}, workflow)
  .then(r => {
    console.log('STATUS', r.status, '|', r.reason)
    console.log('AGENTS', labels.join(' | '))
    console.log('MERGE', r.merge ? `${r.merge.state} | ${r.merge.next || '—'}` : 'none')
    console.log('REVIEW', (r.toReview || []).map(x => x.step).join(',') || 'none')
  })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
