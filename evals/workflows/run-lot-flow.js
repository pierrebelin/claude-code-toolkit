// Whole run-lot body driven by schema-shaped fake agents: a sheet with a valid `## Cycles` block runs no
// design, a sheet without it runs the design once, a resumed cycle carrying `green` is not redone, an
// unreachable method is listed for review instead of retried, the audit is handed the run's decisions,
// the next sheet is reviewed beside the audit, never designed by this batch; past 12 cycles one capture
// feeds two auditors in parallel, the green suites marked for the rerun guard.
// contest: the fix contests a gap with a named harm and another without; the resume audit first forgets to
// answer (audited again), then Accepts — the gap closes, its trade-off listed; refute: the audit Refutes, round 2 fixes.
// scope: the fix changes a file no finding cites — a Scope Major the run adds itself, carried.
// diverge: findings stay open while the fix changed more than a file and its test per finding — rounds stop.
// verify: a fresh agent refutes the Reuse Major before the fix — the fix and the resume audit are told,
// the repeated finding is dropped without a second check, listed for review.
// ripple: an ALREADY_GREEN leaving ripple files out of the batch diff still runs its GREEN on them; one leaving none runs none.
// light: the block plans a light closing — one tdd-cycle agent per cycle, the diff confirms it: one light review, its
// Majors fixed without a second review (the suites rerun instead), no next-batch review the next sheet does not need.
// lightblock: the light review finds a Blocking — round relays, a second light review on the change set; the next
// sheet names a changed type, so it is reviewed. lightred: the cycle agent's RED is rejected — RED alone, then GREEN.
// Usage: node run-lot-flow.js <run-lot.js> block|nodesign|resume|split|contest|refute|scope|diverge|verify|ripple|light|lightblock|lightred
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'block'
const labels = []
let audits = 0
let reviews = 0
const isLight = variant.startsWith('light')
const GAPV = { verdict: 'GAPS', gaps: [{ severity: 'Major', axis: 'Reuse', gap: 'Second type of the same shape', evidence: 'src/X.cs:3', closure: 'one type left', fix: 'rename' }, { severity: 'Major', axis: 'Scope', gap: 'Hunk outside the batch', evidence: 'src/Y.cs:1', closure: 'hunk gone', fix: 'revert' }], minors: [], validations: [], hypotheses: [], block: '## Verdict — GAPS' }
const cyc = (id, wave, b) => ({ id, wave, behaviour: b, rmcu: 'RM-01', steps: ['1. Step'], refactor: false, guard: false, methods: ['A.ShouldX_WhenY', 'A.ShouldDead_WhenZ'], decisions: '' })
const idx = { ok: true, missing: false, errors: [], declaratives: variant === 'block' ? ['src/X.cs — mirrors Y'] : [], cycles: variant === 'split' ? Array.from({ length: 13 }, (_, i) => cyc(`C${i + 1}`, 1, `B${i + 1}`)) : [cyc('C1', 1, 'One'), cyc('C2', 2, 'Two')] }
if (isLight) Object.assign(idx, { closing: { level: 'light', reasons: [], production: 3 }, cycles: idx.cycles.map((c, i) => ({ ...c, files: [`src/C${i}.cs`, `tests/C${i}Tests.cs`] })) })
const REDOK = { status: 'RED', exit: 1, command: 'x', tests: ['t.cs'], stubs: [], productionDiff: [], table: [{ test: 'A.ShouldX_WhenY', case: '' }], removed: [], unreachable: [{ method: 'A.ShouldDead_WhenZ', site: 'src/X.cs:3', why: 'never reached' }], expectedFailure: '' }
const GREENOK = { status: 'GREEN', exit: 0, command: 'x', production: ['src/X.cs'], testsDiff: [], cost: 'Cost: 0 read + 0 write outside loop; Infrastructure in loop or in-memory filter: none', independentOf: 'x', removed: '', flagged: '' }
const VALIDV = { verdict: 'VALID', gaps: [], minors: [], validations: [], hypotheses: [], block: '## Verdict — VALID' }
const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (isLight && l.endsWith('+GREEN')) {
    const own = l.startsWith('RED C1') ? 'C1' : 'C2'
    if (o.agentType !== 'cctoolkit:tdd-cycle' || !prompt.includes("cctoolkit tdd-scope red <<'RED_JSON'") || !prompt.includes(`--cycle ${own} --red`) || !prompt.includes(`--cycle ${own} --green`)) console.log('WARN cycle agent without its type, checkpoint or two contracts')
    return variant === 'lightred' && own === 'C1' ? { red: { ...REDOK, exit: 0 } } : { red: REDOK, green: GREENOK }
  }
  if (isLight && l === 'suites') {
    if (!prompt.includes('cctoolkit closing-level todo/x/X-PLAN-F3.md todo/x/run/.work.jsonl --record --next todo/x/X-PLAN-F4.md')) console.log('WARN suites without the closing level')
    return { green: true, suites: [{ name: 'UnitTests', exit: 0, scope: 'whole suite', count: 1 }], fixes: [], closing: JSON.stringify({ level: 'light', reasons: [], production: 3, review: variant === 'lightblock', reviewWhy: variant === 'lightblock' ? 'the next sheet names types this batch changed: X' : 'the next sheet names no type this batch changed' }) }
  }
  if (isLight && l.startsWith('review light')) {
    reviews += 1
    if (!prompt.includes('Correctness and Scope')) console.log('WARN light review beyond its two axes')
    if (reviews === 1 && !prompt.includes('cctoolkit batch-baseline diff todo/x/run/.work.jsonl F3 --code')) console.log('WARN light review without the batch diff')
    if (reviews === 2 && !prompt.includes('/tmp/r.diff')) console.log('WARN second light review without the change set')
    if (variant === 'light') return GAPV
    if (variant === 'lightblock' && reviews === 1) return { ...GAPV, gaps: [{ severity: 'Blocking', axis: 'Correctness', gap: 'Null owner', evidence: 'src/X.cs:3', closure: 'owner checked', fix: 'guard' }] }
    return VALIDV
  }
  if (isLight && l === 'fix 1') {
    if (!prompt.includes('light-F3.diff')) console.log('WARN fix without the light diff')
    if ((variant === 'light') !== prompt.includes('No audit follows this round')) console.log('WARN fix suites rerun not matching the second review')
    return { fixed: ['x'], files: ['src/X.cs'], validations: [], contested: [], objections: [], extensions: [] }
  }
  if (isLight && (l.startsWith('verify ') || l.startsWith('audit') || l === 'capture')) console.log('WARN full audit step in a light closing:', l)
  if (/^round \d+ open$/.test(l)) return { ok: true, files: [], diff: '' }
  if (/^round \d+ close$/.test(l)) { if (!/"open":[12]/.test(prompt)) console.log('WARN close without the findings answered'); return { ok: true, files: variant === 'scope' ? ['src/X.cs', 'src/Z.cs'] : variant === 'diverge' ? ['src/X.cs', 'src/Y.cs', 'tests/XTests.cs', 'tests/YTests.cs', 'src/W.cs'] : ['src/X.cs'], diff: '/tmp/r.diff' } }
  if (l.startsWith('verify ')) { if (!prompt.includes('Evidence: src/X.cs:3')) console.log('WARN verify without the evidence'); return { real: !(variant === 'verify' && prompt.includes('Second type of the same shape')), why: 'src/Old.cs:9 has another shape' } }
  if (variant === 'verify' && l.startsWith('audit')) { audits += 1; if (audits > 1 && !prompt.includes('never report them again: Second type of the same shape')) console.log('WARN resume audit not told of the refuted finding'); return audits === 1 ? GAPV : { ...GAPV, gaps: [GAPV.gaps[0]] } }
  if (variant === 'verify' && l.startsWith('fix ')) { if (!prompt.includes('leave untouched even where the verdict below still lists them: Second type of the same shape')) console.log('WARN fix not told of the refuted finding'); return { fixed: ['x'], files: ['src/Y.cs'], validations: [], contested: [], objections: [], extensions: [] } }
  if (variant === 'diverge' && l.startsWith('audit')) { audits += 1; return GAPV }
  if (variant === 'diverge' && l.startsWith('fix ')) return { fixed: ['x'], files: [], validations: [], contested: [], objections: [], extensions: [] }
  if (['contest', 'refute', 'scope'].includes(variant) && l.startsWith('audit')) {
    if (variant === 'scope' && audits >= 1) { audits += 1; if (!prompt.includes('/tmp/r.diff') || !prompt.includes('`src/Z.cs`')) console.log('WARN resume audit without the change set'); return { verdict: 'VALID', gaps: [], minors: [], validations: [], hypotheses: [], block: '## Verdict' } }
    audits += 1
    if (audits === 1) return GAPV
    if (audits === 2 && !prompt.includes('Second type of the same shape — harm: breaks the Catalog mapping')) console.log('WARN contest not handed to the resume audit')
    if (variant === 'refute' && audits === 2) return { ...GAPV, gaps: [GAPV.gaps[0]], responses: [{ gap: 'Second type of the same shape', answer: 'Refute', text: 'mapping reads the old type only' }] }
    if (variant === 'contest' && audits === 2) return { ...GAPV, gaps: [GAPV.gaps[0]], responses: [] }
    return { verdict: 'VALID', gaps: variant === 'contest' ? [GAPV.gaps[0]] : [], minors: [], validations: [], hypotheses: [], block: '## Verdict', responses: [{ gap: 'Second type of the same shape', answer: 'Accept', text: 'two types kept, mapping untouched' }] }
  }
  if (l.startsWith('fix ')) {
    if (variant === 'refute' && l === 'fix 2' && !prompt.includes('Refute: mapping reads the old type only')) console.log('WARN rebuttal not handed to round 2')
    return { fixed: ['x'], files: ['src/X.cs'], validations: [], contested: l === 'fix 1' ? [{ gap: 'Second type of the same shape', harm: 'breaks the Catalog mapping' }, { gap: 'Hunk outside the batch', harm: '' }] : [], objections: [] }
  }
  if (l === 'resume state' && !prompt.includes('cctoolkit batch-baseline snapshot todo/x/run/.work.jsonl F3')) console.log('WARN no batch snapshot')
  if (l === 'resume state' && !prompt.includes('--states todo/x/run/.work.jsonl')) console.log('WARN saved states not read through sheet-cycles --states')
  if (l === 'resume state') return { cycles: variant === 'resume' ? [{ behaviour: 'One', rmcu: 'RM-01', steps: [], red: { status: 'RED', exit: 1, table: [{ test: 'A.ShouldX_WhenY', case: '' }], tests: [], stubs: [], productionDiff: [], removed: [], expectedFailure: '', command: 'x' }, green: { status: 'GREEN', exit: 0 } }] : [], index: variant === 'nodesign' ? { ok: false, missing: true, errors: ['no block'], declaratives: [], cycles: [] } : idx, nextSheet: 'todo/x/X-PLAN-F4.md' }
  if (l.startsWith('index')) return idx
  if (l === 'design') return { blocked: false, reason: '', review: ['choice x'] }
  if (l === 'declaratives') return { ok: true }
  if (variant === 'ripple' && l.startsWith('RED')) { if (!prompt.includes('--pending todo/x/run/.work.jsonl')) console.log('WARN RED without the pending command'); return { status: 'ALREADY_GREEN', exit: 0, command: 'x', tests: ['t.cs'], stubs: [], productionDiff: [], table: [{ test: 'A.ShouldX_WhenY', case: '' }], removed: [], expectedFailure: '', pendingRipple: l.startsWith('RED C1') ? ['src/R.cs'] : [] } }
  if (variant === 'ripple' && l.startsWith('GREEN') && !(prompt.includes('Your work is them') && prompt.includes('`src/R.cs`'))) console.log('WARN GREEN without its ripple')
  if (l.startsWith('RED')) return { status: 'RED', exit: 1, command: 'x', tests: ['t.cs'], stubs: [], productionDiff: [], table: [{ test: 'A.ShouldX_WhenY', case: '' }], removed: [], unreachable: [{ method: 'A.ShouldDead_WhenZ', site: 'src/X.cs:3', why: 'never reached' }], expectedFailure: '' }
  if (l.startsWith('GREEN')) return { status: 'GREEN', exit: 0, command: 'x', production: ['src/X.cs'], testsDiff: [], cost: 'Cost: 0 read + 0 write outside loop; Infrastructure in loop or in-memory filter: none', independentOf: 'x', removed: '', flagged: '' }
  if (l === 'suites') return { green: true, suites: [{ name: 'UnitTests', exit: 0, scope: 'whole suite', count: 1 }], fixes: [] }
  if (l === 'pre-audit') return { ok: true, files: [], preauditGreen: true, failures: [] }
  if (l === 'capture') { if (!prompt.includes('--base todo/x/run/.work.jsonl --suites-green UnitTests')) console.log('WARN capture without base or green suites'); return { ok: true } }
  if (l.startsWith('audit ')) { if (prompt.includes('First run')) console.log('WARN split auditor reruns the capture'); if (!prompt.includes('Decisions the run took')) console.log('WARN audit without decisions'); return { verdict: 'VALID', gaps: [], minors: [`minor of ${l}`], validations: [], hypotheses: [], block: `## Verdict — ${l}` } }
  if (l.startsWith('audit')) { if (!prompt.includes('--base todo/x/run/.work.jsonl --suites-green UnitTests')) console.log('WARN audit capture without base or green suites'); if (!prompt.includes('Decisions the run took')) console.log('WARN audit without decisions'); return { verdict: 'VALID', gaps: [], minors: [], validations: [], hypotheses: [], block: '## Verdict — VALID' } }
  if (l === 'next batch review') return { result: 'GAPS', questions: [{ severity: 'Major', question: 'q', evidence: 'e', decidedBy: 'x', answer: 'a', options: [] }] }
  if (l === 'next sheet') return { ok: true }
  if (l === 'report') { if (!prompt.includes('## To validate')) console.log('WARN report without To validate'); if (!prompt.includes('cctoolkit batch-baseline commit todo/x/run/.work.jsonl F3 --sheet todo/x/X-PLAN-F3.md') || !prompt.includes('--kind preexisting,question,answer')) console.log('WARN batch not committed nor its lines reduced'); if (!prompt.includes('run/batches/F3.md')) console.log('WARN report not under run/batches'); return { path: 'todo/x/run/batches/F3.md' } }
  console.log('UNHANDLED', l); return null
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', src)
fn('todo/x/X-PLAN-F3.md', agent, m => console.log('log:', m), () => {}, async ts => Promise.all(ts.map(t => t())), async () => null)
  .then(r => { console.log('STATUS', r.status, '| toReview', r.toReview.length, r.toReview.map(x => x.step).join(',') + (audits ? ` | audits ${audits}` : '') + (reviews ? ` | light reviews ${reviews}` : '')); if (['contest', 'refute', 'scope', 'diverge', 'verify'].includes(variant)) console.log('REVIEW', r.toReview.filter(x => x.step === 'Audit').map(x => x.text.slice(0, 40)).join(' ; ')); console.log('AGENTS', labels.join(' | ')) })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
