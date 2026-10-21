// Whole run-lot body driven by schema-shaped fake agents: a sheet with a valid `## Cycles` block runs no
// design, a sheet without it runs the design once, a resumed cycle carrying `green` is not redone, an
// unreachable method is listed for review instead of retried, the audit is handed the run's decisions,
// the next sheet is reviewed beside the audit, never designed by this batch; past 12 cycles one capture
// feeds two auditors in parallel, the green suites marked for the rerun guard. No agent is ever an arbiter,
// a question or a wait, and every cycle is one tdd-cycle agent.
// retry: C1's RED is rejected twice — a retry carrying the reason, then a last attempt on opus that passes.
// stop: C1's RED is rejected three times — the batch stops BLOCKED. guardout: the guard C2 stays red — left
// out, listed to validate, the batch goes on. greenretry: C1's GREEN is rejected — the retry re-arms the
// accepted RED and writes the GREEN only. resumered: C1 saved with its RED only — one agent re-arms it.
// testsdiff: a GREEN changed a test, took a decision and reported a flagged cost — each to validate, the
// cost handed to the audit, never a rejection.
// ripple: an ALREADY_GREEN leaving ripple files out of the batch diff still writes its GREEN on them.
// fullgaps: the audit finds Majors — one fix rerunning the suites, no second audit, each gap to validate.
// fullblock: a Blocking on Correctness — the fix, then a second audit on its declared files. wrong: the
// Blocking stays after the fix — STATUS GAPS. gatered: the pre-audit stays red — one pass, its failures to the audit.
// light: the block plans a light closing, the diff confirms it: one light review, its Majors fixed without a
// second review, no next-batch review the next sheet does not need. lightblock: the light review finds a
// Blocking on Correctness — a second light review on the fix's files; the next sheet names a changed type.
// review: the next sheet's review asks a human-only question (applied, listed) and one Blocking without
// answer — `unanswered`.
// shortindex: the resume agent relays the index without its cycles — read again alone, both cycles run;
// shortindex2: the second copy is short too — BLOCKED, nothing run.
// asideconflict: the work of a batch set aside does not merge back — the batch starts over, listed to validate.
// root: the batch runs in a worktree of its own beside another — every agent is handed it and the prefix of its Bash
// calls, the work file stays in the session's run folder, the suites run under the build lock, the next sheet (the
// batch running beside) is not reviewed.
// Global green: a green first pass is one haiku agent; snapshot: a red suite → repair (default model), its promoted
// snapshot read off the tree, declared, listed for review and handed to the audit; undeclared: a write under the test
// roots without a `testEdits` entry is rejected, the retry declares it; blocked: a `test-code` write is a BLOCKED,
// retried once, then the batch stops.
// Usage: node run-lot-flow.js <run-lot.js> block|nodesign|resume|split|retry|stop|guardout|greenretry|resumered|testsdiff|ripple|fullgaps|fullblock|wrong|gatered|light|lightblock|review|shortindex|shortindex2|snapshot|undeclared|blocked|root
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'block'
const labels = []
let audits = 0
let reviews = 0
const isLight = variant.startsWith('light')
const GAPV = { verdict: 'GAPS', gaps: [{ severity: 'Major', axis: 'Reuse', gap: 'Second type of the same shape', evidence: 'src/X.cs:3', closure: 'one type left', fix: 'rename' }, { severity: 'Major', axis: 'Scope', gap: 'Hunk outside the batch', evidence: 'src/Y.cs:1', closure: 'hunk gone', fix: 'revert' }], minors: [], validations: [], hypotheses: [], block: '## Verdict — GAPS' }
const WRONGV = { ...GAPV, gaps: [{ severity: 'Blocking', axis: 'Correctness', gap: 'Null owner', evidence: 'src/X.cs:3', closure: 'owner checked', fix: 'guard' }] }
const cyc = (id, wave, b) => ({ id, wave, behaviour: b, rmcu: 'RM-01', steps: ['1. Step'], refactor: false, guard: false, methods: ['A.ShouldX_WhenY', 'A.ShouldDead_WhenZ'], decisions: '' })
const idx = { ok: true, missing: false, errors: [], declaratives: variant === 'block' ? ['src/X.cs — mirrors Y'] : [], cycles: variant === 'split' ? Array.from({ length: 13 }, (_, i) => cyc(`C${i + 1}`, 1, `B${i + 1}`)) : [cyc('C1', 1, 'One'), cyc('C2', 2, 'Two')] }
if (variant === 'guardout') idx.cycles[1] = { ...idx.cycles[1], guard: true }
if (isLight) Object.assign(idx, { closing: { level: 'light', reasons: [], production: 3 }, cycles: idx.cycles.map((c, i) => ({ ...c, files: [`src/C${i}.cs`, `tests/C${i}Tests.cs`] })) })
const REDOK = { status: 'RED', exit: 1, command: 'x', tests: ['t.cs'], stubs: [], productionDiff: [], table: [{ test: 'A.ShouldX_WhenY', case: '' }], removed: [], unreachable: [{ method: 'A.ShouldDead_WhenZ', site: 'src/X.cs:3', why: 'never reached' }], expectedFailure: '' }
const GREENOK = { status: 'GREEN', exit: 0, command: 'x', production: ['src/X.cs'], testsDiff: [], cost: 'Cost: 0 read + 0 write outside loop; Infrastructure in loop or in-memory filter: none', independentOf: 'x', removed: '', flagged: '' }
const FLAGGED = 'Cost: 1 read + 0 write outside loop; Infrastructure in loop or in-memory filter: 1 — design to revisit'
const VALIDV = { verdict: 'VALID', gaps: [], minors: [], validations: [], hypotheses: [], block: '## Verdict — VALID' }
const RUNOK = { build: { exit: 0, output: '/tmp/build.txt' }, suites: [{ name: 'UnitTests', exit: 0, scope: 'whole suite', count: 1, run: 'x', output: '/tmp/test-UnitTests.txt', failed: [] }], unresolved: [], notRun: [], closing: '' }
const GREENTRAP = ['snapshot', 'undeclared', 'blocked']
const SNAP = 'tests/C/BTests.Get.verified.txt'
const green = []
const attempts = {}
let repairs = 0

function cycleAgent(prompt, o, l) {
  const own = /^RED (\S+)/.exec(l)[1]
  const n = (attempts[own] = (attempts[own] || 0) + 1)
  const rearmed = prompt.includes('its RED was accepted earlier')
  if (o.agentType !== 'cctoolkit:tdd-cycle' || !prompt.includes("cctoolkit tdd-scope red <<'RED_JSON'") || !prompt.includes(`--cycle ${own} --red`)) console.log('WARN cycle agent without its type, checkpoint or RED contract:', l)
  if (!(variant === 'guardout' && own === 'C2') && !prompt.includes(`--cycle ${own} --green`)) console.log('WARN cycle agent without its GREEN contract:', l)
  if (!prompt.includes('`decisions`')) console.log('WARN cycle agent not told to decide an ambiguity itself:', l)
  if (n > 1 && !prompt.includes('Before anything else, one call: `cctoolkit run-work append')) console.log('WARN retry without its attempt line:', l)
  if ((n === 3) !== (o.model === 'opus')) console.log('WARN opus not on the last attempt only:', l, o.model || 'default')
  if (n === 3 && !prompt.includes('Why each earlier attempt was rejected')) console.log('WARN last attempt without the reasons:', l)
  const shouldRearm = (variant === 'greenretry' && own === 'C1' && n === 2) || (variant === 'resumered' && own === 'C1')
  if (shouldRearm !== rearmed) console.log('WARN re-arm prompt', rearmed ? 'unexpected' : 'missing', l)
  if (rearmed && !prompt.includes(JSON.stringify(REDOK))) console.log('WARN re-armed RED not handed verbatim:', l)
  if (variant === 'ripple') {
    if (!prompt.includes('--pending todo/x/run/.work.jsonl')) console.log('WARN cycle without the pending command')
    const red = { ...REDOK, status: 'ALREADY_GREEN', exit: 0, unreachable: [], pendingRipple: own === 'C1' ? ['src/R.cs'] : [] }
    return own === 'C1' ? { red, green: GREENOK } : { red }
  }
  if (variant === 'retry' && own === 'C1' && n < 3) return { red: { ...REDOK, exit: 0 } }
  if (variant === 'stop' && own === 'C1') return { red: { ...REDOK, exit: 0 } }
  if (variant === 'guardout' && own === 'C2') return { red: { ...REDOK, unreachable: [] } }
  if (variant === 'greenretry' && own === 'C1' && n === 1) return { red: REDOK, green: { ...GREENOK, exit: 1 } }
  if (variant === 'testsdiff' && own === 'C1') return { red: REDOK, green: { ...GREENOK, cost: FLAGGED, testsDiff: [{ path: 'tests/A/ATests.cs', why: 'fixture built the wrong id' }] }, decisions: ['empty name → refused, RM-01 says so'] }
  return { red: REDOK, green: GREENOK }
}

const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (/^(arbiter|question|wait|round|verify)/.test(l) || o.phase === 'Question' || o.phase === 'Arbiter') console.log('WARN control agent launched:', l)
  if (variant === 'root' && !(prompt.includes('Batch worktree: `/w/F3`') && prompt.includes("`cd '/w/F3' && export CLAUDE_PROJECT_DIR='/w/F3' &&`"))) console.log('WARN agent without its worktree:', l)
  if (variant === 'root' && prompt.includes('Run work file:') && !prompt.includes('Run work file: /m/todo/x/run/.work.jsonl.')) console.log('WARN work file outside the session run folder:', l)
  if (variant === 'root' && l === 'suites run' && !prompt.includes('cctoolkit suites-plan /m/todo/x/run/.work.jsonl F3 --lock')) console.log('WARN suites run without the build lock')
  if (/^RED \S+ w\d+ .* \+GREEN( opus)?$/.test(l)) return cycleAgent(prompt, o, l)
  if (o.phase === 'Global green') green.push(`${l} ${o.model || 'default'}`)
  if (isLight && l === 'suites run') {
    if (!prompt.includes('cctoolkit closing-level todo/x/X-PLAN-F3.md todo/x/run/.work.jsonl --record --next todo/x/X-PLAN-F4.md')) console.log('WARN suites without the closing level')
    return { ...RUNOK, closing: JSON.stringify({ level: 'light', reasons: [], production: 3, review: variant === 'lightblock', reviewWhy: variant === 'lightblock' ? 'the next sheet names types this batch changed: X' : 'the next sheet names no type this batch changed' }) }
  }
  if (l === 'suites run') {
    if (!prompt.includes('cctoolkit suites-plan todo/x/run/.work.jsonl F3') || prompt.includes('test-scope.md')) console.log('WARN suites run not handed the plan, or left to read test-scope.md')
    return GREENTRAP.includes(variant) ? { ...RUNOK, suites: [RUNOK.suites[0], { name: 'ContractTests', exit: 1, scope: 'whole suite', count: 40, run: 'x', output: '/tmp/test-ContractTests.txt', failed: ['BTests.Get'] }] } : RUNOK
  }
  if (l === 'suites repair') {
    repairs += 1
    if (!prompt.includes('/tmp/test-ContractTests.txt') || !prompt.includes('BTests.Get') || prompt.includes('closing-level todo')) console.log('WARN repair without the first pass failures, or told to record the closing')
    if (variant === 'undeclared' && repairs === 2 && !prompt.includes('without a `testEdits` entry: `tests/Core/MockX.cs`')) console.log('WARN undeclared write not handed to the retry')
    const edits = variant === 'snapshot' ? [{ path: SNAP, kind: 'snapshot-promoted', why: 'F3 sheet, Decisions line 2: Get answers 201' }]
      : variant === 'undeclared' && repairs === 2 ? [{ path: 'tests/Core/MockX.cs', kind: 'test-double', why: 'permission Products.Archive the batch adds' }]
      : variant === 'blocked' ? [{ path: 'tests/U/ATests.cs', kind: 'test-code', why: 'expectation updated' }]
      : []
    return { green: true, suites: [{ name: 'UnitTests', exit: 0, scope: 'whole suite', count: 1 }, { name: 'ContractTests', exit: 0, scope: 'whole suite', count: 40 }], fixes: ['src/X.cs: status 201'], testEdits: edits }
  }
  if (l === 'suites tests') {
    const changed = variant === 'snapshot' ? [{ path: SNAP, shared: false }] : variant === 'undeclared' ? [{ path: 'tests/Core/MockX.cs', shared: true }] : [{ path: 'tests/U/ATests.cs', shared: false }]
    return { read: true, changed, closing: '' }
  }
  if (isLight && l.startsWith('review light')) {
    reviews += 1
    if (!prompt.includes('Correctness and Scope')) console.log('WARN light review beyond its two axes')
    if (reviews === 1 && !prompt.includes('cctoolkit batch-baseline diff todo/x/run/.work.jsonl F3 --code')) console.log('WARN light review without the batch diff')
    if (reviews === 2 && !prompt.includes('Read only the files the fix declared — `src/X.cs`')) console.log('WARN second light review without the fix files')
    if (variant === 'light') return GAPV
    if (variant === 'lightblock' && reviews === 1) return WRONGV
    return VALIDV
  }
  if (isLight && (l.startsWith('audit') || l === 'capture')) console.log('WARN full audit step in a light closing:', l)
  if (l === 'fix') {
    const reaudit = ['lightblock', 'fullblock', 'wrong'].includes(variant)
    if (isLight && !prompt.includes('light-F3.diff')) console.log('WARN fix without the light diff')
    if (!isLight && !prompt.includes('<tmp>/audit-F3.txt')) console.log('WARN fix without the capture')
    if (reaudit === prompt.includes('No review follows this fix')) console.log('WARN fix suites rerun not matching the second review')
    if (prompt.includes('contested')) console.log('WARN fix asked to contest')
    return { fixed: ['x'], files: ['src/X.cs'], validations: [], objections: variant === 'fullgaps' ? ['Hunk outside the batch — harm: drops the audit log'] : [], extensions: [] }
  }
  if (l === 'resume state' && !prompt.includes('cctoolkit batch-baseline snapshot todo/x/run/.work.jsonl F3')) console.log('WARN no batch snapshot')
  if (l === 'resume state' && !prompt.includes('--states todo/x/run/.work.jsonl')) console.log('WARN saved states not read through sheet-cycles --states')
  if (l === 'resume state' && !/batch-baseline resume \S+\.work\.jsonl F3; cctoolkit batch-baseline snapshot /.test(prompt)) console.log('WARN work set aside not put back before the snapshot')
  if (l === 'resume state') {
    const saved = variant === 'resume' ? [{ behaviour: 'One', rmcu: 'RM-01', steps: [], red: { ...REDOK, unreachable: [] }, green: { status: 'GREEN', exit: 0 } }]
      : variant === 'resumered' ? [{ behaviour: 'One', rmcu: 'RM-01', steps: [], red: REDOK }]
      : []
    return { cycles: saved, index: variant === 'nodesign' ? { ok: false, missing: true, errors: ['no block'], declaratives: [], cycles: [] } : variant.startsWith('shortindex') ? { ...idx, count: 2, cycles: [] } : idx, nextSheet: 'todo/x/X-PLAN-F4.md', ...(variant === 'asideconflict' ? { resume: 'resume: conflict on src/X.cs — batch starts over, its saved cycles dropped; partial work: /p.patch' } : {}) }
  }
  if (l.startsWith('index')) return variant === 'shortindex2' ? { ...idx, count: 2, cycles: idx.cycles.slice(1) } : variant === 'shortindex' ? { ...idx, count: 2 } : idx
  if (l === 'design') return { blocked: false, reason: '', review: ['choice x'] }
  if (l === 'declaratives') { if (!prompt.includes('`cctoolkit config command build` prints it') || prompt.includes('test-scope.md')) console.log('WARN declaratives without the build command, or sent to test-scope.md'); return { ok: true } }
  if (l === 'pre-audit') return variant === 'gatered' ? { ok: true, files: [], preauditGreen: false, failures: ['DEAD REFERENCE RM-09'] } : { ok: true, files: [], preauditGreen: true, failures: [] }
  if (l === 'capture') { if (!prompt.includes('--base todo/x/run/.work.jsonl --suites-green UnitTests')) console.log('WARN capture without base or green suites'); return { ok: true } }
  if (/^audit (code|plan)/.test(l)) { if (prompt.includes('First run')) console.log('WARN split auditor reruns the capture'); if (!prompt.includes('Decisions the run took')) console.log('WARN audit without decisions'); return { verdict: 'VALID', gaps: [], minors: [`minor of ${l}`], validations: [], hypotheses: [], block: `## Verdict — ${l}` } }
  if (l.startsWith('audit')) {
    audits += 1
    if (variant === 'snapshot' && !(prompt.includes('Test files the global green repair wrote, each a point to verify') && prompt.includes(SNAP))) console.log('WARN audit not handed the test edits')
    if (variant === 'testsdiff' && !(prompt.includes('`Cost` lines a GREEN reported flagged') && prompt.includes(FLAGGED))) console.log('WARN audit not handed the flagged cost')
    if (variant === 'gatered' && !prompt.includes('Failures the pre-audit gate left after its rounds, each a gap of its axis unless the code shows it settled: DEAD REFERENCE RM-09')) console.log('WARN audit not handed the gate failures')
    if (audits === 1 && !prompt.includes('--base todo/x/run/.work.jsonl --suites-green UnitTests')) console.log('WARN audit capture without base or green suites')
    if (!prompt.includes('Decisions the run took')) console.log('WARN audit without decisions')
    if (audits === 2 && !(l === 'audit retry' && prompt.includes('Files the fix declared: `src/X.cs`'))) console.log('WARN second audit not on the fix files:', l)
    if (variant === 'fullgaps' && audits === 1) return GAPV
    if ((variant === 'fullblock' && audits === 1) || variant === 'wrong') return WRONGV
    return VALIDV
  }
  if (l === 'next batch review') {
    if (variant === 'review') return { result: 'GAPS', questions: [{ severity: 'Blocking', question: 'archive or delete?', evidence: 'e', decidedBy: '', answer: 'archive, RM-03 keeps the history', options: ['archive', 'delete'], humanOnly: true }, { severity: 'Blocking', question: 'which tenant?', evidence: 'e', decidedBy: '', answer: '', options: [], humanOnly: true }] }
    return { result: 'GAPS', questions: [{ severity: 'Major', question: 'q', evidence: 'e', decidedBy: 'x', answer: 'a', options: [] }] }
  }
  if (l === 'next sheet') { if (variant === 'review' && (!prompt.includes('archive or delete?') || prompt.includes('which tenant?'))) console.log('WARN next sheet not handed the applied answers only'); return { ok: true } }
  if (l === 'report') { if (!prompt.includes('## To validate')) console.log('WARN report without To validate'); if (prompt.includes('## STATUS — DONE') && !(prompt.includes('cctoolkit batch-baseline commit todo/x/run/.work.jsonl F3 --sheet todo/x/X-PLAN-F3.md') && prompt.includes('--kind preexisting,question,answer'))) console.log('WARN batch not committed nor its lines reduced'); if (!prompt.includes('run/batches/F3.md')) console.log('WARN report not under run/batches'); return { path: 'todo/x/run/batches/F3.md' } }
  console.log('UNHANDLED', l); return null
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', src)
fn(variant === 'root' ? { sheet: 'todo/x/X-PLAN-F3.md', root: '/w/F3/', run: '/m/todo/x/run', partner: '/m/todo/x/X-PLAN-F4.md', lock: true } : 'todo/x/X-PLAN-F3.md', agent, m => console.log('log:', m), () => {}, async ts => Promise.all(ts.map(t => t())), async () => null)
  .then(r => {
    console.log('STATUS', r.status, '| toReview', r.toReview.length, r.toReview.map(x => x.step).join(',') + (audits ? ` | audits ${audits}` : '') + (reviews ? ` | light reviews ${reviews}` : ''))
    console.log('REVIEW', r.toReview.map(x => `${x.step}: ${x.text.slice(0, 60)}`).join(' ; '))
    if (r.unanswered) console.log('UNANSWERED', r.unanswered)
    console.log('AGENTS', labels.join(' | '))
    console.log('GLOBAL GREEN', green.join(' | '))
    if (GREENTRAP.includes(variant) || ['stop', 'wrong'].includes(variant)) console.log('REASON', r.reason, '| TO VALIDATE', r.toReview.filter(x => x.step === 'Global green').map(x => x.text).join(' ; '))
  })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
