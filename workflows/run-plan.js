export const meta = {
  name: 'run-plan',
  description: 'Whole plan, autonomous: run-lot on every runnable batch in dependency order, gate read from disk after each, run report',
  whenToUse: 'Implement every batch of a global plan without human intervention. Argument: path of the global plan `todo/<code>/<CODE>-PLAN.md`, optionally followed by `--until FX` or `--only FX`.',
  phases: [
    { title: 'Preflight', detail: 'plan check, doctor, docker, build green, kit root, failing tests of the starting tree recorded, run folder' },
    { title: 'Batch', detail: 'next batch, out-of-batch check, journal and tree snapshot in one call, run-lot (its questions wait for the answer in the same run)' },
    { title: 'Gate', detail: 'report status, plan heading, fast suites against the start failures, one repair, journal' },
    { title: 'Aside', detail: 'blocked batch: partial work saved as a patch, tree restored to the batch start, dependents skipped' },
    { title: 'Report', detail: 'REPORT.md (journal merged), TO-VALIDATE.md (every decision taken without the user, batches set aside), scratch folder removed, notification' },
  ],
}

const words = (typeof args === 'string' ? args : (args && args.plan) || '').trim().replace(/^@/, '').split(/\s+/).filter(Boolean)
const scope = words.slice(1).join(' ')
if (!/-PLAN\.md$/.test(words[0] || '') || (scope && !/^--(until|only) F\d+$/.test(scope))) {
  throw new Error('expected argument: `todo/<code>/<CODE>-PLAN.md [--until FX | --only FX]`')
}

const DONE = 'DONE'
const BLOCKED = 'BLOCKED'
const USER = 'user decision'
const TO_REVIEW = 'user decision to validate'

const STATUS_DONE = ['## STATUS — DONE', '## STATUT — TERMINÉ']
const VERDICT_LINE = /^Verdict ?:\s*(.*)$/
const VERDICT_PASSED = ['VALID', 'GAPS carried', 'to redo', 'VALIDE', 'ECARTS reportés', 'à refaire']

const str = { type: 'string' }
const int = { type: 'integer' }
const bool = { type: 'boolean' }
const arr = items => ({ type: 'array', items })
const obj = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
})

const SUITE = obj({ name: str, exit: int, failed: arr(str) })
const PREFLIGHT = obj({ ok: bool, failure: str, plan: str, root: str, kit: str, runDir: str, startFailures: arr(SUITE) })
const NEXT = obj({
  kind: { type: 'string', enum: ['END', 'WAITING', 'BATCHES', 'ERROR'] },
  line: str,
  batches: arr(obj({ batch: str, repo: str, sheet: str })),
  held: arr(obj({ batch: str, by: arr(str) })),
  outsideBatch: str,
  outsidePaths: arr(str),
})
const GATE = obj({
  statusLine: str,
  verdictLine: str,
  planDone: bool,
  build: int,
  suites: arr(SUITE),
})
const OK = obj({ ok: bool, detail: str })
const FIX = obj({ fixed: arr(str), files: arr(str), validations: arr(str) })
const REPORT = obj({ path: str, lastLine: str })

const FAILED_NAMES = 'its `failed` = the failing tests named in its output file (`grep -iE \'^\\s*(failed|\\[FAIL\\]|✗|×)\\s\'`), one fully qualified `Namespace.Class.Method` each, arguments and duration dropped; empty for a green suite or when no test is named'
const testName = line => String(line).replace(/^\s*(failed|\[FAIL\]|✗|×)\s+/i, '').replace(/\s*[([].*$/, '').trim()
const fastSuites = kit => `every suite \`${kit}/skills/implement-tdd/references/test-scope.md\` runs whole and always`

function newFailures(build, suites, start) {
  if (build !== 0) return [`build=${build}`]
  return suites.flatMap(s => {
    if (s.exit === 0) return []
    const before = start.find(x => x.name === s.name)
    const known = new Set((before ? before.failed : []).map(testName))
    const failed = s.failed.map(testName).filter(Boolean)
    if (!failed.length) return before && before.exit === s.exit && !known.size ? [] : [`${s.name} exit=${s.exit}`]
    return failed.filter(t => !known.has(t)).map(t => `${s.name} ${t}`)
  })
}

function verdictOf(line) {
  const m = VERDICT_LINE.exec(String(line).trim())
  return m ? m[1].trim() : null
}

function gateFailure(g) {
  if (!g) return 'agent without result'
  if (!STATUS_DONE.includes(g.statusLine.trim())) return `status: ${g.statusLine}`
  if (!VERDICT_PASSED.includes(verdictOf(g.verdictLine))) return `verdict: ${g.verdictLine}`
  if (!g.planDone) return 'plan heading without ✅ DONE'
  return null
}

function dependentsOf(batch, held) {
  return held.filter(h => h.by.includes(batch)).map(h => h.batch)
}

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
    `   Build 0 or none → in one message, ${fastSuites('<kit>')} (\`<kit>\` = \`kit\` above), each \`> "\${TMPDIR:-/tmp}/preflight-<Suite>.txt" 2>&1; echo "<Suite>=$?"\`.`,
    '3. `--check` exit ≠ 0, a doctor `FAIL` line, `docker` neither 0 nor `absent`, or `build` neither 0 nor `none` → `ok: false`, `failure` = the failing line verbatim (for the build: `build=<code>` followed by the first error line, the working tree must compile before any batch starts), `runDir` empty, `startFailures` empty, stop.',
    `   A red suite never stops the run: it goes into \`startFailures\` (\`name\` = the suite, \`exit\`), ${FAILED_NAMES}. The gate ignores these failures, a batch is never blamed for a failure it found.`,
    `4. Otherwise \`stamp\` = \`$(date +%Y-%m-%d-%H%M)\`, \`runDir\` = \`<plan folder>/run/<stamp>\` (absolute), \`work\` = \`<plan folder>/run/.work/<stamp>\`. One call: \`mkdir -p <runDir> <work>; for d in $(ls -1d <plan folder>/run/[0-9]*-[0-9]* | sort -r | tail -n +4); do rm -rf "$d" "<plan folder>/run/.work/$(basename "$d")"; done\` (only the 3 most recent run folders are kept). Write \`<work>/journal.md\` (docs language of \`kit.config.json\`): plan, scope \`${scope || 'whole plan'}\`, start (\`date '+%Y-%m-%d %H:%M'\`). A red suite → also write \`<work>/start-failures.txt\`: one line per failing test \`<Suite> <test>\`, \`<Suite> exit=<code>\` for a red suite without named test. \`ok: true\`, \`failure\` empty.`,
  ].join('\n'),
  { schema: PREFLIGHT, phase: 'Preflight', label: 'preflight', ...SHELL },
)
if (!pre) throw new Error('preflight agent without result')
if (!pre.ok) return { status: BLOCKED, reason: pre.failure, batches: [] }

const runDir = pre.runDir.replace(/\/$/, '')
const work = runDir.replace(/\/([^/]+)$/, '/.work/$1')
const startFailures = pre.startFailures || []
const ran = []
const toReview = []
const aside = []
let held = []
let stop = null

if (startFailures.length) {
  toReview.push({ batch: '—', step: 'Start', text: `failures present on the starting tree, ignored by the gate: ${startFailures.map(x => `${x.name} (${x.failed.length ? x.failed.join(', ') : `exit=${x.exit}`})`).join(' ; ')}` })
}

function journal(line) {
  return agent(`${FRAME}\n\nAppend this line to \`${work}/journal.md\` with \`printf '%s\\n' … >>\`, nothing else:\n\n${line}`, { schema: obj({ ok: bool }), phase: 'Batch', label: 'journal', ...SHELL })
}

let sealing = ''

function nextBatches() {
  const skip = aside.length ? ` --skip ${aside.map(x => x.batch).join(',')}` : ''
  const sealed = sealing
  sealing = ''
  return agent(
    [
      FRAME,
      '',
      sealed ? `First, one call: \`${sealed}\`.` : '',
      `Run \`cctoolkit plan-next-batch ${pre.plan}${scope ? ' ' + scope : ''}${skip} --next ${work}/journal.md\`.`,
      'Exit 0 → it printed one JSON line: return its fields as-is (`held` empty when absent). Exit ≠ 0 → `kind: ERROR`, `line` = the whole output verbatim (stderr included), `batches`, `held` and `outsidePaths` empty, `outsideBatch` empty.',
      `\`outsideBatch\` not empty → then run \`cctoolkit batch-baseline snapshot ${work}/baseline-<outsideBatch>\`: the tree at the batch start, put back if the batch is set aside.`,
    ].filter(l => l !== '').join('\n'),
    { schema: NEXT, phase: 'Batch', label: 'next batch', ...SHELL },
  )
}

function gate(b, result, round) {
  return agent(
    [
      FRAME,
      '',
      `Gate of batch ${b.batch}, every check read from disk, never from a previous agent's words.`,
      `1. First line of \`${result.report}\` → \`statusLine\`; \`grep -m1 -E '^Verdict ?:'\` of it → \`verdictLine\`.`,
      `2. \`grep -nE "^### (Batch|Lot) ${b.batch}\\b" ${pre.plan}\` → \`planDone\` = the heading carries \`✅ DONE\`.`,
      `3. Read \`${pre.kit}/skills/implement-tdd/references/test-scope.md\`: run its solution build once, \`> "${work}/gate-${b.batch}-build.txt" 2>&1; echo "build=$?"\` → \`build\` (no build configured → 0). Red → \`suites\` empty, stop here.`,
      `   Green → in one message, ${fastSuites(pre.kit)}, each \`> "${work}/gate-${b.batch}-<Suite>.txt" 2>&1; echo "exit=$?"\`. One entry per suite: \`name\` = the suite, \`exit\`, ${FAILED_NAMES}. Never open the output files beyond that grep.`,
    ].join('\n'),
    { schema: GATE, phase: 'Gate', label: `gate ${b.batch}${round ? ' again' : ''}`, model: 'haiku' },
  )
}

function repair(b, failures) {
  return agent(
    [
      `Workflow run-plan, gate repair after batch ${b.batch}. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git commit. Return the result through the structured output; prose follows \`language.docs\` of \`kit.config.json\`.`,
      '',
      `After batch ${b.batch} (sheet \`${b.sheet}\`), the fast suites fail where the starting tree passed: ${failures.join(' ; ')}.`,
      startFailures.length ? `Failures already present at start, not to fix: \`${work}/start-failures.txt\`.` : '',
      `Outputs: \`${work}/gate-${b.batch}-build.txt\` and \`${work}/gate-${b.batch}-<Suite>.txt\`, read the failing lines only.`,
      'Fix production code under the source roots only. Never edit, weaken, skip nor delete anything under the test roots: the tests state what the batch must keep.',
      `Read the failing test and the production code it reaches, by range. Rerun only the failing tests, filtered (filtered command of \`${pre.kit}/skills/implement-tdd/references/test-scope.md\`), never a whole suite: the gate reruns the suites.`,
      '`fixed` = one line per failure (cause → fix), `files` = files modified, `validations` = filtered commands run with their exit.',
    ].filter(l => l !== '').join('\n'),
    { schema: FIX, phase: 'Gate', label: `repair ${b.batch}` },
  ).catch(() => null)
}

function seal(b, done) {
  sealing = `rm -rf "${work}/baseline-${b.batch}" "${work}"/gate-${b.batch}-*; printf '%s\\n' '${done}' >> "${work}/journal.md"`
}

function setAside(b, reason) {
  const batchWork = `${b.sheet.slice(0, b.sheet.lastIndexOf('/'))}/run/.work/${b.batch}`
  const patch = `${runDir}/aside-${b.batch}.patch`
  return agent(
    [
      FRAME,
      '',
      `Batch ${b.batch} is set aside: ${reason}. Put the tree back to its state at the batch start, in this order:`,
      `1. \`cctoolkit batch-baseline restore ${work}/baseline-${b.batch} --save ${patch}\` (the script alone touches the source and test roots). Exit ≠ 0 → \`ok: false\`, \`detail\` = its output verbatim, stop.`,
      `2. \`rm -rf ${batchWork} "${work}/baseline-${b.batch}" "${work}"/gate-${b.batch}-*\`: the saved cycles describe code just removed, a later run starts the batch over; the patch alone is kept.`,
      `3. \`grep -nE "^### (Batch|Lot) ${b.batch}\\b" ${pre.plan}\`: the heading carries \`✅ DONE\` → one Edit putting \`⬜\` in place of \`✅ DONE\` and its date, nothing else moves.`,
      `4. \`printf '%s\\n' "${b.batch} ✗ — set aside — <reason above> — patch ${patch}" >> "${work}/journal.md"\`.`,
      '`ok: true`, `detail` = the last line the restore printed.',
    ].join('\n'),
    { schema: OK, phase: 'Aside', label: `aside ${b.batch}`, ...SHELL },
  ).catch(() => null)
}

while (!stop) {
  phase('Batch')
  const next = await nextBatches()
  if (!next) { stop = 'plan-next-batch without result'; break }
  held = next.held || []
  if (next.kind === 'END') break
  if (next.kind !== 'BATCHES') { stop = next.line; break }

  const b = next.batches.find(x => x.repo.replace(/\/$/, '') === pre.root.replace(/\/$/, ''))
  if (!b) {
    stop = `batches of another repo (${next.batches.map(x => `${x.batch} ${x.repo}`).join(', ')}): run run-plan from that repo`
    break
  }
  if (next.batches.length > 1) log(`${next.batches.filter(x => x !== b).map(x => x.batch).join(', ')} in another repo, not launched here`)

  if (next.outsideBatch === b.batch && next.outsidePaths.length) {
    toReview.push({ batch: b.batch, step: 'Start', text: `files modified outside the batch at launch, left out of the batch diff by the tree snapshot: ${next.outsidePaths.join(', ')}` })
  }

  log(`→ ${b.batch} launched`)
  const result = await workflow({ scriptPath: `${pre.kit}/workflows/run-lot.js` }, b.sheet).catch(e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null }))
  const entry = { batch: b.batch, status: result.status, reason: result.reason, report: result.report, audit: result.audit || null, hypotheses: result.hypotheses || [], minors: result.minors || [] }
  ran.push(entry)
  for (const x of result.toReview || []) toReview.push({ batch: b.batch, ...x })

  let failure = result.status !== DONE || !result.report ? `${result.status} — ${result.reason}` : null
  if (!failure) {
    phase('Gate')
    let g = await gate(b, result, 0)
    failure = gateFailure(g)
    let fresh = failure ? [] : newFailures(g.build, g.suites, startFailures)
    if (fresh.length) {
      log(`${b.batch}: gate red (${fresh.join(', ')}), one repair`)
      const fix = await repair(b, fresh)
      if (fix) toReview.push({ batch: b.batch, step: 'Gate', text: `repaired after the batch, outside TDD: ${fresh.join(', ')} → ${fix.fixed.join(' ; ')}`, why: fix.files.join(', ') })
      g = await gate(b, result, 1)
      failure = gateFailure(g)
      fresh = failure ? [] : newFailures(g.build, g.suites, startFailures)
    }
    if (!failure && fresh.length) failure = `gate red after repair: ${fresh.join(', ')}`
    else if (failure) failure = `gate: ${failure}`
  }

  if (failure) {
    entry.status = result.status === DONE ? 'GATE RED' : result.status
    phase('Aside')
    const back = await setAside(b, failure)
    if (!back || !back.ok) {
      stop = `${b.batch} — ${failure} — tree not restored: ${back ? back.detail : 'agent without result'}`
      await journal(`${b.batch} ✗ — ${stop}`)
      break
    }
    entry.patch = `${runDir}/aside-${b.batch}.patch`
    aside.push({ batch: b.batch, reason: failure, patch: entry.patch, report: result.report || null })
    log(`→ ${b.batch} set aside, tree restored — ${failure}`)
  } else {
    seal(b, `${b.batch} ✅ — Hn: ${entry.hypotheses.length}, Minor: ${entry.minors.length}`)
    log(`→ ${b.batch} ✅ (${ran.length})`)
  }

  const unansweredBatch = result.unanswered && (/-(F\d+)\.md\b/.exec(result.unanswered) || [])[1]
  if (unansweredBatch) {
    aside.push({ batch: unansweredBatch, reason: `review questions without answer — ${result.unanswered}`, patch: null, report: null })
    await journal(`${unansweredBatch} ⏸ — set aside, questions without answer`)
  } else if (result.unanswered) {
    stop = `next batch without answer — ${result.unanswered}`
    await journal(`⏸ — ${stop}`)
  }
}

for (const x of aside) {
  x.dependents = dependentsOf(x.batch, held)
  toReview.push({ batch: x.batch, step: 'Set aside', text: `${x.reason}${x.patch ? ` — partial work: \`${x.patch}\` (\`git apply\` to take it back)` : ''} — dependents not launched: ${x.dependents.length ? x.dependents.join(', ') : 'none'}` })
}
const left = aside.length
  ? `batches set aside: ${aside.map(x => `${x.batch}${x.dependents.length ? ` (holds back ${x.dependents.join(', ')})` : ''}`).join(', ')}`
  : null
const reason = [stop, left].filter(Boolean).join(' ; ') || null

phase('Report')
if (!ran.length) {
  await agent(
    `${FRAME}\n\nNo batch ran: in one call, \`rm -rf "${runDir}" "${work}"; command -v osascript >/dev/null && osascript -e 'display notification "${`Plan stopped — ${reason || 'no batch launched'}`.replace(/["'\\]/g, '')}" with title "run-plan"' || true\`.`,
    { schema: obj({ ok: bool }), phase: 'Report', label: 'cleanup', ...SHELL },
  )
  return { status: reason ? BLOCKED : DONE, reason: reason || '—', runDir: null, report: null, batches: [] }
}
const payload = JSON.stringify({ plan: pre.plan, scope: scope || 'whole plan', runDir, stop: reason, batches: ran, aside }, null, 1)
const review = JSON.stringify({ stop: reason, toReview, audits: ran.filter(r => r.audit).map(r => ({ batch: r.batch, audit: r.audit, report: r.report })), hypotheses: ran.flatMap(r => r.hypotheses.map(h => ({ batch: r.batch, h }))) }, null, 1)
const rep = await agent(
  [
    FRAME,
    '',
    sealing ? `First, one call: \`${sealing}\`.` : '',
    `Write \`${runDir}/REPORT.md\` in a single Write, headings verbatim, prose in the docs language of \`kit.config.json\`, from the JSON below, without reading code, tests or batch reports:`,
    '- table `| Batch | Status | Report | Patch |`, one row per batch (`—` when absent)',
    '- `## Set aside` — one bullet per `aside` entry: batch, reason, patch, dependents not launched; only when `aside` is not empty',
    '- `## Assumptions` — every hypothesis, prefixed by its batch; `None.` when none',
    '- `## Minor` — every minor, prefixed by its batch; `None.` when none',
    '- `## Stop` — `stop` verbatim, only when not null',
    `- \`## Journal\` — the lines of \`${work}/journal.md\` verbatim, in order`,
    '- start time = the `start` line of that journal, end time = `date \'+%Y-%m-%d %H:%M\'`.',
    `Then write \`${runDir}/TO-VALIDATE.md\` in a single Write, same language rule, from the second JSON below: everything the run decided without the user (marked \`${TO_REVIEW}\`), to review after the plan. Sections: \`## Stop\` (only when \`stop\` is not null), \`## Batches set aside\` (\`toReview\` entries of step \`Set aside\`), \`## Start\` (\`toReview\` entries of step \`Start\`), \`## Audits to redo\` (\`audit\` = \`to redo\`: batch, report, command \`/verify-ddd-tdd batch FX\`), \`## Audit gaps carried\` (\`toReview\` entries of step \`Audit\`, and \`audit\` = \`GAPS carried\`), \`## Arbiter and design decisions\` (other \`toReview\` entries, step and why kept), \`## Assumptions\` (every \`h\`, prefixed by its batch). One bullet per entry, prefixed by its batch; \`None.\` for an empty section. Add the \`TO-VALIDATE.md\` path to the REPORT.md header.`,
    `\`lastLine\` = \`Plan stopped — <stop>\` when stop is not null, else \`Plan done — review of ${runDir}/REPORT.md required.\`.`,
    `Then one call: \`rm -rf "${work}"; command -v osascript >/dev/null && osascript -e 'display notification "<lastLine, double quotes removed>" with title "run-plan"' || true\` (the scratch folder of the run, its journal now copied into REPORT.md).`,
    '',
    '```json',
    payload,
    '```',
    '',
    '```json',
    review,
    '```',
  ].filter(l => l !== '').join('\n'),
  { schema: REPORT, phase: 'Report', label: 'report', model: 'haiku' },
)

const RESTART = `A blocked batch never ends the plan: its partial work is saved as \`aside-FX.patch\`, the tree goes back to its state at the batch start, its saved cycles are cleared and the plan goes on with every batch that does not depend on it; \`${BLOCKED}\` here means batches were set aside (listed in \`setAside\` with their dependents) or the run met a technical stop (\`reason\`). The arbiter settles what it can, a question waits 30 min then takes its recommendation, so a batch is set aside for a technical stop, a production Blocking the audit fixes did not lift, a \`STOP\` answer, a question without answer nor recommendation, a step still stopped after its last attempt, or a gate still red after its repair. Fix the cause (reapply the patch with \`git apply\` to keep the partial work), write the decision into \`decisions\` of the cycles it touches in the \`## Cycles\` block of the batch sheet (and as \`Hn\` marked \`${USER}\`), then launch a new run-plan: batches ✅ DONE are skipped. Never \`resumeFromRunId\`: replay re-runs finished work.`

return {
  status: reason ? BLOCKED : DONE,
  reason: reason || '—',
  runDir,
  report: rep ? rep.path : null,
  ...(reason ? { setAside: aside.map(x => ({ batch: x.batch, reason: x.reason, patch: x.patch, dependents: x.dependents })), next: RESTART } : {}),
  batches: ran.map(r => ({ batch: r.batch, status: r.status, hypotheses: r.hypotheses.length, minors: r.minors.length })),
}
