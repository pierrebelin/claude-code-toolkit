export const meta = {
  name: 'run-plan',
  description: 'Whole plan, autonomous: run-lot on every runnable batch in dependency order, gate read from disk after each, run report',
  whenToUse: 'Implement every batch of a global plan without human intervention. Argument: path of the global plan `todo/<code>/<CODE>-PLAN.md`, optionally followed by `--until FX` or `--only FX`.',
  phases: [
    { title: 'Preflight', detail: 'plan check, doctor, docker, build, kit root, run folder' },
    { title: 'Batch', detail: 'next batch, out-of-batch check and journal in one call (suspended ones excluded), run-lot, notification per open Blocking' },
    { title: 'Gate', detail: 'report status, plan heading, fast suites, snapshot, journal' },
    { title: 'Report', detail: 'REPORT.md and notification' },
  ],
}

const words = (typeof args === 'string' ? args : (args && args.plan) || '').trim().replace(/^@/, '').split(/\s+/).filter(Boolean)
const scope = words.slice(1).join(' ')
const decisions = (args && typeof args === 'object' && Array.isArray(args.decisions) ? args.decisions : []).filter(d => d && /^F\d+$/.test(d.batch) && typeof d.text === 'string' && d.text.trim())
const decisionFor = batch => decisions.filter(d => d.batch === batch).map(d => d.text.trim()).join(' ; ')
if (!/-PLAN\.md$/.test(words[0] || '') || (scope && !/^--(until|only) F\d+$/.test(scope))) {
  throw new Error('expected argument: `todo/<code>/<CODE>-PLAN.md [--until FX | --only FX]`')
}

const DONE = 'DONE'
const BLOCKED = 'BLOCKED'
const WAITING = 'AWAITING-ANSWER'

const str = { type: 'string' }
const int = { type: 'integer' }
const bool = { type: 'boolean' }
const arr = items => ({ type: 'array', items })
const obj = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
})

const PREFLIGHT = obj({ ok: bool, failure: str, plan: str, root: str, kit: str, runDir: str })
const NEXT = obj({
  kind: { type: 'string', enum: ['END', 'WAITING', 'BATCHES', 'ERROR'] },
  line: str,
  batches: arr(obj({ batch: str, repo: str, sheet: str })),
  outsideBatch: str,
  outsidePaths: arr(str),
})
const GATE = obj({
  ok: bool,
  failure: str,
  statusLine: str,
  verdictLine: str,
  planDone: bool,
  suites: arr(obj({ name: str, exit: int })),
})
const REPORT = obj({ path: str, lastLine: str })

const SHELL = { model: 'haiku', effort: 'low' }
const FRAME = 'Workflow run-plan, supervisor step. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git commit, never read nor edit `src/` or `tests/`. Run exactly the commands given, return their outputs through the structured output.'

phase('Preflight')
const pre = await agent(
  [
    FRAME,
    '',
    `Plan argument: \`${words[0]}\`.`,
    '1. `plan` = absolute path of the plan (`realpath`), `root` = `git rev-parse --show-toplevel`, `kit` = `cctoolkit root`.',
    '2. First, one call: `command -v docker >/dev/null && ! docker info >/dev/null 2>&1 && [ "$(uname)" = Darwin ] && open -a Docker; true` (Docker Desktop boots during the build, no wait loop).',
    '   Then in one message, from `root`: `cctoolkit plan-next-batch <plan> --check`, `cctoolkit doctor --quiet`, and the build configured by kit-init (`commands.build`, empty for a stack without one): `b=$(python3 -c \'import sys; sys.path.insert(0, sys.argv[1]); import kit_config; print(kit_config.load().command("build"))\' "$(cctoolkit root)/lib"); if [ -z "$b" ]; then echo build=none; else out=$(eval "$b" 2>&1); echo "build=$?"; printf \'%s\\n\' "$out" | grep -m1 -iE \'(^|[^a-z])error([^a-z]|$)\'; fi; command -v docker >/dev/null && { docker info >/dev/null 2>&1; echo "docker=$?"; } || echo docker=absent` (timeout 600000).',
    '3. `--check` exit ≠ 0, a doctor `FAIL` line, `docker` neither 0 nor `absent`, or `build` neither 0 nor `none` → `ok: false`, `failure` = the failing line verbatim (for the build: `build=<code>` followed by the first error line, the working tree must compile before any batch starts), `runDir` empty, stop.',
    `4. Otherwise \`runDir\` = \`<plan folder>/run/$(date +%Y-%m-%d-%H%M)\` (absolute), \`mkdir -p\` it, write \`<runDir>/journal.md\` (docs language of \`kit.config.json\`): plan, scope \`${scope || 'whole plan'}\`, start (\`date '+%Y-%m-%d %H:%M'\`). \`ok: true\`, \`failure\` empty.`,
  ].join('\n'),
  { schema: PREFLIGHT, phase: 'Preflight', label: 'preflight', ...SHELL },
)
if (!pre) throw new Error('preflight agent without result')
if (!pre.ok) return { status: BLOCKED, reason: pre.failure, batches: [] }

const runDir = pre.runDir
const ran = []
const suspended = []
let stop = null
let stopped = null

function journal(line) {
  return agent(`${FRAME}\n\nAppend this line to \`${runDir}/journal.md\` with \`printf '%s\\n' … >>\`, nothing else:\n\n${line}`, { schema: obj({ ok: bool }), phase: 'Batch', label: 'journal', ...SHELL })
}

function nextBatches() {
  return agent(
    [
      FRAME,
      '',
      `Run \`cctoolkit plan-next-batch ${pre.plan}${scope ? ' ' + scope : ''}${suspended.length ? ' --exclude ' + suspended.map(x => x.batch).join(',') : ''} --next ${runDir}/journal.md\`.`,
      'Exit 0 → it printed one JSON line: return its fields as-is. Exit ≠ 0 → `kind: ERROR`, `line` = the whole output verbatim (stderr included), `batches` and `outsidePaths` empty, `outsideBatch` empty.',
    ].join('\n'),
    { schema: NEXT, phase: 'Batch', label: 'next batch', ...SHELL },
  )
}

function notifyQuestions(s) {
  return agent(
    `${FRAME}\n\nOne call, nothing else: \`osascript -e 'display notification "${s.batch} awaiting an answer — ${s.questions.length} question(s), independent batches go on" with title "run-plan"'\`.`,
    { schema: obj({ ok: bool }), phase: 'Batch', label: `notify ${s.batch}`, ...SHELL },
  )
}

function gate(b, result, done) {
  return agent(
    [
      FRAME,
      '',
      `Gate of batch ${b.batch}, every check read from disk, never from a previous agent's words.`,
      `1. First line of \`${result.report}\` → \`statusLine\`; \`grep -m1 '^Verdict:'\` of it → \`verdictLine\`.`,
      `2. \`grep -n "^### Batch ${b.batch}\\b" ${pre.plan}\` → \`planDone\` = the heading carries \`✅ DONE\`.`,
      `3. Read \`${pre.kit}/skills/implement-tdd/references/test-scope.md\`: run its solution build once, then in one message every suite it runs whole and always, each \`> "${runDir}/gate-${b.batch}-<Suite>.txt" 2>&1; echo "exit=$?"\`. Build red → every suite exit 1. Never open the output files beyond \`tail -15\` of a red one.`,
      `4. \`ok\` = statusLine is \`## STATUS — ${DONE}\`, verdictLine contains \`VALID\`, planDone, every suite exit 0. \`failure\` = first failing check in that order, one line (suite: name + decisive failing test line), empty when ok.`,
      `5. ok → in one call: \`git diff > "${runDir}/after-${b.batch}.patch"; git ls-files --others --exclude-standard > "${runDir}/after-${b.batch}.untracked"; printf '%s\\n' '${done}' >> "${runDir}/journal.md"\`.`,
      `   not ok → \`printf '%s\\n' "${b.batch} ✗ — gate: <failure>" >> "${runDir}/journal.md"\`.`,
    ].join('\n'),
    { schema: GATE, phase: 'Gate', label: `gate ${b.batch}`, model: 'haiku' },
  )
}


while (!stop) {
  phase('Batch')
  const next = await nextBatches()
  if (!next) { stop = 'plan-next-batch without result'; break }
  if (next.kind === 'END') break
  if (next.kind === 'WAITING' && suspended.length) break
  if (next.kind !== 'BATCHES') { stop = next.line; break }

  const b = next.batches.find(x => x.repo.replace(/\/$/, '') === pre.root.replace(/\/$/, ''))
  if (!b) {
    stop = `batches of another repo (${next.batches.map(x => `${x.batch} ${x.repo}`).join(', ')}): run run-plan from that repo`
    break
  }
  if (next.batches.length > 1) log(`${next.batches.filter(x => x !== b).map(x => x.batch).join(', ')} in another repo, not launched here`)

  if (next.outsideBatch !== b.batch) { stop = `${b.batch} — outside-batch check without result`; break }
  if (next.outsidePaths.length) {
    stop = `${b.batch} — files modified outside the batch, to isolate (user commit) or name in the sheet: ${next.outsidePaths.join(', ')}`
    break
  }

  log(`→ ${b.batch} launched`)
  const result = await workflow({ scriptPath: `${pre.kit}/workflows/run-lot.js` }, decisionFor(b.batch) ? { sheet: b.sheet, decision: decisionFor(b.batch) } : b.sheet).catch(e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null }))
  const entry = { batch: b.batch, status: result.status, reason: result.reason, report: result.report, hypotheses: result.hypotheses || [], minors: result.minors || [] }
  ran.push(entry)

  const pending = result.status === DONE && result.nextBatch && (result.openQuestions || []).length && !decisionFor(result.nextBatch)
  if (result.status !== DONE || !result.report) {
    stop = `${b.batch} — ${result.status} — ${result.reason}`
    stopped = b.batch
    await journal(`${b.batch} ✗ — ${result.status} — ${result.reason}`)
    break
  }

  phase('Gate')
  const g = await gate(b, result, `${b.batch} ✅ — Hn : ${entry.hypotheses.length}, Mineur : ${entry.minors.length}`)
  if (!g || !g.ok) {
    entry.status = 'GATE RED'
    stop = `${b.batch} — gate: ${g ? g.failure : 'agent without result'}`
    if (!g) await journal(`${b.batch} ✗ — ${stop}`)
    break
  }
  entry.patch = `${runDir}/after-${b.batch}.patch`
  log(`→ ${b.batch} ✅ (${ran.length})`)
  if (pending) {
    const s = { batch: result.nextBatch, from: b.batch, questions: result.openQuestions, file: result.waiting }
    suspended.push(s)
    await notifyQuestions(s)
    await journal(`${s.batch} ⏸ — ${s.questions.length} Blocking without source, suspended with its dependents — ${s.file}`)
    log(`→ ${s.batch} suspended, questions in ${s.file}`)
  }
}

phase('Report')
if (!ran.length) {
  await agent(
    `${FRAME}\n\nNo batch ran: in one call, \`rm -r "${runDir}"; osascript -e 'display notification "${`Plan stopped — ${stop || 'no batch launched'}`.replace(/["'\\]/g, '')}" with title "run-plan"'\`.`,
    { schema: obj({ ok: bool }), phase: 'Report', label: 'cleanup', ...SHELL },
  )
  return { status: stop ? BLOCKED : DONE, reason: stop || '—', runDir: null, report: null, suspended: [], batches: [] }
}
const payload = JSON.stringify({ plan: pre.plan, scope: scope || 'whole plan', runDir, stop, suspended: suspended.map(s => ({ batch: s.batch, from: s.from, file: s.file, questions: s.questions.map(q => q.question) })), batches: ran }, null, 1)
const rep = await agent(
  [
    FRAME,
    '',
    `Write \`${runDir}/REPORT.md\` in a single Write, in the docs language of \`kit.config.json\`, from the JSON below, without reading code, tests or batch reports:`,
    '- table `| Batch | Status | Report | Patch |`, one row per batch (`—` when absent)',
    '- `## Assumptions` — every hypothesis, prefixed by its batch; `None.` when none',
    '- `## Minor` — every minor, prefixed by its batch; `None.` when none',
    '- `## Open questions` — only when `suspended` is not empty: per batch, its suspension (dependents included), the questions, the file to read; then `Answer through AskUserQuestion in the session, then this same run is resumed with the decision (never relaunched from scratch).`',
    '- `## Stop` — `stop` verbatim, only when not null',
    `- start time = the \`start\` line of \`${runDir}/journal.md\`, end time = \`date '+%Y-%m-%d %H:%M'\`.`,
    `\`lastLine\` = \`Plan stopped — <stop>\` when stop is not null, else \`Plan awaiting an answer — <suspended batches>\` when suspended is not empty, else \`Plan done — review of ${runDir}/REPORT.md required.\`.`,
    'Then one call: `osascript -e \'display notification "<lastLine, double quotes removed>" with title "run-plan"\'`.',
    '',
    '```json',
    payload,
    '```',
  ].join('\n'),
  { schema: REPORT, phase: 'Report', label: 'report', model: 'haiku' },
)

const RESUME = 'Never relaunch run-plan from scratch unless the user explicitly asks to cut the run: ask through AskUserQuestion, then resume this same run with `Workflow({ scriptPath, resumeFromRunId })` (script and runId of its launch) and `args: { plan, decisions: [{ batch, text }] }`, earlier decisions kept. Agents already through come back from the cache, the batch restarts from its stop with the decision.'

return {
  status: stop ? BLOCKED : suspended.length ? WAITING : DONE,
  reason: stop || '—',
  runDir,
  report: rep ? rep.path : null,
  suspended: suspended.map(s => ({ batch: s.batch, file: s.file, questions: s.questions.map(q => ({ question: q.question, evidence: q.evidence, options: q.options, recommendation: q.answer })) })),
  ...(stopped
    ? { blockedBatch: stopped, next: `Stop question of ${stopped}: the reason above and its report. ${RESUME}` }
    : suspended.length
      ? { next: `Ask each question of \`suspended\` through AskUserQuestion (options as given, first recommended), apply the answers to the batch sheet (design + \`Hn\` \`user decision\`). ${RESUME}` }
      : {}),
  batches: ran.map(r => ({ batch: r.batch, status: r.status, hypotheses: r.hypotheses.length, minors: r.minors.length })),
}
