export const meta = {
  name: 'run-replay',
  description: 'Batch or plan already delivered, replayed read-only: each cycle\'s tests and the suites its commits reach rerun, its REDs re-observed without its production code on --red, its audit; nothing fixed, nothing committed',
  whenToUse: 'Re-check what a batch delivered, or every batch ✅ DONE of a plan, without changing anything. Argument: the batch sheet `todo/<code>/<CODE>-PLAN-FX.md` or the global plan `todo/<code>/<CODE>-PLAN.md`, then optionally `--red` (each RED re-observed without the batch\'s production code), `--no-audit`, `--only FX` (plan), `--base <rev>` (sheet: a batch committed without its `Kit-Batch` trailer, replayed as `<rev>..HEAD`).',
  phases: [
    { title: 'Load', detail: 'plan: its batches ✅ DONE; batch: its commits read off their Kit-Batch trailer (cctoolkit batch-baseline replay), its cycles with their tests and saved commands' },
    { title: 'Batch', detail: 'plan: run-replay on each batch in plan order, one after the other' },
    { title: 'Tests', detail: 'solution build, the suites cctoolkit suites-plan resolves for the batch files, then each cycle\'s filtered command; nothing fixed' },
    { title: 'RED check', detail: '--red: a batch worktree whose production files of the batch are put back as they were before it; each cycle\'s tests must fail there' },
    { title: 'Audit', detail: 'cctoolkit audit-capture on the batch commits, ddd-tdd-auditor; no fix' },
    { title: 'Report', detail: 'run/batches/FX-replay.md; no plan or sheet line changed, nothing committed' },
  ],
}

// On Windows a path may come with `\` (Python, the engine, the user): Git Bash eats an unquoted one. Paths are carried with `/`.
const slashed = p => String(p || '').replace(/\\/g, '/')

const opts = args && typeof args === 'object' ? args : {}
const words = slashed(typeof args === 'string' ? args : opts.sheet || opts.plan || '').trim().replace(/^@/, '').split(/\s+/).filter(Boolean)
const target = words[0] || ''
const flags = words.slice(1)
const valueOf = name => (flags.includes(name) ? flags[flags.indexOf(name) + 1] || '' : '')
const planMode = /-PLAN\.md$/.test(target)
const only = valueOf('--only')
const baseRev = slashed(opts.base || valueOf('--base'))
const withRed = opts.red === true || flags.includes('--red')
const withAudit = opts.audit !== false && !flags.includes('--no-audit')
const known = flags.every((f, i) => ['--red', '--no-audit', '--only', '--base'].includes(f) || ['--only', '--base'].includes(flags[i - 1]))
if (!known || (!planMode && !/-PLAN-F\d+\.md$/.test(target)) || (planMode && baseRev) || (!planMode && only) ||
    (only && !/^F\d+$/.test(only)) || (baseRev && !/^[A-Za-z0-9._\/^~@{}][A-Za-z0-9._\/^~@{}-]*$/.test(baseRev))) {
  throw new Error('expected argument: `todo/<code>/<CODE>-PLAN-FX.md [--base <rev>] [--red] [--no-audit]` or `todo/<code>/<CODE>-PLAN.md [--only FX] [--red] [--no-audit]`')
}

const PASSED = 'PASSED'
const FAILED = 'FAILED'
const SKIPPED = 'SKIPPED'

const str = { type: 'string' }
const int = { type: 'integer' }
const bool = { type: 'boolean' }
const arr = items => ({ type: 'array', items })
const obj = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
})

const short = (text, n = 40) => (text.length > n ? text.slice(0, n - 1) + '…' : text)
const list = xs => (xs && xs.length ? xs.map(x => `\`${x}\``).join(', ') : 'none')

// A plan: each batch ✅ DONE (or `--only FX`) replayed by this same workflow, one after the other — their
// suites build the same projects.
if (planMode) {
  const LISTED = obj({ batches: arr(obj({ batch: str, done: bool })) })
  phase('Load')
  const listed = await agent(
    `Workflow run-replay, plan ${target}. Read-only: run exactly the command given, return its output through the structured output.\n\nOne call: \`grep -E '^### (Batch|Lot) F[0-9]+' ${target}\`. \`batches\` = one entry per line it printed, in order: \`batch\` = its \`F<n>\`, \`done\` = the line carries \`✅ DONE\`.`,
    { schema: LISTED, phase: 'Load', label: 'batches', model: 'haiku', effort: 'low' },
  ).catch(() => null)
  if (!listed) return { status: FAILED, reason: 'batch list agent without result', batches: [] }
  const chosen = only ? listed.batches.filter(b => b.batch === only) : listed.batches.filter(b => b.done)
  const left = only ? [] : listed.batches.filter(b => !b.done).map(b => b.batch)
  if (!chosen.length) return { status: SKIPPED, reason: only ? `${only} is not a batch of ${target}` : `no batch ✅ DONE in ${target}`, batches: [], notReplayed: left }
  if (left.length) log(`not replayed, not ✅ DONE: ${left.join(', ')}`)
  const ran = []
  for (const b of chosen) {
    phase('Batch')
    log(`→ ${b.batch} replay`)
    const r = await workflow('cctoolkit:run-replay', { sheet: `${target.slice(0, -3)}-${b.batch}.md`, red: withRed, audit: withAudit })
      .catch(e => ({ status: FAILED, reason: `run-replay failed: ${e.message}`, report: null }))
    ran.push({ batch: b.batch, status: r.status, reason: r.reason, report: r.report || null, toCheck: (r.toCheck || []).length })
    log(`→ ${b.batch} ${r.status}${r.status === PASSED ? '' : ` — ${short(String(r.reason || ''), 80)}`}`)
  }
  const failed = ran.filter(r => r.status === FAILED)
  const replayed = ran.filter(r => r.status !== SKIPPED)
  return {
    status: failed.length ? FAILED : replayed.length ? PASSED : SKIPPED,
    reason: failed.length ? `failed: ${failed.map(r => r.batch).join(', ')}` : replayed.length ? '—' : 'no batch replayed',
    batches: ran,
    notReplayed: left,
  }
}

const sheet = target
const naming = /^(.*)-(F\d+)\.md$/.exec(sheet)
const plan = `${naming[1]}.md`
const batch = naming[2]
const runRoot = `${sheet.slice(0, sheet.lastIndexOf('/') + 1) || './'}run`
const workFile = `${runRoot}/.work.jsonl`
const reportPath = `${runRoot}/batches/${batch}-replay.md`
const tmpCommand = `cctoolkit run-work tmp ${batch}`
const TMP = `\`<tmp>\` = the folder \`${tmpCommand}\` prints (system temp, never under run/)`

const RANGE = obj({ base: str, head: str, commits: arr(str), files: arr(str) })
const TCYCLE = obj({ id: str, behaviour: str, rmcu: str, refactor: bool, guard: bool, level: str, testClass: str, saved: bool, tests: arr(str), files: arr(str), command: str })
const LOADED = obj({ refused: str, range: RANGE, count: int, cycles: arr(TCYCLE), cyclesError: str }, ['cyclesError'])
const SUITE = obj({ name: str, exit: int, scope: str, count: int, output: str, failed: arr(str) })
const RAN = obj({ id: str, command: str, exit: int, output: str, failed: arr(str) })
const NAMED = arr(obj({ name: str, why: str }))
const TESTS = obj({ build: obj({ exit: int, output: str }), suites: arr(SUITE), cycles: arr(RAN), unresolved: NAMED, notRun: NAMED })
const RED_RUN = obj({ ok: bool, detail: str, build: int, cycles: arr(obj({ id: str, exit: int })), removed: bool })
const GAP = obj({ severity: { type: 'string', enum: ['Blocking', 'Major', 'Minor'] }, axis: str, gap: str, evidence: str, closure: str, fix: str })
const VERDICT = obj({ verdict: { type: 'string', enum: ['VALID', 'GAPS'] }, gaps: arr(GAP), minors: arr(str), validations: arr(str), hypotheses: arr(str), block: str })
const REPORT = obj({ path: str })

const FRAME = [
  `Workflow run-replay, batch ${batch}. Global plan: ${plan}. Batch sheet: ${sheet}. Run work file: ${workFile}.`,
  'Read-only replay of a batch already delivered: never edit, create nor delete a file of the repo, never a Git command that writes, never fix a red build or test — report it. The only writes are those the steps give: the `cctoolkit` commands named, files under `<tmp>`, the report.',
  'Autonomous mode: nobody answers, never AskUserQuestion. Return the result through the structured output.',
  '`<kit>` below = the cctoolkit plugin directory, printed by `cctoolkit root`; kit scripts run as `cctoolkit <script>`.',
].join('\n')

const history = { range: null, cycles: [], tests: null, red: null, verdict: null, audit: withAudit ? null : 'not run (--no-audit)', toCheck: [], cyclesError: '' }
const toCheck = (step, text) => history.toCheck.push({ step, text })

phase('Load')
const loadPrompt = suffix => [
  FRAME,
  '',
  `First call: \`cctoolkit batch-baseline replay ${workFile} ${batch}${baseRev ? ` --base ${baseRev}` : ''}; echo "exit=$?"\`. Exit 0 → \`range\` = the JSON line it printed (\`base\`, \`head\`, \`commits\`, \`files\`), \`refused\` empty. Exit 1 → \`refused\` = the \`refused\` field it printed, \`range\` with empty strings and arrays, \`count\` 0, \`cycles\` empty: stop there.`,
  `Then: \`cctoolkit sheet-cycles ${sheet} --tests ${workFile}\`. Exit 0 → \`count\` and \`cycles\` = the fields of the JSON it printed, each cycle as-is, no field changed. Exit not 0 → \`count\` 0, \`cycles\` empty, \`cyclesError\` = its first line.`,
].join('\n') + suffix
// An agent relays the cycles: a copy short of some would replay none of them (run-lot met it, 2026-10-21).
const whole = x => !!x && (!!x.refused || x.cycles.length === x.count)
let loaded = await agent(loadPrompt(''), { schema: LOADED, phase: 'Load', label: 'replay range', model: 'haiku', effort: 'low' }).catch(() => null)
if (!whole(loaded)) {
  loaded = await agent(loadPrompt(`\n\nA previous attempt ${loaded ? `relayed ${loaded.cycles.length} of ${loaded.count} cycle(s)` : 'ended without structured output'}: run both calls again and relay every cycle.`),
    { schema: LOADED, phase: 'Load', label: 'replay range again', model: 'haiku', effort: 'low' }).catch(() => null)
}
if (loaded && loaded.refused) {
  log(`${batch} not replayed — ${loaded.refused}`)
  return { status: SKIPPED, reason: loaded.refused, batch, report: null, toCheck: [] }
}

const sha = s => String(s || '').slice(0, 12)
const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
const tableOf = (head, rows) => rows.length
  ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)]
  : ['None.']
const bullets = xs => (xs.length ? xs.map(x => `- ${cell(x)}`) : ['None.'])

function replayOf(c) {
  if (!c.tests.length) return 'no test'
  const ran = (history.tests?.cycles ?? []).find(x => x.id === c.id)
  return !ran ? 'not run' : ran.exit === 0 ? 'green' : 'red'
}
function redOf(c) {
  if (!history.red || c.refactor || c.guard || !c.tests.length) return '—'
  if (!history.red.ok) return 'not run'
  if (history.red.build !== 0) return 'does not compile'
  const ran = history.red.cycles.find(x => x.id === c.id)
  return !ran ? 'not run' : ran.exit !== 0 ? 'red observed' : 'NOT RED'
}

function renderReport(status, reasons) {
  const r = history.range
  const gaps = history.verdict ? history.verdict.gaps.filter(g => g.severity !== 'Minor') : []
  const next = [
    ...history.cycles.filter(c => replayOf(c) === 'red').map(c => `\`/cctoolkit:implement-tdd batch ${batch} — correction: ${cell(c.behaviour)} red on replay: ${cell(((history.tests.cycles.find(x => x.id === c.id) || {}).failed || []).join(', ') || 'see its output')}\``),
    ...gaps.map(g => `\`/cctoolkit:implement-tdd batch ${batch} — correction: ${cell(g.gap)}\``),
  ]
  return [
    `## REPLAY — ${status}`,
    '',
    `Replayed: <when>${withRed ? ' — with --red' : ''}${withAudit ? '' : ' — --no-audit'}`,
    '',
    `Reason: ${cell(reasons.join('; ') || '—')}`,
    '',
    r ? `Range: \`${sha(r.base)}..${sha(r.head)}\` — ${r.commits.length} commit(s): ${r.commits.map(x => `\`${sha(x)}\``).join(', ')}${baseRev ? ` (from \`--base ${baseRev}\`)` : ''}` : 'Range: not read.',
    '',
    `## Cycles — batch ${batch}`,
    '',
    ...(history.cyclesError ? [`Not replayed one by one: ${cell(history.cyclesError)}`, ''] : []),
    ...tableOf(['Cycle', 'Behaviour', 'RM/CU', 'Tests', 'Replay', ...(withRed ? ['Without the batch code'] : [])],
      history.cycles.map(c => [c.id, short(c.behaviour, 60), c.rmcu, c.tests.length, replayOf(c), ...(withRed ? [redOf(c)] : [])])),
    '',
    '## Suites',
    '',
    history.tests ? `Build: exit ${history.tests.build.exit}` : 'Not run.',
    '',
    ...tableOf(['Suite', 'Exit', 'Scope', 'Tests', 'Failed'], (history.tests?.suites ?? []).map(s => [s.name, s.exit, s.scope, s.count, s.failed.join(', ')])),
    '',
    '## Audit',
    '',
    `Verdict: ${history.verdict ? history.verdict.verdict : history.audit || 'none'}`,
    '',
    ...(history.verdict ? [
      ...bullets(gaps.map(g => `${g.severity} — ${g.axis} — ${g.gap} (evidence: ${g.evidence}). Fix: ${g.fix}`)),
      ...(history.verdict.minors.length ? ['', 'Minor:', ...bullets(history.verdict.minors)] : []),
    ] : []),
    '',
    '## To check',
    '',
    ...bullets(history.toCheck.map(x => `${x.step} — ${x.text}`)),
    '',
    '## Next',
    '',
    ...(next.length ? next.map(x => `- ${x}`) : ['None.']),
  ].join('\n') + '\n'
}

async function finish(status, reasons) {
  const written = await agent(
    [
      FRAME,
      '',
      'You are a scribe. The markdown below was rendered by the workflow from the structured results of the agents that replayed this batch; persist it, nothing else.',
      `\`mkdir -p ${runRoot}/batches\`, then write \`${reportPath}\` in a single Write, content exactly the markdown between the \`~~~~\` fences below, with one change: \`<when>\` on its third line becomes the output of \`date '+%Y-%m-%d %H:%M'\`.`,
      `Then one call: \`cctoolkit run-work drop ${workFile} --batch ${batch} --kind replay; cctoolkit run-work rm-tmp ${batch}\`.`,
      'Return the written path.',
      '',
      '~~~~markdown',
      renderReport(status, reasons),
      '~~~~',
    ].join('\n'),
    { schema: REPORT, phase: 'Report', label: 'report', model: 'haiku', effort: 'low' },
  ).catch(() => null)
  const r = history.range
  return {
    status,
    reason: reasons.join('; ') || '—',
    batch,
    report: written ? written.path : null,
    range: r ? { base: r.base, head: r.head, commits: r.commits } : null,
    cycles: history.cycles.map(c => ({ id: c.id, behaviour: c.behaviour, replay: replayOf(c), ...(withRed ? { red: redOf(c) } : {}) })),
    suites: (history.tests?.suites ?? []).map(s => ({ name: s.name, exit: s.exit, scope: s.scope })),
    verdict: history.verdict ? history.verdict.verdict : history.audit || 'none',
    gaps: history.verdict ? history.verdict.gaps.filter(g => g.severity !== 'Minor') : [],
    toCheck: history.toCheck,
  }
}

if (!whole(loaded)) return await finish(FAILED, [`replay range ${loaded ? `relayed ${loaded.cycles.length} of ${loaded.count} cycle(s) twice` : 'agent without result'}`])
history.range = loaded.range
history.cycles = loaded.cycles
history.cyclesError = loaded.cyclesError || ''
if (history.cyclesError) toCheck('Load', `cycles not replayed one by one, the suites only: ${history.cyclesError}`)
log(`${batch}: ${loaded.range.commits.length} commit(s) ${sha(loaded.range.base)}..${sha(loaded.range.head)}, ${loaded.range.files.length} file(s), ${loaded.cycles.length} cycle(s)`)

const replayable = history.cycles.filter(c => c.tests.length)
for (const c of history.cycles.filter(c => !c.tests.length)) toCheck(`Cycle ${c.id}`, `no test to replay: its RED wrote none (already covered or unreachable)`)

// The command a cycle ran, saved by run-lot; unsaved (a work file lost or purged), the agent writes it.
const commandLine = c => (c.command
  ? `- ${c.id} — \`${c.command}\``
  : `- ${c.id} — no saved command: the filtered command of test class \`${c.testClass}\` (level ${c.level}) on ${list(c.tests.map(t => t.split('.').pop()))}, per the Runner section of \`<kit>/skills/implement-tdd/references/test-scope.md\` (\`cctoolkit config command test <suite>\` prints the base command)${c.files.length ? `; test files ${list(c.files)}` : ''}`)
const SAVED_ROOT = 'A saved command opening with `cd \'<path>\' &&` to a folder that no longer exists (a batch worktree since removed): drop that prefix, run the rest.'
const testModel = replayable.every(c => c.command) ? 'haiku' : 'sonnet'

phase('Tests')
const testsPrompt = suffix => [
  FRAME,
  '',
  'Replay of the tests: you run commands and report their exits. Never edit a file, never diagnose, never fix.',
  `First call: \`cctoolkit suites-plan ${workFile} ${batch}\`. It prints one JSON object: \`tmp\`, \`build\`, \`suites\` (each with its \`run\` line, \`scope\` and \`output\`), \`unresolved\`, \`notRun\`. Copy each line literally, never rebuild nor \`eval\` one.`,
  'Then `build.run` alone (skip it when empty, `build.exit` 0). Exit not 0 → stop there: `build` = its exit and output, `suites` and `cycles` empty.',
  'Then every `suites[].run` line in a single message, one Bash call each.',
  ...(replayable.length ? [
    'Once they all returned, the command of each cycle below, in a single message, one Bash call each, as `<command> > "<tmp>/cycle-<id>.txt" 2>&1; echo "exit=$?"; tail -15 "<tmp>/cycle-<id>.txt"` (`<tmp>` = the `tmp` field of the plan):',
    ...replayable.map(commandLine),
    SAVED_ROOT,
  ] : []),
  'Each suite: `exit` read off its `exit=` line, `count` = the total the tail prints (0 when none), `name`, `scope` and `output` from the plan. Each cycle: `id`, `command` as run, `exit`, `output` = its file. `failed`, for a suite or a cycle whose exit is not 0 = the lines `cctoolkit suites-plan --failed <output>` prints, those calls in one message; empty on exit 0.',
  '`unresolved` and `notRun` = the plan\'s, verbatim.',
].join('\n') + suffix
let tests = await agent(testsPrompt(''), { schema: TESTS, phase: 'Tests', label: 'replay tests', model: testModel, effort: 'low' }).catch(() => null)
if (!tests) tests = await agent(testsPrompt('\n\nA previous attempt ended without structured output: run the plan again, then return the report at once.'), { schema: TESTS, phase: 'Tests', label: 'replay tests again', model: testModel, effort: 'low' }).catch(() => null)
history.tests = tests
const reasons = []
if (!tests) reasons.push('tests agent without result')
else {
  if (tests.build.exit !== 0) reasons.push(`build red: exit ${tests.build.exit}`)
  const redSuites = tests.suites.filter(s => s.exit !== 0)
  if (redSuites.length) reasons.push(`suites red: ${redSuites.map(s => `${s.name}${s.failed.length ? ` (${s.failed.length} failed)` : ''}`).join(', ')}`)
  const redCycles = replayable.filter(c => replayOf(c) === 'red')
  if (redCycles.length) reasons.push(`cycles red: ${redCycles.map(c => c.id).join(', ')}`)
  if (tests.build.exit === 0) for (const c of replayable.filter(c => replayOf(c) === 'not run')) toCheck(`Cycle ${c.id}`, 'command not run by the tests agent')
  for (const u of tests.unresolved) toCheck('Suites', `${u.name} unresolved: ${u.why}`)
  log(`tests: build ${tests.build.exit}, ${tests.suites.length} suite(s) (${redSuites.length} red), ${replayable.length - redCycles.length}/${replayable.length} cycle(s) green`)
}

// --red: the batch's tests without its production code. The worktree is HEAD with only the batch's files
// under the source roots put back: a test that still passes there proves nothing this batch wrote.
const redEligible = replayable.filter(c => !c.refactor && !c.guard)
if (withRed && tests && tests.build.exit === 0 && redEligible.length) {
  phase('RED check')
  history.red = await agent(
    [
      FRAME,
      '',
      'RED check: the batch\'s tests run without its production code, in a worktree of their own. The writes of this step are the worktree and its files, through the two `cctoolkit` commands below only.',
      `1. \`cctoolkit batch-worktree create ${batch} --plan ${plan} --sheet ${sheet}\` → one JSON line, \`<path>\` = its \`path\`. Refused or exit not 0 → \`ok\` false, \`detail\` = that line, go to step 5.`,
      `2. \`cctoolkit batch-baseline red ${workFile} ${batch} --root <path>\` → \`detail\` = the line it printed. Exit not 0 → \`ok\` false, go to step 5.`,
      `3. \`<tmp>\` = the folder \`${tmpCommand}\` prints, run from the session's checkout. From here every Bash call opens with \`cd '<path>' && export CLAUDE_PROJECT_DIR='<path>' &&\`: \`cctoolkit config command build\` prints the solution build (nothing printed → \`build\` 0); run it literally, \`<build> > "<tmp>/red-build.txt" 2>&1; echo "exit=$?"\` → \`build\`.`,
      '4. Build exit 0 → each command below in a single message, one Bash call each, opening the same way, as `<command> > "<tmp>/red-<id>.txt" 2>&1; echo "exit=$?"`: `cycles` = each id with its exit. Build not 0 → no command, `cycles` empty.',
      ...redEligible.map(commandLine),
      SAVED_ROOT,
      `5. Last, always, from the session's checkout: \`cctoolkit batch-worktree remove ${batch}\` → \`removed\` = exit 0.`,
      '`ok` = steps 1 and 2 passed.',
    ].join('\n'),
    { schema: RED_RUN, phase: 'RED check', label: 'replay red', model: testModel, effort: 'low' },
  ).catch(() => null)
  const red = history.red
  if (!red || !red.ok) {
    history.red = red ? { ...red, ok: false } : { ok: false, detail: 'agent without result', build: 0, cycles: [], removed: false }
    toCheck('RED check', `not run: ${history.red.detail || 'agent without result'}`)
  } else {
    if (red.build !== 0) toCheck('RED check', `the batch's tests do not compile without its production code (build exit ${red.build}): RED re-observed as a compile error only`)
    for (const c of redEligible.filter(c => redOf(c) === 'NOT RED')) toCheck(`Cycle ${c.id}`, `green without the batch's production code: its tests prove nothing this batch wrote (${c.tests.join(', ')})`)
  }
  if (history.red && history.red.removed === false) toCheck('RED check', `worktree of ${batch} left: \`cctoolkit batch-worktree remove ${batch}\``)
} else if (withRed) {
  toCheck('RED check', !redEligible.length ? 'no cycle with a RED to re-observe' : !tests ? 'not run: the tests agent gave no result' : 'not run: the build is red on the current tree')
}

if (withAudit) {
  phase('Audit')
  const capture = `<tmp>/audit-${batch}.txt`
  const notes = `<tmp>/audit-${batch}.replay.notes.md`
  const greenSuites = (tests?.suites ?? []).filter(x => x.exit === 0).map(x => x.name)
  const captureCommand = `cctoolkit audit-capture ${batch} ${sheet} "$(${tmpCommand})/audit-${batch}.txt" --base ${workFile}${greenSuites.length ? ` --suites-green ${greenSuites.join(',')}` : ''}`
  const r = history.range
  const audit = again => agent(
    [
      FRAME,
      '',
      `Read \`<kit>/skills/verify-ddd-tdd/SKILL.md\` and follow it as if the skill were invoked with the argument \`batch ${batch}\`, fast mode.`,
      `This batch was delivered earlier and is replayed: the capture's diff is its commits, \`${sha(r.base)}..${sha(r.head)}\` (${r.commits.length} commit(s)), not the working tree — its \`git status\` and \`git diff --check\` sections say nothing of it. A file may have changed since (a later batch): judge the diff, read a file as the batch left it with \`git show ${r.head}:<path>\`.`,
      again
        ? `Capture: \`${capture}\` (already written: never rerun it), ${TMP}. A previous attempt ended without structured output: read \`${notes}\` first, never re-establish what it settled, then return the verdict at once.`
        : `First run \`${captureCommand}\`, then read the capture \`${capture}\`, ${TMP}. Notes: \`${notes}\`. Empty it first (\`: > <path>\`), then append each finding the moment you settle it, one line \`severity | axis | gap | evidence | closure | fix\`.`,
      `Section ${batch} of the sheet: \`${sheet}\`.`,
      'Search with `git grep -n -e <pattern> -- <paths>`, never a recursive grep; every command in the foreground.',
      tests && tests.suites.length ? `Suites the replay ran on the current tree: read these exit codes, never rerun them; run only a suite missing here.\n${tests.suites.map(x => `- ${x.name} — exit ${x.exit}, scope ${x.scope}, ${x.count} tests`).join('\n')}` : '',
      replayable.length ? `Cycles replayed: ${replayable.map(c => `${c.id} ${replayOf(c)}`).join(', ')}.` : '',
      '',
      'Structured output: `block` = the markdown verdict block verbatim (fixed format of the skill), `gaps` = its Blocking/Major rows, `minors` = its minors one line each, `validations` = its Validations lines, `hypotheses` = the Hn.',
    ].filter(l => l !== '').join('\n'),
    { agentType: 'cctoolkit:ddd-tdd-auditor', schema: VERDICT, phase: 'Audit', label: `audit${again ? ' again' : ''}` },
  ).catch(() => null)
  history.verdict = (await audit(false)) || (await audit(true))
  if (!history.verdict) {
    history.audit = 'to redo'
    toCheck('Audit', `without result after two attempts: \`/verify-ddd-tdd batch ${batch}\``)
  } else {
    const gaps = history.verdict.gaps.filter(g => g.severity !== 'Minor')
    if (gaps.length) reasons.push(`audit: ${['Blocking', 'Major'].map(s => [s, gaps.filter(g => g.severity === s).length]).filter(x => x[1]).map(([s, n]) => `${n} ${s}`).join(', ')}`)
  }
}

return await finish(reasons.length ? FAILED : PASSED, reasons)
