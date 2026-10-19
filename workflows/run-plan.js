export const meta = {
  name: 'run-plan',
  description: 'Whole plan, autonomous: run-lot on every runnable batch in dependency order, gate read from disk after each, run report',
  whenToUse: 'Implement every batch of a global plan without human intervention. Argument: path of the global plan `todo/<code>/<CODE>-PLAN.md`, optionally followed by `--until FX` or `--only FX`.',
  phases: [
    { title: 'Preflight', detail: 'plan check, doctor, docker, build green, kit root, run stamp, old runs and orphan scratch folders removed' },
    { title: 'Batch', detail: 'next batch, out-of-batch check and journal in one call, run-lot (its questions wait for the answer in the same run)' },
    { title: 'Gate', detail: 'report status, plan heading, build green, one repair, batch commit, journal' },
    { title: 'Aside', detail: 'blocked batch: partial work saved as a patch, tree restored to the batch start, dependents skipped; from the second, an arbiter looks for a cause common to the batches set aside — one stops the plan' },
    { title: 'Final check', detail: 'every test suite run whole once, integration included, after the last batch: reported, never blocking' },
    { title: 'Security', detail: 'one read-only pass over the batch commits of the plan: findings listed for review, never blocking' },
    { title: 'Merge', detail: 'whole plan delivered, spec written against the knowledge base: its merge drafted and staged by knowledge-merger, never written — /cctoolkit:knowledge-merge shows it and writes it on confirmation' },
    { title: 'Report', detail: 'run/<stamp>.md: every decision taken without the user first, then batches, final check and journal; run lines of run/.work.jsonl removed, notification' },
  ],
}

// On Windows a path may come with `\` (Python, the engine, the user): Git Bash eats an unquoted one, and two
// spellings of one folder compare unequal. Paths are carried with `/`, compared with the drive's case aside.
const slashed = p => String(p || '').replace(/\\/g, '/')
const samePath = (a, b) => {
  const [x, y] = [slashed(a).replace(/\/$/, ''), slashed(b).replace(/\/$/, '')]
  return /^[A-Za-z]:/.test(x) ? x.toLowerCase() === y.toLowerCase() : x === y
}

const words = slashed(typeof args === 'string' ? args : (args && args.plan) || '').trim().replace(/^@/, '').split(/\s+/).filter(Boolean)
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
  kind: { type: 'string', enum: ['END', 'WAITING', 'BATCHES', 'PAUSED', 'ERROR'] },
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
const BREAKER = obj({ commonCause: bool, cause: str, batches: arr(str), fixBeforeRelaunch: str })
const PREPARED = obj({ exit: int, nothing: str, refused: arr(str) })
const MERGED = obj({ staged: bool, stagedLine: str, files: arr(str), warnings: arr(str), blocked: str })
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
    '1. `plan` = absolute path of the plan (`realpath`; under Git Bash on Windows `cygpath -m "$(realpath <p>)"`, a `C:/…` path the Write tool reads), `root` = `git rev-parse --show-toplevel`, `kit` = `cctoolkit root`.',
    '2. First, one call: `command -v docker >/dev/null && ! docker info >/dev/null 2>&1 && case "$(uname)" in Darwin) open -a Docker ;; MINGW*|MSYS*) (\"/c/Program Files/Docker/Docker/Docker Desktop.exe\" >/dev/null 2>&1 &) ;; esac; true` (Docker Desktop boots during the build, no wait loop).',
    '   Then in one message, from `root`: `cctoolkit plan-next-batch <plan> --check`, `cctoolkit doctor --quiet`, and the build configured by kit-init (`commands.build`, empty for a stack without one): `b=$(cctoolkit config command build); if [ -z "$b" ]; then echo build=none; else out=$(eval "$b" 2>&1); echo "build=$?"; printf \'%s\\n\' "$out" | grep -m1 -iE \'(^|[^a-z])error([^a-z]|$)\'; fi; command -v docker >/dev/null && { docker info >/dev/null 2>&1; echo "docker=$?"; } || echo docker=absent` (timeout 600000).',
    '3. `--check` exit ≠ 0, a doctor `FAIL` line, `docker` neither 0 nor `absent`, or `build` neither 0 nor `none` → `ok: false`, `failure` = the failing line verbatim (for the build: `build=<code>` followed by the first error line, the working tree must compile before any batch starts), `runRoot` and `stamp` empty, stop. No test suite runs here: each batch runs the tests its diff reaches, in its own global green.',
    `4. Otherwise \`stamp\` = \`$(date +%Y-%m-%d-%H%M)\`, \`runRoot\` = \`<plan folder>/run\` (absolute). One call: \`cctoolkit run-work purge <runRoot> <stamp> && cctoolkit run-validate apply <runRoot>/.work.jsonl && cctoolkit run-work journal <runRoot>/.work.jsonl <stamp> "start $(date '+%Y-%m-%d %H:%M') — plan <plan> — scope ${scope || 'whole plan'}"\` (purge: older layouts migrated, lines no run needs dropped, the 3 most recent runs kept; run-validate: the answers given in the run-lot-pane mod written into the sheets). \`ok: true\`, \`failure\` empty.`,
  ].join('\n'),
  { schema: PREFLIGHT, phase: 'Preflight', label: 'preflight', ...SHELL },
)
if (!pre) throw new Error('preflight agent without result')
if (!pre.ok) return { status: BLOCKED, reason: pre.failure, batches: [] }

const runRoot = slashed(pre.runRoot).replace(/\/$/, '')
const reportFile = `${runRoot}/${pre.stamp}.md`
const work = `${runRoot}/.work.jsonl`
const patchOf = batch => `${runRoot}/${pre.stamp}-aside-${batch}.patch`
const ran = []
const toReview = []
const aside = []
let held = []
let stop = null
let breaker = null

const journalLine = line => `cctoolkit run-work append ${work} <<'JOURNAL_LINE'\n${JSON.stringify({ kind: 'journal', run: pre.stamp, text: line })}\nJOURNAL_LINE`
const tmpOf = name => `"$(cctoolkit run-work tmp ${name})"`
const rmTmp = (...names) => `cctoolkit run-work rm-tmp ${names.join(' ')}`

function journal(line) {
  return agent(`${FRAME}\n\nOne call, nothing else:\n\n${journalLine(line)}`, { schema: obj({ ok: bool }), phase: 'Batch', label: 'journal', ...SHELL })
}

const breakerLine = (decision, b) => `cctoolkit run-work append ${work} <<'BREAKER_LINE'\n${JSON.stringify({ kind: 'breaker', run: pre.stamp, asides: aside.map(x => x.batch), decision, cause: b ? b.cause : '' })}\nBREAKER_LINE`

// From the second batch set aside, an arbiter compares the reasons: a cause they share (the same
// spec ambiguity, the same wrong assumption, the same workaround) would set aside every batch it
// reaches, so the plan stops for the spec or the plan to be fixed first. Distinct causes: the plan
// goes on as before. Every decision is a `breaker` line of the work file.
function checkBreaker() {
  return agent(
    [
      FRAME.replace('Run exactly the commands given, return their outputs through the structured output.', 'Return your decision through the structured output.'),
      '',
      `Batches set aside in this run, latest last:`,
      ...aside.map(x => `- ${x.batch} — ${x.reason}${x.report ? ` — report \`${x.report}\`` : ''}`),
      'In each report, read only its `Reason:` line and its `## To validate` section (`sed -n` on that section), nothing else.',
      `Does the latest one (${aside[aside.length - 1].batch}) share its cause with an earlier one? A shared cause is the same spec ambiguity, the same wrong assumption, the same workaround, the same missing precondition — not merely the same step or the same kind of failure (two red suites for unrelated reasons are distinct).`,
      '`commonCause` true only when that cause is named: `cause` = one sentence citing the report lines it rests on, `batches` = the batches it explains, `fixBeforeRelaunch` = what to fix in the spec or the plan before a new run. Otherwise `commonCause` false, `cause` = why the causes differ, one line, `batches` empty, `fixBeforeRelaunch` empty. Prose in the docs language of `kit.config.json`.',
    ].join('\n'),
    { schema: BREAKER, phase: 'Aside', label: `breaker ${aside.length}`, model: 'sonnet', effort: 'medium' },
  ).catch(() => null)
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
      `Then one call: \`cctoolkit run-work drop ${work} --batch ${b.batch} --kind preexisting,question,answer; ${rmTmp(`gate-${b.batch}`, b.batch)}\`, then \`${journalLine(done)}\`.`,
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
      `2. \`cctoolkit run-work drop ${work} --batch ${b.batch}; ${rmTmp(`gate-${b.batch}`, b.batch)}\`: the saved cycles describe code just removed, a later run starts the batch over; the patch alone is kept.`,
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
  if (next.kind === 'PAUSED') { stop = 'paused by user'; log('⏸ paused by user between two batches'); break }
  if (next.kind !== 'BATCHES') { stop = next.line; break }

  const b = next.batches.find(x => samePath(x.repo, pre.root))
  if (!b) {
    stop = `batches of another repo (${next.batches.map(x => `${x.batch} ${x.repo}`).join(', ')}): run run-plan from that repo`
    break
  }
  if (next.batches.length > 1) log(`${next.batches.filter(x => x !== b).map(x => x.batch).join(', ')} in another repo, not launched here`)

  if (next.outsideBatch === b.batch && next.outsidePaths.length) {
    toReview.push({ batch: b.batch, step: 'Start', text: `files modified outside the batch at launch, left out of the batch diff and commit: ${next.outsidePaths.join(', ')}` })
  }

  log(`→ ${b.batch} launched`)
  const result = await workflow('cctoolkit:run-lot', { sheet: slashed(b.sheet), commit: false }).catch(e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null }))
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
    if (aside.length >= 2) {
      const b2 = await checkBreaker()
      const decision = b2 && b2.commonCause ? 'stop' : 'continue'
      await agent(`${FRAME}\n\nOne call, nothing else:\n\n${breakerLine(decision, b2)}`, { schema: obj({ ok: bool }), phase: 'Aside', label: 'breaker line', ...SHELL }).catch(() => null)
      if (decision === 'stop') {
        breaker = b2
        stop = `common cause across the batches set aside (${b2.batches.join(', ') || aside.map(x => x.batch).join(', ')}): ${b2.cause}`
        log(`breaker: ${stop}`)
        await journal(`⛔ ${stop}`)
        break
      }
      log(`breaker: ${aside.length} batches set aside, distinct causes — plan goes on`)
    }
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

// One security pass over what the plan committed, read-only, never a stop: the audits judge a batch
// against its sheet, none looks at the plan's changes for what an attacker can reach.
const SECURITY = obj({ findings: arr(obj({ severity: { type: 'string', enum: ['Blocking', 'Major'] }, finding: str, evidence: str, fix: str })) })
const committed = ran.map(r => (/\bcommitted ([0-9a-f]{4,40}):/.exec(r.commit || '') || [])[1]).filter(Boolean)
const security = committed.length
  ? await (phase('Security'), agent(
      [
        'Workflow run-plan, security pass after the last batch. Autonomous mode: nobody answers. Read-only: never edit, never a Git command that writes, never build nor run a test. Return the findings through the structured output; prose follows `language.docs` of `kit.config.json`.',
        '',
        `Batch commits of the plan: ${committed.join(' ')}. Read them with \`git show --stat <commit>\`, then bounded \`git show <commit> -- <path>\` on production files only, never tests.`,
        'Look only for security defects these changes bring: authorisation missing, or checked on mere existence instead of the relationship that grants it; a resource of another organisation reachable; injection (SQL, command, path); a secret or personal data written to a log, a response or the repo; input reaching a query, a file path or an external call unvalidated; an unbounded read an anonymous caller can trigger.',
        'Each finding: `severity` Blocking (exploitable as written) or Major (exploitable under an assumption you name), `finding` one line, `evidence` `path:line`, `fix` one line. No evidence, no finding; hardening wishes and style are not findings. Nothing found → `findings` empty.',
      ].join('\n'),
      { schema: SECURITY, phase: 'Security', label: 'security', model: 'sonnet', effort: 'medium' },
    ).catch(() => null))
  : null
if (committed.length && !security) toReview.push({ batch: '—', step: 'Security', text: 'security pass without result: run /security-review on the plan commits' })
for (const f of security ? security.findings : []) toReview.push({ batch: '—', step: 'Security', text: `${f.severity} — ${f.finding}`, why: `${f.evidence} ; proposed fix: ${f.fix}` })
if (security && security.findings.length) log(`security: ${security.findings.length} finding(s) to validate`)

// The base changes once per feature, when its plan is delivered whole: the merge is drafted and
// staged here, autonomously, and written only by /cctoolkit:knowledge-merge on the user's word.
// A stop, a batch set aside or a partial scope leaves the spec under todo/ for the run that ends it.
let merge = null
if (!reason && !scope && ran.some(r => r.status === DONE)) {
  phase('Merge')
  const prep = await agent(
    [
      FRAME,
      '',
      `One call: \`cctoolkit knowledge-merge prepare ${pre.plan} 2>&1; echo "exit=$?"\`.`,
      '`exit` = the code on the last line; `nothing` = the line starting `nothing to merge: `, empty when none; `refused` = every line starting `refused: ` or `collision: `, verbatim.',
    ].join('\n'),
    { schema: PREPARED, phase: 'Merge', label: 'merge prepare', ...SHELL },
  ).catch(() => null)
  const skill = `/cctoolkit:knowledge-merge ${words[0]}`
  if (!prep) merge = { state: 'failed', lines: ['prepare agent without result'], next: skill }
  else if (prep.exit === 0 && prep.nothing) merge = { state: 'nothing', lines: [prep.nothing] }
  else if (prep.exit !== 0) merge = { state: 'refused', lines: prep.refused.length ? prep.refused : [`exit=${prep.exit}`], next: skill }
  else {
    const m = await agent(
      [
        'Workflow run-plan, knowledge-base merge after the last batch. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes, never `cctoolkit knowledge-write`: the user confirms the merge after the run. Return the report fields through the structured output.',
        '',
        `plan: ${pre.plan} · partial: no`,
        '`staged` true with `## MERGE STAGED`: `stagedLine` = the `staged:` line, `files` = the `+n −n <file>` lines, `warnings` = the `WARN` lines left, `blocked` empty. `## BLOCKED`: `staged` false, `blocked` = the cause, `files` = its output lines.',
      ].join('\n'),
      { agentType: 'cctoolkit:knowledge-merger', schema: MERGED, phase: 'Merge', label: 'merge draft' },
    ).catch(e => ({ staged: false, stagedLine: '', files: [], warnings: [], blocked: `knowledge-merger failed: ${e.message}` }))
    merge = m && m.staged
      ? { state: 'staged', lines: [m.stagedLine, ...m.files], warnings: m.warnings, next: skill }
      : { state: 'blocked', lines: [m ? m.blocked : 'agent without result', ...(m ? m.files : [])], next: skill }
  }
  if (merge.state !== 'nothing') {
    log(`knowledge base: merge ${merge.state}${merge.next ? ` — ${merge.next}` : ''}`)
    await journal(`knowledge base: merge ${merge.state} — ${merge.lines[0]}`)
  }
  if (merge.state === 'refused' || merge.state === 'blocked' || merge.state === 'failed') {
    toReview.push({ batch: '—', step: 'Knowledge base', text: `merge not staged: ${merge.lines.join(' ; ')} — ${merge.next}` })
  }
}

phase('Report')
if (!ran.length) {
  await agent(
    `${FRAME}\n\nNo batch ran: in one call, \`cctoolkit run-work drop ${work} --run ${pre.stamp}; ${rmTmp('final')}; command -v osascript >/dev/null && osascript -e 'display notification "${`Plan stopped — ${reason || 'no batch launched'}`.replace(/["'\\]/g, '')}" with title "run-plan"' || true\`.`,
    { schema: obj({ ok: bool }), phase: 'Report', label: 'cleanup', ...SHELL },
  )
  return { status: reason ? BLOCKED : DONE, reason: reason || '—', report: null, batches: [] }
}
const payload = JSON.stringify({ plan: pre.plan, scope: scope || 'whole plan', report: reportFile, stop: reason, batches: ran, aside, finalCheck: finalCheck ? finalCheck.suites : null }, null, 1)
const review = JSON.stringify({ stop: reason, breaker, merge, toReview, audits: ran.filter(r => r.audit).map(r => ({ batch: r.batch, audit: r.audit, report: r.report })), hypotheses: ran.flatMap(r => r.hypotheses.map(h => ({ batch: r.batch, h }))) }, null, 1)
const rep = await agent(
  [
    FRAME,
    '',
    `First, one call: \`cctoolkit run-work journal ${work} ${pre.stamp}\`: the journal of the run, one line each.`,
    `Write \`${reportFile}\` in a single Write, headings verbatim, prose in the docs language of \`kit.config.json\`, from the two JSON below, without reading code, tests or batch reports. Header: plan, scope, start time = the \`start\` line of the journal, end time = \`date '+%Y-%m-%d %H:%M'\`. Then, in this order:`,
    '- table `| Batch | Status | Report | Commit | Patch |`, one row per batch of the first JSON, `Commit` = the hash `commit` starts with (`—` when absent)',
    ...(breaker ? ['- `## Plan stopped — common cause` — from `breaker` of the second JSON: the cause, the batches it reached, what to fix in the spec or the plan before relaunching (`fixBeforeRelaunch`), then the relaunch: a new `/run-plan` skips the batches ✅ DONE'] : []),
    `- \`## To validate\` — from the second JSON, everything the run decided without the user (marked \`${TO_REVIEW}\`), to review after the plan, one \`###\` per kind: \`### Stop\` (\`stop\` verbatim, only when not null), \`### Batches set aside\` (\`toReview\` entries of step \`Set aside\`), \`### Start\` (\`toReview\` entries of step \`Start\`), \`### Final check\` (\`toReview\` entries of step \`Final check\`), \`### Security\` (\`toReview\` entries of step \`Security\`),\`### Audits to redo\` (\`audit\` = \`to redo\`: batch, report, command \`/verify-ddd-tdd batch FX\`), \`### Audit gaps carried\` (\`toReview\` entries of step \`Audit\`, and \`audit\` = \`GAPS carried\`), \`### Arbiter and design decisions\` (other \`toReview\` entries, step and why kept), \`### Assumptions\` (every \`h\`). One bullet per entry, prefixed by its batch; \`None.\` for an empty section.`,
    '- `## Minor` — every minor of the first JSON, prefixed by its batch; `None.` when none',
    '- `## Final check` — table `| Suite | Exit | Failed tests |` from `finalCheck`; `Not run.` when `finalCheck` is null',
    '- `## Knowledge base` — from `merge` of the second JSON: `state` staged → its `lines` verbatim one bullet each, then its `warnings`, then the line `Staged, not written: <next> shows the diff and writes it on confirmation.`; refused, blocked or failed → its `lines` verbatim, then `Not staged: <next>.`; nothing → its line verbatim; `merge` null → `Not run.`',
    '- `## Journal` — the journal lines verbatim, in order',
    `\`lastLine\` = \`Plan stopped — <stop>\` when stop is not null, else \`Plan done — review of ${reportFile} required.\`${finalRed.length ? `, followed by \` — final check red: ${finalRed.map(x => x.name).join(', ')}\`` : ''}${merge && merge.state === 'staged' ? ', followed by ` — knowledge base merge staged`' : ''}.`,
    `Then one call: \`cctoolkit run-work drop ${work} --run ${pre.stamp}; ${rmTmp('final')}; command -v osascript >/dev/null && osascript -e 'display notification "<lastLine, double quotes removed>" with title "run-plan"' || true\` (the journal of the run, now copied into the report).`,
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

const RESTART = `A blocked batch never ends the plan: its partial work is saved as \`run/<stamp>-aside-FX.patch\`, the tree goes back to the last batch commit (files the user modified before the batch left as they are), its saved cycles are cleared and the plan goes on with every batch that does not depend on it; \`${BLOCKED}\` here means batches were set aside (listed in \`setAside\` with their dependents) or the run met a technical stop (\`reason\`). The arbiter settles what it can, a question waits 10 min then takes its recommendation, so a batch is set aside for a technical stop, a production Blocking the audit fixes did not lift, a \`STOP\` answer, a question without answer nor recommendation, a step still stopped after its last attempt, or a gate still red after its repair. From the second batch set aside, an arbiter compares the reasons: a cause shared with an earlier one stops the plan, named under \`## Plan stopped — common cause\` of the run report with what to fix in the spec or the plan first. Fix the cause (reapply the patch with \`git apply\` to keep the partial work), write the decision into \`decisions\` of the cycles it touches in the \`## Cycles\` block of the batch sheet (and as \`Hn\` marked \`${USER}\`), then launch a new run-plan: batches ✅ DONE are skipped. A pause asked from the run-lot-pane mod stops the plan between two batches (\`paused by user\`): a new run-plan goes on from there. Never \`resumeFromRunId\`: replay re-runs finished work.`

return {
  status: reason ? BLOCKED : DONE,
  reason: reason || '—',
  report: rep ? rep.path : null,
  ...(reason ? { setAside: aside.map(x => ({ batch: x.batch, reason: x.reason, patch: x.patch, dependents: x.dependents })), next: RESTART } : {}),
  batches: ran.map(r => ({ batch: r.batch, status: r.status, hypotheses: r.hypotheses.length, minors: r.minors.length })),
  finalCheck: finalCheck ? finalCheck.suites.map(x => ({ name: x.name, exit: x.exit, failed: x.failed.length })) : null,
  ...(merge && merge.state !== 'nothing' ? { merge: { state: merge.state, lines: merge.lines, warnings: merge.warnings || [], next: `${merge.next} — the knowledge base is not written yet: it shows the diff and writes it on the user's confirmation` } } : {}),
}
