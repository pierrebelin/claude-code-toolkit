export const meta = {
  name: 'run-lot',
  description: 'FX batch under strict TDD, autonomous: cycles from the sheet, RED/GREEN per behaviour, global green, pre-audit, audit, next-batch review',
  whenToUse: 'Implement a plan batch without human intervention. Argument: path of the batch sheet, `todo/<code>/<CODE>-PLAN-FX.md`; plan, batch and run folder are derived from it.',
  phases: [
    { title: 'Design', detail: 'cycle index of the sheet; design writes the `## Cycles` block only when absent or invalid; declaratives' },
    { title: 'RED', detail: 'tdd-test-author, waves in sequence, cycles of a wave in parallel; light closing: tdd-cycle writes a cycle\'s RED then its GREEN past a checkpoint the hook checks' },
    { title: 'GREEN', detail: 'tdd-implementer, serial, writes the cycle state and the handler CLAUDE.md' },
    { title: 'Global green', detail: 'beside the pre-audit gate: suites run on haiku as cctoolkit suites-plan resolves them; red → suites repair, its writes under the test roots checked against testEdits; closing level full or light read off the batch diff' },
    { title: 'Closing', detail: 'cctoolkit pre-audit and what it lists, beside global green' },
    { title: 'Audit', detail: 'full: cctoolkit audit-capture, ddd-tdd-auditor, each Blocking or Major on Correctness, Reuse or Placement checked once by a fresh agent, two retries at most; light: one review of the diff on Correctness and Scope, a second only after a Blocking' },
    { title: 'Review', detail: 'adversarial-reviewer on the next sheet, beside the audit; light: only when the next sheet names a type the batch changed' },
    { title: 'Arbiter', detail: 'a stop is settled by the arbiter and listed for review after the run; a question only when no decision is defensible' },
    { title: 'Question', detail: 'human-only stop: question line in run/.work.jsonl, wait for the answer appended from the session, same run' },
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

const INDEX = obj({ ok: bool, missing: bool, errors: arr(str), declaratives: arr(str), closing: LEVEL, cycles: arr(CYCLE) }, ['closing'])

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
  testsDiff: arr(str),
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

const CYCLE_RESULT = obj({ red: RED, green: GREEN }, ['green'])

const CLOSING = obj({ ok: bool, files: arr(str), preauditGreen: bool, failures: arr(str), diagnostic: str }, ['diagnostic'])

const GAP = obj({ severity: { type: 'string', enum: ['Blocking', 'Major', 'Minor'] }, axis: str, gap: str, evidence: str, closure: str, fix: str })
const ANSWERS = ['Accept', 'Counter', 'Refute', 'Escalate']

const VERDICT = obj({
  verdict: { type: 'string', enum: ['VALID', 'GAPS'] },
  gaps: arr(GAP),
  minors: arr(str),
  validations: arr(str),
  hypotheses: arr(str),
  block: str,
  responses: arr(obj({ gap: str, answer: { type: 'string', enum: ANSWERS }, text: str })),
}, ['responses'])

const FIX = obj({ fixed: arr(str), files: arr(str), validations: arr(str), contested: arr(obj({ gap: str, harm: str })), objections: arr(str), extensions: arr(obj({ file: str, why: str })) })
const ROUND = obj({ ok: bool, files: arr(str), diff: str, detail: str }, ['detail'])

const REVIEW = obj({
  result: { type: 'string', enum: ['CLEAR', 'GAPS'] },
  questions: arr(obj({ severity: { type: 'string', enum: ['Blocking', 'Major'] }, question: str, evidence: str, decidedBy: str, answer: str, options: arr(str), humanOnly: bool }, ['humanOnly'])),
})

const REPORT = obj({ path: str, commit: str }, ['commit'])

const ANSWER = obj({ answered: bool, answers: arr(obj({ id: str, text: str })) })
const ASKED = obj({ ok: bool, id: str })

const ARBITRATION = obj({ decision: { type: 'string', enum: ['continue', 'defer', 'ask'] }, text: str, rationale: str })

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

const history = { cycles: [], suites: null, gate: null, verdicts: [], fixes: [], contests: [], rounds: [], review: null, audit: null, toReview: [], checked: [], refuted: [], closing: null }
const toReview = (step, text, why = '') => history.toReview.push({ step, text, why })
let reviewing = null
const USER = 'user decision'
const WAIT_SECONDS = 300
const WAIT_ROUNDS = 2
const UNANSWERED = 'decided without answer after 10 min'
const REVIEWER = 'reviewer recommendation'
const MAX_DECISIONS = 3
let asked = 0

async function ask(kind, context, questions) {
  await loading
  asked += 1
  const label = `${batch}-${asked}`
  const payload = { batch, sheet, kind, context, waitSeconds: WAIT_ROUNDS * WAIT_SECONDS, questions: questions.map((q, i) => ({ id: `q${i + 1}`, ...q })) }
  const written = await agent(
    [
      FRAME,
      '',
      `One call, the JSON below verbatim between the heredoc markers: \`cctoolkit run-question ask ${workFile} ${batch} <<'QUESTION_JSON'\` … \`QUESTION_JSON\`. \`id\` = the id it printed.`,
      `Then one call: \`command -v osascript >/dev/null && osascript -e 'display notification "${batch}: question awaiting an answer in the session" with title "run-lot"' || true\`.`,
      '',
      '```json',
      JSON.stringify(payload, null, 1),
      '```',
    ].join('\n'),
    { schema: ASKED, phase: 'Question', label: `question ${label}`, model: 'haiku', effort: 'low' },
  ).catch(() => null)
  if (!written || !written.ok || !written.id) return null
  const qid = written.id.trim()
  log(`❓ ${qid} waits for an answer in the session: ${workFile}`)
  for (let round = 1; round <= WAIT_ROUNDS; round++) {
    const r = await agent(
      [
        FRAME,
        '',
        `Run \`cctoolkit run-question wait ${workFile} ${qid} --seconds ${WAIT_SECONDS}\` once, Bash timeout 600000, nothing else.`,
        'Exit 0 → it printed `{"answers": [...]}`: `answered` true, `answers` = that array verbatim. Exit 3 (PENDING) or any other outcome → `answered` false, `answers` empty.',
      ].join('\n'),
      { schema: ANSWER, phase: 'Question', label: `wait ${label} #${round}`, model: 'haiku', effort: 'low' },
    ).catch(() => null)
    if (r && r.answered && r.answers.length) {
      log(`${label} answered`)
      return r.answers
    }
  }
  const recommended = payload.questions.filter(q => String(q.recommendation || '').trim())
  log(`${label} unanswered after ${(WAIT_ROUNDS * WAIT_SECONDS) / 60} min — ${recommended.length ? `${recommended.length} recommendation(s) applied` : 'no recommendation'}`)
  if (!recommended.length) return null
  for (const q of recommended) toReview(`Question ${label}`, `${UNANSWERED}: ${q.question} → ${q.recommendation.trim()}`, context)
  return recommended.map(q => ({ id: q.id, text: q.recommendation.trim(), recommended: true }))
}

const ALLOW_TEST = /allow-test:\s*`?([^\s`,;]+)`?/g
const ACCEPT_COST = /accept-cost\b/i
// lib/tdd_scope.py writes these at the head of a BLOCKED diagnostic, from the tree it checks.
const TESTS_AT_GREEN = 'tests modified at GREEN: '
const GRANTED = ' — granted: '
const RED_ON_STUB = 'RED on stub: '
const MECHANICAL = [TESTS_AT_GREEN, RED_ON_STUB]
const GRANT_LINE = 'Test files you may modify, granted: '
const COST_CLEAR = ['Infrastructure in loop or in-memory filter: none', 'Infrastructure en boucle ou filtre mémoire : aucun']

const noGrants = () => ({ tests: new Set(), cost: false })

function grantsFrom(text, grants = noGrants()) {
  // A path closing the arbiter's sentence keeps its period (`allow-test: tests/A.cs.`): it would match no file.
  for (const m of String(text || '').matchAll(ALLOW_TEST)) grants.tests.add(repoPath(m[1].replace(/[.:)\]]+$/, '')))
  if (ACCEPT_COST.test(String(text || ''))) grants.cost = true
  return grants
}

function arbitrate(step, reason, touched, earlier) {
  return agent(
    [
      FRAME,
      '',
      `You arbitrate a stop of this autonomous batch in place of the user, who reviews every decision you take after the whole plan has run. Step: ${step}. Stop reason: ${reason}`,
      earlier.length ? `Decisions already applied at this step, each followed by the same kind of stop: ${earlier.map(e => `« ${e.text} » then « ${e.reason} »`).join(' ; ')}. Never repeat one of them.` : '',
      'Read only what the reason names (test lines, production lines, the sheet section), by range; never edit a file.',
      'Decide so the batch goes on without weakening what the tests prove:',
      `- Test files modified at GREEN (${touched.length ? touched.join(', ') : 'none listed'}): the test itself is wrong (fixture bug, expectation written against the raw value a shared helper normalizes, expected key the fixture contradicts, compile ripple of a signature the sheet changes) → grant it, text \`allow-test: <path>\` once per file. The change removes, negates or loosens an assertion of the behaviour → text tells the GREEN to restore the test and fix production instead.`,
      '- `Cost` line flagged: the flagged call was there before this batch, or is bounded by an input the sheet fixes → text `accept-cost: <why>`. A loop the cycle wrote over an unbounded input → text tells the GREEN to rewrite it out of the loop.',
      '- Ambiguity of the sheet or the design: pick the option the spec, the rules, the handler `CLAUDE.md` or an earlier `Hn` favour, else the smallest one that keeps every RM/CU; text = the decision, stated so the next agent applies it.',
      '- Contract methods missing from a RED table because no caller reaches their throw site: text tells the RED to list each in `unreachable` (method, site `path:line`, why), never to write it.',
      '- Suites red, pre-audit red, agent without result: text = the concrete instruction for the retry (what to fix, what to read first).',
      '- Test files the global green repair wrote outside its two exceptions (test-scope.md §6): never grant them; text tells the repair to put each back and fix production. `ask` when the test itself contradicts the sheet.',
      '`defer` when the stop holds back no later batch and can be settled after the plan: a guard red on code that predates the batch, a refactor whose safety net is red, a documentation or pre-audit failure. The step is left out, the run goes on; `text` = what to settle later. Never for red suites, a GREEN or a design: later batches build on them.',
      '`ask` only when no decision is defensible: options of comparable weight on behaviour a customer sees, data loss, security, the contract of an external system, or every option already tried above. Then `text` = your recommendation.',
      '`text` in the docs language of `kit.config.json`, one paragraph; `rationale` = why, one sentence, citing the evidence `path:line`.',
    ].filter(l => l !== '').join('\n'),
    { schema: ARBITRATION, phase: 'Arbiter', label: `arbiter ${short(step, 40)}`, effort: 'medium' },
  ).catch(() => null)
}

async function decide(step, reason, earlier = []) {
  const atGreen = step.startsWith('GREEN')
  const touched = reason.startsWith(TESTS_AT_GREEN) ? reason.slice(TESTS_AT_GREEN.length).split(GRANTED)[0].split(', ').filter(Boolean) : []
  const arbitration = await arbitrate(step, reason, touched, earlier)
  if (arbitration && arbitration.decision === 'defer') {
    toReview(step, `deferred after the plan: ${reason} → ${arbitration.text.trim()}`, arbitration.rationale)
    log(`${step}: deferred — ${short(reason, 60)}`)
    return { deferred: true }
  }
  if (arbitration && arbitration.decision === 'continue' && arbitration.text.trim()) {
    const text = arbitration.text.trim()
    toReview(step, `${reason} → ${text}`, arbitration.rationale)
    log(`${step}: arbiter — ${short(text, 60)}`)
    return { text, by: TO_REVIEW }
  }
  const answers = await ask('stop', step, [{
    severity: 'Blocking',
    question: `${step} stopped: ${reason}. How should the batch go on?${atGreen ? ' To let the GREEN modify a test file, answer `allow-test: <path>` per file: the check then accepts it.' : ''}`,
    evidence: arbitration ? `${reason} — ${arbitration.rationale}` : reason,
    options: [...(arbitration && arbitration.text.trim() ? [arbitration.text.trim()] : []), ...(touched.length ? [touched.map(p => `allow-test: ${p}`).join(' ')] : []), 'STOP'],
    recommendation: arbitration ? arbitration.text : '',
  }])
  const answer = answers && answers[0]
  const text = answer ? answer.text.trim() : ''
  if (text.toUpperCase() === 'STOP') return { stop: true }
  return text ? { text, by: answer.recommended ? TO_REVIEW : USER } : null
}

function decided(text, grants = noGrants()) {
  return [
    '',
    '',
    `Decision answering the stop of this step, overriding the sheet and the contract: ${text}`,
    grants.tests.size ? `${GRANT_LINE}${[...grants.tests].join(', ')}. List them in \`testsDiff\`.` : '',
    grants.cost ? 'The flagged `Cost` line is accepted as is: report it verbatim.' : '',
    'The workflow lists this decision for the user review after the plan: never copy it into the sheet.',
  ].filter(l => l !== '').join('\n')
}

const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

const contractCommand = (c, phaseFlag) => `cctoolkit sheet-cycles ${sheet} --cycle ${c.id} ${phaseFlag}`

function redContract(c, declaratives) {
  return [
    FRAME,
    '',
    `RED phase, cycle ${c.id}. Your contract, no plan attached: first call, \`${contractCommand(c, '--red')}\` — it prints the contract lines (RM/CU, behaviour, level and skill, test class and fixture, methods, \`Rewritten by you (read in full)\`, \`Read bounded (context only)\`, scenarios, expected observation). Never read the sheet itself.`,
    '',
    '```text',
    ...(c.refactor ? [
      'Refactor under safety net: write no test and touch no file. Run the filtered command on the methods above, existing and unchanged.',
      'Green net (exit 0) = RED of the refactor: `status: RED`, `table` = one row per method run, `tests` = their paths, `stubs` and `productionDiff` empty. Red net = ## BLOCKED.',
    ] : []),
    ...(c.guard ? [
      'Guard test: the sheet declares it green at once on the current code (architecture or convention guard, no production code drives it). Write it, run it filtered: exit 0 expected, `status: RED` with `exit` 0, `stubs` and `productionDiff` empty.',
      'A red guard = the code already breaks it: ## BLOCKED with the violations listed.',
    ] : []),
    'An existing assertion on a literal or contract this behaviour changes is listed in `Rewritten by you`: rewrite it to the new expected value, never into a negative assertion (does-not-contain, not-equal) that would pass whatever the code does.',
    `Behaviour already in place on disk → \`status: ALREADY_GREEN\`, \`table\` = the methods run, \`stubs\` and \`productionDiff\` empty, \`pendingRipple\` = the lines of \`cctoolkit sheet-cycles ${sheet} --cycle ${c.id} --pending ${workFile}\` (files of the ripple and creations the batch has not changed; a hook checks the list): the GREEN still runs on them.`,
    ...(declaratives.length ? [
      `Declarative artefacts already written by the orchestrator (common-rules §4.5, neither yours nor stubs): ${declaratives.join(' ; ')}`,
    ] : []),
    '```',
    '',
    'Your `## RED` report goes through the structured output: `tests` = test paths, `exit` = code of the filtered command,',
    '`productionDiff` = `src/` files you created or modified yourself, no annotation (display only: a hook compares the tree to your start), `stubs` = paths only of the stubs written, no annotation — every source file you changed must be listed there, the hook refuses the output otherwise, `table` = one row per method written or modified',
    '(`test` = `Class.Method`), `removed` = tests removed because already covered, `unreachable` = contract methods not written, site unreachable. `## BLOCKED` = `status: BLOCKED` + `diagnostic` (six RTK lines at most).',
    `Last step before the structured output, except on ## BLOCKED: one call, \`cctoolkit run-work append ${workFile} <<'CYCLE_STATE'\` then the line \`{"kind": "cycle", "batch": "${batch}", "slug": "${slug(c.behaviour)}", "state": {"behaviour": ${JSON.stringify(c.behaviour)}, "rmcu": ${JSON.stringify(c.rmcu)}, "steps": ${JSON.stringify(c.steps)}, "red": <your report>}}\` then \`CYCLE_STATE\`, \`<your report>\` = the object you return, same fields and values.`,
  ].filter(l => l !== '').join('\n')
}

// An ALREADY_GREEN whose ripple or creations are absent from the batch diff (sheet-cycles --pending):
// the tests cover none of them, so only this GREEN lands them.
const rippleOnly = files => (files.length
  ? `

The red test above already passes: no test covers the files below, which the batch diff does not hold yet. Your work is them, per the \`Signature ripple\` and \`To create\` lines of your contract: ${list(files)}. The filtered test stays green.`
  : '')

function greenContract(c, r) {
  const redTests = r.table.map(l => `\`${l.test}\``).join(', ')
  return [
    FRAME,
    '',
    `GREEN + REFACTOR phase, cycle ${c.id}. Your contract, no plan attached: first call, \`${contractCommand(c, '--green')}\` — it prints the contract lines (out of scope, to create, production you may fill, signature ripple, read bounded, elements, applied ids, invariants, expected cost). Never read the sheet itself. The lines below complete it:`,
    '',
    '```text',
    c.refactor
      ? `Safety net, green and kept green — behaviour unchanged, no test touched: ${list(r.tests)} — ${redTests}`
      : `Red test: ${list(r.tests)} — ${redTests}`,
    `Already stubbed at RED (body to fill, read in full): ${list(r.stubs)}`,
    `\`Cost\` line from \`cctoolkit access-cost --base ${workFile} ${batch} <production files>\`: lines this batch added flagged, earlier ones listed pre-existing`,
    '```',
    '',
    'Your `## GREEN` report goes through the structured output: `production` = paths modified or created (handler `CLAUDE.md` included), `exit` = code of the final filtered test,',
    '`testsDiff` = `tests/` files you created or modified yourself, no annotation (display only: a hook compares the tree to your start and refuses a changed test file not granted), `cost` = last line of `cctoolkit access-cost` verbatim,',
    '`independentOf` = the input the cost is independent of. `## BLOCKED` = `status: BLOCKED` + `diagnostic`.',
    `Last step before the structured output, except on ## BLOCKED: one call, \`cctoolkit run-work append ${workFile} <<'CYCLE_STATE'\` then the line \`{"kind": "cycle", "batch": "${batch}", "slug": "${slug(c.behaviour)}", "state": {"behaviour": ${JSON.stringify(c.behaviour)}, "rmcu": ${JSON.stringify(c.rmcu)}, "steps": ${JSON.stringify(c.steps)}, "red": ${JSON.stringify(r)}, "green": <your report>}}\` then \`CYCLE_STATE\`, \`<your report>\` = the object you return, same fields and values.`,
  ].filter(l => l !== '').join('\n')
}

// What a RED or GREEN wrote and how its RED fails is checked on the tree by the hook
// (lib/tdd_scope.py): it refuses the structured output until the tree matches, or lets a
// BLOCKED through whose diagnostic starts with the reason it found. That reason is returned
// as is, so the retry and the arbiter read the hook's words, never the agent's.
const mechanical = r => (r && r.status === 'BLOCKED' && MECHANICAL.some(m => String(r.diagnostic || '').startsWith(m)) ? r.diagnostic.trim() : null)

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

const repoPath = p => slashed(p).replace(/^.*?(^|\/)((src|tests)\/)/, '$2')

function checkGreen(r, grants = noGrants()) {
  if (!r) return 'GREEN agent without result'
  if (mechanical(r)) return mechanical(r)
  if (r.status === 'BLOCKED') return `BLOCKED — ${r.diagnostic || r.cost}`
  if (r.exit !== 0) return `GREEN not observed: exit ${r.exit} on \`${r.command}\``
  if (!grants.cost && !COST_CLEAR.some(x => r.cost.includes(x))) return `Cost line malformed or flagged: ${r.cost}`
  return null
}

const ESCALATED = /^(RED|GREEN) /
const LAST_MODEL = 'opus'

function escalation(reasons, earlier, grants) {
  return [
    '',
    '',
    `Last attempt at this step, after ${reasons.length} rejected one(s). Earlier attempts may have left files on disk: Read the contract paths in one message first, keep what is right, never rewrite from scratch.`,
    `Why each earlier attempt was rejected, in order: ${reasons.map((r, i) => `${i + 1}. ${r}`).join(' ; ')}.`,
    earlier.length ? `Decisions applied in between, none lifted the stop: ${earlier.map(e => `« ${e.text} »`).join(' ; ')}. They stay in force.` : '',
    grants.tests.size ? `${GRANT_LINE}${[...grants.tests].join(', ')}. List them in \`testsDiff\`.` : '',
    grants.cost ? 'The flagged `Cost` line is accepted as is: report it verbatim.' : '',
    'Diagnose the common cause of these rejections before writing, then fix that cause. Same contract, same report.',
  ].filter(l => l !== '').join('\n')
}

// `first`: the result of an attempt already made elsewhere (a tdd-cycle agent's RED or GREEN), checked
// as the first attempt; its rejection opens the same retries, arbiter and escalation.
async function withRetry(step, launch, check, standing = '', first = undefined) {
  const grants = grantsFrom(standing)
  let tries = 1
  const attempt = (suffix, options = {}) => launch(suffix, options).catch(() => null)
  const again = (suffix, options = {}) => { tries += 1; return attempt(retryHead(step, tries, reasons[reasons.length - 1] || '') + suffix, options) }
  let result = first !== undefined ? first : await attempt(grants.tests.size || grants.cost ? decided(standing, grants) : '')
  let reason = check(result, grants)
  const reasons = reason ? [reason] : []
  if (reason && !reason.startsWith('BLOCKED')) {
    result = await again(reason.endsWith('without result')
      ? '\n\nPrevious attempt ended without structured output, most likely out of turns. Its files may already be on disk: before writing, Read the contract paths in one message and keep what is done, never rewrite from scratch. Finish what is missing, run the filtered command once, then return the report at once.'
      : `\n\nPrevious attempt rejected by the orchestrator: ${reason}. Fix this point and return a new report.`)
    reason = check(result, grants)
    if (reason) reasons.push(reason)
  }
  const earlier = []
  for (let n = 0; reason && n < MAX_DECISIONS; n++) {
    const decision = await decide(step, reason, earlier)
    if (decision && decision.deferred) return { result, reason, deferred: true }
    if (decision && decision.stop) return { result, reason }
    if (!decision) break
    earlier.push({ text: decision.text, reason })
    grantsFrom(decision.text, grants)
    const previous = reason
    result = await again(decided(decision.text, grants))
    reason = check(result, grants)
    if (reason) reasons.push(reason)
    if (reason === previous && earlier.filter(e => e.reason === previous).length > 1) {
      log(`${step}: same stop after two decisions — ${short(reason, 60)}`)
      break
    }
  }
  if (reason && ESCALATED.test(step)) {
    log(`${step}: last attempt on ${LAST_MODEL} — ${short(reason, 60)}`)
    result = await again(escalation(reasons, earlier, grants), { model: LAST_MODEL })
    reason = check(result, grants)
  }
  return { result, reason }
}

const redLabel = (c, model) => `RED ${c.id} w${c.wave} ${short(c.behaviour)}${model ? ` ${model}` : ''}`
const greenLabel = (c, model) => `GREEN ${c.id} ${short(c.behaviour)}${model ? ` ${model}` : ''}`

function launchRed(c, first = undefined) {
  const live = () => withRetry(
    `RED ${short(c.behaviour, 60)}`,
    (suffix, options) => agent(redContract(c, lotIndex.declaratives) + suffix, { agentType: 'cctoolkit:tdd-test-author', schema: RED, phase: 'RED', label: redLabel(c, options.model), ...options }),
    r => checkRed(c, r),
    c.decisions || '',
    first,
  )
  if (c.resume) {
    const state = savedOf(c)
    if (state && !checkRed(c, state.red)) return Promise.resolve({ result: state.red, reason: null })
    log(`${c.behaviour}: saved RED ${state ? 'rejected' : 'missing'}, RED rerun`)
  }
  return live()
}

function launchWave(wave, n) {
  return parallel(wave.map(c => () => launchRed(c).then(x => ({ ...x, cycle: c, wave: n }))))
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
    ...cycles.flatMap(c => [...(c.red?.tests ?? []), ...(c.red?.stubs ?? []), ...(c.red?.productionDiff ?? []), ...(c.green?.production ?? []), ...(c.green?.testsDiff ?? [])]),
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
      ? history.verdicts.map((v, i) => `- ${i ? `Resume ${i}` : history.closing && history.closing.level === LIGHT ? 'Light review (Correctness, Scope)' : 'Initial'}: ${v.verdict}${gapsOf(v).length ? ` (${gapsOf(v).map(g => g.severity).join(', ')})` : ''}`)
      : ['No audit.']),
    ...history.refuted.map(g => `- Refuted by verification: ${g.severity} — ${g.axis} — ${cell(g.gap)} → ${cell(g.why)}`),
    ...history.rounds.map(x => `- Round ${x.round}: findings ${x.open} → ${x.after}, files ${x.files.length}${x.diverged ? ' — diverging, rounds stopped' : ''}`),
    ...history.contests.flatMap(x => [
      ...x.contested.map(c => `- Round ${x.round} contested: ${cell(c.gap)} — harm: ${cell(c.harm)} → ${cell(answerOf(x.responses, c) ? `${answerOf(x.responses, c).answer}: ${answerOf(x.responses, c).text}` : 'no response')}`),
      ...x.objections.map(o => `- Round ${x.round} objection, gap applied: ${cell(o)}`),
    ]),
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
      : ['', '## Resume', '', `Stop after a \`STOP\` answer, a question left unanswered or a decision that did not lift the block: fix the cause, write the decision into the \`decisions\` field of the cycles it touches in the \`## Cycles\` block of \`${sheet}\` (and as \`Hn\` marked \`${USER}\` under \`## Assumptions\`), then launch a new \`/run-plan\` or \`/run-lot ${sheet}\`: cycles already through (\`cycle\` lines of \`${workFile}\`) are not redone. Under \`/run-plan\`, the batch was set aside: tree put back to its start state, partial work in \`<stamp>-aside-${batch}.patch\` of the run folder, cycles cleared, the batch starts over.`]),
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
      ...(history.rounds.length ? [`Before that call, one call: \`${appendRound(history.rounds[history.rounds.length - 1])}\` (the audit's answers to the last round).`] : []),
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
  : null)

const loaded = await loading
saved = loaded || { cycles: [] }
if (!loaded) log('resume state agent without result — no cycle reused')
lotIndex = loaded ? loaded.index : null
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

// What follows an accepted RED, on both paths: the trace, the cases without GREEN, then the GREEN —
// `first` the GREEN a tdd-cycle agent already wrote, checked as its first attempt. The stop reason, or null.
async function afterRed(cycle, red, first = undefined) {
  const trace = { behaviour: cycle.behaviour, rmcu: cycle.rmcu, red, green: null, ...(cycle.resume ? { resumed: true } : {}) }
  history.cycles.push(trace)
  for (const u of red.unreachable || []) toReview(`RED ${cycle.behaviour}`, `unreachable guard, test not written, removal proposed: \`${u.method}\` — ${u.site}`, u.why)
  if (!red.table.length) {
    log(`${cycle.behaviour}: no test written (already covered or unreachable) — no GREEN`)
    trace.green = { ...noGreen(''), removed: (red.unreachable || []).length ? 'unreachable sites' : 'tests already covered' }
    return null
  }
  const ripple = red.status === 'ALREADY_GREEN' ? red.pendingRipple || [] : []
  if (ripple.length) {
    log(`${cycle.behaviour}: tests already green, ripple not in the batch diff — GREEN runs on ${ripple.length} file(s)`)
    toReview(`RED ${cycle.behaviour}`, `ALREADY_GREEN refused, ripple not in the batch diff: GREEN run on ${ripple.join(', ')}`)
  } else if (red.status === 'ALREADY_GREEN') {
    log(`${cycle.behaviour}: already in place on disk — GREEN observed, no GREEN`)
    trace.green = noGreen('GREEN observed: behaviour already in place on disk at RED')
    toReview(`RED ${cycle.behaviour}`, 'behaviour already in place on disk at RED: GREEN observed without a RED observed in this run', red.table.map(l => l.test).join(', '))
    return null
  }
  if (cycle.guard) {
    log(`${cycle.behaviour}: guard green at once — no GREEN`)
    trace.green = noGreen('guard green at once, no GREEN')
    return null
  }
  const { result: green, reason } = await withRetry(
    `GREEN ${short(cycle.behaviour, 60)}`,
    (suffix, options) => agent(greenContract(cycle, red) + rippleOnly(ripple) + suffix, { agentType: 'cctoolkit:tdd-implementer', schema: GREEN, phase: 'GREEN', label: greenLabel(cycle, options.model), ...options }),
    checkGreen,
    cycle.decisions || '',
    first,
  )
  trace.green = green
  return reason ? `GREEN ${cycle.behaviour} — ${reason}` : null
}

// Light closing: one tdd-cycle agent writes a cycle's RED, passes the checkpoint the TDD scope hook
// checks on the tree (agents/tdd-cycle.md), then writes its GREEN. Its RED and GREEN go through the
// same checks as two agents' would; a rejected one goes on as the first attempt of the usual path.
// A resumed, refactor or guard cycle keeps the usual path.
const combinable = c => !c.resume && !c.refactor && !c.guard

function cycleContract(c) {
  const red = redContract(c, lotIndex.declaratives).split('\n').filter(l => !l.startsWith('Last step before the structured output'))
  const at = red.findIndex(l => l.startsWith('RED phase, cycle'))
  return [
    ...red.slice(0, at),
    `Cycle ${c.id}, light batch: you write its RED, then its GREEN, in this one agent (agents/tdd-cycle.md). The RED part:`,
    ...red.slice(at),
    '',
    `RED checkpoint, before any production beyond the stubs: \`cctoolkit tdd-scope red <<'RED_JSON'\` then your RED report as one JSON line, then \`RED_JSON\`. Refused → fix what it names and run it again; passed → one call, \`cctoolkit run-work append ${workFile} <<'CYCLE_STATE'\` then the line \`{"kind": "cycle", "batch": "${batch}", "slug": "${slug(c.behaviour)}", "state": {"behaviour": ${JSON.stringify(c.behaviour)}, "rmcu": ${JSON.stringify(c.rmcu)}, "steps": ${JSON.stringify(c.steps)}, "red": <the RED report>}}\` then \`CYCLE_STATE\`.`,
    '',
    `The GREEN part, once the checkpoint passed: your contract is \`${contractCommand(c, '--green')}\` (out of scope, to create, production you may fill, signature ripple, read bounded, elements, applied ids, invariants, expected cost). The red tests are those of your RED report; \`Cost\` line from \`cctoolkit access-cost --base ${workFile} ${batch} <production files>\`. No GREEN for an \`ALREADY_GREEN\` with an empty \`pendingRipple\` or a RED that wrote no test.`,
    '',
    'Structured output: `red` = the report the checkpoint accepted, unchanged; `green` = your `## GREEN` report (`production`, `command`, `exit`, `testsDiff`, `cost`, `independentOf`, `removed`, `flagged`; `BLOCKED` = `status: BLOCKED` + `diagnostic`).',
    `Last step before the structured output, after a GREEN: one call, the same \`cctoolkit run-work append ${workFile} <<'CYCLE_STATE'\` with \`"red"\` and \`"green": <your GREEN report>\` in \`state\`.`,
  ].join('\n')
}

const cycleLabel = (c, model) => `${redLabel(c, model)} +GREEN`

async function runCycle(c) {
  if (!combinable(c)) {
    const { result: red, reason, deferred } = await launchRed(c)
    if (deferred && (c.guard || c.refactor)) {
      log(`${c.behaviour}: left out, settled after the plan`)
      return null
    }
    return reason ? `RED ${c.behaviour} — ${reason}` : afterRed(c, red)
  }
  const both = await agent(cycleContract(c), { agentType: 'cctoolkit:tdd-cycle', schema: CYCLE_RESULT, phase: 'RED', label: cycleLabel(c) }).catch(() => null)
  const red = both ? both.red : null
  if (checkRed(c, red)) {
    log(`${c.behaviour}: cycle agent's RED rejected — ${short(checkRed(c, red), 60)}; RED retried alone`)
    const { result, reason } = await launchRed(c, red)
    return reason ? `RED ${c.behaviour} — ${reason}` : afterRed(c, result)
  }
  return afterRed(c, red, both.green || null)
}

// Cycles whose code files (tests, production, ripple) do not meet run side by side; the others wait.
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

if (planned === LIGHT) {
  for (const wave of waves) {
    for (const group of disjoint(wave)) {
      const stops = await parallel(group.map(c => () => runCycle(c)))
      const stop = stops.find(Boolean)
      if (stop) return await finish(BLOCKED, stop)
    }
  }
}

// Wave n+1's REDs start beside wave n's GREENs unless they rewrite one of its test files: a GREEN runs its
// filtered class, and rows the next RED adds to a shared theory would keep it red (a block validated before
// `--index` refused it, or waves made adjacent by the cycles a resume skips).
const testsOf = wave => new Set(wave.flatMap(c => c.tests || []))
const overlap = (a, b) => { const t = testsOf(a); return [...testsOf(b)].filter(f => t.has(f)) }

let pendingReds = planned === FULL && waves.length ? launchWave(waves[0], 0) : null
for (let n = 0; planned === FULL && n < waves.length; n++) {
  const reds = await pendingReds
  pendingReds = null
  const deferrable = x => x && x.deferred && (x.cycle.guard || x.cycle.refactor)
  for (const x of reds.filter(deferrable)) log(`${x.cycle.behaviour}: left out, settled after the plan`)
  const iRejected = reds.findIndex(x => !x || (x.reason && !deferrable(x)))
  if (iRejected >= 0) {
    const rejected = reds[iRejected]
    return await finish(BLOCKED, rejected ? `RED ${rejected.cycle.behaviour} — ${rejected.reason}` : `RED ${waves[n][iRejected].behaviour} — agent without result`)
  }

  const shared = n + 1 < waves.length ? overlap(waves[n], waves[n + 1]) : []
  if (shared.length) log(`wave ${waves[n + 1][0].wave} rewrites ${short(shared.join(', '), 80)} of wave ${waves[n][0].wave}: its REDs wait for that wave's GREENs`)
  else if (n + 1 < waves.length) pendingReds = launchWave(waves[n + 1], n + 1)
  for (let i = 0; i < reds.length; i++) {
    if (deferrable(reds[i])) continue
    const { cycle, result: red } = reds[i]
    const stop = await afterRed(cycle, red)
    if (stop) {
      if (pendingReds) await pendingReds
      return await finish(BLOCKED, stop)
    }
  }
  if (shared.length) pendingReds = launchWave(waves[n + 1], n + 1)
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
  withRetry('Closing', runGate, x => (!x ? 'pre-audit agent without result' : !x.ok ? `pre-audit not run — ${x.diagnostic || ''}` : !x.preauditGreen ? `pre-audit RED — ${x.failures.join(' ; ')}` : null)),
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

function audit(retry, again = false, part = null, captured = false) {
  const notes = notesOf(part ? part.key : retry ? `resume-${retry.round}` : 'all')
  const previous = retry
    ? [
        '',
        'Mode `resume`. Gap table of the previous verdict:',
        retry.verdict.gaps.map(e => `| ${e.severity} | ${e.axis} | ${e.gap} | ${e.evidence} | ${e.closure} | ${e.fix} |`).join('\n'),
        retry.contested.length
          ? `Gaps the fix contested, left as they were — one entry in \`responses\` each (\`gap\` = the Gap cell verbatim), per \`<kit>/skills/verify-ddd-tdd/SKILL.md\` § Contested findings:\n${retry.contested.map(c => `- ${c.gap} — harm: ${c.harm}`).join('\n')}`
          : '',
        retry.unanswered ? `A previous attempt left these contests without a response: ${retry.unanswered.map(c => c.gap).join(' ; ')}. Every contest gets Accept, Counter, Refute or Escalate, never the gap repeated.` : '',
        retry.fix.objections.length ? `Objections of the fix, gaps applied anyway (no contest): ${retry.fix.objections.join(' ; ')}.` : '',
        history.refuted.length ? `Findings refuted by verification, never report them again: ${history.refuted.map(g => `${g.gap} — ${g.why}`).join(' ; ')}.` : '',
        retry.changeSet
          ? `Change set of the fix, read off the tree by \`cctoolkit audit-round\`, not declared: ${list(retry.changeSet.files)} — diff in \`${retry.changeSet.diff}\`. Read only these files and that diff: a finding whose evidence lies outside them was not touched by the fix.`
          : `Files the fix declared (the tree could not be read): ${list(retry.fix.files)} — diff from: \`git diff -- <these files>\`.`,
        retry.outside && retry.outside.length ? `Files the fix changed outside every finding, each already a Scope Major of this verdict, keep it in \`gaps\` unless the file is now back as it was: ${list(retry.outside)}.` : '',
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
          'Suites the global green ran after the last production change, the pre-audit gate touched no production code since: read these exit codes, never rerun them (verify-ddd-tdd §3); a guard refuses the rerun. A scope you judge too narrow is a Test gap carrying the filtered command, the fix round runs it; run only a suite missing here.',
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
      previous,
      '',
      'Structured output: `block` = the markdown verdict block verbatim (fixed format of the skill), `gaps` = its Blocking/Major rows,',
      '`minors` = its minors one line each, `validations` = its Validations lines, `hypotheses` = the Hn.',
      retry && retry.contested.length ? '`responses` = one entry per contested gap: `gap` (its Gap cell), `answer` (Accept, Counter, Refute, Escalate), `text` (the trade-off, the other closure, the refutation with its evidence, or the two readings).' : '',
    ].join('\n'),
    { agentType: 'cctoolkit:ddd-tdd-auditor', schema: VERDICT, phase: 'Audit', label: `${retry ? `audit retry ${retry.round}` : 'audit'}${part ? ` ${part.key}` : ''}${again ? ' again' : ''}` },
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
    `${root ? `${ROOT_LINE}\n\n` : ''}mode: next-batch ${nextSheet} ${sheet}\n\nReturn your questions through the structured output: \`result\` CLEAR or GAPS, each question with its severity, its evidence, \`decidedBy\` (the \`Settled by\` column, empty when none), \`answer\` (the answer the source dictates; without source, your recommendation and why), \`options\` (without source: 2 to 4 short mutually exclusive answers, recommended first; empty otherwise) and \`humanOnly\` (your \`Human only\` rule; the run applies every other answer and the user reviews it afterwards).`,
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

function fixGaps(verdict, round, answered = [], lightRound = null) {
  return agent(
    [
      FRAME,
      '',
      'Fix the Blocking and Major gaps of the verdict below, per `<kit>/skills/implement-tdd/references/closing.md` §3 (verdict GAPS).',
      'Each gap is closed when its `Closure` holds; `Expected fix` is one way there, not an order.',
      'Touch only the files a finding cites as evidence and their tests; a file beyond them goes in `extensions` with the closure that required it — any other changed file becomes a Scope Major the next audit keeps.',
      'Contest a gap only when closing it would do named harm — a behaviour it breaks, an invariant it violates, a cost it adds: `contested` = its Gap cell verbatim and that `harm`, the gap left as is (protocol: `<kit>/skills/verify-ddd-tdd/SKILL.md` § Contested findings). "Complex", "out of scope", "not needed" open no contest: apply the gap, put the objection in `objections`.',
      answered.length ? `Answers of the audit to the earlier contests — Counter and Refute are fixed this round: ${answered.map(a => `${a.gap} → ${a.answer}: ${a.text}`).join(' ; ')}` : '',
      history.refuted.length ? `Refuted by verification, leave untouched even where the verdict below still lists them: ${history.refuted.map(g => g.gap).join(' ; ')}` : '',
      'A fix that adds a rule or a branch goes through a red test first.',
      `The batch diff is already gathered in \`${lightRound ? lightRound.diff : capture}\` (${TMP}): read the hunks a gap cites there, open only the files its \`Evidence\` names, never \`git diff\` the batch again.`,
      `The sheet already holds the analysis of each cycle: for the cycle owning a file a gap cites, \`cctoolkit sheet-cycles ${sheet} --cycle <id> --green\` prints its production, signature ripple (each file with the call it needs), elements and invariants — read that, never re-derive it from the handlers. Cycles and the files each wrote:`,
      ...cycleFiles(),
      'Change code with Edit and Write only: never a script that rewrites files through Bash (python, sed, a heredoc), never a `/tmp` path. Bash builds, runs tests and reads.',
      lightRound && !lightRound.reaudit
      ? `No audit follows this round: once fixed, run in one message the suites the global green ran, same scope (\`<kit>/skills/implement-tdd/references/test-scope.md\`): ${history.suites.suites.map(x => `${x.name} (${x.scope})`).join(', ')}. Red → fix production, never a test. Return them with exit and scope.`
      : 'Run only the filtered tests of the classes you touch (filtered command of `<kit>/skills/implement-tdd/references/test-scope.md`), never a whole suite: the audit that follows reruns the suites. Return them with exit and scope.',
      '',
      verdict.block,
    ].filter(l => l !== '').join('\n'),
    { schema: FIX, phase: 'Audit', label: `fix ${round}`, model: 'sonnet' },
  ).catch(() => null)
}

const wrongProduction = v => v.gaps.some(g => g.severity === 'Blocking' && /correct/i.test(g.axis))

const gapKey = text => String(text || '').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const sameGap = (a, b) => { const x = gapKey(a); const y = gapKey(b); return !!x && !!y && (x === y || x.startsWith(y.slice(0, 60)) || y.startsWith(x.slice(0, 60))) }
const answerOf = (responses, c) => (responses || []).find(r => sameGap(r.gap, c.gap)) || null

// A contest without a named harm is no contest: the gap stays open, the objection is kept.
function contestsOf(fix) {
  const contested = (fix.contested || []).filter(c => String(c.harm || '').trim())
  const bare = (fix.contested || []).filter(c => !String(c.harm || '').trim()).map(c => `${c.gap} (contest without harm, gap left open)`)
  return { contested, objections: [...(fix.objections || []), ...bare] }
}

// A Blocking or Major on a judgement axis is checked by a fresh agent before the fix round it
// would trigger: a false finding costs a round and widens the batch. A refuted one is not fixed,
// not reported again, and listed for the user's review. Each finding is checked once.
const CHECKED_AXES = /correct|reuse|placement/i
const CHECK = obj({ real: bool, why: str })
const refutedGap = g => history.refuted.some(r => sameGap(r.gap, g.gap))

function checkGap(g) {
  return agent(
    [
      FRAME,
      '',
      `Verify one finding of the audit of batch ${batch}; its author may be wrong. Read-only: never edit, never build, never run a test suite.`,
      `Finding: ${g.severity} — ${g.axis} — ${g.gap}. Evidence: ${g.evidence}. Closure: ${g.closure}.`,
      `Read the lines its evidence cites and, in \`${capture}\` (${TMP}), the hunks around them; search with \`git grep -n -e <pattern> -- <paths>\`.`,
      '- Correctness: follow the scenario through the code as written. `real` false only when a guard, an invariant, a caller or a test shows the wrong behaviour cannot happen.',
      '- Reuse: open the existing element it names. `real` false only when that element covers neither the need nor 80 % of it.',
      '- Placement: read the line of the rule id it invokes. `real` false only when the code already sits where that rule puts it.',
      'Doubt → `real` true. `why` = one line, with the `path:line` that refutes it when false.',
    ].join('\n'),
    { schema: CHECK, phase: 'Audit', label: `verify ${short(g.gap, 30)}`, model: 'sonnet', effort: 'low' },
  ).catch(() => null)
}

async function verified(v) {
  const fresh = v.gaps.filter(g => g.severity !== 'Minor' && CHECKED_AXES.test(g.axis) && !history.checked.some(x => sameGap(x, g.gap)))
  const checks = fresh.length ? await parallel(fresh.map(g => () => checkGap(g))) : []
  fresh.forEach((g, i) => {
    history.checked.push(g.gap)
    if (!checks[i] || checks[i].real !== false) return
    history.refuted.push({ ...g, why: checks[i].why })
    toReview('Audit', `finding refuted by verification, not fixed: ${g.severity} — ${g.axis} — ${g.gap}`, `${g.evidence} ; ${checks[i].why}`)
  })
  const gaps = v.gaps.filter(g => !refutedGap(g))
  if (gaps.length === v.gaps.length) return v
  return { ...v, gaps, verdict: gaps.some(g => g.severity !== 'Minor') ? GAPS : 'VALID' }
}

// Accept closes the gap, its trade-off listed for the user; Escalate hands it to the user and
// holds nothing back; Counter and Refute leave it open for the next round.
function settle(v, contested, round) {
  const closing = []
  for (const c of contested) {
    const r = answerOf(v.responses, c)
    if (!r || (r.answer !== 'Accept' && r.answer !== 'Escalate')) continue
    closing.push(c)
    toReview('Audit', `contest ${r.answer === 'Accept' ? 'accepted, trade-off' : 'escalated'} (round ${round}): ${c.gap} — harm: ${c.harm} → ${r.text}`)
  }
  const gaps = v.gaps.filter(g => !closing.some(c => sameGap(g.gap, c.gap)))
  return { ...v, gaps, verdict: gaps.some(g => g.severity !== 'Minor') ? GAPS : 'VALID' }
}

const lastContest = () => history.contests[history.contests.length - 1] || null

// The change set of a fix is read off the tree around it by a relay of `cctoolkit audit-round`,
// never taken from the fixer's `files`. One relay before the fix, one after.
const roundLine = x => JSON.stringify({ kind: 'audit-round', batch, round: x.round, open: x.open, files: x.files, contested: x.contested, responses: x.responses || [], after: x.after, diverged: !!x.diverged })
const appendRound = x => `cctoolkit run-work append ${workFile} <<'ROUND_LINE'\n${roundLine(x)}\nROUND_LINE`

function openRound(round) {
  const earlier = history.rounds[history.rounds.length - 1]
  return agent(
    [FRAME, '', `Run, one call each, nothing else: ${earlier ? `\`${appendRound(earlier)}\` then ` : ''}\`cctoolkit audit-round open ${workFile} ${batch} ${round}\`. \`ok\` = exit 0 of the last, \`files\` empty, \`diff\` empty, \`detail\` = its output.`].join('\n'),
    { schema: ROUND, phase: 'Audit', label: `round ${round} open`, model: 'haiku', effort: 'low' },
  ).catch(() => null)
}

function closeRound(round, open, contested) {
  return agent(
    [FRAME, '', `One call: \`cctoolkit audit-round close ${workFile} ${batch} ${round} <<'ROUND_JSON'\` then the line \`${JSON.stringify({ open, contested })}\` then \`ROUND_JSON\`.`, 'Exit 0 → it printed one JSON line: `ok` true, `files` and `diff` = its fields as-is. Otherwise `ok` false, `files` empty, `diff` empty, `detail` = the output verbatim.'].join('\n'),
    { schema: ROUND, phase: 'Audit', label: `round ${round} close`, model: 'haiku', effort: 'low' },
  ).catch(() => null)
}

const pathsIn = text => [...String(text || '').matchAll(/[\w./\\-]+\.[A-Za-z]\w*/g)].map(m => slashed(m[0]).replace(/^\.\//, ''))
const stem = p => p.split('/').pop().replace(/\.[^.]+$/, '')

// A file the fix changed that no finding cites, that is no test of a cited file, and that the
// fix did not declare as an extension: a Scope Major, decided here without judgment.
function outsideFindings(files, verdict, extensions) {
  const cited = verdict.gaps.flatMap(g => pathsIn(`${g.evidence} ${g.gap}`))
  const declared = new Set((extensions || []).map(x => fileName(x.file)))
  return files.filter(f => !declared.has(f) &&
    !cited.some(c => f === c || f.endsWith(`/${c}`) || c.endsWith(`/${f}`)) &&
    !cited.some(c => stem(f).startsWith(stem(c)) && stem(f) !== stem(c)))
}

const scopeGap = f => ({ severity: 'Major', axis: 'Scope', gap: `Audit fix changed a file outside every finding: \`${f}\``, evidence: `\`${f}\``, closure: 'the file is back as it was before the fix, or tied to a finding', fix: 'revert the change' })

const openCount = v => v.gaps.filter(g => g.severity !== 'Minor').length
const rebuttals = x => (x ? x.contested.map(c => ({ gap: c.gap, ...(answerOf(x.responses, c) || { answer: '', text: '' }) })).filter(a => a.answer === 'Counter' || a.answer === 'Refute') : [])

// Light closing: one review of the batch diff on the Correctness and Scope axes, no capture, no
// verification of the findings; a second one only after a Blocking, on the fix's change set.
const lightDiff = `<tmp>/light-${batch}.diff`

function lightReview(retry, again = false) {
  const notes = notesOf(retry ? `light-resume-${retry.round}` : 'light')
  return agent(
    [
      FRAME,
      '',
      `Light review of batch ${batch} (closing level light: ${history.closing.reasons.length ? history.closing.reasons.join(' ; ') : 'no file on authorisation, migration or public contract, no ripple, few production files'}). Two axes only, Correctness and Scope.`,
      `Read in \`<kit>/skills/verify-ddd-tdd/SKILL.md\`, by range: the Correctness and Scope rows of the §2 table, the bug-class paragraph under it, § Severities and § Verdict. Nothing else of the skill: no coverage table, no other axis, no validation run — the suites are green (${history.suites.suites.map(x => `${x.name} exit ${x.exit}, ${x.scope}`).join('; ')}).`,
      retry
        ? `Mode resume: the Blocking gaps below were fixed. Read only the fix's change set — ${retry.changeSet ? `${list(retry.changeSet.files)}, diff in \`${retry.changeSet.diff}\`` : `the files it declared: ${list(retry.fix.files)}`} — and judge each gap closed or not, plus Scope on the change set. Gaps:\n${retry.verdict.gaps.filter(g => g.severity !== 'Minor').map(e => `| ${e.severity} | ${e.axis} | ${e.gap} | ${e.evidence} | ${e.closure} | ${e.fix} |`).join('\n')}`
        : `The diff: ${again ? `already in \`${lightDiff}\`, never rerun it` : `one call, \`mkdir -p "$(${tmpCommand})" && cctoolkit batch-baseline diff ${workFile} ${batch} --code > "$(${tmpCommand})/light-${batch}.diff"\`, then read \`${lightDiff}\``} (${TMP}). Walk it hunk by hunk: tie each to a cycle's behaviour or a step of \`${sheet}\`, judge Correctness on the production hunks. A cycle's contract: \`cctoolkit sheet-cycles ${sheet} --cycle <id> --green\`. Cycles and the files each wrote:`,
      ...(retry ? [] : cycleFiles()),
      again ? `A previous attempt ended without structured output: read \`${notes}\` first, never re-establish what it settled.` : `Notes: \`${notes}\`. Empty it first (\`: > <path>\`), then append each finding the moment you settle it, one line \`severity | axis | gap | evidence | closure | fix\`.`,
      'Search with `git grep -n -e <pattern> -- <paths>`, never a recursive grep; every command in the foreground.',
      history.toReview.length ? `Decisions the run took without the user, listed for the user review — never a gap for being absent from the sheet: ${history.toReview.map(x => `${x.step}: ${x.text}`).join(' ; ')}` : '',
      testEditsToCheck(),
      '',
      'Structured output: `block` = the markdown verdict block (fixed format of the skill), `gaps` = its Blocking/Major rows, `minors` = its minors, `validations` = empty, `hypotheses` = the Hn.',
    ].filter(l => l !== '').join('\n'),
    { agentType: 'cctoolkit:ddd-tdd-auditor', schema: VERDICT, phase: 'Audit', label: `review light${retry ? ` retry ${retry.round}` : ''}${again ? ' again' : ''}` },
  ).catch(() => null)
}

async function reviewedLight(retry) {
  const verdict = await lightReview(retry)
  if (verdict) return verdict
  log('light review without result — one more attempt')
  return lightReview(retry, true)
}

const hasBlocking = v => v.gaps.some(g => g.severity === 'Blocking')

async function closeLight() {
  let verdict = await reviewedLight(null)
  if (!verdict) {
    auditPending()
    return null
  }
  history.verdicts.push(verdict)
  if (verdict.verdict !== GAPS) return verdict
  const reaudit = hasBlocking(verdict)
  const before = openCount(verdict)
  const opened = reaudit ? await openRound(1) : null
  const fix = await fixGaps(verdict, 1, [], { diff: lightDiff, reaudit })
  if (!fix) return verdict
  const { contested, objections } = contestsOf(fix)
  history.fixes.push({ ...fix, objections })
  for (const c of contested) toReview('Audit', `light closing, contest left to the user: ${c.gap} — harm: ${c.harm}`)
  if (!reaudit) {
    history.audit = GAPS_CARRIED
    for (const g of verdict.gaps.filter(g => g.severity !== 'Minor' && !contested.some(c => sameGap(c.gap, g.gap)))) {
      toReview('Audit', `light closing: ${g.severity} — ${g.axis} — ${g.gap} fixed without a second review`, `${g.evidence} ; fix: ${fix.fixed.join('; ')}`)
    }
    history.unreviewed = true
    return verdict
  }
  const closed = opened && opened.ok ? await closeRound(1, before, contested) : null
  const changeSet = closed && closed.ok ? { files: closed.files, diff: closed.diff } : null
  const next = await reviewedLight({ verdict, fix, round: 1, changeSet })
  if (!next) {
    auditPending()
    return verdict
  }
  verdict = next
  history.verdicts.push(verdict)
  history.rounds.push({ round: 1, open: before, files: changeSet ? changeSet.files : fix.files, contested, responses: [], after: openCount(verdict) })
  return verdict
}

phase('Audit')
let verdict = light ? await closeLight() : await firstAudit()
if (light) {
  if (verdict && verdict.verdict === GAPS) {
    if (wrongProduction(verdict)) {
      return await finish(GAPS, 'Blocking on the Correctness axis after the fix: production is wrong', verdict)
    }
    history.audit = history.audit || GAPS_CARRIED
    if (!history.unreviewed) for (const g of verdict.gaps.filter(g => g.severity !== 'Minor')) toReview('Audit', `${g.severity} — ${g.axis} — ${g.gap}`, `${g.evidence} ; proposed fix: ${g.fix}`)
  }
} else if (!verdict) auditPending()
else {
  verdict = await verified(verdict)
  history.verdicts.push(verdict)
  for (let round = 1; round <= 2 && verdict.verdict === GAPS && (round === 1 || wrongProduction(verdict) || rebuttals(lastContest()).length); round++) {
    const opened = await openRound(round)
    const fix = await fixGaps(verdict, round, rebuttals(lastContest()))
    if (!fix) break
    const { contested, objections } = contestsOf(fix)
    const applied = { ...fix, objections }
    history.fixes.push(applied)
    const before = openCount(verdict)
    const closed = opened && opened.ok ? await closeRound(round, before, contested) : null
    const changeSet = closed && closed.ok ? { files: closed.files, diff: closed.diff } : null
    if (!changeSet) toReview('Audit', `round ${round}: change set of the fix not read off the tree (${closed ? closed.detail || '' : opened ? opened.detail || 'open failed' : 'relay without result'}), the resume audit read the declared files`)
    const outside = changeSet ? outsideFindings(changeSet.files, verdict, fix.extensions) : []
    const retry = { verdict, fix: applied, round, contested, changeSet, outside }
    let next = await audited(retry)
    const unanswered = n => contested.filter(c => !answerOf(n.responses, c))
    if (next && unanswered(next).length) {
      log(`audit retry ${round}: ${unanswered(next).length} contest(s) without a response — audit again`)
      next = (await audited({ ...retry, unanswered: unanswered(next) })) || next
    }
    if (!next) {
      auditPending()
      break
    }
    const kept = outside.filter(f => !next.gaps.some(g => g.axis === 'Scope' && g.gap.includes(f)))
    if (kept.length) next = { ...next, verdict: GAPS, gaps: [...next.gaps, ...kept.map(scopeGap)] }
    next = await verified(next)
    history.contests.push({ round, contested, objections, responses: next.responses || [] })
    verdict = settle(next, contested, round)
    history.verdicts.push(verdict)
    const files = changeSet ? changeSet.files : fix.files
    const previous = history.rounds[history.rounds.length - 1]
    history.rounds.push({ round, open: before, files, contested, responses: next.responses || [], after: openCount(verdict) })
    // Divergence: the findings did not go down while the change set grew — past the previous
    // round's, or in round 1 past a file and its test per finding — another round would widen the batch.
    if (openCount(verdict) >= before && files.length > (previous ? previous.files.length : 2 * before)) {
      const why = `audit rounds stopped, diverging: round ${round} changed ${files.length} file(s) for ${before} finding(s), ${openCount(verdict)} still open`
      log(why)
      toReview('Audit', why, files.join(', '))
      history.rounds[history.rounds.length - 1].diverged = true
      break
    }
  }
  if (verdict.verdict === GAPS) {
    if (wrongProduction(verdict)) {
      return await finish(GAPS, 'Blocking on the Correctness axis after the fixes: production is wrong', verdict)
    }
    history.audit = history.audit || GAPS_CARRIED
    for (const g of verdict.gaps.filter(g => g.severity !== 'Minor')) toReview('Audit', `${g.severity} — ${g.axis} — ${g.gap}`, `${g.evidence} ; proposed fix: ${g.fix}`)
  }
}

if (reviewing) {
  phase('Review')
  const review = await reviewing
  reviewing = null
  history.review = review
  const questions = review ? review.questions : []
  const unsourced = q => q.severity === 'Blocking' && !q.decidedBy.trim()
  const human = questions.filter(q => unsourced(q) && q.humanOnly)
  const applied = questions.filter(q => !human.includes(q)).map(q => (unsourced(q) ? { ...q, decidedBy: REVIEWER } : q))
  for (const q of applied.filter(q => q.decidedBy === REVIEWER)) toReview(`Review ${nextSheet}`, `${q.question} → ${q.answer}`, q.evidence)
  let answeredByUser = []
  if (human.length) {
    phase('Question')
    const answers = await ask(
      'review',
      `next batch sheet ${nextSheet}, reviewed after batch ${batch}`,
      human.map(q => ({ severity: q.severity, question: q.question, evidence: q.evidence, options: q.options, recommendation: q.answer })),
    )
    answeredByUser = human.map((q, i) => {
      const a = (answers || []).find(x => x.id === `q${i + 1}`)
      return { ...q, decidedBy: a && a.recommended ? UNANSWERED : USER, answer: a ? a.text.trim() : '' }
    })
  }
  const unanswered = answeredByUser.filter(q => !q.answer || q.answer.toUpperCase() === 'STOP')
  const settled = [...applied, ...answeredByUser.filter(q => !unanswered.includes(q))]
  const carried = history.verdicts.flatMap(v => v.gaps).filter(g => g.severity !== 'Minor')
  if (settled.length || carried.length) await amendNext(settled, carried)
  if (unanswered.length) {
    const result = await finish(DONE, '—', verdict)
    return { ...result, unanswered: `${nextSheet} — ${unanswered.length} Blocking question(s) without answer` }
  }
}

return await finish(DONE, '—', verdict)
