// Whole run-replay body driven by schema-shaped fake agents, on batch F1 of todo/x/X-PLAN.md: C1 carries its
// saved command, C2 none (the tests agent writes it, on sonnet). pass: every test green, audit VALID.
// red: C2 red on replay and an audit Major — FAILED, each a correction command under ## Next.
// redcheck: --red, C1 red without the batch code, C2 still green — a point to check, not a failure.
// refused: no Kit-Batch commit — SKIPPED, no report. noaudit: --no-audit, no auditor.
// plan: the plan lists F1 ✅, F2 ⬜, F3 ✅ — run-replay on F1 and F3 only, F3 FAILED.
// Usage: node run-replay-flow.js <run-replay.js> pass|red|redcheck|refused|noaudit|plan
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'pass'
const labels = []
const warn = m => console.log(`WARN ${m}`)
const cycles = [
  { id: 'C1', behaviour: 'Archive a product', rmcu: 'RM-01', refactor: false, guard: false, level: 'UT', testClass: 'ArchiveTests', saved: true, tests: ['ArchiveTests.ShouldArchive'], files: ['tests/U/ArchiveTests.cs'], command: 'dotnet test --project tests/U --filter-class "*ArchiveTests"' },
  { id: 'C2', behaviour: 'Refuse archiving twice', rmcu: 'RM-02', refactor: false, guard: false, level: 'UT', testClass: 'ArchiveTests', saved: false, tests: ['ArchiveTests.ShouldRefuse_WhenArchived'], files: [], command: '' },
]
const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (l === 'batches') return { batches: [{ batch: 'F1', done: true }, { batch: 'F2', done: false }, { batch: 'F3', done: true }] }
  if (l === 'replay range') {
    if (!prompt.includes('cctoolkit batch-baseline replay todo/x/run/.work.jsonl F1') || !prompt.includes('cctoolkit sheet-cycles todo/x/X-PLAN-F1.md --tests todo/x/run/.work.jsonl')) warn('range without its two commands')
    return variant === 'refused'
      ? { refused: 'no commit carries `Kit-Batch: x/F1`', range: { base: '', head: '', commits: [], files: [] }, count: 0, cycles: [] }
      : { refused: '', range: { base: 'aaaaaaaaaaaa0', head: 'bbbbbbbbbbbb0', commits: ['bbbbbbbbbbbb0'], files: ['src/A.cs'] }, count: 2, cycles }
  }
  if (l === 'replay tests') {
    if (o.model !== 'sonnet') warn('a cycle without saved command, tests agent not on sonnet')
    if (!prompt.includes('cctoolkit suites-plan todo/x/run/.work.jsonl F1') || !prompt.includes('- C1 — `dotnet test --project tests/U --filter-class "*ArchiveTests"`') || !prompt.includes('- C2 — no saved command')) warn('tests without the plan or the cycle commands')
    return { build: { exit: 0, output: '' }, suites: [{ name: 'UnitTests', exit: 0, scope: 'whole suite', count: 40, output: '/t/u.txt', failed: [] }], cycles: [{ id: 'C1', command: 'x', exit: 0, output: '/t/c1', failed: [] }, { id: 'C2', command: 'y', exit: variant === 'red' ? 1 : 0, output: '/t/c2', failed: variant === 'red' ? ['ArchiveTests.ShouldRefuse_WhenArchived'] : [] }], unresolved: [], notRun: [] }
  }
  if (l === 'replay red') {
    if (!prompt.includes('cctoolkit batch-baseline red todo/x/run/.work.jsonl F1 --root <path>') || !prompt.includes('cctoolkit batch-worktree remove F1')) warn('red check without its worktree commands')
    return { ok: true, detail: 'red: 1 production file(s) back', build: 0, cycles: [{ id: 'C1', exit: 1 }, { id: 'C2', exit: 0 }], removed: true }
  }
  if (l === 'audit') {
    if (o.agentType !== 'cctoolkit:ddd-tdd-auditor' || !prompt.includes('--base todo/x/run/.work.jsonl --suites-green UnitTests') || !prompt.includes('`aaaaaaaaaaaa..bbbbbbbbbbbb`')) warn('audit without its capture on the replayed range')
    return variant === 'red'
      ? { verdict: 'GAPS', gaps: [{ severity: 'Major', axis: 'Placement', gap: 'archive rule in the handler', evidence: 'src/A.cs:3', closure: 'rule in the aggregate', fix: 'move it' }], minors: [], validations: [], hypotheses: [], block: 'b' }
      : { verdict: 'VALID', gaps: [], minors: [], validations: [], hypotheses: [], block: 'b' }
  }
  if (l === 'report') {
    if (!prompt.includes('todo/x/run/batches/F1-replay.md') || !prompt.includes('--kind replay')) warn('report without its path or the replay line dropped')
    const status = /## REPLAY — (\w+)/.exec(prompt)
    console.log(`REPORT ${status ? status[1] : '?'}`)
    if (variant === 'red' && !prompt.includes('`/cctoolkit:implement-tdd batch F1 — correction: Refuse archiving twice red on replay: ArchiveTests.ShouldRefuse_WhenArchived`')) warn('red cycle without its correction command')
    if (variant === 'redcheck' && !prompt.includes('| C2 | Refuse archiving twice | RM-02 | 1 | green | NOT RED |')) warn('red check row missing')
    return { path: 'todo/x/run/batches/F1-replay.md' }
  }
  console.log('UNHANDLED', l); return null
}
const workflow = async (name, a) => {
  if (name !== 'cctoolkit:run-replay') warn(`child ${name}`)
  const b = /-(F\d+)\.md$/.exec(a.sheet)[1]
  labels.push(`run-replay ${b}`)
  return b === 'F3' ? { status: 'FAILED', reason: 'cycles red: C1', report: `todo/x/run/batches/${b}-replay.md`, toCheck: [] } : { status: 'PASSED', reason: '—', report: `todo/x/run/batches/${b}-replay.md`, toCheck: [] }
}
const argument = variant === 'plan' ? 'todo/x/X-PLAN.md' : `todo/x/X-PLAN-F1.md${variant === 'redcheck' ? ' --red' : variant === 'noaudit' ? ' --no-audit' : ''}`
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', src)
fn(argument, agent, m => console.log('log:', m), () => {}, async ts => Promise.all(ts.map(t => t())), workflow)
  .then(r => {
    console.log('STATUS', r.status, '|', r.reason)
    console.log('AGENTS', labels.join(' | '))
    if (r.toCheck) console.log('TOCHECK', r.toCheck.map(x => x.step).join(', ') || 'none')
    if (r.batches && variant === 'plan') console.log('BATCHES', r.batches.map(b => `${b.batch} ${b.status}`).join(', '), '| not replayed', (r.notReplayed || []).join(', '))
  })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
