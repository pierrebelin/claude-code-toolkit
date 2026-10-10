export const meta = {
  name: 'run-lot',
  description: 'FX batch under strict TDD, autonomous: design, RED/GREEN per behaviour, global green, closing, audit, next-batch review',
  whenToUse: 'Implement a plan batch without human intervention. Argument: path of the batch sheet, `todo/<code>/<CODE>-PLAN-FX.md`; plan, batch and run folder are derived from it.',
  phases: [
    { title: 'Design', detail: 'earlier audit gaps, behaviours, waves, RED and GREEN contracts, declaratives' },
    { title: 'RED', detail: 'tdd-test-author, one wave in parallel' },
    { title: 'GREEN', detail: 'tdd-implementer, serial, TDD tick after COST' },
    { title: 'Global green', detail: 'whole or filtered suites per test-scope.md, beside closing' },
    { title: 'Closing', detail: 'closing.md §1-2 then cctoolkit pre-audit, beside global green' },
    { title: 'Audit', detail: 'cctoolkit audit-capture, ddd-tdd-auditor, two retries at most' },
    { title: 'Review', detail: 'adversarial-reviewer on the next sheet, beside the audit' },
    { title: 'Report', detail: 'FX-report.md, written even on stop' },
  ],
}

const sheet = (typeof args === 'string' ? args : (args && args.sheet) || '').trim().replace(/^@/, '')
const naming = /^(.*)-(F\d+)\.md$/.exec(sheet)
if (!naming) throw new Error('expected argument: path of the batch sheet, `todo/<code>/<CODE>-PLAN-FX.md`')
const plan = `${naming[1]}.md`
const batch = naming[2]
const runDir = `${sheet.slice(0, sheet.lastIndexOf('/') + 1) || './'}run/${batch}`

const BLOCKED = 'BLOCKED'
const DONE = 'DONE'
const GAPS = 'GAPS'
const REVIEW_BLOCKING = 'REVIEW-BLOCKING'

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
  behaviour: str,
  refactor: bool,
  rmcu: str,
  steps: arr(str),
  level: str,
  skill: str,
  testClass: str,
  fixture: str,
  methods: arr(str),
  full: arr(str),
  bounded: arr(str),
  scenarios: str,
  observation: str,
  outOfScope: str,
  toCreate: arr(str),
  ripple: arr(str),
  boundedGreen: arr(str),
  elements: str,
  appliedIds: str,
  invariants: str,
  expectedCost: str,
  snapshot: str,
}, ['snapshot'])

const DESIGN = obj({
  blocked: bool,
  reason: str,
  nextSheet: str,
  declaratives: arr(str),
  waves: arr(arr(CYCLE)),
})

const RED = obj({
  status: { type: 'string', enum: ['RED', 'BLOCKED'] },
  tests: arr(str),
  command: str,
  exit: int,
  productionDiff: arr(str),
  stubs: arr(str),
  expectedFailure: str,
  table: arr(obj({ test: str, case: str })),
  removed: arr(str),
  diagnostic: str,
}, ['diagnostic'])

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
  questions: arr(obj({ severity: { type: 'string', enum: ['Blocking', 'Major'] }, question: str, evidence: str })),
})

const REPORT = obj({ path: str })

const FRAME = [
  `Workflow run-lot, batch ${batch}. Global plan: ${plan}. Batch sheet: ${sheet}. Run folder: ${runDir}.`,
  'Autonomous mode: nobody answers. Never AskUserQuestion, never a Git commit.',
  'Return the result through the structured output; prose written into repo files follows `language.docs` of `kit.config.json`.',
  '`<kit>` below = the cctoolkit plugin directory, printed by `cctoolkit root`; kit scripts run as `cctoolkit <script>`.',
].join('\n')

const list = xs => (xs && xs.length ? xs.map(x => `\`${x}\``).join(', ') : 'none')
const fileName = line => line.replace(/`/g, '').trim().replace(/^[ MADRCU?!]{1,2}\s+/, '').split(/\s+/)[0] || ''
const short = (text, n = 40) => (text.length > n ? text.slice(0, n - 1) + '…' : text)

const history = { cycles: [], suites: null, closing: null, verdicts: [], fixes: [], review: null }
let reviewing = null

function redContract(c, declaratives) {
  return [
    FRAME,
    '',
    'RED phase. Contract, no plan attached:',
    '',
    '```text',
    `RM/CU: ${c.rmcu}`,
    `Behaviour: ${c.behaviour}`,
    `Level / skill: ${c.level} / ${c.skill}`,
    `Test class / fixture: \`${c.testClass}\` / \`${c.fixture}\``,
    `Methods: ${c.methods.map(m => `\`${m}\``).join(', ')}`,
    `Rewritten by you (read in full): ${list(c.full)}`,
    `Read bounded (context only): ${list(c.bounded)}`,
    `Scenarios: ${c.scenarios}`,
    `Expected observation: ${c.observation}`,
    ...(c.refactor ? [
      'Refactor under safety net: write no test and touch no file. Run the filtered command on the methods above, existing and unchanged.',
      'Green net (exit 0) = RED of the refactor: `status: RED`, `table` = one row per method run, `tests` = their paths, `stubs` and `productionDiff` empty. Red net = ## BLOCKED.',
    ] : []),
    'Forbidden: any file search. A missing path comes back as ## BLOCKED.',
    ...(declaratives.length ? [
      `Declarative artefacts already written by the orchestrator (common-rules §4.5, neither yours nor stubs): ${declaratives.join(' ; ')}`,
      'A constructor parameter, member or type your test still lacks = signature stub you write (§4.1), not a blocker.',
    ] : []),
    '```',
    '',
    'Your `## RED` report goes through the structured output: `tests` = test paths, `exit` = code of the filtered command,',
    '`productionDiff` = `src/` files you created or modified yourself, no annotation (other agents write in parallel: `git status` cannot tell you apart), `stubs` = paths only of the stubs written, no annotation, `table` = one row per method written or modified',
    '(`test` = `Class.Method`), `removed` = tests removed because already covered. `## BLOCKED` = `status: BLOCKED` + `diagnostic` (six RTK lines at most).',
  ].join('\n')
}

function greenContract(c, r) {
  const redTests = r.table.map(l => `\`${l.test}\``).join(', ')
  return [
    FRAME,
    '',
    'GREEN + REFACTOR phase. Contract, no plan attached:',
    '',
    '```text',
    `RM/CU: ${c.rmcu}`,
    `Behaviour: ${c.behaviour}`,
    c.refactor
      ? `Safety net, green and kept green — behaviour unchanged, no test touched: ${list(r.tests)} — ${redTests}`
      : `Red test: ${list(r.tests)} — ${redTests}`,
    `Out of scope — next behaviour: ${c.outOfScope || 'none'}`,
    `Already stubbed at RED (body to fill, read in full): ${list(r.stubs)}`,
    `To create from scratch: ${list(c.toCreate)}`,
    `Signature ripple — also touched (read in full): ${c.ripple.length ? c.ripple.join(' ; ') : 'none'}`,
    `Read bounded (context only): ${list(c.boundedGreen)}`,
    `Elements: ${c.elements}`,
    `Applied DDD/APP ids: ${c.appliedIds}`,
    `Exploitable invariants — what they remove: ${c.invariants}`,
    `Expected access cost: ${c.expectedCost}`,
    c.snapshot ? `Snapshot (ContractTests only): ${c.snapshot}` : '',
    '```',
    '',
    'Your `## GREEN` report goes through the structured output: `production` = paths modified or created, `exit` = code of the final filtered test,',
    '`testsDiff` = `tests/` files you created or modified yourself, no annotation (empty expected, a `.verified.txt` snapshot accepted), `cost` = last line of `cctoolkit access-cost` verbatim,',
    '`independentOf` = the input the cost is independent of. `## BLOCKED` = `status: BLOCKED` + `diagnostic`.',
  ].filter(l => l !== '').join('\n')
}

function checkRed(c, r, writtenBefore) {
  if (!r) return 'RED agent without result'
  if (r.status === 'BLOCKED') return `BLOCKED — ${r.diagnostic || r.expectedFailure}`
  if (!r.table.length && r.removed.length) return null
  if (c.refactor && r.exit !== 0) return `safety net red: exit ${r.exit} on \`${r.command}\``
  if (!c.refactor && r.exit === 0) return `RED not observed: exit 0 on \`${r.command}\``
  const stubs = new Set([...r.stubs.map(fileName).map(repoPath), ...writtenBefore()])
  const beyondStubs = r.productionDiff.map(fileName).map(repoPath).filter(f => f && !stubs.has(f))
  if (beyondStubs.length) return `production code beyond the stubs: ${beyondStubs.join(', ')}`
  const sameMethod = (a, b) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
  const missing = c.methods.filter(m => {
    const name = fileName(m)
    return !r.table.some(l => sameMethod(fileName(l.test), name)) &&
      !r.removed.some(s => s.includes(name))
  })
  if (missing.length) return `contract methods missing from the table: ${missing.join(', ')}`
  return null
}

const repoPath = p => p.replace(/^.*?(^|\/)((src|tests)\/)/, '$2')

function checkGreen(r) {
  if (!r) return 'GREEN agent without result'
  if (r.status === 'BLOCKED') return `BLOCKED — ${r.diagnostic || r.cost}`
  if (r.exit !== 0) return `GREEN not observed: exit ${r.exit} on \`${r.command}\``
  const tests = r.testsDiff.map(fileName).filter(Boolean).map(repoPath)
  if (tests.length > 1 || tests.some(f => !f.endsWith('.verified.txt'))) return `tests modified at GREEN: ${tests.join(', ')}`
  if (!r.cost.includes('Infrastructure in loop or in-memory filter: none')) return `Cost line malformed or flagged: ${r.cost}`
  return null
}

async function withRetry(launch, check) {
  const attempt = suffix => launch(suffix).catch(() => null)
  const first = await attempt('')
  const reason = check(first)
  if (!reason || reason.startsWith('BLOCKED')) return { result: first, reason }
  const second = await attempt(`\n\nPrevious attempt rejected by the orchestrator: ${reason}. Fix this point and return a new report.`)
  return { result: second, reason: check(second) }
}

const declarativesOf = c => c.toCreate.filter(a => /orchestrat|declarati|déclarati/i.test(a))

const writtenBefore = () => new Set([
  ...design.declaratives,
  ...history.cycles.flatMap(t => [...(t.red?.stubs ?? []), ...(t.green?.production ?? [])]),
].map(fileName).map(repoPath))

function launchRed(c, i) {
  return withRetry(
    suffix => agent(redContract(c, declarativesOf(c)) + suffix, { agentType: 'cctoolkit:tdd-test-author', schema: RED, phase: 'RED', label: `RED ${i + 1} ${short(c.behaviour)}` }),
    r => checkRed(c, r, writtenBefore),
  )
}

function launchWave(wave, n) {
  return parallel(wave.map((c, i) => () => launchRed(c, i).then(x => ({ ...x, cycle: c, wave: n }))))
}

const finishedCycles = new Set()

function tick(c) {
  finishedCycles.add(c)
  const steps = c.steps.filter(e => design.waves.flat().filter(x => x.steps.includes(e)).every(x => finishedCycles.has(x)))
  if (!steps.length) return null
  return agent(
    `${FRAME}\n\nIn the sheet \`${sheet}\`, for each step ${steps.map(e => `« ${e} »`).join(', ')}, replace its \`TDD: RED … · GREEN … · COST …\` line with \`TDD: RED ✅ · GREEN ✅ · COST ✅\`. One Edit per line, nothing else moves.`,
    { schema: OK, phase: 'GREEN', label: `tick ${short(c.behaviour)}`, model: 'haiku', effort: 'low' },
  )
}

async function report(status, reason, verdict) {
  const payload = JSON.stringify({ batch, status, reason, ...history, finalVerdict: verdict || null }, null, 1)
  const r = await agent(
    [
      FRAME,
      '',
      `Write \`${runDir}/${batch}-report.md\` in a single Write, in the docs language of \`kit.config.json\`, from the JSON data below, without rereading code or tests.`,
      'Content: first line `## STATUS — ' + status + '`, then `Reason:`, then the summary of `<kit>/skills/implement-tdd/references/closing.md` §4',
      '(files, layers, access cost per behaviour, Hn hypotheses, flagged without fix, verdict, validations with exit and scope),',
      'then the test recap table, one table per class, columns `Test | RM/CU | Use case verified`, width rules of closing.md §4,',
      'then `## Audit gaps`: one line per Blocking or Major gap of every verdict in `verdicts`, with its axis, the rejected choice and the fix applied (from `fixes`); `None.` when there is none. Later batches read this section before designing.',
      'Read only closing.md §4 for the format.',
      ...(status === DONE
        ? [`Then delete the other run files, keeping the report: \`find ${runDir} -type f ! -name '${batch}-report.md' -delete\`.`]
        : []),
      'Return the written path.',
      '',
      '```json',
      payload,
      '```',
    ].join('\n'),
    { schema: REPORT, phase: 'Report', label: 'report', model: 'haiku' },
  )
  return r ? r.path : null
}

async function finish(status, reason, verdict) {
  if (reviewing) history.review = await reviewing
  const path = await report(status, reason, verdict)
  return {
    status,
    reason,
    verdict: verdict ? verdict.verdict : 'none',
    gaps: verdict ? verdict.gaps.filter(e => e.severity !== 'Minor') : [],
    hypotheses: verdict ? verdict.hypotheses : [],
    minors: verdict ? verdict.minors : [],
    review: history.review,
    report: path,
  }
}

phase('Design')
const design = await agent(
  [
    FRAME,
    '',
    'You are the batch design orchestrator, without delegation: you design, other agents write tests and code.',
    'Read `<kit>/skills/implement-tdd/SKILL.md` §1 and §2 (never §3-4), `<kit>/skills/implement-tdd/references/test-scope.md`, then apply §1 "Analysis" to the batch:',
    'plan by sections, whole sheet, applied DDD/APP/PERF ids, invariants and what they remove.',
    `Earlier batches of the same plan first: for each sheet \`${naming[1]}-FY.md\` with Y before ${batch}, read the \`## Audit gaps\` section of \`run/FY/FY-report.md\` next to it when the file exists, and \`grep -n "user decision\\|GAPS"\` the sheet.`,
    'A choice an earlier audit rejected or a recorded user decision overrides a contrary line of the current sheet (test level, double, exception "carried over"): fix that line by one Edit and record `Hn` citing the source. Never design a choice already rejected.',
    'Sheet without `TDD:` lines → add `TDD: RED ⬜ · GREEN ⬜ · COST ⬜` to each step in one Edit. Ambiguity without scope effect → record `Hn` under `## Assumptions` of the sheet.',
    'Ambiguity that changes scope, RM/CU or a design decision → `blocked: true` and `reason`.',
    '',
    'Return the end-to-end behaviours (§2), ordered Domain → Application → Infrastructure → WebAPI, grouped into waves per',
    '`<kit>/skills/implement-tdd/references/parallelism.md`: a wave = behaviours whose test files and production code are disjoint.',
    'Steps already `RED ✅ · GREEN ✅ · COST ✅` → excluded. Each cycle carries its RED and GREEN contract, paths, classes and methods copied from the sheet',
    '(`## Ancrages`, `## TDD sequence`), never searched: missing line → one Edit adding it to the sheet.',
    'Exploration bounded to what the sheet names: open those files by range, never `git show` nor `git log`; a repo-wide search only for a ripple the sheet does not list, `grep -rln` on the member name, paths only.',
    '`refactor` = true only for a cycle the sheet carries as a refactor under an existing safety net (no test written): `methods` = the net methods, run unchanged at RED and kept green at GREEN.',
    '`steps` = exact titles of the sheet steps carried by the cycle. `full` / `bounded` = RED contract paths, `boundedGreen` = GREEN contract `Read bounded` paths.',
    '`nextSheet` = path of the sheet of the next ⬜ batch of the global plan after this one, empty string if none.',
    'Declarative artefact (`<kit>/skills/implement-tdd/references/common-rules.md` §4 point 5, that paragraph only) a RED of any wave needs → write it yourself now: declaration and mapping only, no branch, validation or business decision, mirror the named existing file;',
    'what the expected observation assigns to the orchestrator (enum member, discriminator property) is part of it, nothing else (no test, no signature stub). List it in the cycle `toCreate`, suffixed `— declarative, already written by the orchestrator`, and name the associated enum member or discriminator in `observation`.',
    'At least one written → the solution build of `<kit>/skills/implement-tdd/references/test-scope.md` must compile, else `blocked: true`. `declaratives` = paths created or modified, repo-relative, no annotation; empty array when none.',
  ].join('\n'),
  { schema: DESIGN, phase: 'Design', label: 'design' },
)
if (!design) return await finish(BLOCKED, 'design agent without result')
if (design.blocked) return await finish(BLOCKED, design.reason)
log(`${design.waves.length} wave(s), ${design.waves.flat().length} behaviour(s)`)

let pendingReds = design.waves.length ? launchWave(design.waves[0], 0) : null
for (let n = 0; n < design.waves.length; n++) {
  const reds = await pendingReds
  pendingReds = null
  const iRejected = reds.findIndex(x => !x || x.reason)
  if (iRejected >= 0) {
    const rejected = reds[iRejected]
    return await finish(BLOCKED, rejected ? `RED ${rejected.cycle.behaviour} — ${rejected.reason}` : `RED ${design.waves[n][iRejected].behaviour} — agent without result`)
  }

  for (let i = 0; i < reds.length; i++) {
    const { cycle, result: red } = reds[i]
    if (i === 0 && n + 1 < design.waves.length) pendingReds = launchWave(design.waves[n + 1], n + 1)
    const trace = { behaviour: cycle.behaviour, rmcu: cycle.rmcu, red, green: null }
    history.cycles.push(trace)
    if (!red.table.length) {
      log(`${cycle.behaviour}: tests removed, already covered — no GREEN`)
      await tick(cycle)
      continue
    }
    const { result: green, reason } = await withRetry(
      suffix => agent(greenContract(cycle, red) + suffix, { agentType: 'cctoolkit:tdd-implementer', schema: GREEN, phase: 'GREEN', label: `GREEN ${short(cycle.behaviour)}` }),
      checkGreen,
    )
    trace.green = green
    if (reason) {
      if (pendingReds) await pendingReds
      return await finish(BLOCKED, `GREEN ${cycle.behaviour} — ${reason}`)
    }
    await tick(cycle)
  }
}

phase('Global green')
const runSuites = () => agent(
  [
    FRAME,
    '',
    'Global green loop of the batch: `<kit>/skills/implement-tdd/SKILL.md` §3 and `<kit>/skills/implement-tdd/references/test-scope.md` §2-4.',
    `Pick the suites the diff requires (\`git status --short\`), run them once, output to a file in \`${runDir}\`, independent suites in a single message.`,
    'Red → fix production code until fully green; never weaken nor remove a test to pass.',
    'Return each suite with its exit, its scope (filter or "whole suite") and its test count.',
  ].join('\n'),
  { schema: SUITES, phase: 'Global green', label: 'suites' },
).catch(() => null)

const runClosing = () => agent(
  [
    FRAME,
    '',
    'Another agent runs the global green suites at the same time: never build nor run tests, never touch `src/` production code.',
    'Read `<kit>/skills/implement-tdd/references/closing.md` and apply §1 (plan and sheet update) and §2 (handler CLAUDE.md), nothing else.',
    'The cost line of each "Flux" section is copied from the GREEN `Cost` line below, never re-derived from the code.',
    `Then run \`cctoolkit pre-audit ${batch} ${sheet}\`. RED → fix what it lists (closing.md §3) without touching production code, rerun; three rounds at most.`,
    '`ok` = closing §1-2 applied, `files` = files written, `preauditGreen` = last pre-audit exit 0, `failures` = its remaining failures.',
    '',
    '```json',
    JSON.stringify(history.cycles.map(c => ({ behaviour: c.behaviour, rmcu: c.rmcu, tests: c.red.table, production: c.green && c.green.production, cost: c.green && `${c.green.cost} — independent of ${c.green.independentOf}` })), null, 1),
    '```',
  ].join('\n'),
  { schema: CLOSING, phase: 'Closing', label: 'closing + pre-audit' },
).catch(() => null)

const [suites, closing] = await Promise.all([runSuites(), runClosing()])
history.suites = suites
history.closing = closing
if (!suites || !suites.green) return await finish(BLOCKED, `global green not reached — ${suites ? suites.diagnostic || '' : 'agent without result'}`)
if (!closing || !closing.ok) return await finish(BLOCKED, `documentation closing — ${closing ? closing.diagnostic || '' : 'agent without result'}`)
if (!closing.preauditGreen) return await finish(BLOCKED, `pre-audit RED — ${closing.failures.join(' ; ')}`)

const capture = `${runDir}/audit-${batch}.txt`

function audit(retry) {
  const previous = retry
    ? [
        '',
        'Mode `resume`. Gap table of the previous verdict:',
        retry.verdict.gaps.map(e => `| ${e.severity} | ${e.axis} | ${e.gap} | ${e.evidence} | ${e.fix} |`).join('\n'),
        `Files touched by the fix: ${list(retry.fix.files)} — diff from: \`git diff -- <these files>\`.`,
        `Validations the fix reran: ${list(retry.fix.validations)}.`,
      ].join('\n')
    : ''
  const alreadyRun = [
    '',
    'Suites the global green ran after the last production change, closing touched no code since: read these exit codes, never rerun them (verify-ddd-tdd §3); run only a suite missing here or scoped too narrowly for the diff.',
    history.suites.suites.map(x => `- ${x.name} — exit ${x.exit}, scope ${x.scope}, ${x.count} tests`).join('\n'),
  ].join('\n')
  return agent(
    [
      FRAME,
      '',
      `Read \`<kit>/skills/verify-ddd-tdd/SKILL.md\` and follow it as if the skill were invoked with the argument \`batch ${batch}${retry ? ' resume' : ''}\`, fast mode.`,
      retry
        ? `Capture: \`${capture}\` (to read). Section ${batch} of the sheet: \`${sheet}\`.`
        : `First run \`cctoolkit audit-capture ${batch} ${sheet} ${capture}\`, then read the capture. Section ${batch} of the sheet: \`${sheet}\`.`,
      alreadyRun,
      previous,
      '',
      'Structured output: `block` = the markdown verdict block verbatim (fixed format of the skill), `gaps` = its Blocking/Major rows,',
      '`minors` = its minors one line each, `validations` = its Validations lines, `hypotheses` = the Hn.',
    ].join('\n'),
    { agentType: 'cctoolkit:ddd-tdd-auditor', schema: VERDICT, phase: 'Audit', label: retry ? `audit retry ${retry.round}` : 'audit' },
  )
}

if (design.nextSheet) {
  reviewing = agent(
    `mode: next-batch ${design.nextSheet} ${sheet}\n\nReturn your questions through the structured output: \`result\` CLEAR or GAPS, each question with its severity and its evidence.`,
    { agentType: 'cctoolkit:adversarial-reviewer', schema: REVIEW, phase: 'Review', label: 'next batch review' },
  ).catch(() => null)
}

phase('Audit')
let verdict = await audit(null)
if (!verdict) return await finish(BLOCKED, 'auditor without result')
history.verdicts.push(verdict)
for (let round = 1; verdict.verdict === 'GAPS' && round <= 2; round++) {
  const fix = await agent(
    [
      FRAME,
      '',
      'Fix the Blocking and Major gaps of the verdict below, per `<kit>/skills/implement-tdd/references/closing.md` §3 (verdict GAPS).',
      'A fix that adds a rule or a branch goes through a red test first. Rerun the touched validations, return them with exit and scope.',
      'Minors: do not touch.',
      '',
      verdict.block,
    ].join('\n'),
    { schema: FIX, phase: 'Audit', label: `fix ${round}`, model: 'sonnet' },
  )
  if (!fix) return await finish(BLOCKED, `fix ${round} without result`, verdict)
  history.fixes.push(fix)
  const next = await audit({ verdict, fix, round })
  if (!next) return await finish(BLOCKED, `retry audit ${round} without result`, verdict)
  verdict = next
  history.verdicts.push(verdict)
}
if (verdict.verdict === 'GAPS') return await finish(GAPS, 'two fix rounds still with gaps', verdict)

if (reviewing) {
  phase('Review')
  const review = await reviewing
  reviewing = null
  history.review = review
  if (review) {
    const majors = review.questions.filter(q => q.severity === 'Major')
    if (majors.length) {
      await agent(
        [
          FRAME,
          '',
          `Update the next batch sheet \`${design.nextSheet}\` per these Major questions (name, path, signature changed by batch ${batch}), one Edit per spot. The review ran beside the audit: check each name, path and signature against the current code, audit fixes included.`,
          majors.map(q => `- ${q.question} — ${q.evidence}`).join('\n'),
        ].join('\n'),
        { schema: OK, phase: 'Review', label: 'next sheet', effort: 'low' },
      )
    }
    if (review.questions.some(q => q.severity === 'Blocking')) {
      return await finish(REVIEW_BLOCKING, 'the next batch review carries at least one Blocking', verdict)
    }
  }
}

return await finish(DONE, '—', verdict)
