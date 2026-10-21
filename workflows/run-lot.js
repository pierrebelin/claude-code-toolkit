export const meta = {
  name: 'run-lot',
  description: 'FX batch under strict TDD, autonomous: cycles from the sheet, RED/GREEN per behaviour, global green, pre-audit, audit, next-batch review',
  whenToUse: 'Implement a plan batch without human intervention. Argument: path of the batch sheet, `todo/<code>/<CODE>-PLAN-FX.md`; plan, batch and run folder are derived from it.',
  phases: [
    { title: 'Design', detail: 'cycle index of the sheet; design writes the `## Cycles` block only when absent or invalid; declaratives' },
    { title: 'RED', detail: 'one tdd-cycle agent per cycle writes its RED, passes the checkpoint the hook checks, then its GREEN and the handler CLAUDE.md; waves in sequence, disjoint cycles of a wave in parallel; rejected → one retry, then one on opus, then stop' },
    { title: 'Global green', detail: 'beside the pre-audit gate: suites run on haiku as cctoolkit suites-plan resolves them; red → suites repair, its writes under the test roots checked against testEdits; closing level full or light read off the batch diff' },
    { title: 'Closing', detail: 'cctoolkit pre-audit and what it lists, one pass beside global green; what stays red goes to the audit' },
    { title: 'Audit', detail: 'full: cctoolkit audit-capture, ddd-tdd-auditor; light: one review of the diff on Correctness and Scope; GAPS → one fix, a second review only after a Blocking on Correctness' },
    { title: 'Review', detail: 'adversarial-reviewer on the next sheet, beside the audit, every answer applied and listed for review; light: only when the next sheet names a type the batch changed' },
    { title: 'Report', detail: 'run/batches/FX.md, written even on stop; DONE: batch committed, its lines reduced to the cycle states' },
  ],
}

// On Windows a path may come with `\` (Python, the engine, an agent): Git Bash eats an unquoted one, and
// the regexes below split on `/`. Paths are carried with `/`.
const slashed = p => String(p || '').replace(/\\/g, '/')

const sheet = slashed(typeof args === 'string' ? args : (args && args.sheet) || '').trim().replace(/^@/, '')
const naming = /^(.*)-(F\d+)\.md$/.exec(sheet)
if (!naming) throw new Error('expected argument: path of the batch sheet, `todo/<code>/<CODE>-PLAN-FX.md`')
const plan = `${naming[1]}.md`
const batch = naming[2]
// A batch run in a git worktree of its own, beside another batch (run-plan, `run.parallelBatches`):
// `root` = that worktree, absolute — sheet, plan, source and test paths resolve under it; `run` = the run
// folder of the session's checkout, absolute — work file, questions and report stay where the session reads them.
const opts = args && typeof args === 'object' ? args : {}
const root = slashed(opts.root || '').trim().replace(/\/+$/, '')
const runRoot = opts.run ? slashed(opts.run).trim().replace(/\/+$/, '') : `${sheet.slice(0, sheet.lastIndexOf('/') + 1) || './'}run`
const workFile = `${runRoot}/.work.jsonl`
const reportPath = `${runRoot}/batches/${batch}.md`
const commitAtEnd = !(args && typeof args === 'object' && args.commit === false)
// Beside another batch: `partner` = the sheet of the batch running at the same time — never reviewed nor
// amended by this one, it is already running; `lock` = solution builds and whole suites under `cctoolkit build-lock`.
const partner = slashed(opts.partner || '').trim()
const lock = opts.lock === true
const tmpCommand = `cctoolkit run-work tmp ${batch}`
const TMP = `\`<tmp>\` = the folder \`${tmpCommand}\` prints (system temp, never under run/)`

const BLOCKED = 'BLOCKED'
const DONE = 'DONE'
const GAPS = 'GAPS'
const AUDIT_PENDING = 'to redo'
const GAPS_CARRIED = 'GAPS carried'
const TO_REVIEW = 'user decision to validate'

const str = { type: 'string' }
const int = { type: 'integer' }
const bool = { type: 'boolean' }
const arr = items => ({ type: 'array', items })
const obj = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
})

const CYCLE = obj({
  id: str,
  wave: int,
  behaviour: str,
  rmcu: str,
  steps: arr(str),
  refactor: bool,
  guard: bool,
  methods: arr(str),
  decisions: str,
  files: arr(str),
  tests: arr(str),
}, ['files', 'tests'])

// The closing level, `full` or `light` (lib/closing_level.py): planned by `sheet-cycles --index`,
// read off the batch diff by `cctoolkit closing-level` once the suites are green.
const FULL = 'full'
const LIGHT = 'light'
const LEVEL = obj({ level: { type: 'string', enum: [FULL, LIGHT] }, reasons: arr(str), production: int }, ['production'])

const INDEX = obj({ ok: bool, missing: bool, errors: arr(str), declaratives: arr(str), closing: LEVEL, count: int, cycles: arr(CYCLE) }, ['closing', 'count'])

const DESIGN = obj({ blocked: bool, reason: str, review: arr(str) }, ['review'])

const RED = obj({
  status: { type: 'string', enum: ['RED', 'ALREADY_GREEN', 'BLOCKED'] },
  tests: arr(str),
  command: str,
  exit: int,
  productionDiff: arr(str),
  stubs: arr(str),
  expectedFailure: str,
  table: arr(obj({ test: str, case: str })),
  removed: arr(str),
  unreachable: arr(obj({ method: str, site: str, why: str })),
  pendingRipple: arr(str),
  diagnostic: str,
}, ['diagnostic', 'unreachable', 'pendingRipple'])

const GREEN = obj({
  status: { type: 'string', enum: ['GREEN', 'BLOCKED'] },
  production: arr(str),
  command: str,
  exit: int,
  testsDiff: arr(obj({ path: str, why: str })),
  cost: str,
  independentOf: str,
  removed: str,
  flagged: str,
  diagnostic: str,
}, ['diagnostic'])

const OK = obj({ ok: bool, detail: str }, ['detail'])

// A file the global green repair wrote under the test roots: the only two it may write are an
// approved snapshot a sheet decision changes and a shared double a value of the batch requires.
const SNAPSHOT_PROMOTED = 'snapshot-promoted'
const TEST_DOUBLE = 'test-double'
const TEST_CODE = 'test-code'
const TEST_EDIT = obj({ path: str, kind: { type: 'string', enum: [SNAPSHOT_PROMOTED, TEST_DOUBLE, TEST_CODE] }, why: str })

const SUITES = obj({
  green: bool,
  suites: arr(obj({ name: str, exit: int, scope: str, count: int })),
  fixes: arr(str),
  testEdits: arr(TEST_EDIT),
  diagnostic: str,
  closing: str,
}, ['diagnostic', 'closing'])

// The first pass of the global green, run as `cctoolkit suites-plan` resolves it, nothing fixed.
const SUITES_RUN = obj({
  build: obj({ exit: int, output: str }),
  suites: arr(obj({ name: str, exit: int, scope: str, count: int, run: str, output: str, failed: arr(str) })),
  unresolved: arr(obj({ name: str, why: str })),
  notRun: arr(obj({ name: str, why: str })),
  closing: str,
}, ['closing'])

const TESTS_CHANGED = obj({ read: bool, changed: arr(obj({ path: str, shared: bool })), closing: str }, ['closing'])

const CYCLE_RESULT = obj({ red: RED, green: GREEN, decisions: arr(str) }, ['green', 'decisions'])

const CLOSING = obj({ ok: bool, files: arr(str), preauditGreen: bool, failures: arr(str), diagnostic: str }, ['diagnostic'])

const GAP = obj({ severity: { type: 'string', enum: ['Blocking', 'Major', 'Minor'] }, axis: str, gap: str, evidence: str, closure: str, fix: str })

const VERDICT = obj({
  verdict: { type: 'string', enum: ['VALID', 'GAPS'] },
  gaps: arr(GAP),
  minors: arr(str),
  validations: arr(str),
  hypotheses: arr(str),
  block: str,
})

const FIX = obj({ fixed: arr(str), files: arr(str), validations: arr(str), objections: arr(str), extensions: arr(obj({ file: str, why: str })) })

const REVIEW = obj({
  result: { type: 'string', enum: ['CLEAR', 'GAPS'] },
  questions: arr(obj({ severity: { type: 'string', enum: ['Blocking', 'Major'] }, question: str, evidence: str, decidedBy: str, answer: str, options: arr(str), humanOnly: bool }, ['humanOnly'])),
})

const REPORT = obj({ path: str, commit: str }, ['commit'])

const LOADED = obj({
  cycles: arr(obj({ behaviour: str, rmcu: str, steps: arr(str), red: RED, green: GREEN }, ['green'])),
  index: INDEX,
  nextSheet: str,
})

// An agent's shell starts in the session's checkout and goes back there after each call: in a worktree, every
// call opens with this prefix, so relative paths and `cctoolkit` (kit_config.project_root()) resolve there —
// and the TDD scope hook (lib/tdd_scope.py) takes the agent's tree from it.
const AT_ROOT = root ? `cd '${root}' && export CLAUDE_PROJECT_DIR='${root}' &&` : ''
const ROOT_LINE = root
  ? `Batch worktree: \`${root}\`, a git worktree of the repo, not the session's checkout. Every Bash call opens with \`${AT_ROOT}\` (the shell goes back to the session's checkout after each call): the relative paths below resolve in that worktree. Read, Edit and Write take absolute paths, \`${root}/<path>\` for a sheet, plan, source or test path; no file of the session's checkout is yours, save under the run folder \`${runRoot}\`.`
  : ''
const FRAME = [
  `Workflow run-lot, batch ${batch}. Global plan: ${plan}. Batch sheet: ${sheet}. Run work file: ${workFile}.`,
  'Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes: the batch commit is `cctoolkit batch-baseline commit`, run only where a step gives it.',
  'Return the result through the structured output; prose written into repo files follows `language.docs` of `kit.config.json`.',
  '`<kit>` below = the cctoolkit plugin directory, printed by `cctoolkit root`; kit scripts run as `cctoolkit <script>`.',
  ...(root ? [ROOT_LINE] : []),
].join('\n')

const list = xs => (xs && xs.length ? xs.map(x => `\`${x}\``).join(', ') : 'none')

const attemptLine = (step, n, reason) => `cctoolkit run-work append ${workFile} <<'ATTEMPT_LINE'\n${JSON.stringify({ kind: 'attempt', batch, step, n, reason })}\nATTEMPT_LINE`
const retryHead = (step, n, reason) => `\n\nBefore anything else, one call: \`${attemptLine(step, n, reason)}\`.`
const fileName = line => line.replace(/`/g, '').trim().replace(/^[ MADRCU?!]{1,2}\s+/, '').split(/\s+/)[0] || ''
const short = (text, n = 40) => (text.length > n ? text.slice(0, n - 1) + '…' : text)

// Files the global green repair wrote under the test roots, read off the tree by `suites-plan
// --tests-changed`, against its `testEdits`: an undeclared write is rejected, a declared one outside
// the two exceptions of test-scope.md §6 is a BLOCKED. Tree unread: nothing to check here.
function testWrites(tree, declared) {
  if (!tree || !tree.read) return null
  const key = p => relative(p) || slashed(p)
  const edits = new Map(declared.map(e => [key(e.path), e]))
  const undeclared = tree.changed.filter(f => !edits.has(key(f.path))).map(f => f.path)
  if (undeclared.length) return `files written under the test roots without a \`testEdits\` entry: ${list(undeclared)} — put each back as it was, or declare it`
  const written = new Map(tree.changed.map(f => [key(f.path), f.shared]))
  const unquoted = declared.filter(e => e.kind === SNAPSHOT_PROMOTED && written.has(key(e.path)) && !e.why.trim())
  if (unquoted.length) return `snapshot promoted without the sheet line it follows from: ${list(unquoted.map(e => e.path))} — quote it in \`why\`, or put the snapshot back`
  const outside = declared.filter(e => written.has(key(e.path)) && (e.kind === TEST_CODE || (e.kind === TEST_DOUBLE && !written.get(key(e.path)))))
  if (outside.length) return `BLOCKED — test writes outside the two global green exceptions (test-scope.md §6): ${outside.map(e => `${e.path} (${e.kind === TEST_DOUBLE ? 'double outside layout.tests.shared' : e.kind})`).join(', ')}`
  return null
}

const history = { cycles: [], suites: null, gate: null, verdicts: [], fixes: [], review: null, audit: null, toReview: [], closing: null }
const toReview = (step, text, why = '') => history.toReview.push({ step, text, why })
let reviewing = null
const USER = 'user decision'
const REVIEWER = 'reviewer recommendation'

// lib/tdd_scope.py writes this at the head of a BLOCKED diagnostic, from the tree it checks.
const RED_ON_STUB = 'RED on stub: '
const COST_CLEAR = ['Infrastructure in loop or in-memory filter: none', 'Infrastructure en boucle ou filtre mémoire : aucun']

// Nobody answers a run: an ambiguity is decided by the agent that meets it, listed for the review after the plan.
const AMBIGUITY = `An ambiguity of the sheet or the contract → never stop on it: pick the option the spec, the rules, the handler \`CLAUDE.md\` or an earlier \`Hn\` favour, else the smallest one keeping every RM/CU; one line in \`decisions\` (question → choice → why). Never copy it into the sheet: the run lists it for the user review after the plan.`

const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

const contractCommand = (c, phaseFlag) => `cctoolkit sheet-cycles ${sheet} --cycle ${c.id} ${phaseFlag}`

function redContract(c, declaratives) {
  return [
    `RED phase, cycle ${c.id}. Your contract, no plan attached: first call, \`${contractCommand(c, '--red')}\` — it prints the contract lines (RM/CU, behaviour, level and skill, test class and fixture, methods, \`Rewritten by you (read in full)\`, \`Read bounded (context only)\`, scenarios, expected observation). Never read the sheet itself.`,
    '',
    '```text',
    ...(c.refactor ? [
      'Refactor under safety net: write no test. Run the filtered command on the methods above, existing and unchanged.',
      'Green net (exit 0) = RED of the refactor: `status: RED`, `table` = one row per method run, `tests` = their paths, `stubs` and `productionDiff` empty. Red net = `red.status: BLOCKED`.',
    ] : []),
    ...(c.guard ? [
      'Guard test: the sheet declares it green at once on the current code (architecture or convention guard, no production code drives it). Write it, run it filtered: exit 0 expected, `status: RED` with `exit` 0, `stubs` and `productionDiff` empty.',
      'A red guard = the code already breaks it: `red.status: BLOCKED` with the violations listed.',
    ] : []),
    'An existing assertion on a literal or contract this behaviour changes is listed in `Rewritten by you`: rewrite it to the new expected value, never into a negative assertion (does-not-contain, not-equal) that would pass whatever the code does.',
    `Behaviour already in place on disk → \`status: ALREADY_GREEN\`, \`table\` = the methods run, \`stubs\` and \`productionDiff\` empty, \`pendingRipple\` = the lines of \`cctoolkit sheet-cycles ${sheet} --cycle ${c.id} --pending ${workFile}\` (files of the ripple and creations the batch has not changed; a hook checks the list): the GREEN still runs on them.`,
    ...(declaratives.length ? [
      `Declarative artefacts already written by the orchestrator (common-rules §4.5, neither yours nor stubs): ${declaratives.join(' ; ')}`,
    ] : []),
    '```',
    '',
    'Your `## RED` report: `tests` = test paths, `exit` = code of the filtered command,',
    '`productionDiff` = `src/` files you created or modified yourself, no annotation (display only: a hook compares the tree to your start), `stubs` = paths only of the stubs written, no annotation — every source file you changed must be listed there, the hook refuses the checkpoint otherwise, `table` = one row per method written or modified',
    '(`test` = `Class.Method`), `removed` = tests removed because already covered, `unreachable` = contract methods not written, site unreachable. Cannot complete it → `red.status: BLOCKED` + `diagnostic` (six RTK lines at most), no `green`.',
  ].filter(l => l !== '').join('\n')
}

// An ALREADY_GREEN whose ripple or creations are absent from the batch diff (sheet-cycles --pending):
// the tests cover none of them, so only this GREEN lands them.
const rippleOnly = files => (files.length
  ? `The red test already passes: no test covers the files below, which the batch diff does not hold yet. Your GREEN is them, per the \`Signature ripple\` and \`To create\` lines of your contract: ${list(files)}. The filtered test stays green.`
  : '')

function greenContract(c, ripple = []) {
  return [
    `GREEN + REFACTOR phase, once the checkpoint passed: your contract is \`${contractCommand(c, '--green')}\` (out of scope, to create, production you may fill, signature ripple, read bounded, elements, applied ids, invariants, expected cost). Never read the sheet itself.`,
    c.refactor
      ? 'Safety net, green and kept green — behaviour unchanged: the tests of your RED report, untouched.'
      : 'Red tests: those of your RED report; the stubs it lists are bodies to fill (read in full).',
    rippleOnly(ripple),
    `\`Cost\` line from \`cctoolkit access-cost --base ${workFile} ${batch} <production files>\`: lines this batch added flagged, earlier ones listed pre-existing.`,
    'Your `## GREEN` report: `production` = paths modified or created (handler `CLAUDE.md` included), `exit` = code of the final filtered test,',
    '`testsDiff` = each test file you changed after the checkpoint, `path` and `why` (a test changes only when it is wrong: fixture, compile ripple, a value a shared helper normalises — never an assertion of the behaviour removed or loosened; a hook records each one for the audit), `cost` = last line of `cctoolkit access-cost` verbatim, a flagged line included (the audit judges it),',
    '`independentOf` = the input the cost is independent of. Cannot reach green → `green.status: BLOCKED` + `diagnostic`.',
  ].filter(l => l !== '').join('\n')
}

const cycleState = (c, red, green = false) => `\`cctoolkit run-work append ${workFile} <<'CYCLE_STATE'\` then the line \`{"kind": "cycle", "batch": "${batch}", "slug": "${slug(c.behaviour)}", "state": {"behaviour": ${JSON.stringify(c.behaviour)}, "rmcu": ${JSON.stringify(c.rmcu)}, "steps": ${JSON.stringify(c.steps)}, "red": ${red ? JSON.stringify(red) : '<the RED report>'}${green ? ', "green": <your GREEN report>' : ''}}}\` then \`CYCLE_STATE\``

// One tdd-cycle agent per cycle, every closing: its RED, the checkpoint the TDD scope hook checks on the
// tree (agents/tdd-cycle.md), then its GREEN. `red`: a RED already accepted (saved by an earlier run, or by
// an earlier attempt whose GREEN was rejected) — the agent re-arms the checkpoint with it and writes the GREEN.

function cycleContract(c, red = null) {
  const ripple = red && red.status === 'ALREADY_GREEN' ? red.pendingRipple || [] : []
  const noGreenAfter = c.guard
    ? 'A guard writes no GREEN: the output carries `red` alone.'
    : 'No GREEN for an `ALREADY_GREEN` with an empty `pendingRipple` or a RED that wrote no test: the output carries `red` alone. An `ALREADY_GREEN` with files in `pendingRipple`: those files are your GREEN, per the `Signature ripple` and `To create` lines of your contract, the filtered test kept green.'
  return [
    FRAME,
    '',
    red
      ? `Cycle ${c.id}: its RED was accepted earlier, its GREEN is yours (agents/tdd-cycle.md). Run no test before the checkpoint. First calls, in one message: \`${contractCommand(c, '--red')}\` (context only, write no test) and the checkpoint re-armed with that RED, verbatim: \`cctoolkit tdd-scope red <<'RED_JSON'\` then the line \`${JSON.stringify(red)}\` then \`RED_JSON\`. Refused → the tree no longer matches that RED: fix it per the RED contract and run the checkpoint again with the corrected report.`
      : `Cycle ${c.id}: you write its RED, then its GREEN, in this one agent (agents/tdd-cycle.md). The RED part:`,
    ...(red ? [] : [
      redContract(c, lotIndex.declaratives),
      '',
      `RED checkpoint, before any production beyond the stubs: \`cctoolkit tdd-scope red <<'RED_JSON'\` then your RED report as one JSON line, then \`RED_JSON\`. Refused → fix what it names and run it again. Passed → one call, ${cycleState(c, null)}.`,
      noGreenAfter,
    ]),
    '',
    ...(c.guard ? [] : [greenContract(c, ripple), '']),
    AMBIGUITY,
    'Structured output: `red` = the report the checkpoint accepted, unchanged; `green` = your `## GREEN` report (`production`, `command`, `exit`, `testsDiff`, `cost`, `independentOf`, `removed`, `flagged`); `decisions` = your ambiguity lines, empty when none.',
    `Last step before the structured output, after a GREEN: one call, ${cycleState(c, red, true)}${red ? '' : ', `<the RED report>` = the one the checkpoint accepted'}.`,
  ].filter(l => l !== '').join('\n')
}

// What a RED or GREEN wrote and how its RED fails is checked on the tree by the hook (lib/tdd_scope.py):
// it refuses the checkpoint until the tree matches, or lets a BLOCKED through whose diagnostic starts with
// the reason it found. That reason is returned as is, so the retry reads the hook's words, never the agent's.
const mechanical = r => (r && r.status === 'BLOCKED' && String(r.diagnostic || '').startsWith(RED_ON_STUB) ? r.diagnostic.trim() : null)

function checkRed(c, r) {
  if (!r) return 'RED agent without result'
  if (mechanical(r)) return mechanical(r)
  if (r.status === 'BLOCKED') return `BLOCKED — ${r.diagnostic || r.expectedFailure}`
  if (r.status === 'ALREADY_GREEN') {
    if (c.refactor || c.guard) return `ALREADY_GREEN on a ${c.refactor ? 'refactor' : 'guard'} cycle`
    if (r.exit !== 0) return `ALREADY_GREEN with exit ${r.exit} on \`${r.command}\``
    if (r.stubs.length) return `ALREADY_GREEN with stubs written: ${r.stubs.join(', ')}`
    if (!r.table.length) return 'ALREADY_GREEN without the methods run'
    return null
  }
  const unreachable = (r.unreachable || []).map(u => u.method)
  if (!r.table.length && (r.removed.length || unreachable.length)) return null
  if (c.refactor && r.exit !== 0) return `safety net red: exit ${r.exit} on \`${r.command}\``
  if (c.guard && r.exit !== 0) return `guard red on the current code: exit ${r.exit} on \`${r.command}\``
  if (c.guard && r.stubs.length) return `guard with stubs: ${r.stubs.join(', ')}`
  if (!c.refactor && !c.guard && r.exit === 0) return `RED not observed: exit 0 on \`${r.command}\` — already in place on disk → status ALREADY_GREEN`
  const sameMethod = (a, b) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
  const missing = c.methods.filter(m => {
    const name = fileName(m)
    return !r.table.some(l => sameMethod(fileName(l.test), name)) &&
      !r.removed.some(s => s.includes(name)) &&
      !unreachable.some(u => sameMethod(fileName(u), name))
  })
  if (missing.length) return `contract methods missing from the table: ${missing.join(', ')}`
  return null
}

// A flagged `Cost` line is no rejection: it goes to `### Reported without fixing` and to the audit (Cost axis).
function checkGreen(r) {
  if (!r) return 'GREEN missing from the cycle agent\'s output'
  if (r.status === 'BLOCKED') return `BLOCKED — ${r.diagnostic || r.cost}`
  if (r.exit !== 0) return `GREEN not observed: exit ${r.exit} on \`${r.command}\``
  return null
}
const costFlagged = r => !!r && !!r.cost && !COST_CLEAR.some(x => r.cost.includes(x))

const LAST_MODEL = 'opus'
const RETRY_EMPTY = 'Previous attempt ended without structured output, most likely out of turns. Its files may already be on disk: before writing, Read the contract paths in one message and keep what is done, never rewrite from scratch. Finish what is missing, run the filtered command once, then return the report at once.'

const retryText = reason => (reason.endsWith('without result') || reason.endsWith('output')
  ? `\n\n${RETRY_EMPTY}`
  : `\n\nPrevious attempt rejected by the orchestrator: ${reason}. Fix this point and return a new report.`)

function escalation(reasons) {
  return [
    '',
    '',
    `Last attempt at this step, after ${reasons.length} rejected one(s). Earlier attempts may have left files on disk: Read the contract paths in one message first, keep what is right, never rewrite from scratch.`,
    `Why each earlier attempt was rejected, in order: ${reasons.map((r, i) => `${i + 1}. ${r}`).join(' ; ')}.`,
    'Diagnose the common cause of these rejections before writing, then fix that cause. Same contract, same report.',
  ].join('\n')
}

// A step attempted once, retried once with the reason; still rejected, the run stops on it.
async function withRetry(step, launch, check) {
  const attempt = (suffix, options = {}) => launch(suffix, options).catch(() => null)
  let result = await attempt('')
  let reason = check(result)
  if (!reason) return { result, reason }
  result = await attempt(retryHead(step, 2, reason) + retryText(reason))
  reason = check(result)
  return { result, reason }
}

const cycleLabel = (c, model) => `RED ${c.id} w${c.wave} ${short(c.behaviour)} +GREEN${model ? ` ${model}` : ''}`
const needsGreen = (c, red) => !c.guard && red.table.length > 0 && !(red.status === 'ALREADY_GREEN' && !(red.pendingRipple || []).length)

// One cycle: an attempt, one retry carrying the reason, one last attempt on opus with every reason. A RED
// accepted on the way is kept: the next attempt re-arms it and writes the GREEN only. Still rejected: a
// refactor or guard cycle is left out and listed to validate, any other stops the batch. The stop reason, or null.
async function runCycle(c) {
  const resumed = c.resume ? savedOf(c) : null
  let red = resumed && resumed.red && !checkRed(c, resumed.red) ? resumed.red : null
  if (c.resume && !red) log(`${c.behaviour}: saved RED ${resumed && resumed.red ? 'rejected' : 'missing'}, RED rerun`)
  const reasons = []
  for (let n = 1; n <= 3; n++) {
    const step = `${red ? 'GREEN' : 'RED'} ${short(c.behaviour, 60)}`
    const model = n === 3 ? LAST_MODEL : null
    if (model) log(`${step}: last attempt on ${LAST_MODEL} — ${short(reasons[reasons.length - 1], 60)}`)
    const suffix = n === 1 ? '' : retryHead(step, n, reasons[reasons.length - 1]) + (model ? escalation(reasons) : retryText(reasons[reasons.length - 1]))
    const x = await agent(cycleContract(c, red) + suffix, { agentType: 'cctoolkit:tdd-cycle', schema: CYCLE_RESULT, phase: 'RED', label: cycleLabel(c, model), ...(model ? { model } : {}) }).catch(() => null)
    const redWhy = red ? null : x ? checkRed(c, x.red) : 'cycle agent without result'
    if (redWhy) {
      reasons.push(redWhy)
      continue
    }
    if (!red) red = x.red
    const greenWhy = !x ? 'cycle agent without result' : needsGreen(c, red) ? checkGreen(x.green) : null
    if (!greenWhy) {
      for (const d of x.decisions || []) toReview(`Cycle ${c.id}`, d)
      accepted(c, red, x.green || null)
      return null
    }
    reasons.push(greenWhy)
  }
  const reason = reasons[reasons.length - 1]
  if (c.refactor || c.guard) {
    log(`${c.behaviour}: left out after ${reasons.length} attempts, settled after the plan`)
    toReview(`Cycle ${c.id}`, `${c.refactor ? 'refactor' : 'guard'} cycle left out, still rejected after ${reasons.length} attempts: ${reason}`, c.behaviour)
    return null
  }
  return `${red ? 'GREEN' : 'RED'} ${c.behaviour} — ${reason}`
}

// The trace of a cycle the run accepts, and what it hands to the review after the plan.
function accepted(c, red, green) {
  const trace = { behaviour: c.behaviour, rmcu: c.rmcu, red, green, ...(c.resume ? { resumed: true } : {}) }
  history.cycles.push(trace)
  for (const u of red.unreachable || []) toReview(`RED ${c.behaviour}`, `unreachable guard, test not written, removal proposed: \`${u.method}\` — ${u.site}`, u.why)
  if (!red.table.length) {
    log(`${c.behaviour}: no test written (already covered or unreachable) — no GREEN`)
    trace.green = { ...noGreen(''), removed: (red.unreachable || []).length ? 'unreachable sites' : 'tests already covered' }
    return
  }
  const ripple = red.status === 'ALREADY_GREEN' ? red.pendingRipple || [] : []
  if (ripple.length) toReview(`RED ${c.behaviour}`, `ALREADY_GREEN refused, ripple not in the batch diff: GREEN run on ${ripple.join(', ')}`)
  else if (red.status === 'ALREADY_GREEN') {
    log(`${c.behaviour}: already in place on disk — GREEN observed, no GREEN`)
    trace.green = noGreen('GREEN observed: behaviour already in place on disk at RED')
    toReview(`RED ${c.behaviour}`, 'behaviour already in place on disk at RED: GREEN observed without a RED observed in this run', red.table.map(l => l.test).join(', '))
    return
  }
  if (c.guard) {
    trace.green = noGreen('guard green at once, no GREEN')
    return
  }
  for (const t of green.testsDiff || []) toReview(`GREEN ${c.behaviour}`, `test changed at GREEN: \`${t.path ?? t}\``, t.why || '')
  if (costFlagged(green)) trace.green = { ...green, flagged: [green.flagged, `${short(c.behaviour, 60)}: ${green.cost}`].filter(Boolean).join(' ; ') }
}

const NO_ACCESS = /^(Cost: 0 read \+ 0 write outside loop; Infrastructure in loop or in-memory filter: none|Coût : 0 lecture \+ 0 écriture hors boucle ; Infrastructure en boucle ou filtre mémoire : aucun)/
const noGreen = flagged => ({ status: 'GREEN', production: [], command: '', exit: 0, testsDiff: [], cost: '', independentOf: '', removed: '', flagged })

let saved = { cycles: [] }
let lotIndex = null
const savedOf = c => saved.cycles.find(x => x.behaviour === c.behaviour) || null

const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
const relative = p => slashed(fileName(p)).replace(/^.*?(?=(src|tests|todo)\/)/, '')
const projectOf = p => (/^(src|tests)\/([^/]+)\//.exec(p) || [])[2] || ''
const withinLayer = p => p.replace(/^(src|tests)\/[^/]+\//, '')
function sharedPrefix(projects) {
  const names = projects.map(n => n.split('.'))
  let k = names.length ? Math.min(...names.map(n => n.length - 1)) : 0
  while (k > 0 && !names.every(n => n.slice(0, k).join('.') === names[0].slice(0, k).join('.'))) k--
  return k
}
const tableOf = (head, rows) => rows.length
  ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)]
  : ['None.']
const bullets = xs => (xs.length ? xs.map(x => `- ${cell(x)}`) : ['None.'])

function renderReport(status, reason, verdict) {
  const cycles = history.cycles
  const files = new Set([
    ...(lotIndex?.declaratives ?? []),
    ...cycles.flatMap(c => [...(c.red?.tests ?? []), ...(c.red?.stubs ?? []), ...(c.red?.productionDiff ?? []), ...(c.green?.production ?? []), ...(c.green?.testsDiff ?? []).map(t => t.path ?? t)]),
    ...(history.gate?.files ?? []),
    ...history.fixes.flatMap(f => f.files),
  ].map(relative).filter(Boolean))
  const prefix = sharedPrefix([...new Set([...files].map(projectOf).filter(Boolean))])
  const layerOf = f => projectOf(f).split('.').slice(prefix).join('.') || 'Other'
  const byLayer = new Map()
  for (const f of [...files].sort()) {
    const key = `${f.startsWith('tests/') ? 'Tests ' : ''}${layerOf(f)}`
    byLayer.set(key, [...(byLayer.get(key) ?? []), withinLayer(f)])
  }
  const flagged = cycles.map(c => c.green?.flagged).filter(Boolean)
  const gapsOf = v => v.gaps.filter(g => g.severity !== 'Minor')
  const auditGaps = history.verdicts.flatMap((v, i) => gapsOf(v).map(g =>
    `- ${g.severity} — ${g.axis} — ${cell(g.gap)} (evidence: ${cell(g.evidence)}). Fix: ${cell(g.fix)}${history.fixes[i] ? `; applied in round ${i + 1}: ${cell(history.fixes[i].fixed.join('; '))}` : '; not applied'}.${g.closure ? ` Closure: ${cell(g.closure)}.` : ''}`))
  const reviews = history.review ? [history.review] : []
  const tests = new Map()
  for (const c of cycles) {
    for (const t of c.red?.table ?? []) {
      const parts = t.test.replace(/`/g, '').split('.')
      const klass = parts.length > 1 ? parts[parts.length - 2] : (fileName((c.red.tests ?? [])[0] || '').split(/[\\/]/).pop() || '').replace(/\.cs$/, '')
      tests.set(klass, [...(tests.get(klass) ?? []), [`\`${parts[parts.length - 1]}\``, c.rmcu, short(t.case, 50)]])
    }
  }
  const finalVerdict = history.audit === AUDIT_PENDING ? AUDIT_PENDING
    : verdict ? (verdict.verdict === GAPS && status === DONE ? GAPS_CARRIED : verdict.verdict)
    : 'none'
  return [
    `## STATUS — ${status}`,
    '',
    `Reason: ${cell(reason)}`,
    '',
    `Verdict: ${finalVerdict}`,
    '',
    ...(history.closing ? [`Closing: ${history.closing.level} — ${cell(history.closing.reasons.join('; ') || 'no file on authorisation, migration or public contract, no ripple, few production files')}`, ''] : []),
    `## Closing summary — batch ${batch}`,
    '',
    `${cycles.length} TDD cycle(s)${cycles.some(c => c.resumed) ? `, ${cycles.filter(c => c.resumed).length} resumed from an earlier run` : ''}.`,
    '',
    '### Files',
    '',
    ...tableOf(['Layer', 'Files'], [...byLayer].map(([layer, xs]) => [layer, xs.map(x => `\`${x}\``).join(', ')])),
    '',
    '### Access cost per behaviour',
    '',
    ...tableOf(['Behaviour', 'Cost', 'Independent of'], cycles.filter(c => c.green && c.green.cost && !NO_ACCESS.test(c.green.cost)).map(c => [short(c.behaviour, 60), c.green.cost, c.green.independentOf])),
    '',
    '### Assumptions `Hn`',
    '',
    ...bullets(verdict ? verdict.hypotheses : []),
    '',
    '### Reported without fixing',
    '',
    ...bullets([...flagged, ...(verdict ? verdict.minors.map(m => `Audit minor: ${m}`) : [])]),
    '',
    '### Audit',
    '',
    ...(history.verdicts.length
      ? history.verdicts.map((v, i) => `- ${i ? 'After the fix' : history.closing && history.closing.level === LIGHT ? 'Light review (Correctness, Scope)' : 'Initial'}: ${v.verdict}${gapsOf(v).length ? ` (${gapsOf(v).map(g => g.severity).join(', ')})` : ''}`)
      : ['No audit.']),
    ...history.fixes.flatMap(f => f.objections.map(o => `- Fix objection, gap left as it was: ${cell(o)}`)),
    ...(reviews.length
      ? ['', '### Next batch review', '', ...reviews.map(r => `- ${r.result} — ${r.questions.length} question(s)${r.questions.length ? ': ' + r.questions.map(q => `${q.severity} — ${cell(q.question)} — answer: ${cell(q.answer)}`).join('; ') : ''}`)]
      : []),
    '',
    '### Validations',
    '',
    ...tableOf(['Suite', 'Exit', 'Scope', 'Tests'], (history.suites?.suites ?? []).map(s => [s.name, s.exit, s.scope, s.count])),
    ...(verdict && verdict.validations.length ? ['', 'Final audit:', ...bullets(verdict.validations)] : []),
    ...(history.fixes.length ? ['', 'Audit fixes:', ...bullets(history.fixes.flatMap(f => f.validations))] : []),
    '',
    '## Test recap',
    '',
    ...(tests.size
      ? [...tests].flatMap(([klass, rows]) => [`**${klass}**`, '', ...tableOf(['Test', 'RM/CU', 'Use case verified'], rows), ''])
      : ['No test written.', '']),
    '## To validate',
    '',
    ...(history.toReview.length ? history.toReview.map(x => `- ${cell(x.step)} — ${cell(x.text)}${x.why ? ` (${cell(x.why)})` : ''}`) : ['None.']),
    '',
    '## Audit gaps',
    '',
    ...(auditGaps.length ? auditGaps : ['None.']),
    ...(status === DONE
      ? []
      : ['', '## Resume', '', `Stop on a blocked design or declaratives, a cycle still rejected after its retry and its \`${LAST_MODEL}\` attempt, a global green not reached or a Blocking on Correctness after the fix: fix the cause, write the decision into the \`decisions\` field of the cycles it touches in the \`## Cycles\` block of \`${sheet}\` (and as \`Hn\` marked \`${USER}\` under \`## Assumptions\`), then launch a new \`/run-plan\` or \`/run-lot ${sheet}\`: cycles already through (\`cycle\` lines of \`${workFile}\`) are not redone. Under \`/run-plan\`, the batch was set aside: tree put back to its start state, partial work in \`<stamp>-aside-${batch}.patch\` of the run folder, cycles cleared, the batch starts over.`]),
  ].join('\n') + '\n'
}

async function report(status, reason, verdict) {
  const path = reportPath
  const r = await agent(
    [
      FRAME,
      '',
      'You are a scribe. The markdown below was rendered by the orchestrating workflow from the structured results of the agents that ran this batch (cycles, suites, audit); you are not asked to vouch for it, verify it or reproduce it, only to persist it verbatim.',
      `\`mkdir -p ${runRoot}/batches\`, then write \`${path}\` in a single Write, content exactly the markdown between the \`~~~~\` fences below, nothing added, removed or reformatted.`,
      ...(status === DONE
        ? [`Then in \`${plan}\`, on the heading line starting \`### Batch ${batch} \` (or \`### Lot ${batch} \`): replace a trailing \`⬜\` with \`✅ DONE ($(date +%Y-%m-%d))\`, or append \` — ✅ DONE (<that date>)\` when it carries neither; and in \`${sheet}\`, append \` — ✅ DONE (<that date>)\` to its first \`# \` line unless it already carries \`✅ DONE\`. One Edit per file, nothing else moves.`]
        : []),
      ...(status === DONE
        ? [commitAtEnd
            ? `Then one call: \`cctoolkit batch-baseline commit ${workFile} ${batch} --sheet ${sheet} && cctoolkit run-work drop ${workFile} --batch ${batch} --kind preexisting,question,answer; cctoolkit run-work rm-tmp ${batch}\`. \`commit\` = the line the commit printed (stderr included on failure). The commit holds the files of the batch only, the user's earlier changes left out; the \`cycle\` lines stay as the TDD evidence a later correction resumes from. This is the intended end of every finished batch.`
            : `Then one call: \`cctoolkit run-work drop ${workFile} --batch ${batch} --kind question,answer; cctoolkit run-work rm-tmp ${batch}\`. The run-plan gate commits the batch after its build check. \`commit\` empty.`]
        : [`Then one call: \`cctoolkit run-work drop ${workFile} --batch ${batch} --kind question,answer\`: the \`preexisting\` and \`cycle\` lines stay for the resume.`]),
      'Return the written path.',
      '',
      '~~~~markdown',
      renderReport(status, reason, verdict),
      '~~~~',
    ].join('\n'),
    { schema: REPORT, phase: 'Report', label: 'report', model: 'haiku', effort: 'low' },
  ).catch(() => null)
  return r || null
}

async function finish(status, reason, verdict) {
  if (reviewing) history.review = await reviewing
  const written = await report(status, reason, verdict)
  return {
    status,
    reason,
    verdict: verdict ? verdict.verdict : 'none',
    gaps: verdict ? verdict.gaps.filter(e => e.severity !== 'Minor') : [],
    hypotheses: verdict ? verdict.hypotheses : [],
    minors: verdict ? verdict.minors : [],
    review: history.review,
    audit: history.audit,
    toReview: history.toReview,
    report: written ? written.path : null,
    commit: written && written.commit ? written.commit : null,
  }
}

phase('Design')
const indexCommand = target => `cctoolkit sheet-cycles ${target} --index`
const loading = agent(
  [
    FRAME,
    '',
    `First, one call: \`cctoolkit run-work drop ${workFile} --batch ${batch} --kind question,answer; cctoolkit run-validate apply ${workFile}; cctoolkit batch-baseline snapshot ${workFile} ${batch}\` — questions of an earlier run never answer this one; run-validate writes the answers given in the run-lot-pane mod into the sheets; the snapshot records the files already modified, left out of the batch diff and commit (kept when it exists).`,
    `Then in one message: \`cctoolkit sheet-cycles ${sheet} --states ${workFile}\`, \`${indexCommand(sheet)}\` and \`grep -E '^### (Batch|Lot) F[0-9]+' ${plan}\`.`,
    '`cycles` = the JSON array `--states` printed, each object as-is, no field changed (`[]` when no cycle was saved).',
    '`index` = the JSON line `sheet-cycles` printed, verbatim, whatever its exit code (0 valid, 1 invalid, 2 no block).',
    `\`nextSheet\` = the first \`### Batch FY\` (or \`### Lot FY\`) heading after the one of ${batch} without \`✅ DONE\` → \`${naming[1]}-FY.md\` when that file exists; empty string otherwise.`,
  ].join('\n'),
  { schema: LOADED, phase: 'Design', label: 'resume state', model: 'haiku', effort: 'low' },
).catch(() => null)

const readIndex = (target, phaseName) => agent(
  `${FRAME}\n\nRun \`${indexCommand(target)}\` once. Return the JSON line it printed, verbatim, whatever its exit code.`,
  { schema: INDEX, phase: phaseName, label: `index ${fileName(target).split(/[\\/]/).pop()}`, model: 'haiku', effort: 'low' },
).catch(() => null)

function designPrompt(target, targetBatch) {
  return [
    FRAME,
    '',
    `You are the design of batch ${targetBatch}, without delegation: you write the \`## Cycles\` block of its sheet \`${target}\`; other agents write tests and code from that block alone.`,
    `First call: \`${indexCommand(target)}\`. Exit 0 → the block is already valid: return \`blocked: false\` at once, nothing else.`,
    'Otherwise read, in one message: `<kit>/skills/implement-tdd/references/design.md`, `test-scope.md` and `parallelism.md` of the same folder, then analyse the batch per `design.md`.',
    `Earlier batches and sheet paths in one call: \`cctoolkit plan-next-batch ${plan} --context ${targetBatch}\` prints the \`## Audit gaps\` of the earlier batches' reports, the \`${USER}\`/GAPS lines of the sheets, saved cycles, and the source and test paths the sheet cites that do not exist. Never reread those reports nor grep those sheets.`,
    'A choice an earlier audit rejected or a recorded user decision overrides a contrary line of the sheet (test level, double, exception "carried over"): design per the source, one `review` line citing it. Never design a choice already rejected.',
    'An absent cited path is either a file the batch creates (`toCreate`) or a stale anchor: fix the stale one in the block, never search for it twice.',
    `Ambiguity → decide, never stop: the option the spec, the rules, the handler \`CLAUDE.md\` or an earlier decision favour, else the smallest one keeping every RM/CU; one line in \`review\` (question → choice → why). A choice that changes scope or an RM/CU also gets one line under \`## Decisions\`, marked \`${TO_REVIEW}\`. \`blocked: true\` only when no option is defensible (options of comparable weight on behaviour a customer sees, data loss, security, contract of an external system) or the sheet cannot be implemented at all.`,
    `A \`${USER}\` of the sheet overriding a contract → its text in \`decisions\` of each cycle it touches.`,
    'Saved cycles listed by `--context`: keep their `behaviour` verbatim in the block, the run reuses them by that key.',
    '',
    'Write the block per `design.md` § "The `## Cycles` block": one `## Cycles` section before `## Assumptions`, one ```json fence. It replaces `## TDD sequence` and `## Ancrages`: delete those sections once their content is in the block, and the `TDD:` lines with them.',
    'Declarative artefacts are never written by you: list them in `declaratives`, the run writes them before the first RED.',
    `Last: \`${indexCommand(target)}\` until exit 0, fixing what it lists; still exit 1 after three rounds → \`blocked: true\`, \`reason\` = its errors.`,
    '`review` = one line per choice made in place of the user (empty when none).',
  ].filter(l => l !== '').join('\n')
}

const designAgent = (target, targetBatch, suffix = '') => agent(
  designPrompt(target, targetBatch) + suffix,
  { schema: DESIGN, phase: 'Design', label: 'design' },
)

async function designed(suffix) {
  const d = await designAgent(sheet, batch, suffix)
  if (!d || d.blocked) return { design: d, index: null }
  return { design: d, index: await readIndex(sheet, 'Design') }
}

const designRejected = x => (!x || !x.design ? 'design agent without result'
  : x.design.blocked ? `BLOCKED — ${x.design.reason}`
  : !x.index ? 'index agent without result'
  : !x.index.ok ? `\`## Cycles\` still invalid — ${x.index.errors.join(' ; ')}: fix the block, then rerun \`${indexCommand(sheet)}\` until exit 0`
  : !whole(x.index) ? `index relayed with ${x.index.cycles.length} of its ${x.index.count} cycle(s)`
  : null)

// An agent relays the index: a copy short of cycles would run none of them (2026-10-21: `cycles: []` relayed
// for a 7-cycle block, the run went straight to the global green). `count` is printed by `sheet-cycles --index`.
const whole = x => !x || !x.ok || !Number.isInteger(x.count) || x.cycles.length === x.count

const loaded = await loading
saved = loaded || { cycles: [] }
if (!loaded) log('resume state agent without result — no cycle reused')
lotIndex = loaded ? loaded.index : null
if (!whole(lotIndex)) {
  log(`resume state relayed ${lotIndex.cycles.length} of ${lotIndex.count} cycle(s) — index read again`)
  lotIndex = await readIndex(sheet, 'Design')
  if (!whole(lotIndex)) return await finish(BLOCKED, `cycle index relayed incomplete twice (${lotIndex.cycles.length} of ${lotIndex.count} cycles): rerun the batch`)
}
const nextSheet = loaded ? loaded.nextSheet.trim() : ''
if (!lotIndex || !lotIndex.ok) {
  log(!lotIndex ? 'cycle index unread — design writes the block' : lotIndex.missing ? 'no `## Cycles` block — design writes it' : `\`## Cycles\` invalid — design fixes it: ${short(lotIndex.errors.join(' ; '), 80)}`)
  const { result, reason } = await withRetry('Design', designed, designRejected)
  if (reason) return await finish(BLOCKED, `design — ${reason}`)
  for (const line of result.design.review || []) toReview('Design', line)
  lotIndex = result.index
}

const settledGreen = r => r.status === 'ALREADY_GREEN' && !(r.pendingRipple || []).length
const finishedAtStart = (c, s) => !!(s && s.red && (settledGreen(s.red) || c.guard || !s.red.table.length ||
  (s.green && s.green.status === 'GREEN' && s.green.exit === 0)))
const pending = []
for (const c of lotIndex.cycles) {
  const s = savedOf(c)
  if (finishedAtStart(c, s)) {
    history.cycles.push({ behaviour: c.behaviour, rmcu: c.rmcu, red: s.red, green: s.green || noGreen('resumed without GREEN'), resumed: true })
    continue
  }
  pending.push(s && s.red ? { ...c, resume: true } : c)
}
const waves = [...new Set(pending.map(c => c.wave))].sort((a, b) => a - b).map(w => pending.filter(c => c.wave === w))
log(`${waves.length} wave(s), ${pending.length} behaviour(s)${history.cycles.length ? `, ${history.cycles.length} already done` : ''}`)

if (lotIndex.declaratives.length) {
  const { reason } = await withRetry(
    'Declaratives',
    suffix => agent(
      [
        FRAME,
        '',
        'Write the declarative artefacts below before any RED, per `<kit>/skills/implement-tdd/references/common-rules.md` §4 point 5, that paragraph only: each mirrors the existing file it names, a registry entry goes after the neighbour entry it names; one already on disk with that content stays as is. No test, no signature stub, no logic.',
        ...lotIndex.declaratives.map(d => `- ${d}`),
        'Then the solution build of `<kit>/skills/implement-tdd/references/test-scope.md` once: exit 0 → `ok: true`; otherwise fix what you wrote, at most twice, then `ok: false`, `detail` = the first error line.',
        ...(lock ? ["Another batch builds beside this one: run each solution build as `cctoolkit build-lock '<build command>'`, it waits for the other's build to end and keeps the exit."] : []),
      ].join('\n') + suffix,
      { schema: OK, phase: 'Design', label: 'declaratives', model: 'sonnet', effort: 'low' },
    ),
    x => (!x ? 'declaratives agent without result' : !x.ok ? `declaratives — ${x.detail || ''}` : null),
  )
  if (reason) return await finish(BLOCKED, `declaratives — ${reason}`)
}

/// Cycles whose code files (tests, production, ripple) do not meet run side by side; the others wait.
function disjoint(wave) {
  const groups = []
  for (const c of wave) {
    const files = new Set(c.files || [])
    const g = groups.find(x => (c.files || []).length && x.every(o => (o.files || []).length && !o.files.some(f => files.has(f))))
    g ? g.push(c) : groups.push([c])
  }
  return groups
}

const planned = lotIndex.closing && lotIndex.closing.level === LIGHT ? LIGHT : FULL
log(`closing planned ${planned}${lotIndex.closing && lotIndex.closing.reasons.length ? ` — ${short(lotIndex.closing.reasons.join(' ; '), 100)}` : ''}`)

for (const wave of waves) {
  for (const group of disjoint(wave)) {
    const stops = await parallel(group.map(c => () => runCycle(c)))
    const stop = stops.find(Boolean)
    if (stop) return await finish(BLOCKED, stop)
  }
}

phase('Global green')
// Two agents (2026-10-20: one agent on the session model took 9 min 53 s, 4 min 50 s of it the repair;
// resolving, building, running and reading exits is mechanical): `suites run` on haiku runs what
// `cctoolkit suites-plan` resolves, `suites repair` only when a suite is red or a scope unresolved.
const closingCommand = `cctoolkit closing-level ${sheet} ${workFile} --record${nextSheet ? ` --next ${nextSheet}` : ''}`
const planCommand = `cctoolkit suites-plan ${workFile} ${batch}${lock ? ' --lock' : ''}`

const runSuites = (suffix = '') => agent(
  [
    FRAME,
    '',
    'Global green, first pass: you run commands and report their exits. Never edit a file, never diagnose, never fix, never read a test or production file.',
    `First call: \`${planCommand}\`. It prints one JSON object: \`build\`, \`suites\` (each with its \`run\` line, \`scope\` and \`output\`), \`unresolved\`, \`notRun\`. Copy each line literally, never rebuild nor \`eval\` one.`,
    'Then `build.run` alone (skip it when empty, `build.exit` 0). Exit not 0 → stop there: `build` = its exit and output, `suites` empty.',
    'Then every `suites[].run` line in a single message, one Bash call each.',
    'Each suite: `exit` read off its `exit=` line, `count` = the total the tail prints (0 when none), `name`, `scope`, `run` and `output` from the plan. `failed` = for a suite whose exit is not 0, the lines `cctoolkit suites-plan --failed <output>` prints, those calls in one message; empty on exit 0.',
    '`unresolved` and `notRun` = the plan\'s, verbatim.',
    `Build exit 0, every suite exit 0 and \`unresolved\` empty → last call: \`${closingCommand}\`; \`closing\` = the JSON line it printed, verbatim. Otherwise no closing call, \`closing\` empty.`,
  ].join('\n') + suffix,
  { schema: SUITES_RUN, phase: 'Global green', label: 'suites run', model: 'haiku', effort: 'low' },
).catch(() => null)

const ranGreen = r => !!r && r.build.exit === 0 && r.suites.length > 0 && r.suites.every(s => s.exit === 0) && !r.unresolved.length
const asSuites = r => ({ green: true, suites: r.suites.map(({ name, exit, scope, count }) => ({ name, exit, scope, count })), fixes: [], testEdits: [], closing: r.closing || '' })

function repairPrompt(ran) {
  const red = ran ? ran.suites.filter(s => s.exit !== 0) : []
  return [
    FRAME,
    '',
    ran
      ? 'Global green repair of the batch. A first pass ran the suites below: start from their output files, never rerun a suite before you have fixed something.'
      : `Global green repair of the batch. No first pass reached a result: first call \`${planCommand}\` and run its \`build.run\` line, then every \`suites[].run\` line in one message, each copied literally.`,
    ran && ran.build.exit !== 0 ? `Build: exit ${ran.build.exit}, output \`${ran.build.output}\`. No suite ran.` : '',
    ...red.map(s => `- ${s.name} — exit ${s.exit}, scope ${s.scope}, output \`${s.output}\`${s.failed.length ? `, failed: ${s.failed.join(', ')}` : ''}`),
    ran && ran.unresolved.length ? `Scope left to you, per \`<kit>/skills/implement-tdd/references/test-scope.md\` §2-3 (Runner for the command and filter): ${ran.unresolved.map(u => `${u.name} — ${u.why}`).join(' ; ')}.` : '',
    'Red → fix production code until green; never weaken nor remove a test to pass.',
    `Never write under the test roots (\`layout.tests.roots\`), save two cases, each listed in \`testEdits\` (test-scope.md §6): \`${SNAPSHOT_PROMOTED}\` — an approved snapshot promoted from its received file only when the difference follows directly from a decision of the sheet, \`why\` quoting that sheet line; \`${TEST_DOUBLE}\` — a shared double under \`layout.tests.shared\` only when a value the batch adds requires it (a constant, a permission), \`why\` naming that value. Any other test write — a test, a fixture, a double outside the shared roots, a snapshot no sheet line decides — is not yours: \`green\` false, \`diagnostic\` \`BLOCKED — <test> — <why>\`. A test file an earlier attempt wrote outside these two is listed \`${TEST_CODE}\`.`,
    'Once fixed: rerun each red suite once, filtered to its failing classes (the runner filter of test-scope.md Runner), in one message; then once, in one message, every suite of the first pass with its `run` line verbatim, and the unresolved ones with the scope you chose. Return each suite of that last run with its exit, scope and test count; `green` = all exit 0.',
    '`fixes` = one line per production change, `testEdits` = every file you wrote under the test roots, empty when none.',
    'Never call `cctoolkit closing-level`: the run records it once it has read the test tree.',
  ].filter(l => l !== '').join('\n')
}

// Reads the test tree the repair left and records the closing level: never the repair's own report.
const readTests = () => agent(
  [
    FRAME,
    '',
    `Two calls in a single message, nothing else: \`${planCommand} --tests-changed\` and \`${closingCommand}\`.`,
    '`read` = the first exited 0, `changed` = the `changed` array it printed, verbatim (empty when it failed); `closing` = the JSON line the second printed, verbatim.',
  ].join('\n'),
  { schema: TESTS_CHANGED, phase: 'Global green', label: 'suites tests', model: 'haiku', effort: 'low' },
).catch(() => null)

async function globalGreen() {
  let ran = await runSuites()
  if (!ran) ran = await runSuites('\n\nA previous attempt ended without structured output: run the plan again, then return the report at once.')
  if (ranGreen(ran)) return { result: asSuites(ran), reason: null }
  log(`global green: ${ran ? `${ran.build.exit ? 'build red' : ran.suites.filter(s => s.exit).map(s => s.name).concat(ran.unresolved.map(u => `${u.name} unresolved`)).join(', ') || 'no suite run'}` : 'first pass without result'} — repair`)
  const declared = []
  const repair = async (suffix, options) => {
    const r = await agent(repairPrompt(ran) + suffix, { schema: SUITES, phase: 'Global green', label: 'suites repair', ...options })
    for (const e of (r && r.testEdits) || []) if (!declared.some(d => d.path === e.path)) declared.push(e)
    if (!r || !r.green) return r
    const tree = await readTests()
    return { ...r, testEdits: [...declared], closing: tree ? tree.closing || '' : '', tree }
  }
  return withRetry('Global green', repair, x => (
    !x ? 'suites agent without result'
      : !x.green ? (/^BLOCKED/.test(x.diagnostic || '') ? x.diagnostic : `global green not reached — ${x.diagnostic || ''}`)
      : testWrites(x.tree, x.testEdits)
  ))
}

const runGate = (suffix = '') => agent(
  [
    FRAME,
    '',
    'Another agent runs the global green suites at the same time: never build nor run tests, never touch production code under the source roots.',
    `Run \`cctoolkit pre-audit ${batch} ${sheet}\`. RED → fix what it lists per \`<kit>/skills/implement-tdd/references/closing.md\` §3 (handler \`CLAUDE.md\` row or trait, sheet line), then rerun; three rounds at most.`,
    'A `DEAD REFERENCE` is fixed in the handler table only: add the row from the draft the pre-audit prints, reworded as a rule. Never retarget, rename nor delete an `RM` trait, never edit a test file to turn the gate green.',
    'Run the pre-audit in the foreground: it takes seconds, never poll a background output.',
    'A sheet line is never added to cover a rule of the repo tests rule (`.claude/rules/tests.md`: a test calling an aggregate directly, a hand-written registry count): such a test goes into `failures`.',
    '`ok` = pre-audit run, `files` = files written, `preauditGreen` = last pre-audit exit 0, `failures` = its remaining failures.',
  ].join('\n') + suffix,
  { schema: CLOSING, phase: 'Closing', label: 'pre-audit', model: 'sonnet', effort: 'low' },
).catch(() => null)

const [{ result: suites, reason: greenStop }, { result: gated }] = await Promise.all([
  globalGreen(),
  // One pass, its own three rounds inside: what it leaves red goes to the audit, never a rerun.
  runGate().then(result => ({ result })),
])
history.suites = suites
history.gate = gated
// Every test file the repair wrote goes to the user's review and to the audit, as a point to check.
for (const e of (suites && suites.testEdits) || []) toReview('Global green', `test file written to reach green, ${e.kind}: ${e.path}`, e.why)
const testEditsToCheck = () => (history.suites && history.suites.testEdits && history.suites.testEdits.length
  ? `Test files the global green repair wrote, each a point to verify: a promoted snapshot against the sheet line its \`why\` quotes, a shared double against the value of the batch it names; anything else, or a reason that does not hold, is a Test gap (test-scope.md §6): ${history.suites.testEdits.map(e => `\`${e.path}\` (${e.kind}) — ${e.why}`).join(' ; ')}.`
  : '')
if (suites && suites.green && 'tree' in suites && !(suites.tree && suites.tree.read)) toReview('Global green', 'test tree not read after the repair: its writes under the test roots are unchecked')
if (!suites || !suites.green || greenStop) return await finish(BLOCKED, greenStop && greenStop.startsWith('global green') ? greenStop : `global green not reached — ${greenStop || (suites ? suites.diagnostic || '' : 'agent without result')}`)

// The level the diff earns decides the closing, whatever the plan said; unread, the closing is full.
function closingOf(text) {
  try {
    const c = JSON.parse(String(text || '').trim())
    if (c && (c.level === FULL || c.level === LIGHT) && Array.isArray(c.reasons)) return { review: true, reviewWhy: '', ...c }
  } catch (e) { /* unread */ }
  return null
}
history.closing = closingOf(suites.closing) || { level: FULL, reasons: ['closing level unread — full by default'], review: true, reviewWhy: '' }
const light = history.closing.level === LIGHT
log(`closing ${history.closing.level}${history.closing.reasons.length ? ` — ${short(history.closing.reasons.join(' ; '), 100)}` : ''}`)
if (!gated || !gated.ok) toReview('Closing', `pre-audit not run, the audit judges it: ${gated ? gated.diagnostic || '' : 'agent without result'}`)
else if (!gated.preauditGreen) toReview('Closing', `pre-audit RED, the audit judges it: ${gated.failures.join(' ; ')}`)
const gateToCheck = () => (!gated || !gated.ok
  ? `The pre-audit gate did not run (${gated ? gated.diagnostic || '' : 'agent without result'}): run \`cctoolkit pre-audit ${batch} ${sheet}\` once, each failure it lists is a gap of its axis.`
  : !gated.preauditGreen
    ? `Failures the pre-audit gate left after its rounds, each a gap of its axis unless the code shows it settled: ${gated.failures.join(' ; ')}.`
    : '')

const capture = `<tmp>/audit-${batch}.txt`
const greenSuites = (history.suites?.suites ?? []).filter(x => x.exit === 0).map(x => x.name)
const captureCommand = `cctoolkit audit-capture ${batch} ${sheet} "$(${tmpCommand})/audit-${batch}.txt" --base ${workFile}${greenSuites.length ? ` --suites-green ${greenSuites.join(',')}` : ''}`

// A batch past SPLIT_CYCLES cycles is audited by two auditors in parallel, one per
// group of axes, on one shared capture (2026-10-14: a 27-cycle batch, a 5584-line
// diff, one auditor out of turns after 5.6 min, its retry 13.6 min).
const SPLIT_CYCLES = 12
const PARTS = [
  { key: 'code', scope: 'Audit only the code axes of §2 — Correctness, Reuse, Simplification, Cost, Placement, Comments — over the production hunks of the diff. Coverage (§1.2), the Test, Plan and Scope axes and the validations (§3) belong to a second auditor running beside you: leave them out, `validations` empty.' },
  { key: 'plan', scope: 'Audit only §1 (scope, id coverage, every hunk traced to an RM/CU or step) and the Test, Plan and Scope axes of §2, TDD evidence included, then the validations (§3). The code axes (Correctness, Reuse, Simplification, Cost, Placement, Comments) belong to a second auditor running beside you: read a production hunk only to trace it.' },
]

const notesOf = key => `<tmp>/audit-${batch}.${key}.notes.md`

// Cost lines a GREEN reported flagged: never a rejection, the audit judges each on the Cost axis.
const costsToCheck = () => {
  const flagged = history.cycles.filter(c => costFlagged(c.green))
  return flagged.length
    ? `\`Cost\` lines a GREEN reported flagged, each judged on the Cost axis (a flagged call this batch wrote in a loop or over an unbounded input is a gap; one already there, or bounded by an input the sheet fixes, is not): ${flagged.map(c => `${short(c.behaviour, 60)} — ${c.green.cost}`).join(' ; ')}.`
    : ''
}

function audit(retry, again = false, part = null, captured = false) {
  const notes = notesOf(part ? part.key : retry ? 'resume' : 'all')
  const previous = retry
    ? [
        '',
        'Mode `resume`, after the fix of a Blocking on Correctness. Gap table of the previous verdict:',
        retry.verdict.gaps.map(e => `| ${e.severity} | ${e.axis} | ${e.gap} | ${e.evidence} | ${e.closure} | ${e.fix} |`).join('\n'),
        retry.fix.objections.length ? `Objections of the fix, gaps left as they were, judge each: ${retry.fix.objections.join(' ; ')}.` : '',
        `Files the fix declared: ${list(retry.fix.files)} — diff from: \`git diff -- <these files>\`. Read only these files and that diff: a finding whose evidence lies outside them was not touched by the fix.`,
        retry.fix.extensions && retry.fix.extensions.length ? `Files the fix declared beyond the findings, with why — judge each: a reason a finding's closure required holds; otherwise Scope Major: ${retry.fix.extensions.map(x => `\`${x.file}\` — ${x.why}`).join(' ; ')}.` : '',
        `Validations the fix reran: ${list(retry.fix.validations)}.`,
      ].join('\n')
    : ''
  const alreadyRun = retry
    ? '\nThe fix changed code after the global green and ran only filtered tests: run once, in a single message, the suites `<kit>/skills/implement-tdd/references/test-scope.md` requires for the whole batch diff.'
    : part && part.key === 'code'
      ? ''
      : [
          '',
          'Suites the global green ran after the last production change, the pre-audit gate touched no production code since: read these exit codes, never rerun them (verify-ddd-tdd §3); a guard refuses the rerun. A scope you judge too narrow is a Test gap carrying the filtered command, the fix runs it; run only a suite missing here.',
          history.suites.suites.map(x => `- ${x.name} — exit ${x.exit}, scope ${x.scope}, ${x.count} tests`).join('\n'),
        ].join('\n')
  return agent(
    [
      FRAME,
      '',
      `Read \`<kit>/skills/verify-ddd-tdd/SKILL.md\` and follow it as if the skill were invoked with the argument \`batch ${batch}${retry ? ' resume' : ''}\`, fast mode.`,
      retry || again || captured
        ? `Capture: \`${capture}\` (to read, already written: never rerun it), ${TMP}. Section ${batch} of the sheet: \`${sheet}\`.`
        : `First run \`${captureCommand}\`, then read the capture \`${capture}\`, ${TMP}. Section ${batch} of the sheet: \`${sheet}\`.`,
      part ? part.scope : '',
      again
        ? `A previous attempt ended without structured output, most likely out of turns: the capture is written, never rerun it nor a suite it already holds. Read \`${notes}\` first: the findings and validations that attempt settled, never re-establish them; finish what they leave uncovered, then return the verdict at once.`
        : `Notes: \`${notes}\`. Empty it first (\`: > <path>\`), then append each finding the moment you settle it, one line \`severity | axis | gap | evidence | closure | fix\`, and each validation read or run. Your turns are bounded: these notes are what a second attempt starts from.`,
      'Search with `git grep -n -e <pattern> -- <paths>`, never a recursive grep; every command in the foreground.',
      alreadyRun,
      history.toReview.length ? `Decisions the run took without the user, each listed for the user review after the plan — never a \`Plan\` gap for being absent from the sheet: ${history.toReview.map(x => `${x.step}: ${x.text}`).join(' ; ')}` : '',
      part && part.key === 'code' ? '' : testEditsToCheck(),
      part && part.key === 'plan' ? '' : costsToCheck(),
      part && part.key === 'code' ? '' : gateToCheck(),
      previous,
      '',
      'Structured output: `block` = the markdown verdict block verbatim (fixed format of the skill), `gaps` = its Blocking/Major rows,',
      '`minors` = its minors one line each, `validations` = its Validations lines, `hypotheses` = the Hn.',
    ].join('\n'),
    { agentType: 'cctoolkit:ddd-tdd-auditor', schema: VERDICT, phase: 'Audit', label: `${retry ? 'audit retry' : 'audit'}${part ? ` ${part.key}` : ''}${again ? ' again' : ''}` },
  ).catch(() => null)
}

async function audited(retry, part = null, captured = false) {
  const verdict = await audit(retry, false, part, captured)
  if (verdict) return verdict
  log(`audit${part ? ` ${part.key}` : ''} without result — one more attempt on the same capture`)
  return audit(retry, true, part, captured)
}

function merged(verdicts) {
  return {
    verdict: verdicts.some(v => v.verdict === GAPS) ? GAPS : verdicts[0].verdict,
    gaps: verdicts.flatMap(v => v.gaps),
    minors: verdicts.flatMap(v => v.minors),
    validations: verdicts.flatMap(v => v.validations),
    hypotheses: verdicts.flatMap(v => v.hypotheses),
    block: verdicts.map(v => v.block).join('\n\n'),
  }
}

async function firstAudit() {
  if (history.cycles.length < SPLIT_CYCLES) return audited(null)
  const captured = await agent(
    [FRAME, '', `Run \`${captureCommand}\` in the foreground, ${TMP}. Read nothing else. \`ok\` = exit 0, \`detail\` = on failure, its last 6 lines.`].join('\n'),
    { schema: OK, phase: 'Audit', label: 'capture', model: 'haiku', effort: 'low' },
  ).catch(() => null)
  if (!captured || !captured.ok) {
    log(`capture failed${captured ? ` — ${captured.detail || ''}` : ''}: one auditor captures and audits alone`)
    return audited(null)
  }
  const parts = await parallel(PARTS.map(part => () => audited(null, part, true)))
  if (parts.some(v => !v)) return null
  return merged(parts)
}

function auditPending() {
  history.audit = AUDIT_PENDING
  toReview('Audit', `audit of batch ${batch} without result after two attempts: ${AUDIT_PENDING} (\`/verify-ddd-tdd batch ${batch}\`)`)
}

function reviewNext(label) {
  return agent(
    `${root ? `${ROOT_LINE}\n\n` : ''}mode: next-batch ${nextSheet} ${sheet}\n\nReturn your questions through the structured output: \`result\` CLEAR or GAPS, each question with its severity, its evidence, \`decidedBy\` (the \`Settled by\` column, empty when none), \`answer\` (the answer the source dictates; without source, your recommendation and why), \`options\` (without source: 2 to 4 short mutually exclusive answers, recommended first; empty otherwise) and \`humanOnly\` (your \`Human only\` rule). Nobody answers during the run: it applies every answer, \`humanOnly\` ones included, and the user reviews them afterwards.`,
    { agentType: 'cctoolkit:adversarial-reviewer', schema: REVIEW, phase: 'Review', label },
  ).catch(() => null)
}

function amendNext(questions, gaps) {
  return agent(
    [
      FRAME,
      '',
      `Update the next batch sheet \`${nextSheet}\` per the questions and audit gaps below, one Edit per spot, its \`## Cycles\` block included. The review ran beside the audit: check each name, path and signature against the current code, audit fixes included.`,
      '- Major: mechanical staleness (name, path, signature changed by batch ' + batch + '), apply the delivered value.',
      `- Blocking: settled by the cited source; rewrite the design of the sheet per that source and \`answer\`. A change of scope or of an RM/CU gets one line under \`## Decisions\`: the answer and its source, marked \`${USER}\` when the source is \`${USER}\`, \`${TO_REVIEW}\` otherwise. No \`Hn\`: the run lists every other answer for the user review.`,
      `- Audit gap of batch ${batch}: apply it to the next sheet only where that sheet repeats the rejected choice.`,
      `Last: \`${indexCommand(nextSheet)}\` until exit 0, fixing what it lists in the block; exit 2 (no block) → nothing to fix there.`,
      '',
      questions.map(q => `- ${q.severity} — ${q.question} — ${q.evidence} — source: ${q.decidedBy || '—'} — answer: ${q.answer}`).join('\n'),
      ...gaps.map(g => `- Audit gap ${g.severity} — ${g.axis} — ${g.gap} — fix: ${g.fix}`),
    ].join('\n'),
    { schema: OK, phase: 'Review', label: 'next sheet', effort: questions.some(q => q.severity === 'Blocking') ? 'medium' : 'low' },
  ).catch(() => null)
}

const nextIsPartner = !!partner && !!nextSheet && partner.split('/').pop() === nextSheet.split('/').pop()
if (nextIsPartner) {
  log(`next batch review skipped — ${nextSheet} runs beside this batch`)
} else if (nextSheet && (!light || history.closing.review)) {
  reviewing = reviewNext('next batch review')
} else if (nextSheet) {
  log(`next batch review skipped — ${history.closing.reviewWhy || 'light closing'}`)
}

// One line per cycle for the fix brief: its id, its behaviour, the files its RED and GREEN reported.
function cycleFiles() {
  return (lotIndex?.cycles ?? []).map(c => {
    const t = history.cycles.find(x => x.behaviour === c.behaviour)
    const files = [...new Set([...(t?.red?.tests ?? []), ...(t?.red?.stubs ?? []), ...(t?.green?.production ?? []), ...(t?.red?.pendingRipple ?? [])].map(relative).filter(Boolean))]
    return `- ${c.id} — ${short(c.behaviour, 60)} — ${list(files)}`
  })
}

// One fix of the verdict's Blocking and Major gaps. `reaudit`: a second review follows (a Blocking on
// Correctness), so the fix runs filtered tests only; otherwise it reruns the global green's suites itself.
function fixGaps(verdict, diff, reaudit) {
  return agent(
    [
      FRAME,
      '',
      'Fix the Blocking and Major gaps of the verdict below, per `<kit>/skills/implement-tdd/references/closing.md` §3 (verdict GAPS).',
      'Each gap is closed when its `Closure` holds; `Expected fix` is one way there, not an order.',
      'Touch only the files a finding cites as evidence and their tests; a file beyond them goes in `extensions` with the closure that required it.',
      'Apply every gap. One whose closure would do named harm — a behaviour it breaks, an invariant it violates, a cost it adds — is left as is, one line in `objections` with that harm; the user reviews it. "Complex", "out of scope", "not needed" are no harm: apply the gap.',
      'A fix that adds a rule or a branch goes through a red test first.',
      `The batch diff is already gathered in \`${diff}\` (${TMP}): read the hunks a gap cites there, open only the files its \`Evidence\` names, never \`git diff\` the batch again.`,
      `The sheet already holds the analysis of each cycle: for the cycle owning a file a gap cites, \`cctoolkit sheet-cycles ${sheet} --cycle <id> --green\` prints its production, signature ripple (each file with the call it needs), elements and invariants — read that, never re-derive it from the handlers. Cycles and the files each wrote:`,
      ...cycleFiles(),
      'Change code with Edit and Write only: never a script that rewrites files through Bash (python, sed, a heredoc), never a `/tmp` path. Bash builds, runs tests and reads.',
      reaudit
        ? 'Run only the filtered tests of the classes you touch (filtered command of `<kit>/skills/implement-tdd/references/test-scope.md`), never a whole suite: the review that follows reruns the suites. Return them with exit and scope.'
        : `No review follows this fix: once fixed, run in one message the suites the global green ran, same scope (\`<kit>/skills/implement-tdd/references/test-scope.md\`): ${history.suites.suites.map(x => `${x.name} (${x.scope})`).join(', ')}. Red → fix production, never a test. Return them with exit and scope.`,
      '',
      verdict.block,
    ].filter(l => l !== '').join('\n'),
    { schema: FIX, phase: 'Audit', label: 'fix', model: 'sonnet' },
  ).catch(() => null)
}

const wrongProduction = v => v.gaps.some(g => g.severity === 'Blocking' && /correct/i.test(g.axis))

// Light closing: one review of the batch diff on the Correctness and Scope axes, no capture.
const lightDiff = `<tmp>/light-${batch}.diff`

function lightReview(retry, again = false) {
  const notes = notesOf(retry ? 'light-resume' : 'light')
  return agent(
    [
      FRAME,
      '',
      `Light review of batch ${batch} (closing level light: ${history.closing.reasons.length ? history.closing.reasons.join(' ; ') : 'no file on authorisation, migration or public contract, no ripple, few production files'}). Two axes only, Correctness and Scope.`,
      `Read in \`<kit>/skills/verify-ddd-tdd/SKILL.md\`, by range: the Correctness and Scope rows of the §2 table, the bug-class paragraph under it, § Severities and § Verdict. Nothing else of the skill: no coverage table, no other axis, no validation run — the suites are green (${history.suites.suites.map(x => `${x.name} exit ${x.exit}, ${x.scope}`).join('; ')}).`,
      retry
        ? `Mode resume: the Blocking gaps below were fixed. Read only the files the fix declared — ${list(retry.fix.files)}, diff from \`git diff -- <these files>\` — and judge each gap closed or not, plus Scope on those files. Gaps:\n${retry.verdict.gaps.filter(g => g.severity !== 'Minor').map(e => `| ${e.severity} | ${e.axis} | ${e.gap} | ${e.evidence} | ${e.closure} | ${e.fix} |`).join('\n')}`
        : `The diff: ${again ? `already in \`${lightDiff}\`, never rerun it` : `one call, \`mkdir -p "$(${tmpCommand})" && cctoolkit batch-baseline diff ${workFile} ${batch} --code > "$(${tmpCommand})/light-${batch}.diff"\`, then read \`${lightDiff}\``} (${TMP}). Walk it hunk by hunk: tie each to a cycle's behaviour or a step of \`${sheet}\`, judge Correctness on the production hunks. A cycle's contract: \`cctoolkit sheet-cycles ${sheet} --cycle <id> --green\`. Cycles and the files each wrote:`,
      ...(retry ? [] : cycleFiles()),
      again ? `A previous attempt ended without structured output: read \`${notes}\` first, never re-establish what it settled.` : `Notes: \`${notes}\`. Empty it first (\`: > <path>\`), then append each finding the moment you settle it, one line \`severity | axis | gap | evidence | closure | fix\`.`,
      'Search with `git grep -n -e <pattern> -- <paths>`, never a recursive grep; every command in the foreground.',
      history.toReview.length ? `Decisions the run took without the user, listed for the user review — never a gap for being absent from the sheet: ${history.toReview.map(x => `${x.step}: ${x.text}`).join(' ; ')}` : '',
      testEditsToCheck(),
      gateToCheck(),
      '',
      'Structured output: `block` = the markdown verdict block (fixed format of the skill), `gaps` = its Blocking/Major rows, `minors` = its minors, `validations` = empty, `hypotheses` = the Hn.',
    ].filter(l => l !== '').join('\n'),
    { agentType: 'cctoolkit:ddd-tdd-auditor', schema: VERDICT, phase: 'Audit', label: `review light${retry ? ' retry' : ''}${again ? ' again' : ''}` },
  ).catch(() => null)
}

async function reviewedLight(retry) {
  const verdict = await lightReview(retry)
  if (verdict) return verdict
  log('light review without result — one more attempt')
  return lightReview(retry, true)
}

const toValidate = (gaps, why) => {
  for (const g of gaps.filter(g => g.severity !== 'Minor')) toReview('Audit', `${g.severity} — ${g.axis} — ${g.gap}`, `${g.evidence} ; ${why(g)}`)
}

// One audit pass: the audit (full) or the light review, one fix when GAPS, a second review only after a
// Blocking on Correctness — still one after it, the batch ends GAPS. Every other gap fixed goes to review.
phase('Audit')
let verdict = light ? await reviewedLight(null) : await firstAudit()
if (!verdict) auditPending()
else {
  history.verdicts.push(verdict)
  if (verdict.verdict === GAPS) {
    const reaudit = wrongProduction(verdict)
    const fix = await fixGaps(verdict, light ? lightDiff : capture, reaudit)
    if (fix) {
      history.fixes.push(fix)
      for (const o of fix.objections) toReview('Audit', `fix objection, gap left as it was: ${o}`)
    }
    if (!fix) {
      history.audit = GAPS_CARRIED
      toValidate(verdict.gaps, g => `not fixed (fix agent without result) ; proposed fix: ${g.fix}`)
    } else if (!reaudit) {
      history.audit = GAPS_CARRIED
      toValidate(verdict.gaps, () => `fixed without a second review: ${fix.fixed.join('; ')}`)
    } else {
      const retry = { verdict, fix }
      const next = light ? await reviewedLight(retry) : await audited(retry)
      if (!next) auditPending()
      else {
        verdict = next
        history.verdicts.push(verdict)
        if (verdict.verdict === GAPS) {
          if (wrongProduction(verdict)) return await finish(GAPS, 'Blocking on the Correctness axis after the fix: production is wrong', verdict)
          history.audit = GAPS_CARRIED
          toValidate(verdict.gaps, g => `proposed fix: ${g.fix}`)
        }
      }
    }
  }
}

// The next sheet's review: every answer applied and listed for review, `humanOnly` included; a Blocking
// question with neither source nor answer is `unanswered`, which run-plan turns into the next batch set aside.
if (reviewing) {
  phase('Review')
  const review = await reviewing
  reviewing = null
  history.review = review
  const questions = review ? review.questions : []
  const unanswered = questions.filter(q => q.severity === 'Blocking' && !q.decidedBy.trim() && !q.answer.trim())
  const applied = questions.filter(q => !unanswered.includes(q)).map(q => (q.decidedBy.trim() ? q : { ...q, decidedBy: REVIEWER }))
  for (const q of applied.filter(q => q.decidedBy === REVIEWER)) toReview(`Review ${nextSheet}`, `${q.humanOnly ? 'human-only question, answered by the reviewer: ' : ''}${q.question} → ${q.answer}`, q.evidence)
  const carried = history.verdicts.flatMap(v => v.gaps).filter(g => g.severity !== 'Minor')
  if (applied.length || carried.length) await amendNext(applied, carried)
  if (unanswered.length) {
    const result = await finish(DONE, '—', verdict)
    return { ...result, unanswered: `${nextSheet} — ${unanswered.length} Blocking question(s) without answer` }
  }
}

return await finish(DONE, '—', verdict)
