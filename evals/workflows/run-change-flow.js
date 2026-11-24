// Whole run-change body driven by schema-shaped fake agents and a fake run-lot.
// written: the draft READY with one assumption, the batch DONE, the delta prepared, drafted by knowledge-merger and written.
// outofscope: the draft OUT_OF_SCOPE — the run stops before run-lot, business-spec named.
// ambiguous: the draft AMBIGUOUS — the run stops with its questions.
// nopath: the draft READY without a plan path — BLOCKED before run-lot.
// blocked: run-lot BLOCKED — the run stops with its reason and the resume command, no merge attempted.
// resume: the argument is a plan path — no draft, run-lot on its sheet, then the merge.
// Usage: node run-change-flow.js <run-change.js> written|outofscope|ambiguous|nopath|blocked|resume
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'written'
const labels = []
const READY = { status: 'READY', reason: '—', plan: 'todo/chg-archive/CHG-ARCHIVE-PLAN.md', rule: 'CAT-RM-003 — An archived product is never listed', before: 'An archived product is hidden from the catalog.', after: 'An archived product is never listed, even to its owner.', assumptions: ['existing archived products need no migration'], questions: [] }
const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (l === 'draft') {
    if (!prompt.includes('Change requested: archived products must not be listed to their owner either') || !prompt.includes('<kit>/skills/fix-bug/references/fix-template.md') || !prompt.includes('Code: `chg-archive`.')) console.log('WARN draft without the request, the template or the code')
    if (variant === 'outofscope') return { ...READY, status: 'OUT_OF_SCOPE', reason: 'no rule of the base says it: a new capability', plan: '', rule: '', before: '', after: '', assumptions: [] }
    if (variant === 'ambiguous') return { ...READY, status: 'AMBIGUOUS', reason: 'two readings', plan: '', assumptions: [], questions: ['Do admins still see archived products? (yes / no)'] }
    if (variant === 'nopath') return { ...READY, plan: '' }
    return READY
  }
  if (l === 'merge prepare') {
    if (!prompt.includes('`cctoolkit knowledge-merge prepare todo/chg-archive/CHG-ARCHIVE-PLAN.md 2>&1; echo "exit=$?"`')) console.log('WARN merge prepare without its command')
    return { exit: 0, nothing: '', refused: [] }
  }
  if (l === 'merge draft') {
    if (o.agentType !== 'cctoolkit:knowledge-merger' || !prompt.includes('plan: todo/chg-archive/CHG-ARCHIVE-PLAN.md · partial: no')) console.log('WARN merge draft without its agent or its contract')
    return { staged: true, stagedLine: 'staged: 1 file(s)', files: ['+1 −1 docs/business/Catalog/rules.md'], warnings: [], blocked: '' }
  }
  if (l === 'merge apply') {
    if (!prompt.includes('`cctoolkit knowledge-write apply --merge CHG-ARCHIVE 2>&1; echo "exit=$?"`')) console.log('WARN merge apply without its command')
    return { exit: 0, lines: ['written: docs/business/Catalog/rules.md'] }
  }
  console.log('UNHANDLED', l)
  return null
}
const workflow = async (name, a) => {
  labels.push(`${name.replace(/^cctoolkit:/, '')} ${a.sheet}`)
  if (name !== 'cctoolkit:run-lot' || a.sheet !== 'todo/chg-archive/CHG-ARCHIVE-PLAN-F1.md') console.log('WARN run-lot not launched on the change sheet')
  return variant === 'blocked'
    ? { status: 'BLOCKED', reason: 'C1 RED rejected twice', report: 'todo/chg-archive/run/batches/F1.md', toReview: [] }
    : { status: 'DONE', reason: '—', report: 'todo/chg-archive/run/batches/F1.md', audit: 'VALID', minors: [], hypotheses: [], toReview: [{ step: 'Audit', text: 'Major — Scope — x' }] }
}
const arg = variant === 'resume' ? 'todo\\chg-archive\\CHG-ARCHIVE-PLAN.md' : 'archived products must not be listed to their owner either --code chg-archive'
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'workflow', src)
fn(arg, agent, m => console.log('log:', m), () => {}, workflow)
  .then(r => {
    console.log('STATUS', r.status, '|', r.reason)
    console.log('AGENTS', labels.join(' | '))
    console.log('RULE', r.rule ? r.rule.id : 'none')
    console.log('MERGE', r.merge ? `${r.merge.state} | ${r.merge.next || '—'}` : 'none')
    console.log('REVIEW', (r.toReview || []).map(x => x.step).join(',') || 'none')
    console.log('NEXT', r.next)
  })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
