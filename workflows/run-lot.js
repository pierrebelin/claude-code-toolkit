export const meta = {
  name: 'run-lot',
  description: 'FX batch under strict TDD, autonomous: cycles from the sheet, RED/GREEN per behaviour, global green, pre-audit, audit, next-batch review',
  whenToUse: 'Implement a plan batch without human intervention. Argument: path of the batch sheet, `todo/<code>/<CODE>-PLAN-FX.md`; plan, batch and run folder are derived from it.',
  phases: [
    { title: 'Design', detail: 'cycle index of the sheet; design writes the `## Cycles` block only when absent or invalid; declaratives' },
    { title: 'RED', detail: 'tdd-test-author, waves in sequence, cycles of a wave in parallel' },
    { title: 'GREEN', detail: 'tdd-implementer, serial, writes the cycle state and the handler CLAUDE.md' },
    { title: 'Global green', detail: 'whole or filtered suites per test-scope.md, beside the pre-audit gate' },
    { title: 'Closing', detail: 'cctoolkit pre-audit and what it lists, beside global green' },
    { title: 'Audit', detail: 'cctoolkit audit-capture, ddd-tdd-auditor, two retries at most' },
    { title: 'Review', detail: 'adversarial-reviewer on the next sheet, beside the audit' },
    { title: 'Arbiter', detail: 'a stop is settled by the arbiter and listed for review after the run; a question only when no decision is defensible' },
    { title: 'Question', detail: 'human-only stop: question line in run/.work.jsonl, wait for the answer appended from the session, same run' },
    { title: 'Report', detail: 'run/batches/FX.md, written even on stop; DONE: batch committed, its lines reduced to the cycle states' },
  ],
}

const sheet = (typeof args === 'string' ? args : (args && args.sheet) || '').trim().replace(/^@/, '')
const naming = /^(.*)-(F\d+)\.md$/.exec(sheet)
if (!naming) throw new Error('expected argument: path of the batch sheet, `todo/<code>/<CODE>-PLAN-FX.md`')
const plan = `${naming[1]}.md`
const batch = naming[2]
const runRoot = `${sheet.slice(0, sheet.lastIndexOf('/') + 1) || './'}run`
const workFile = `${runRoot}/.work.jsonl`
const reportPath = `${runRoot}/batches/${batch}.md`
const commitAtEnd = !(args && typeof args === 'object' && args.commit === false)
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
})

const INDEX = obj({ ok: bool, missing: bool, errors: arr(str), declaratives: arr(str), cycles: arr(CYCLE) })

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
  diagnostic: str,
}, ['diagnostic', 'unreachable'])

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

const SUITES = obj({
  green: bool,
  suites: arr(obj({ name: str, exit: int, scope: str, count: int })),
  fixes: arr(str),
  diagnostic: str,
}, ['diagnostic'])

const CLOSING = obj({ ok: bool, files: arr(str), preauditGreen: bool, failures: arr(str), diagnostic: str }, ['diagnostic'])

const GAP = obj({ severity: { type: 'string', enum: ['Blocking', 'Major', 'Minor'] }, axis: str, gap: str, evidence: str, fix: str })

const VERDICT = obj({
  verdict: { type: 'string', enum: ['VALID', 'GAPS'] },
  gaps: arr(GAP),
  minors: arr(str),
  validations: arr(str),
  hypotheses: arr(str),
  block: str,
})

const FIX = obj({ fixed: arr(str), files: arr(str), validations: arr(str) })

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

const FRAME = [
  `Workflow run-lot, batch ${batch}. Global plan: ${plan}. Batch sheet: ${sheet}. Run work file: ${workFile}.`,
  'Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes: the batch commit is `cctoolkit batch-baseline commit`, run only where a step gives it.',
  'Return the result through the structured output; prose written into repo files follows `language.docs` of `kit.config.json`.',
  '`<kit>` below = the cctoolkit plugin directory, printed by `cctoolkit root`; kit scripts run as `cctoolkit <script>`.',
].join('\n')

const list = xs => (xs && xs.length ? xs.map(x => `\`${x}\``).join(', ') : 'none')
const fileName = line => line.replace(/`/g, '').trim().replace(/^[ MADRCU?!]{1,2}\s+/, '').split(/\s+/)[0] || ''
const short = (text, n = 40) => (text.length > n ? text.slice(0, n - 1) + '…' : text)

const history = { cycles: [], suites: null, gate: null, verdicts: [], fixes: [], review: null, audit: null, toReview: [] }
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
  const payload = { batch, sheet, kind, context, questions: questions.map((q, i) => ({ id: `q${i + 1}`, ...q })) }
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
const TESTS_AT_GREEN = 'tests modified at GREEN: '
const GRANTED = ' — granted: '
const COST_CLEAR = ['Infrastructure in loop or in-memory filter: none', 'Infrastructure en boucle ou filtre mémoire : aucun']

const noGrants = () => ({ tests: new Set(), cost: false })

function grantsFrom(text, grants = noGrants()) {
  for (const m of String(text || '').matchAll(ALLOW_TEST)) grants.tests.add(repoPath(m[1]))
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
    grants.tests.size ? `Test files you may modify, granted: ${[...grants.tests].join(', ')}. List them in \`testsDiff\`.` : '',
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
    'A contract method whose throw site no caller reaches (every path to it refused earlier, an exhaustive switch, a non-nullable result) is never written: list it in `unreachable` with the site `path:line` and why; the user decides on removing the dead guard after the plan.',
    'Behaviour already in place on disk (a stopped run went further than its saved state: the contract methods exist in the test class and production is written): run them filtered, unchanged; exit 0 → `status: ALREADY_GREEN`, `table` = the methods run, `stubs` and `productionDiff` empty. Never write a new test that passes at once to get there: a method you write must fail first.',
    ...(declaratives.length ? [
      `Declarative artefacts already written by the orchestrator (common-rules §4.5, neither yours nor stubs): ${declaratives.join(' ; ')}`,
    ] : []),
    '```',
    '',
    'Your `## RED` report goes through the structured output: `tests` = test paths, `exit` = code of the filtered command,',
    '`productionDiff` = `src/` files you created or modified yourself, no annotation (other agents write in parallel: `git status` cannot tell you apart), `stubs` = paths only of the stubs written, no annotation, `table` = one row per method written or modified',
    '(`test` = `Class.Method`), `removed` = tests removed because already covered, `unreachable` = contract methods not written, site unreachable. `## BLOCKED` = `status: BLOCKED` + `diagnostic` (six RTK lines at most).',
    `Last step before the structured output, except on ## BLOCKED: one call, \`cctoolkit run-work append ${workFile} <<'CYCLE_STATE'\` then the line \`{"kind": "cycle", "batch": "${batch}", "slug": "${slug(c.behaviour)}", "state": {"behaviour": ${JSON.stringify(c.behaviour)}, "rmcu": ${JSON.stringify(c.rmcu)}, "steps": ${JSON.stringify(c.steps)}, "red": <your report>}}\` then \`CYCLE_STATE\`, \`<your report>\` = the object you return, same fields and values.`,
  ].filter(l => l !== '').join('\n')
}

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
    'Handler `CLAUDE.md`: a rule your code adds or changes in a handler → `<kit>/skills/implement-tdd/references/closing.md` §2, in the same message as your last production edit.',
    'Every `RM` trait id the tests of this cycle cite is a row of its handler table before you report: an id absent from it → add the row, even when your code only refines an existing behaviour (a dedicated error code is a rule).',
    '',
    'Your `## GREEN` report goes through the structured output: `production` = paths modified or created (handler `CLAUDE.md` included), `exit` = code of the final filtered test,',
    '`testsDiff` = `tests/` files you created or modified yourself, no annotation (empty expected, `.verified.txt` snapshots accepted), `cost` = last line of `cctoolkit access-cost` verbatim,',
    '`independentOf` = the input the cost is independent of. `## BLOCKED` = `status: BLOCKED` + `diagnostic`.',
    `Last step before the structured output, except on ## BLOCKED: one call, \`cctoolkit run-work append ${workFile} <<'CYCLE_STATE'\` then the line \`{"kind": "cycle", "batch": "${batch}", "slug": "${slug(c.behaviour)}", "state": {"behaviour": ${JSON.stringify(c.behaviour)}, "rmcu": ${JSON.stringify(c.rmcu)}, "steps": ${JSON.stringify(c.steps)}, "red": ${JSON.stringify(r)}, "green": <your report>}}\` then \`CYCLE_STATE\`, \`<your report>\` = the object you return, same fields and values.`,
  ].filter(l => l !== '').join('\n')
}

function checkRed(c, r, writtenBefore) {
  if (!r) return 'RED agent without result'
  if (r.status === 'BLOCKED') return `BLOCKED — ${r.diagnostic || r.expectedFailure}`
  if (r.status === 'ALREADY_GREEN') {
    if (c.refactor || c.guard) return `ALREADY_GREEN on a ${c.refactor ? 'refactor' : 'guard'} cycle`
    if (r.exit !== 0) return `ALREADY_GREEN with exit ${r.exit} on \`${r.command}\``
    if (r.stubs.length || r.productionDiff.length) return `ALREADY_GREEN with code written: ${[...r.stubs, ...r.productionDiff].join(', ')}`
    if (!r.table.length) return 'ALREADY_GREEN without the methods run'
    return null
  }
  const unreachable = (r.unreachable || []).map(u => u.method)
  if (!r.table.length && (r.removed.length || unreachable.length)) return null
  if (c.refactor && r.exit !== 0) return `safety net red: exit ${r.exit} on \`${r.command}\``
  if (c.guard && r.exit !== 0) return `guard red on the current code: exit ${r.exit} on \`${r.command}\``
  if (c.guard && (r.stubs.length || r.productionDiff.length)) return `guard with production code: ${[...r.stubs, ...r.productionDiff].join(', ')}`
  if (!c.refactor && !c.guard && r.exit === 0) return `RED not observed: exit 0 on \`${r.command}\` — already in place on disk → status ALREADY_GREEN`
  const stubs = new Set([...r.stubs.map(fileName).map(repoPath), ...writtenBefore()])
  const beyondStubs = r.productionDiff.map(fileName).map(repoPath).filter(f => f && !stubs.has(f))
  if (beyondStubs.length) return `production code beyond the stubs: ${beyondStubs.join(', ')}`
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

const repoPath = p => p.replace(/^.*?(^|\/)((src|tests)\/)/, '$2')

function checkGreen(r, grants = noGrants()) {
  if (!r) return 'GREEN agent without result'
  if (r.status === 'BLOCKED') return `BLOCKED — ${r.diagnostic || r.cost}`
  if (r.exit !== 0) return `GREEN not observed: exit ${r.exit} on \`${r.command}\``
  const tests = r.testsDiff.map(fileName).filter(Boolean).map(repoPath)
  const forbidden = tests.filter(f => !f.endsWith('.verified.txt') && !grants.tests.has(f))
  if (forbidden.length) return `${TESTS_AT_GREEN}${forbidden.join(', ')}${GRANTED}${grants.tests.size ? [...grants.tests].join(', ') : 'none'}`
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
    grants.tests.size ? `Test files you may modify, granted: ${[...grants.tests].join(', ')}. List them in \`testsDiff\`.` : '',
    grants.cost ? 'The flagged `Cost` line is accepted as is: report it verbatim.' : '',
    'Diagnose the common cause of these rejections before writing, then fix that cause. Same contract, same report.',
  ].filter(l => l !== '').join('\n')
}

async function withRetry(step, launch, check, standing = '') {
  const grants = grantsFrom(standing)
  const attempt = (suffix, options = {}) => launch(suffix, options).catch(() => null)
  let result = await attempt(grants.tests.size || grants.cost ? decided(standing, grants) : '')
  let reason = check(result, grants)
  const reasons = reason ? [reason] : []
  if (reason && !reason.startsWith('BLOCKED')) {
    result = await attempt(reason.endsWith('without result')
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
    result = await attempt(decided(decision.text, grants))
    reason = check(result, grants)
    if (reason) reasons.push(reason)
    if (reason === previous && earlier.filter(e => e.reason === previous).length > 1) {
      log(`${step}: same stop after two decisions — ${short(reason, 60)}`)
      break
    }
  }
  if (reason && ESCALATED.test(step)) {
    log(`${step}: last attempt on ${LAST_MODEL} — ${short(reason, 60)}`)
    result = await attempt(escalation(reasons, earlier, grants), { model: LAST_MODEL })
    reason = check(result, grants)
  }
  return { result, reason }
}

const writtenBefore = () => new Set([
  ...lotIndex.declaratives,
  ...history.cycles.flatMap(t => [...(t.red?.stubs ?? []), ...(t.green?.production ?? [])]),
].map(fileName).map(repoPath))

const redLabel = (c, model) => `RED ${c.id} w${c.wave} ${short(c.behaviour)}${model ? ` ${model}` : ''}`
const greenLabel = (c, model) => `GREEN ${c.id} ${short(c.behaviour)}${model ? ` ${model}` : ''}`

function launchRed(c) {
  const live = () => withRetry(
    `RED ${short(c.behaviour, 60)}`,
    (suffix, options) => agent(redContract(c, lotIndex.declaratives) + suffix, { agentType: 'cctoolkit:tdd-test-author', schema: RED, phase: 'RED', label: redLabel(c, options.model), ...options }),
    r => checkRed(c, r, writtenBefore),
    c.decisions || '',
  )
  if (c.resume) {
    const state = savedOf(c)
    if (state && !checkRed(c, state.red, writtenBefore)) return Promise.resolve({ result: state.red, reason: null })
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
const relative = p => fileName(p).replace(/^.*?(?=(src|tests|todo)\/)/, '')
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
    `- ${g.severity} — ${g.axis} — ${cell(g.gap)} (evidence: ${cell(g.evidence)}). Fix: ${cell(g.fix)}${history.fixes[i] ? `; applied in round ${i + 1}: ${cell(history.fixes[i].fixed.join('; '))}` : '; not applied'}.`))
  const reviews = history.review ? [history.review] : []
  const tests = new Map()
  for (const c of cycles) {
    for (const t of c.red?.table ?? []) {
      const parts = t.test.replace(/`/g, '').split('.')
      const klass = parts.length > 1 ? parts[parts.length - 2] : (fileName((c.red.tests ?? [])[0] || '').split('/').pop() || '').replace(/\.cs$/, '')
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
      ? history.verdicts.map((v, i) => `- ${i ? `Resume ${i}` : 'Initial'}: ${v.verdict}${gapsOf(v).length ? ` (${gapsOf(v).map(g => g.severity).join(', ')})` : ''}`)
      : ['No audit.']),
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
    `First, one call: \`cctoolkit run-work drop ${workFile} --batch ${batch} --kind question,answer; cctoolkit batch-baseline snapshot ${workFile} ${batch}\` — questions of an earlier run never answer this one; the snapshot records the files already modified, left out of the batch diff and commit (kept when it exists).`,
    `Then in one message: \`cctoolkit sheet-cycles ${sheet} --states ${workFile}\`, \`${indexCommand(sheet)}\` and \`grep -E '^### (Batch|Lot) F[0-9]+' ${plan}\`.`,
    '`cycles` = the JSON array `--states` printed, each object as-is, no field changed (`[]` when no cycle was saved).',
    '`index` = the JSON line `sheet-cycles` printed, verbatim, whatever its exit code (0 valid, 1 invalid, 2 no block).',
    `\`nextSheet\` = the first \`### Batch FY\` (or \`### Lot FY\`) heading after the one of ${batch} without \`✅ DONE\` → \`${naming[1]}-FY.md\` when that file exists; empty string otherwise.`,
  ].join('\n'),
  { schema: LOADED, phase: 'Design', label: 'resume state', model: 'haiku', effort: 'low' },
).catch(() => null)

const readIndex = (target, phaseName) => agent(
  `${FRAME}\n\nRun \`${indexCommand(target)}\` once. Return the JSON line it printed, verbatim, whatever its exit code.`,
  { schema: INDEX, phase: phaseName, label: `index ${fileName(target).split('/').pop()}`, model: 'haiku', effort: 'low' },
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

const finishedAtStart = (c, s) => !!(s && s.red && (s.red.status === 'ALREADY_GREEN' || c.guard || !s.red.table.length ||
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
      ].join('\n') + suffix,
      { schema: OK, phase: 'Design', label: 'declaratives', model: 'sonnet', effort: 'low' },
    ),
    x => (!x ? 'declaratives agent without result' : !x.ok ? `declaratives — ${x.detail || ''}` : null),
  )
  if (reason) return await finish(BLOCKED, `declaratives — ${reason}`)
}

let pendingReds = waves.length ? launchWave(waves[0], 0) : null
for (let n = 0; n < waves.length; n++) {
  const reds = await pendingReds
  pendingReds = null
  const deferrable = x => x && x.deferred && (x.cycle.guard || x.cycle.refactor)
  for (const x of reds.filter(deferrable)) log(`${x.cycle.behaviour}: left out, settled after the plan`)
  const iRejected = reds.findIndex(x => !x || (x.reason && !deferrable(x)))
  if (iRejected >= 0) {
    const rejected = reds[iRejected]
    return await finish(BLOCKED, rejected ? `RED ${rejected.cycle.behaviour} — ${rejected.reason}` : `RED ${waves[n][iRejected].behaviour} — agent without result`)
  }

  if (n + 1 < waves.length) pendingReds = launchWave(waves[n + 1], n + 1)
  for (let i = 0; i < reds.length; i++) {
    if (deferrable(reds[i])) continue
    const { cycle, result: red } = reds[i]
    const trace = { behaviour: cycle.behaviour, rmcu: cycle.rmcu, red, green: null, ...(cycle.resume ? { resumed: true } : {}) }
    history.cycles.push(trace)
    for (const u of red.unreachable || []) toReview(`RED ${cycle.behaviour}`, `unreachable guard, test not written, removal proposed: \`${u.method}\` — ${u.site}`, u.why)
    if (!red.table.length) {
      log(`${cycle.behaviour}: no test written (already covered or unreachable) — no GREEN`)
      trace.green = { ...noGreen(''), removed: (red.unreachable || []).length ? 'unreachable sites' : 'tests already covered' }
      continue
    }
    if (red.status === 'ALREADY_GREEN') {
      log(`${cycle.behaviour}: already in place on disk — GREEN observed, no GREEN`)
      trace.green = noGreen('GREEN observed: behaviour already in place on disk at RED')
      toReview(`RED ${cycle.behaviour}`, 'behaviour already in place on disk at RED: GREEN observed without a RED observed in this run', red.table.map(l => l.test).join(', '))
      continue
    }
    if (cycle.guard) {
      log(`${cycle.behaviour}: guard green at once — no GREEN`)
      trace.green = noGreen('guard green at once, no GREEN')
      continue
    }
    const { result: green, reason } = await withRetry(
      `GREEN ${short(cycle.behaviour, 60)}`,
      (suffix, options) => agent(greenContract(cycle, red) + suffix, { agentType: 'cctoolkit:tdd-implementer', schema: GREEN, phase: 'GREEN', label: greenLabel(cycle, options.model), ...options }),
      checkGreen,
      cycle.decisions || '',
    )
    trace.green = green
    if (reason) {
      if (pendingReds) await pendingReds
      return await finish(BLOCKED, `GREEN ${cycle.behaviour} — ${reason}`)
    }
  }
}

phase('Global green')
const runSuites = (suffix = '') => agent(
  [
    FRAME,
    '',
    'Global green loop of the batch: suites and scope per `<kit>/skills/implement-tdd/references/test-scope.md` (Runner, §2-4).',
    `Pick the suites the diff requires (\`cctoolkit batch-baseline diff ${workFile} ${batch} --name-only\`), run them once, output to a file in \`<tmp>\`, independent suites in a single message. ${TMP}.`,
    'Red → fix production code until fully green; never weaken nor remove a test to pass.',
    'Return each suite with its exit, its scope (filter or "whole suite") and its test count.',
  ].join('\n') + suffix,
  { schema: SUITES, phase: 'Global green', label: 'suites' },
).catch(() => null)

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

const [{ result: suites }, { result: gated }] = await Promise.all([
  withRetry('Global green', runSuites, x => (!x ? 'suites agent without result' : !x.green ? `global green not reached — ${x.diagnostic || ''}` : null)),
  withRetry('Closing', runGate, x => (!x ? 'pre-audit agent without result' : !x.ok ? `pre-audit not run — ${x.diagnostic || ''}` : !x.preauditGreen ? `pre-audit RED — ${x.failures.join(' ; ')}` : null)),
])
history.suites = suites
history.gate = gated
if (!suites || !suites.green) return await finish(BLOCKED, `global green not reached — ${suites ? suites.diagnostic || '' : 'agent without result'}`)
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
        retry.verdict.gaps.map(e => `| ${e.severity} | ${e.axis} | ${e.gap} | ${e.evidence} | ${e.fix} |`).join('\n'),
        `Files touched by the fix: ${list(retry.fix.files)} — diff from: \`git diff -- <these files>\`.`,
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
        : `Notes: \`${notes}\`. Empty it first (\`: > <path>\`), then append each finding the moment you settle it, one line \`severity | axis | gap | evidence | fix\`, and each validation read or run. Your turns are bounded: these notes are what a second attempt starts from.`,
      'Search with `git grep -n -e <pattern> -- <paths>`, never a recursive grep; every command in the foreground.',
      alreadyRun,
      history.toReview.length ? `Decisions the run took without the user, each listed for the user review after the plan — never a \`Plan\` gap for being absent from the sheet: ${history.toReview.map(x => `${x.step}: ${x.text}`).join(' ; ')}` : '',
      previous,
      '',
      'Structured output: `block` = the markdown verdict block verbatim (fixed format of the skill), `gaps` = its Blocking/Major rows,',
      '`minors` = its minors one line each, `validations` = its Validations lines, `hypotheses` = the Hn.',
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
    `mode: next-batch ${nextSheet} ${sheet}\n\nReturn your questions through the structured output: \`result\` CLEAR or GAPS, each question with its severity, its evidence, \`decidedBy\` (the \`Settled by\` column, empty when none), \`answer\` (the answer the source dictates; without source, your recommendation and why), \`options\` (without source: 2 to 4 short mutually exclusive answers, recommended first; empty otherwise) and \`humanOnly\` (your \`Human only\` rule; the run applies every other answer and the user reviews it afterwards).`,
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

if (nextSheet) {
  reviewing = reviewNext('next batch review')
}

function fixGaps(verdict, round) {
  return agent(
    [
      FRAME,
      '',
      'Fix the Blocking and Major gaps of the verdict below, per `<kit>/skills/implement-tdd/references/closing.md` §3 (verdict GAPS).',
      'A fix that adds a rule or a branch goes through a red test first.',
      `The batch diff is already gathered in \`${capture}\` (${TMP}): read the hunks a gap cites there, open only the files its \`Evidence\` names, never \`git diff\` the batch again.`,
      'Run only the filtered tests of the classes you touch (filtered command of `<kit>/skills/implement-tdd/references/test-scope.md`), never a whole suite: the audit that follows reruns the suites. Return them with exit and scope.',
      '',
      verdict.block,
    ].join('\n'),
    { schema: FIX, phase: 'Audit', label: `fix ${round}`, model: 'sonnet' },
  ).catch(() => null)
}

const wrongProduction = v => v.gaps.some(g => g.severity === 'Blocking' && /correct/i.test(g.axis))

phase('Audit')
let verdict = await firstAudit()
if (!verdict) auditPending()
else {
  history.verdicts.push(verdict)
  for (let round = 1; round <= 2 && verdict.verdict === GAPS && (round === 1 || wrongProduction(verdict)); round++) {
    const fix = await fixGaps(verdict, round)
    if (!fix) break
    history.fixes.push(fix)
    const next = await audited({ verdict, fix, round })
    if (!next) {
      auditPending()
      break
    }
    verdict = next
    history.verdicts.push(verdict)
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
