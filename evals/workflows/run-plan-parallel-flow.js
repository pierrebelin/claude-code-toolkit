// run-plan with `run.parallelBatches` 2, driven by schema-shaped fake agents. F1 and F2 are independent, F3
// depends on F1: F1 runs in the checkout beside F2 in a worktree of its own, then F3 alone.
// together: both pass — F1 gated and committed as alone, F2 gated and committed in its worktree, landed on the
// checkout, its build checked once landed, the worktree removed; F3 then alone; the report told who ran with whom.
// conflict: F2 does not land (a conflict) — discarded, its lines dropped, then run again alone in the checkout.
// landedred: F2's build is red once landed — the checkout put back (`batch-worktree undo`), F2 run again alone.
// aside: F2 blocked in its worktree — set aside there (patch in the run folder), F1 committed, F3 runs.
// serial: `parallel` 1 — no pairing agent, today's run.
// Usage: node run-plan-parallel-flow.js <run-plan.js> together|conflict|landedred|aside|serial
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'together'
const labels = []
const done = new Set()
const deps = { F1: [], F2: [], F3: ['F1'] }
const set = new Set()
const runs = []
const WT = '/r/.claude/worktrees/cctoolkit-batch-F2'
const sheet = b => `/r/todo/x/X-PLAN-${b}.md`
const warn = m => console.log('WARN', m)
const runnable = () => ['F1', 'F2', 'F3'].filter(b => !done.has(b) && !set.has(b) && deps[b].every(d => done.has(d)))
let f2InTree = false
const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (l === 'preflight') {
    if (!prompt.includes('`cctoolkit config parallel-batches` (→ `parallel`')) warn('preflight does not read run.parallelBatches')
    return { ok: true, failure: '', plan: '/r/todo/x/X-PLAN.md', root: '/r', kit: '/k', runRoot: '/r/todo/x/run', stamp: '2026-10-20-1000', parallel: variant === 'serial' ? 1 : 2 }
  }
  if (l === 'next batch') {
    const b = runnable()[0]
    return b ? { kind: 'BATCHES', line: '', batches: [{ batch: b, repo: '/r', sheet: sheet(b) }], held: [], outsideBatch: '', outsidePaths: [] } : { kind: 'END', line: '', batches: [], held: [], outsideBatch: '', outsidePaths: [] }
  }
  if (l === 'pair') {
    if (!prompt.includes('cctoolkit plan-next-batch /r/todo/x/X-PLAN.md') || !prompt.includes('--parallel 2')) warn('pair without the plan or --parallel 2')
    const g = runnable()
    return { batches: g.slice(0, 2).map(b => ({ batch: b, repo: '/r', sheet: sheet(b) })), apart: [] }
  }
  if (l === 'worktree F2') {
    if (!prompt.includes('cctoolkit batch-worktree create F2 --plan /r/todo/x/X-PLAN.md --sheet /r/todo/x/X-PLAN-F2.md')) warn('worktree created without its plan and sheet')
    return { ok: true, path: `${WT}/`, detail: '' }
  }
  if (l === 'journal') {
    if (prompt.includes('∥') && !prompt.includes(`F1 ∥ F2 — run together, F2 in worktree ${WT}`)) warn('journal of the pair malformed')
    return { ok: true }
  }
  if (l.startsWith('gate')) {
    const inTree = prompt.includes(`Batch worktree: \`${WT}\``)
    if (l === 'gate F2' && f2InTree !== (inTree && prompt.includes(`${WT}/todo/x/X-PLAN.md`))) warn('gate F2 in the wrong tree')
    if ((l === 'gate F1' || l === 'gate F2 landed' || l === 'gate F3') && inTree) warn(`${l} in the worktree`)
    if (l === 'gate F2 landed' && variant === 'landedred') return { statusLine: '## STATUS — DONE', verdictLine: 'Verdict: VALID', planDone: true, build: 1 }
    return { statusLine: '## STATUS — DONE', verdictLine: 'Verdict: VALID', planDone: true, build: 0 }
  }
  if (l.startsWith('commit')) {
    const b = l.split(' ')[1]
    const inTree = prompt.includes(`cd '${WT}' && export CLAUDE_PROJECT_DIR='${WT}' &&`)
    if ((b === 'F2' && f2InTree) !== inTree) warn(`commit ${b} in the wrong tree`)
    if (!inTree) done.add(b)
    return { ok: true, commit: `committed abc12${labels.length % 10}f: 3 file(s)` }
  }
  if (l === 'land F2') {
    if (!prompt.includes('cctoolkit batch-worktree land F2')) warn('land without its command')
    if (variant === 'conflict') return { landed: false, commit: '', from: '', detail: 'src/Catalog/Product.cs' }
    done.add('F2')
    return { landed: true, commit: 'def4567', from: 'abc0000', detail: '' }
  }
  if (l === 'discard F2') {
    if (!prompt.includes('cctoolkit run-work drop /r/todo/x/run/.work.jsonl --batch F2')) warn('discard keeps the cycles of F2')
    if ((variant === 'landedred') !== prompt.includes('cctoolkit batch-worktree undo F2 --to abc0000')) warn('discard and undo do not match the landing')
    if (variant === 'landedred') done.delete('F2')
    return { ok: true, detail: '' }
  }
  if (l === 'remove F2') { if (!prompt.includes('cctoolkit batch-worktree remove F2')) warn('worktree not removed'); return { ok: true, detail: '' } }
  if (l.startsWith('aside')) {
    if (l === 'aside F2' && !(prompt.includes(`cd '${WT}'`) && prompt.includes('/r/todo/x/run/2026-10-20-1000-aside-F2.patch'))) warn('aside of F2 outside its worktree or without its patch')
    set.add(l.split(' ')[1])
    return { ok: true, detail: 'restored' }
  }
  if (l === 'final check') return { suites: [] }
  if (l === 'security') return { findings: [] }
  if (l === 'merge prepare') return { exit: 0, nothing: 'nothing to merge: the spec carries no delta anchor', refused: [] }
  if (l === 'report') {
    if (variant !== 'serial' && !(prompt.includes('gets ` ∥ <with>` after its status') && prompt.includes('cctoolkit batch-worktree prune;') && prompt.includes('"with": "F2"'))) warn('report not told which batches ran together')
    if (variant === 'serial' && (prompt.includes('∥') || prompt.includes('batch-worktree'))) warn('serial report mentions parallel runs')
    return { path: '/r/todo/x/run/2026-10-20-1000.md', lastLine: 'x' }
  }
  if (l === 'cleanup') return { ok: true }
  console.log('UNHANDLED', l)
  return null
}
const workflow = async (name, a) => {
  const b = /-(F\d+)\.md$/.exec(a.sheet)[1]
  runs.push(b)
  const inTree = !!a.root
  if (b === 'F2') f2InTree = inTree
  labels.push(`run-lot ${b}${inTree ? ' wt' : ''}`)
  if (inTree && !(a.root === WT && a.sheet === `${WT}/todo/x/X-PLAN-${b}.md` && a.run === '/r/todo/x/run' && a.lock === true)) warn(`run-lot ${b} in the worktree without root, sheet, run, partner or lock`)
  if (!inTree && b === 'F1' && variant !== 'serial' && a.lock !== true) warn('run-lot F1 without the build lock')
  if (!inTree && (b !== 'F1' || variant === 'serial') && (a.lock || a.root)) warn(`run-lot ${b} alone carries parallel arguments`)
  return variant === 'aside' && inTree
    ? { status: 'BLOCKED', reason: 'GREEN stopped', report: `/r/todo/x/run/batches/${b}.md`, toReview: [], hypotheses: [], minors: [] }
    : { status: 'DONE', reason: '—', report: `/r/todo/x/run/batches/${b}.md`, toReview: [], hypotheses: [], minors: [] }
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', src)
fn('todo/x/X-PLAN.md', agent, m => console.log('log:', m), () => {}, async ts => Promise.all(ts.map(t => t())), workflow)
  .then(r => { console.log('STATUS', r.status, '|', r.reason, '|', r.batches.map(x => `${x.batch} ${x.status}${x.with ? ` with ${x.with}` : ''}`).join(', ')); console.log('AGENTS', labels.join(' | ')) })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
