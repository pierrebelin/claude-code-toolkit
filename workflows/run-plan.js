export const meta = {
  name: 'run-plan',
  description: 'Whole plan, autonomous: run-lot on every runnable batch in dependency order, gate read from disk after each, run report',
  whenToUse: 'Implement every batch of a global plan without human intervention. Argument: path of the global plan `todo/<code>/<CODE>-PLAN.md`, optionally followed by `--until FX` or `--only FX`.',
  phases: [
    { title: 'Preflight', detail: 'plan check, doctor, docker, build green, kit root, run stamp, old runs and orphan scratch folders removed' },
    { title: 'Batch', detail: 'next batch, out-of-batch check and journal in one call, run-lot (its questions wait for the answer in the same run)' },
    { title: 'Gate', detail: 'report status, plan heading, build green, one repair, batch commit, journal' },
    { title: 'Aside', detail: 'blocked batch: partial work saved as a patch, tree restored to the batch start, dependents skipped' },
    { title: 'Final check', detail: 'every test suite run whole once, integration included, after the last batch: reported, never blocking' },
    { title: 'Report', detail: 'run/<stamp>.md: every decision taken without the user first, then batches, final check and journal; run lines of run/.work.jsonl removed, notification' },
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

const PREFLIGHT = obj({ ok: bool, failure: str, plan: str, root: str, kit: str, runRoot: str, stamp: str })
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
})
const OK = obj({ ok: bool, detail: str })
const SEALED = obj({ ok: bool, commit: str })
const FIX = obj({ fixed: arr(str), files: arr(str), validations: arr(str) })
const REPORT = obj({ path: str, lastLine: str })
const FINAL = obj({ suites: arr(obj({ name: str, exit: int, failed: arr(str) })) })
const FINAL_TIMEOUT_MIN = 40

function newFailures(build) {
  return build === 0 ? [] : [`build=${build}`]
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
const FRAME = 'Workflow run-plan, supervisor step. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes (the batch commit is `cctoolkit batch-baseline commit`, run only where a step gives it), never read nor edit `src/` or `tests/`. Run exactly the commands given, return their outputs through the structured output.'

phase('Preflight')
const pre = await agent(
  [
    FRAME,
    '',
    `Plan argument: \`${words[0]}\`.`,
    '1. `plan` = absolute path of the plan (`realpath`), `root` = `git rev-parse --show-toplevel`, `kit` = `cctoolkit root`.',
    '2. First, one call: `command -v docker >/dev/null && ! docker info >/dev/null 2>&1 && [ "$(uname)" = Darwin ] && open -a Docker; true` (Docker Desktop boots during the build, no wait loop).',
    '   Then in one message, from `root`: `cctoolkit plan-next-batch <plan> --check`, `cctoolkit doctor --quiet`, and the build configured by kit-init (`commands.build`, empty for a stack without one): `b=$(python3 -c \'import sys; sys.path.insert(0, sys.argv[1]); import kit_config; print(kit_config.load().command("build"))\' "$(cctoolkit root)/lib"); if [ -z "$b" ]; then echo build=none; else out=$(eval "$b" 2>&1); echo "build=$?"; printf \'%s\\n\' "$out" | grep -m1 -iE \'(^|[^a-z])error([^a-z]|$)\'; fi; command -v docker >/dev/null && { docker info >/dev/null 2>&1; echo "docker=$?"; } || echo docker=absent` (timeout 600000).',
    '3. `--check` exit ≠ 0, a doctor `FAIL` line, `docker` neither 0 nor `absent`, or `build` neither 0 nor `none` → `ok: false`, `failure` = the failing line verbatim (for the build: `build=<code>` followed by the first error line, the working tree must compile before any batch starts), `runRoot` and `stamp` empty, stop. No test suite runs here: each batch runs the tests its diff reaches, in its own global green.',
    `4. Otherwise \`stamp\` = \`$(date +%Y-%m-%d-%H%M)\`, \`runRoot\` = \`<plan folder>/run\` (absolute). One call: \`cctoolkit run-work purge <runRoot> <stamp> && cctoolkit run-work journal <runRoot>/.work.jsonl <stamp> "start $(date '+%Y-%m-%d %H:%M') — plan <plan> — scope ${scope || 'whole plan'}"\` (purge: older layouts migrated, lines no run needs dropped, the 3 most recent runs kept). \`ok: true\`, \`failure\` empty.`,
  ].join('\n'),
  { schema: PREFLIGHT, phase: 'Preflight', label: 'preflight', ...SHELL },
)
if (!pre) throw new Error('preflight agent without result')
if (!pre.ok) return { status: BLOCKED, reason: pre.failure, batches: [] }

const runRoot = pre.runRoot.replace(/\/$/, '')
const reportFile = `${runRoot}/${pre.stamp}.md`
const work = `${runRoot}/.work.jsonl`
const patchOf = batch => `${runRoot}/${pre.stamp}-aside-${batch}.patch`
const ran = []
const toReview = []
const aside = []
let held = []
let stop = null

const journalLine = line => `cctoolkit run-work append ${work} <<'JOURNAL_LINE'\n${JSON.stringify({ kind: 'journal', run: pre.stamp, text: line })}\nJOURNAL_LINE`
const tmpOf = name => `"$(cctoolkit run-work tmp ${name})"`

function journal(line) {
  return agent(`${FRAME}\n\nOne call, nothing else:\n\n${journalLine(line)}`, { schema: obj({ ok: bool }), phase: 'Batch', label: 'journal', ...SHELL })
}

function nextBatches() {
  const skip = aside.length ? ` --skip ${aside.map(x => x.batch).join(',')}` : ''
  return agent(
    [
      FRAME,
      '',
      `Run \`cctoolkit plan-next-batch ${pre.plan}${scope ? ' ' + scope : ''}${skip} --next ${work} --run ${pre.stamp}\`.`,
      'Exit 0 → it printed one JSON line: return its fields as-is (`held` empty when absent). Exit ≠ 0 → `kind: ERROR`, `line` = the whole output verbatim (stderr included), `batches`, `held` and `outsidePaths` empty, `outsideBatch` empty.',
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
      `3. Read \`${pre.kit}/skills/implement-tdd/references/test-scope.md\`: run its solution build once, \`> ${tmpOf(`gate-${b.batch}`)}/build.txt 2>&1; echo "build=$?"\` → \`build\` (no build configured → 0). No test suite: run-lot's global green already ran the tests the batch diff reaches.`,
    ].join('\n'),
    { schema: GATE, phase: 'Gate', label: `gate ${b.batch}${round ? ' again' : ''}`, model: 'haiku' },
  )
}

function repair(b, failures) {
  return agent(
    [
      `Workflow run-plan, gate repair after batch ${b.batch}. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git commit. Return the result through the structured output; prose follows \`language.docs\` of \`kit.config.json\`.`,
      '',
      `After batch ${b.batch} (sheet \`${b.sheet}\`), the solution build fails: ${failures.join(' ; ')}.`,
      `Output: \`build.txt\` in the folder \`cctoolkit run-work tmp gate-${b.batch}\` prints, read the error lines only.`,
      'Fix production code under the source roots only. Never edit, weaken, skip nor delete anything under the test roots: the tests state what the batch must keep.',
      'Read the production code each error points to, by range, fix it, then rerun the build once.',
      '`fixed` = one line per error (cause → fix), `files` = files modified, `validations` = commands run with their exit.',
    ].filter(l => l !== '').join('\n'),
    { schema: FIX, phase: 'Gate', label: `repair ${b.batch}` },
  ).catch(() => null)
}

function seal(b, done) {
  return agent(
    [
      FRAME,
      '',
      `Batch ${b.batch} passed its gate. One call: \`cctoolkit batch-baseline commit ${work} ${b.batch} --sheet ${b.sheet}; echo "exit=$?"\`.`,
      'exit 0 → `ok: true`; otherwise `ok: false`. `commit` = the output verbatim, stderr included.',
      `Then one call: \`cctoolkit run-work drop ${work} --batch ${b.batch} --kind preexisting,question,answer; rm -rf ${tmpOf(`gate-${b.batch}`)} ${tmpOf(b.batch)}\`, then \`${journalLine(done)}\`.`,
    ].join('\n'),
    { schema: SEALED, phase: 'Gate', label: `commit ${b.batch}`, ...SHELL },
  ).catch(() => null)
}

function setAside(b, reason) {
  const patch = patchOf(b.batch)
  return agent(
    [
      FRAME,
      '',
      `Batch ${b.batch} is set aside: ${reason}. Put the tree back to its state at the batch start, in this order:`,
      `1. \`cctoolkit batch-baseline restore ${work} ${b.batch} --save ${patch}\` (the script alone touches the source and test roots). Exit ≠ 0 → \`ok: false\`, \`detail\` = its output verbatim, stop.`,
      `2. \`cctoolkit run-work drop ${work} --batch ${b.batch}; rm -rf ${tmpOf(`gate-${b.batch}`)} ${tmpOf(b.batch)}\`: the saved cycles describe code just removed, a later run starts the batch over; the patch alone is kept.`,
      `3. \`grep -nE "^### (Batch|Lot) ${b.batch}\\b" ${pre.plan}\`: the heading carries \`✅ DONE\` → one Edit putting \`⬜\` in place of \`✅ DONE\` and its date, nothing else moves.`,
      `4. \`${journalLine(`${b.batch} ✗ — set aside — ${reason} — patch ${patch}`)}\`.`,
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
    toReview.push({ batch: b.batch, step: 'Start', text: `files modified outside the batch at launch, left out of the batch diff and commit: ${next.outsidePaths.join(', ')}` })
  }

  log(`→ ${b.batch} launched`)
  const result = await workflow('cctoolkit:run-lot', { sheet: b.sheet, commit: false }).catch(e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null }))
  const entry = { batch: b.batch, status: result.status, reason: result.reason, report: result.report, audit: result.audit || null, hypotheses: result.hypotheses || [], minors: result.minors || [] }
  ran.push(entry)
  for (const x of result.toReview || []) toReview.push({ batch: b.batch, ...x })

  let failure = result.status !== DONE || !result.report ? `${result.status} — ${result.reason}` : null
  if (!failure) {
    phase('Gate')
    let g = await gate(b, result, 0)
    failure = gateFailure(g)
    let fresh = failure ? [] : newFailures(g.build)
    if (fresh.length) {
      log(`${b.batch}: gate red (${fresh.join(', ')}), one repair`)
      const fix = await repair(b, fresh)
      if (fix) toReview.push({ batch: b.batch, step: 'Gate', text: `repaired after the batch, outside TDD: ${fresh.join(', ')} → ${fix.fixed.join(' ; ')}`, why: fix.files.join(', ') })
      g = await gate(b, result, 1)
      failure = gateFailure(g)
      fresh = failure ? [] : newFailures(g.build)
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
    entry.patch = patchOf(b.batch)
    aside.push({ batch: b.batch, reason: failure, patch: entry.patch, report: result.report || null, restored: back.detail || '' })
    log(`→ ${b.batch} set aside, tree restored — ${failure}`)
  } else {
    const sealed = await seal(b, `${b.batch} ✅ — Hn: ${entry.hypotheses.length}, Minor: ${entry.minors.length}`)
    entry.commit = sealed ? sealed.commit : null
    if (!sealed || !sealed.ok) toReview.push({ batch: b.batch, step: 'Gate', text: `batch commit failed, the batch stays uncommitted in the tree: ${sealed ? sealed.commit : 'agent without result'}` })
    else if (/committed whole/.test(sealed.commit)) toReview.push({ batch: b.batch, step: 'Gate', text: sealed.commit })
    log(`→ ${b.batch} ✅ (${ran.length})${sealed && sealed.ok ? ` — ${sealed.commit.split(':')[0]}` : ' — not committed'}`)
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
  toReview.push({ batch: x.batch, step: 'Set aside', text: `${x.reason}${x.patch ? ` — partial work: \`${x.patch}\` (\`git apply\` to take it back)` : ''}${/left \(/.test(x.restored || '') ? ` — ${x.restored}` : ''} — dependents not launched: ${x.dependents.length ? x.dependents.join(', ') : 'none'}` })
}
const left = aside.length
  ? `batches set aside: ${aside.map(x => `${x.batch}${x.dependents.length ? ` (holds back ${x.dependents.join(', ')})` : ''}`).join(', ')}`
  : null
const reason = [stop, left].filter(Boolean).join(' ; ') || null

const finalCheck = ran.some(r => r.status === DONE) && !scope.startsWith('--only')
  ? await (phase('Final check'), agent(
      [
        FRAME,
        '',
        `Final check of the plan, after its last batch: every suite runs whole once, \`IntegrationTests\` included. The result is reported, never a stop: fix nothing.`,
        `1. Read the Runner section and the §2 table of \`${pre.kit}/skills/implement-tdd/references/test-scope.md\`: the suites are the rows of that table, the command is \`commands.test\` resolved per suite. Prefix each command with \`KIT_FINAL_CHECK=1\` (the integration guard lets a whole suite through on that marker only) and the suite's test-mode variable when its own \`CLAUDE.md\` documents one.`,
        `2. \`<tmp>\` = the folder \`cctoolkit run-work tmp final\` prints (system temp). One call starts every suite detached, in parallel: \`nohup sh -c '<command> > "<tmp>/final-<Suite>.txt" 2>&1; echo $? > "<tmp>/final-<Suite>.exit"' >/dev/null 2>&1 &\` per suite.`,
        `3. Then wait, Bash timeout 600000: \`for i in $(seq 1 55); do [ $(ls "<tmp>"/final-*.exit 2>/dev/null | wc -l) -ge <suite count> ] && break; sleep 10; done; ls "<tmp>"/final-*.exit\`. Repeat that call until every exit file exists, ${FINAL_TIMEOUT_MIN} min in all; a suite still without exit file then gets \`exit\` 124.`,
        `4. One entry per suite: \`name\`, \`exit\` = the content of its exit file, \`failed\` = the failing tests named in its output file (\`grep -iE '^\\s*(failed|\\[FAIL\\]|✗|×)\\s'\`), one fully qualified \`Namespace.Class.Method\` each, arguments and duration dropped; empty for a green suite. Never open the output files beyond that grep.`,
      ].join('\n'),
      { schema: FINAL, phase: 'Final check', label: 'final check', ...SHELL },
    ).catch(() => null))
  : null
const finalRed = finalCheck ? finalCheck.suites.filter(x => x.exit !== 0) : []
if (finalCheck === null && ran.some(r => r.status === DONE) && !scope.startsWith('--only')) toReview.push({ batch: '—', step: 'Final check', text: 'final check agent without result: suites not run whole' })
for (const x of finalRed) toReview.push({ batch: '—', step: 'Final check', text: `${x.name} exit=${x.exit}${x.failed.length ? `: ${x.failed.join(', ')}` : ''} — not attributed: a batch of this run or a failure already on the starting tree; output removed with the temp folder of the run, rerun filtered to inspect` })
if (finalRed.length) log(`final check red: ${finalRed.map(x => x.name).join(', ')}`)

phase('Report')
if (!ran.length) {
  await agent(
    `${FRAME}\n\nNo batch ran: in one call, \`cctoolkit run-work drop ${work} --run ${pre.stamp}; rm -rf ${tmpOf('final')}; command -v osascript >/dev/null && osascript -e 'display notification "${`Plan stopped — ${reason || 'no batch launched'}`.replace(/["'\\]/g, '')}" with title "run-plan"' || true\`.`,
    { schema: obj({ ok: bool }), phase: 'Report', label: 'cleanup', ...SHELL },
  )
  return { status: reason ? BLOCKED : DONE, reason: reason || '—', report: null, batches: [] }
}
const payload = JSON.stringify({ plan: pre.plan, scope: scope || 'whole plan', report: reportFile, stop: reason, batches: ran, aside, finalCheck: finalCheck ? finalCheck.suites : null }, null, 1)
const review = JSON.stringify({ stop: reason, toReview, audits: ran.filter(r => r.audit).map(r => ({ batch: r.batch, audit: r.audit, report: r.report })), hypotheses: ran.flatMap(r => r.hypotheses.map(h => ({ batch: r.batch, h }))) }, null, 1)
const rep = await agent(
  [
    FRAME,
    '',
    `First, one call: \`cctoolkit run-work journal ${work} ${pre.stamp}\`: the journal of the run, one line each.`,
    `Write \`${reportFile}\` in a single Write, headings verbatim, prose in the docs language of \`kit.config.json\`, from the two JSON below, without reading code, tests or batch reports. Header: plan, scope, start time = the \`start\` line of the journal, end time = \`date '+%Y-%m-%d %H:%M'\`. Then, in this order:`,
    '- table `| Batch | Status | Report | Commit | Patch |`, one row per batch of the first JSON, `Commit` = the hash `commit` starts with (`—` when absent)',
    `- \`## To validate\` — from the second JSON, everything the run decided without the user (marked \`${TO_REVIEW}\`), to review after the plan, one \`###\` per kind: \`### Stop\` (\`stop\` verbatim, only when not null), \`### Batches set aside\` (\`toReview\` entries of step \`Set aside\`), \`### Start\` (\`toReview\` entries of step \`Start\`), \`### Final check\` (\`toReview\` entries of step \`Final check\`), \`### Audits to redo\` (\`audit\` = \`to redo\`: batch, report, command \`/verify-ddd-tdd batch FX\`), \`### Audit gaps carried\` (\`toReview\` entries of step \`Audit\`, and \`audit\` = \`GAPS carried\`), \`### Arbiter and design decisions\` (other \`toReview\` entries, step and why kept), \`### Assumptions\` (every \`h\`). One bullet per entry, prefixed by its batch; \`None.\` for an empty section.`,
    '- `## Minor` — every minor of the first JSON, prefixed by its batch; `None.` when none',
    '- `## Final check` — table `| Suite | Exit | Failed tests |` from `finalCheck`; `Not run.` when `finalCheck` is null',
    '- `## Journal` — the journal lines verbatim, in order',
    `\`lastLine\` = \`Plan stopped — <stop>\` when stop is not null, else \`Plan done — review of ${reportFile} required.\`${finalRed.length ? `, followed by \` — final check red: ${finalRed.map(x => x.name).join(', ')}\`` : ''}.`,
    `Then one call: \`cctoolkit run-work drop ${work} --run ${pre.stamp}; rm -rf ${tmpOf('final')}; command -v osascript >/dev/null && osascript -e 'display notification "<lastLine, double quotes removed>" with title "run-plan"' || true\` (the journal of the run, now copied into the report).`,
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

const RESTART = `A blocked batch never ends the plan: its partial work is saved as \`run/<stamp>-aside-FX.patch\`, the tree goes back to the last batch commit (files the user modified before the batch left as they are), its saved cycles are cleared and the plan goes on with every batch that does not depend on it; \`${BLOCKED}\` here means batches were set aside (listed in \`setAside\` with their dependents) or the run met a technical stop (\`reason\`). The arbiter settles what it can, a question waits 10 min then takes its recommendation, so a batch is set aside for a technical stop, a production Blocking the audit fixes did not lift, a \`STOP\` answer, a question without answer nor recommendation, a step still stopped after its last attempt, or a gate still red after its repair. Fix the cause (reapply the patch with \`git apply\` to keep the partial work), write the decision into \`decisions\` of the cycles it touches in the \`## Cycles\` block of the batch sheet (and as \`Hn\` marked \`${USER}\`), then launch a new run-plan: batches ✅ DONE are skipped. Never \`resumeFromRunId\`: replay re-runs finished work.`

return {
  status: reason ? BLOCKED : DONE,
  reason: reason || '—',
  report: rep ? rep.path : null,
  ...(reason ? { setAside: aside.map(x => ({ batch: x.batch, reason: x.reason, patch: x.patch, dependents: x.dependents })), next: RESTART } : {}),
  batches: ran.map(r => ({ batch: r.batch, status: r.status, hypotheses: r.hypotheses.length, minors: r.minors.length })),
  finalCheck: finalCheck ? finalCheck.suites.map(x => ({ name: x.name, exit: x.exit, failed: x.failed.length })) : null,
}
