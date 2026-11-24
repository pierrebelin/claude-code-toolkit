// Whole run-sync body driven by schema-shaped fake agents.
// parts: Catalog over budget in two parts, a retire, a conflict the code won — extracted part by part,
//        validated and written; Studio untouched — marked; Billing without prefix — skipped.
// refused: the first apply refused — one repair agent, the second apply written.
// blocked: part 1 BLOCKED — no apply, the drafts kept, the run PARTIAL.
// scanfail: the scan exits 3 — BLOCKED, cctoolkit doctor.
// Usage: node run-sync-flow.js <run-sync.js> parts|refused|blocked|scanfail
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'parts'
const labels = []
const phases = []
let applies = 0
const PLAN = {
  root: 'docs/business', head: 'abc1234', budget: 12000, unassigned: 0,
  contexts: [
    { name: 'Billing', prefix: null, proposedPrefix: 'BIL', mode: 'bootstrap', marks: [], tokens: null, overBudget: false, parts: [{ part: null, tokens: null, useCases: [], files: null }], staged: false, mechanical: [] },
    { name: 'Catalog', prefix: 'CAT', proposedPrefix: null, mode: 'incremental', marks: ['1111111'], tokens: 30000, overBudget: true,
      parts: [{ part: 1, tokens: 11000, useCases: ['CAT-CU-01'], files: 3 }, { part: 2, tokens: 9000, useCases: ['CAT-CU-02'], files: 2 }],
      staged: false, mechanical: ['cctoolkit knowledge-write retire Catalog GetProductQueryHandler'] },
    { name: 'Studio', prefix: 'STU', proposedPrefix: null, mode: 'incremental', marks: ['1111111'], tokens: 0, overBudget: false, parts: [], staged: false, mechanical: [] },
  ],
}
const none = { blocked: '', status: '', adr: [], removed: [], retire: [], overview: 'unchanged', conflicts: [], notCovered: [] }
const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (l === 'scan') {
    if (!prompt.includes('`cctoolkit knowledge-write init; cctoolkit knowledge-scan --plan  2>&1; echo "exit=$?"`')) console.log('WARN scan without its command')
    return variant === 'scanfail'
      ? { exit: 3, staging: '', plan: '', error: 'kit.config.json: knowledge.contexts expects an object' }
      : { exit: 0, staging: 'docs/business/.sync', plan: JSON.stringify(PLAN), error: '' }
  }
  if (l === 'Catalog · mechanical') {
    if (!prompt.includes('cctoolkit knowledge-write retire Catalog GetProductQueryHandler 2>&1; echo "exit=$?"')) console.log('WARN mechanical without its command')
    return { exit: 0, lines: [] }
  }
  if (/^Catalog · part [12]\/2$/.test(l)) {
    const n = l.slice(-3, -2)
    if (o.agentType !== 'cctoolkit:knowledge-extractor' || !prompt.includes('context: Catalog · prefix: CAT · mode: incremental · staging: docs/business/.sync/') || !prompt.includes(`scan option: --part ${n}\n`) && !prompt.endsWith(`scan option: --part ${n}`)) console.log(`WARN part ${n} without its contract`)
    if (variant === 'blocked' && n === '1') return { ...none, blocked: 'knowledge-scan exit 2' }
    return n === '1'
      ? { ...none, status: 'Catalog: 2 file(s), +1 ~1', conflicts: [{ object: 'CAT-RM-002', sheet: 'refused when draft', code: 'archived anyway', evidence: 'src/a.cs:12' }] }
      : { ...none, status: 'Catalog: 1 file(s), ~1', removed: [{ id: 'CAT-RM-005', why: 'guard gone', evidence: 'src/b.cs:4' }], retire: ['ListProductsQueryHandler'] }
  }
  if (l === 'Catalog · retire ListProductsQueryHandler') return { exit: 0, lines: [] }
  if (l === 'Catalog · apply' || l === 'Catalog · apply again') {
    applies++
    if (l === 'Catalog · apply' && !prompt.includes('validate --context Catalog --accept high --drop low')) console.log('WARN apply without validate')
    if (variant === 'refused' && applies === 1) return { exit: 1, lines: ['refused: CAT-RM-?1 in Catalog/usecases/CAT-CU-01.md, applied by CAT-CU-01, CAT-CU-02 — belongs in Catalog/rules.md'] }
    return { exit: 0, lines: ['Catalog: sync abc1234 | +CAT-RM-006 ~CAT-RM-002 -CAT-RM-005', '  +CAT-RM-006 — Names are unique', '  ~CAT-RM-002 — Only a published product can be archived', '  -CAT-RM-005 — Archived twice is a no-op', 'INDEX.md written'] }
  }
  if (l === 'Catalog · repair') {
    if (!prompt.includes('mode: repair') || !prompt.includes('- refused: CAT-RM-?1')) console.log('WARN repair without its lines')
    return none
  }
  if (l === 'mark') {
    if (!prompt.includes('`cctoolkit knowledge-write mark --context Studio 2>&1; echo "exit=$?"`')) console.log('WARN mark without its command')
    return { exit: 0, lines: ['Studio: sync abc1234 | —'] }
  }
  console.log('UNHANDLED', l)
  return null
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', src)
fn('', agent, () => {}, p => phases.push(p))
  .then(r => {
    console.log('STATUS', r.status, '|', r.reason, '|', r.next)
    console.log('PHASES', phases.join(' | '))
    console.log('AGENTS', labels.join(' | '))
    for (const c of r.contexts) console.log('CTX', c.name, c.state, c.parts, `objects=${c.objects.length}`, `conflicts=${c.conflicts.length}`, `removed=${c.removed.length}`, `retired=${c.retired.join(',') || '-'}`)
  })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
