export const meta = {
  name: 'run-plan',
  description: 'Whole plan, autonomous: run-lot on every runnable batch in dependency order, gate read from disk after each, run report',
  whenToUse: 'Implement every batch of a global plan without human intervention. Argument: path of the global plan `todo/<code>/<CODE>-PLAN.md`, optionally followed by `--until FX` or `--only FX`.',
  phases: [
    { title: 'Preflight', detail: 'plan check, doctor, docker, build green, kit root, run stamp, old runs and orphan scratch folders removed' },
    { title: 'Batch', detail: 'next batch, out-of-batch check and journal in one call, run-lot; run.parallelBatches 2: an independent batch beside it, in a worktree of its own, long builds under build-lock' },
    { title: 'Gate', detail: 'report status, plan heading, build green, one repair, batch commit, journal; a worktree batch committed there, landed on the checkout, its build checked once landed — a conflict or a red build reruns it alone' },
    { title: 'Aside', detail: 'blocked batch: partial work saved under a git ref (and a patch to read), its saved cycles kept, tree restored to the batch start, dependents skipped — the next run puts the work back and resumes; from the second, an arbiter looks for a cause common to the batches set aside — one stops the plan' },
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

const PREFLIGHT = obj({ ok: bool, failure: str, plan: str, root: str, kit: str, runRoot: str, stamp: str, parallel: int }, ['parallel'])
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
const FINAL = obj({ suites: arr(obj({ name: str, exit: int, failed: arr(str), last: arr(str) }, ['last'])) })
const BREAKER = obj({ commonCause: bool, cause: str, batches: arr(str), fixBeforeRelaunch: str })
const PREPARED = obj({ exit: int, nothing: str, refused: arr(str) })
const MERGED = obj({ staged: bool, stagedLine: str, files: arr(str), warnings: arr(str), blocked: str })
const PAIR = obj({ batches: arr(obj({ batch: str, repo: str, sheet: str })), apart: arr(obj({ batch: str, reason: str })) })
const WORKTREE = obj({ ok: bool, path: str, detail: str })
const LANDED = obj({ landed: bool, commit: str, from: str, detail: str })
// A whole IntegrationTests run measured 602 s downstream (2026-09-10): past 25 min the suite hangs.
const FINAL_TIMEOUT_MIN = 25

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
    '2. First, one call: `cctoolkit docker-up --wait 0 || true` (Docker Desktop boots during the build, no wait loop).',
    '   Then in one message, from `root`: `cctoolkit plan-next-batch <plan> --check`, `cctoolkit doctor --quiet`, `cctoolkit config parallel-batches` (→ `parallel`, 1 when it fails) and `cctoolkit config command build`, the build configured by kit-init (`commands.build`, empty for a stack without one).',
    '   Then one call, from `root` (timeout 600000): the printed build command run literally, never through `eval` (the Bash guards read the command text) — `f=$(mktemp); <printed command> > "$f" 2>&1; echo "build=$?"; grep -m1 -iE \'(^|[^a-z])error([^a-z]|$)\' "$f"; rm -f "$f"`, nothing printed → `echo build=none` in its place —, followed by `; cctoolkit docker-up --wait 120`.',
    '3. `--check` exit ≠ 0, a doctor `FAIL` line, a `docker=` line other than `docker=ready…` or `docker=absent`, or `build` neither 0 nor `none` → `ok: false`, `failure` = the failing line verbatim (for the build: `build=<code>` followed by the first error line, the working tree must compile before any batch starts), `runRoot` and `stamp` empty, stop. No test suite runs here: each batch runs the tests its diff reaches, in its own global green.',
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

// A batch run beside another, in a worktree of its own (`run.parallelBatches`): its gate, repair, commit and
// setting aside run in that tree `at` — each Bash call opens with the prefix run-lot gives the batch's agents.
const rootOf = () => slashed(pre.root).replace(/\/$/, '')
const inTree = (path, at) => (at && slashed(path).toLowerCase().startsWith(`${rootOf().toLowerCase()}/`) ? `${at}${slashed(path).slice(rootOf().length)}` : path)
const treeLine = at => (at ? `\n\nBatch worktree: \`${at}\`, not the session's checkout. Every Bash call opens with \`cd '${at}' && export CLAUDE_PROJECT_DIR='${at}' &&\`; Read and Edit take absolute paths under it.` : '')

function gate(b, result, round, at = null) {
  return agent(
    [
      FRAME + treeLine(at),
      '',
      `Gate of batch ${b.batch}, every check read from disk, never from a previous agent's words.`,
      `1. First line of \`${result.report}\` → \`statusLine\`; \`grep -m1 -E '^Verdict ?:'\` of it → \`verdictLine\`.`,
      `2. \`grep -nE "^### (Batch|Lot) ${b.batch}\\b" ${inTree(pre.plan, at)}\` → \`planDone\` = the heading carries \`✅ DONE\`.`,
      `3. \`cctoolkit config command build\` prints the solution build: run it once, literally (never \`eval\`), \`<printed command> > ${tmpOf(`gate-${b.batch}`)}/build.txt 2>&1; echo "build=$?"\` → \`build\`; nothing printed → \`build\` = 0. No test suite: run-lot's global green already ran the tests the batch diff reaches.`,
    ].join('\n'),
    { schema: GATE, phase: 'Gate', label: `gate ${b.batch}${round === 'landed' ? ' landed' : round ? ' again' : ''}`, ...SHELL },
  )
}

function repair(b, failures, at = null) {
  return agent(
    [
      `Workflow run-plan, gate repair after batch ${b.batch}. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git commit. Return the result through the structured output; prose follows \`language.docs\` of \`kit.config.json\`.${treeLine(at)}`,
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

function seal(b, done, at = null) {
  return agent(
    [
      FRAME + treeLine(at),
      '',
      `Batch ${b.batch} passed its gate. One call: \`cctoolkit batch-baseline commit ${work} ${b.batch} --sheet ${b.sheet}; echo "exit=$?"\`.`,
      'exit 0 → `ok: true`; otherwise `ok: false`. `commit` = the output verbatim, stderr included.',
      `Then one call: \`cctoolkit run-work drop ${work} --batch ${b.batch} --kind preexisting,question,answer; ${rmTmp(`gate-${b.batch}`, b.batch)}\`, then \`${journalLine(done)}\`.`,
    ].join('\n'),
    { schema: SEALED, phase: 'Gate', label: `commit ${b.batch}`, ...SHELL },
  ).catch(() => null)
}

function setAside(b, reason, at = null) {
  const patch = patchOf(b.batch)
  return agent(
    [
      FRAME + treeLine(at),
      '',
      `Batch ${b.batch} is set aside: ${reason}. Put the tree back to its state at the batch start, in this order:`,
      `1. \`cctoolkit batch-baseline restore ${work} ${b.batch} --save ${patch}\` (the script alone touches the source and test roots; it keeps the work under a git ref, or drops the saved cycles when it could not). Exit ≠ 0 → \`ok: false\`, \`detail\` = its output verbatim, stop.`,
      `2. \`cctoolkit run-work drop ${work} --batch ${b.batch} --kind question,answer; ${rmTmp(`gate-${b.batch}`, b.batch)}\`: the saved cycles and the snapshot stay — the next run puts the work back (\`cctoolkit batch-baseline resume\`) and resumes the batch from them.`,
      `3. \`grep -nE "^### (Batch|Lot) ${b.batch}\\b" ${inTree(pre.plan, at)}\`: the heading carries \`✅ DONE\` → one Edit putting \`⬜\` in place of \`✅ DONE\` and its date, nothing else moves.`,
      `4. \`${journalLine(`${b.batch} ✗ — set aside — ${reason} — patch ${patch}`)}\`.`,
      '`ok: true`, `detail` = the last line the restore printed.',
    ].join('\n'),
    { schema: OK, phase: 'Aside', label: `aside ${b.batch}`, ...SHELL },
  ).catch(() => null)
}

// `run.parallelBatches` 2: the next runnable batch and one independent of it (`plan-next-batch --parallel`: no
// dependency between them, the paths of their `## Cycles` blocks disjoint) run at once, the second in a worktree
// of its own (`cctoolkit batch-worktree`), their long builds one at a time (`cctoolkit build-lock`). Then, one
// after the other: the checkout's batch gated and committed as when it runs alone; the worktree's gated and
// committed there, landed on the checkout (rebased, fast-forwarded), its build checked once landed. A conflict
// or a red build once landed discards that result: it runs again alone in the checkout. 1: one batch at a time.
// `cctoolkit config parallel-batches` caps the setting (lib/kit_config.py); two is the shape of `runPair`.
const PARALLEL = Number(pre.parallel) > 1 ? 2 : 1
const serialOnly = new Set()
let paired = false

function record(b, result, together = null) {
  const entry = { batch: b.batch, status: result.status, reason: result.reason, report: result.report, audit: result.audit || null, hypotheses: result.hypotheses || [], minors: result.minors || [], ...(together ? { with: together } : {}) }
  ran.push(entry)
  for (const x of result.toReview || []) toReview.push({ batch: b.batch, ...x })
  return entry
}

// The gate of a finished batch, one repair when its build is red: the failure, or null.
async function gated(b, result, at = null) {
  phase('Gate')
  let g = await gate(b, result, 0, at)
  let failure = gateFailure(g)
  let fresh = failure ? [] : newFailures(g.build)
  if (fresh.length) {
    log(`${b.batch}: gate red (${fresh.join(', ')}), one repair`)
    const fix = await repair(b, fresh, at)
    if (fix) toReview.push({ batch: b.batch, step: 'Gate', text: `repaired after the batch, outside TDD: ${fresh.join(', ')} → ${fix.fixed.join(' ; ')}`, why: fix.files.join(', ') })
    g = await gate(b, result, 1, at)
    failure = gateFailure(g)
    fresh = failure ? [] : newFailures(g.build)
  }
  if (!failure && fresh.length) failure = `gate red after repair: ${fresh.join(', ')}`
  else if (failure) failure = `gate: ${failure}`
  return failure
}

// A batch whose run or gate failed is set aside — in its worktree `at`, only that tree. True when the plan stops.
async function putAside(b, result, entry, failure, at = null) {
  entry.status = result.status === DONE ? 'GATE RED' : result.status
  phase('Aside')
  const back = await setAside(b, failure, at)
  if (!at && (!back || !back.ok)) {
    stop = `${b.batch} — ${failure} — tree not restored: ${back ? back.detail : 'agent without result'}`
    await journal(`${b.batch} ✗ — ${stop}`)
    return true
  }
  entry.patch = patchOf(b.batch)
  aside.push({ batch: b.batch, reason: failure, patch: entry.patch, report: result.report || null, restored: back ? back.detail || '' : '' })
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
      return true
    }
    log(`breaker: ${aside.length} batches set aside, distinct causes — plan goes on`)
  }
  return false
}

async function sealed(b, entry, at = null) {
  const s = await seal(b, `${b.batch} ✅ — Hn: ${entry.hypotheses.length}, Minor: ${entry.minors.length}`, at)
  entry.commit = s ? s.commit : null
  if (!s || !s.ok) toReview.push({ batch: b.batch, step: 'Gate', text: `batch commit failed, the batch stays uncommitted in the tree: ${s ? s.commit : 'agent without result'}` })
  else if (/committed whole/.test(s.commit)) toReview.push({ batch: b.batch, step: 'Gate', text: s.commit })
  if (!at) log(`→ ${b.batch} ✅ (${ran.length})${s && s.ok ? ` — ${s.commit.split(':')[0]}` : ' — not committed'}`)
  return s
}

// The batch that may run beside `b`, or null: the second of `plan-next-batch --parallel` when its first is `b`.
async function partnerOf(b) {
  const skip = aside.length ? ` --skip ${aside.map(x => x.batch).join(',')}` : ''
  const g = await agent(
    [
      FRAME,
      '',
      `Run \`cctoolkit plan-next-batch ${pre.plan}${scope ? ' ' + scope : ''}${skip} --parallel ${PARALLEL}\`.`,
      'Exit 0 → it printed one JSON line: `batches` and `apart` = its fields as-is. Exit ≠ 0 → both empty.',
    ].join('\n'),
    { schema: PAIR, phase: 'Batch', label: 'pair', ...SHELL },
  ).catch(() => null)
  const [first, second] = g ? g.batches : []
  if (!first || first.batch !== b.batch || !second || serialOnly.has(second.batch) || !samePath(second.repo, pre.root)) return null
  return second
}

async function worktreeFor(p) {
  const w = await agent(
    [
      FRAME,
      '',
      `One call, Bash timeout 600000: \`cctoolkit batch-worktree create ${p.batch} --plan ${pre.plan} --sheet ${slashed(p.sheet)}\`.`,
      'Exit 0 → it printed one JSON line: `ok` true, `path` = its `path`, `detail` empty. Otherwise `ok` false, `path` empty, `detail` = its `refused` field, else its output verbatim.',
    ].join('\n'),
    { schema: WORKTREE, phase: 'Batch', label: `worktree ${p.batch}`, ...SHELL },
  ).catch(() => null)
  if (w && w.ok && w.path) return slashed(w.path).replace(/\/$/, '')
  log(`${p.batch}: no worktree (${w ? w.detail : 'agent without result'}) — one batch at a time`)
  return null
}

function treeCall(label, lines) {
  return agent([FRAME, '', ...lines].join('\n'), { schema: OK, phase: 'Gate', label, ...SHELL }).catch(() => null)
}

// The worktree's result is dropped: the checkout put back when it had landed, the batch's lines removed from the
// work file (its cycles describe code the checkout does not hold); it runs again alone in the checkout.
async function discard(p, entry, why, undoTo = null) {
  entry.status = 'DISCARDED'
  entry.reason = why
  entry.commit = null
  serialOnly.add(p.batch)
  const done = await treeCall(`discard ${p.batch}`, [
    `Batch ${p.batch}, run in a worktree beside another, is discarded: ${why}. In this order:`,
    ...(undoTo ? [`- \`cctoolkit batch-worktree undo ${p.batch} --to ${undoTo}\`. Exit ≠ 0 → \`ok: false\`, \`detail\` = its output verbatim, stop.`] : []),
    `- \`cctoolkit run-work drop ${work} --batch ${p.batch}\`, then \`${journalLine(`${p.batch} ↺ — discarded, runs again alone — ${why}`)}\`.`,
    '`ok: true`, `detail` empty.',
  ])
  if (undoTo && (!done || !done.ok)) {
    stop = `${p.batch} landed red and not undone: ${done ? done.detail : 'agent without result'}`
    await journal(`${p.batch} ✗ — ${stop}`)
    return
  }
  toReview.push({ batch: p.batch, step: 'Start', text: `run in a worktree beside ${entry.with}, its result discarded (${why}): run again alone in the checkout` })
  log(`→ ${p.batch} discarded — ${why}; it runs again alone`)
}

// The worktree's batch, gate passed: committed there, landed on the checkout, its build checked once landed.
async function landed(p, result, entry, at) {
  const s = await sealed(p, entry, at)
  if (!s || !s.ok) return discard(p, entry, `batch commit in its worktree failed: ${s ? s.commit : 'agent without result'}`)
  const l = await agent(
    [
      FRAME,
      '',
      `One call: \`cctoolkit batch-worktree land ${p.batch}\`.`,
      'It printed one JSON line: `landed`, `commit` and `from` = its fields, empty when absent; `detail` = its `conflict` paths joined by `, `, else its `refused`, empty when landed.',
    ].join('\n'),
    { schema: LANDED, phase: 'Gate', label: `land ${p.batch}`, ...SHELL },
  ).catch(() => null)
  if (!l || !l.landed) return discard(p, entry, `not landed on the checkout: ${l ? l.detail : 'agent without result'}`)
  entry.commit = `committed ${l.commit}: landed from its worktree`
  const g = await gate(p, result, 'landed')
  const red = gateFailure(g) || newFailures(g.build).join(', ')
  if (red) return discard(p, entry, `red once landed: ${red}`, l.from)
  log(`→ ${p.batch} ✅ (${ran.length}) — ${l.commit}, landed from its worktree`)
}

async function runPair(b, p, at) {
  paired = true
  log(`→ ${b.batch} and ${p.batch} launched together — ${p.batch} in ${at}`)
  await journal(`${b.batch} ∥ ${p.batch} — run together, ${p.batch} in worktree ${at}`)
  const failed = e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null })
  const [ra, rb] = await Promise.all([
    workflow('cctoolkit:run-lot', { sheet: slashed(b.sheet), commit: false, lock: true }).catch(failed),
    workflow('cctoolkit:run-lot', { sheet: inTree(p.sheet, at), commit: false, root: at, run: runRoot, lock: true }).catch(failed),
  ])
  const ea = record(b, ra, p.batch)
  const eb = record(p, rb, b.batch)
  let failure = ra.status !== DONE || !ra.report ? `${ra.status} — ${ra.reason}` : null
  if (!failure) failure = await gated(b, ra)
  let halt = failure ? await putAside(b, ra, ea, failure) : (await sealed(b, ea), false)
  failure = rb.status !== DONE || !rb.report ? `${rb.status} — ${rb.reason}` : null
  if (!failure) failure = await gated(p, rb, at)
  if (failure) halt = (await putAside(p, rb, eb, failure, at)) || halt
  else await landed(p, rb, eb, at)
  await treeCall(`remove ${p.batch}`, [`One call: \`cctoolkit batch-worktree remove ${p.batch}\`. \`ok\` = exit 0, \`detail\` = its output.`])
  if (halt || stop) return true
  return !!stop
}

while (!stop) {
  phase('Batch')
  const next = await nextBatches()
  if (!next) { stop = 'plan-next-batch without result'; break }
  held = next.held || []
  if (next.kind === 'END') break
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

  const partner = PARALLEL > 1 && !serialOnly.has(b.batch) ? await partnerOf(b) : null
  const at = partner ? await worktreeFor(partner) : null
  if (at) {
    if (await runPair(b, partner, at)) break
    continue
  }

  log(`→ ${b.batch} launched`)
  const result = await workflow('cctoolkit:run-lot', { sheet: slashed(b.sheet), commit: false }).catch(e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null }))
  const entry = record(b, result)

  let failure = result.status !== DONE || !result.report ? `${result.status} — ${result.reason}` : null
  if (!failure) failure = await gated(b, result)

  if (failure) {
    if (await putAside(b, result, entry, failure)) break
  } else await sealed(b, entry)

}

for (const x of aside) {
  x.dependents = dependentsOf(x.batch, held)
  const ref = (/, ref: (\S+)/.exec(x.restored || '') || [])[1]
  const kept = ref ? ` — partial work kept under \`${ref}\` (patch \`${x.patch}\`), put back by the next run, which resumes from the saved cycles`
    : x.patch ? ` — partial work: \`${x.patch}\` (\`git apply\` to take it back), the next run starts the batch over` : ''
  toReview.push({ batch: x.batch, step: 'Set aside', text: `${x.reason}${kept}${/left \(/.test(x.restored || '') ? ` — ${x.restored}` : ''} — dependents not launched: ${x.dependents.length ? x.dependents.join(', ') : 'none'}` })
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
        `1. One call: \`cctoolkit suites-plan --final ${pre.stamp}\`. It prints \`suites\` (each with \`name\`, \`job\`, \`start\`, \`log\`) and \`notRun\`: copy each line literally, never rebuild nor \`eval\` one — the suite's env prefix, the integration guard's \`KIT_FINAL_CHECK=1\` marker and the Docker start are in it. \`suites\` empty → \`suites\` empty, stop.`,
        '2. Every `start` line in a single message, one Bash call each: each suite runs detached, a `cctoolkit bg` job.',
        `3. Then each job in turn, Bash timeout 600000: \`cctoolkit bg wait <job> --seconds 540\`. It prints \`DONE exit=<n>\`, \`FAILED exit=<n>\` (\`exit=none\`: the process died without an exit code) or \`RUNNING <seconds>s\`. \`RUNNING\` under ${FINAL_TIMEOUT_MIN * 60} s → the same call again; ${FINAL_TIMEOUT_MIN * 60} s or more → \`cctoolkit bg stop <job>\`, that suite's \`exit\` = 124. No other wait loop, no \`sleep\`.`,
        '4. One entry per suite: `name`, `exit` = the code `bg wait` printed (`exit=none` → 125), `failed` = for an exit other than 0, the lines `cctoolkit suites-plan --failed <log>` prints, those calls in one message; empty for a green suite. A suite at 124 also gets `last` = the lines `cctoolkit bg log <job> --lines 8` prints (the log fills test by test: they name the test the suite stopped on). Never open a log beyond that.',
      ].join('\n'),
      { schema: FINAL, phase: 'Final check', label: 'final check', ...SHELL },
    ).catch(() => null))
  : null
const finalRed = finalCheck ? finalCheck.suites.filter(x => x.exit !== 0) : []
if (finalCheck === null && ran.some(r => r.status === DONE) && !scope.startsWith('--only')) toReview.push({ batch: '—', step: 'Final check', text: 'final check agent without result: suites not run whole' })
for (const x of finalRed) toReview.push({ batch: '—', step: 'Final check', text: `${x.name} exit=${x.exit}${x.exit === 124 ? ` (stopped after ${FINAL_TIMEOUT_MIN} min)` : ''}${x.failed.length ? `: ${x.failed.join(', ')}` : ''} — not attributed: a batch of this run or a failure already on the starting tree; log: \`cctoolkit bg log final-${pre.stamp}-${x.name} --lines 40\``, why: (x.last || []).join(' / ') })
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
// What run-lot logged as decided alone (`info`) stays in its batch report: here, a count per batch.
const decidedAlone = Object.entries(toReview.filter(x => x.info).reduce((n, x) => ({ ...n, [x.batch]: (n[x.batch] || 0) + 1 }), {})).map(([batch, n]) => ({ batch, n }))
const review = JSON.stringify({ stop: reason, breaker, merge, toReview: toReview.filter(x => !x.info), decidedAlone, audits: ran.filter(r => r.audit).map(r => ({ batch: r.batch, audit: r.audit, report: r.report })), hypotheses: ran.flatMap(r => r.hypotheses.map(h => ({ batch: r.batch, h }))) }, null, 1)
const rep = await agent(
  [
    FRAME,
    '',
    `First, one call: \`cctoolkit run-work journal ${work} ${pre.stamp}\`: the journal of the run, one line each.`,
    `Write \`${reportFile}\` in a single Write, headings verbatim, prose in the docs language of \`kit.config.json\`, from the two JSON below, without reading code, tests or batch reports. Header: plan, scope, start time = the \`start\` line of the journal, end time = \`date '+%Y-%m-%d %H:%M'\`. Then, in this order:`,
    '- table `| Batch | Status | Report | Commit | Patch |`, one row per batch of the first JSON, `Commit` = the hash `commit` starts with (`—` when absent)',
    ...(paired ? ['- in that table, a batch carrying `with` gets ` ∥ <with>` after its status: the two ran together, the second listed in a worktree of its own, then landed on the checkout or `DISCARDED` and run again alone'] : []),
    ...(breaker ? ['- `## Plan stopped — common cause` — from `breaker` of the second JSON: the cause, the batches it reached, what to fix in the spec or the plan before relaunching (`fixBeforeRelaunch`), then the relaunch: a new `/run-plan` skips the batches ✅ DONE'] : []),
    `- \`## To validate\` — from the second JSON, everything the run decided without the user (marked \`${TO_REVIEW}\`), to review after the plan, one \`###\` per kind: \`### Stop\` (\`stop\` verbatim, only when not null), \`### Batches set aside\` (\`toReview\` entries of step \`Set aside\`), \`### Start\` (\`toReview\` entries of step \`Start\`), \`### Final check\` (\`toReview\` entries of step \`Final check\`), \`### Security\` (\`toReview\` entries of step \`Security\`),\`### Audits to redo\` (\`audit\` = \`to redo\`: batch, report, command \`/verify-ddd-tdd batch FX\`), \`### Audit gaps carried\` (\`toReview\` entries of step \`Audit\`, and \`audit\` = \`GAPS carried\`), \`### Arbiter and design decisions\` (other \`toReview\` entries, step and why kept), \`### Assumptions\` (every \`h\`). One bullet per entry, prefixed by its batch; \`None.\` for an empty section. Last, when \`decidedAlone\` is not empty, one line after the sections: \`Decided alone, nothing to do: <total> — section Decided alone of the batch reports (<FX n, …>).\``,
    '- `## Minor` — every minor of the first JSON, prefixed by its batch; `None.` when none',
    '- `## Final check` — table `| Suite | Exit | Failed tests |` from `finalCheck`; `Not run.` when `finalCheck` is null',
    '- `## Knowledge base` — from `merge` of the second JSON: `state` staged → its `lines` verbatim one bullet each, then its `warnings`, then the line `Staged, not written: <next> shows the diff and writes it on confirmation.`; refused, blocked or failed → its `lines` verbatim, then `Not staged: <next>.`; nothing → its line verbatim; `merge` null → `Not run.`',
    '- `## Journal` — the journal lines verbatim, in order',
    `\`lastLine\` = \`Plan stopped — <stop>\` when stop is not null, else \`Plan done — review of ${reportFile} required.\`${finalRed.length ? `, followed by \` — final check red: ${finalRed.map(x => x.name).join(', ')}\`` : ''}${merge && merge.state === 'staged' ? ', followed by ` — knowledge base merge staged`' : ''}.`,
    `Then one call: \`cctoolkit run-work drop ${work} --run ${pre.stamp}; ${rmTmp('final')}; ${paired ? 'cctoolkit batch-worktree prune; ' : ''}command -v osascript >/dev/null && osascript -e 'display notification "<lastLine, double quotes removed>" with title "run-plan"' || true\` (the journal of the run, now copied into the report).`,
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

const RESTART = `A blocked batch never ends the plan: its partial work is kept under \`refs/cctoolkit/aside/<plan folder>/FX\` (and \`run/<stamp>-aside-FX.patch\` to read), the tree goes back to the last batch commit (files the user modified before the batch left as they are), its saved cycles stay and the plan goes on with every batch that does not depend on it; \`${BLOCKED}\` here means batches were set aside (listed in \`setAside\` with their dependents) or the run met a technical stop (\`reason\`). The arbiter settles what it can, a question waits 10 min then takes its recommendation, so a batch is set aside for a technical stop, a production Blocking the audit fixes did not lift, a \`STOP\` answer, a question without answer nor recommendation, a step still stopped after its last attempt, or a gate still red after its repair. From the second batch set aside, an arbiter compares the reasons: a cause shared with an earlier one stops the plan, named under \`## Plan stopped — common cause\` of the run report with what to fix in the spec or the plan first. Fix the cause: write the decision into \`decisions\` of the cycles it touches in the \`## Cycles\` block of the batch sheet (and as \`Hn\` marked \`${USER}\`), or answer in the run-lot-pane mod, then launch a new run-plan: batches ✅ DONE are skipped, a batch set aside gets its work back and resumes from its saved cycles (a file that no longer merges: it starts over, listed to validate). Never \`resumeFromRunId\`: replay re-runs finished work.`

return {
  status: reason ? BLOCKED : DONE,
  reason: reason || '—',
  report: rep ? rep.path : null,
  ...(reason ? { setAside: aside.map(x => ({ batch: x.batch, reason: x.reason, patch: x.patch, dependents: x.dependents })), next: RESTART } : {}),
  batches: ran.map(r => ({ batch: r.batch, status: r.status, hypotheses: r.hypotheses.length, minors: r.minors.length, ...(r.with ? { with: r.with } : {}) })),
  finalCheck: finalCheck ? finalCheck.suites.map(x => ({ name: x.name, exit: x.exit, failed: x.failed.length })) : null,
  ...(merge && merge.state !== 'nothing' ? { merge: { state: merge.state, lines: merge.lines, warnings: merge.warnings || [], next: `${merge.next} — the knowledge base is not written yet: it shows the diff and writes it on the user's confirmation` } } : {}),
}
