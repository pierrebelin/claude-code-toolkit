export const meta = {
  name: 'run-plan',
  description: 'Whole plan, autonomous: run-lot on every runnable batch in dependency order, gate read from disk after each, run report',
  whenToUse: 'Implement every batch of a global plan without human intervention. Argument: path of the global plan `todo/<code>/<CODE>-PLAN.md`, optionally followed by `--until FX` or `--only FX`.',
  phases: [
    { title: 'Preflight', detail: 'plan check, doctor, docker, build green, kit root, run stamp, old runs and orphan scratch folders removed; every other repo of the plan in scope (Repo column): kit.config.json, branch rule, doctor, build; a repo that packs or pins a package: its commands and the local feed' },
    { title: 'Batch', detail: 'next batch, out-of-batch check and journal in one call, run-lot; run.parallelBatches 2: an independent batch beside it, in a worktree of its own, long builds under build-lock; a batch of another repo (Repo column): that repo put on the checkout\'s branch, plan folder carried there, run there beside the batch of the checkout; a batch consuming a package (F1(package)): pinned by run-lot to its producer\'s prerelease before its first cycle' },
    { title: 'Gate', detail: 'report status, plan heading, build green, one repair, a package producer packed into the local feed, batch commit, journal; a worktree batch committed there, landed on the checkout, its build checked once landed — a conflict or a red build reruns it alone; a batch of another repo gated and committed in that repo, its plan and sheet brought back' },
    { title: 'Aside', detail: 'blocked batch: partial work saved under a git ref (and a patch to read), its saved cycles kept, tree restored to the batch start, dependents skipped — the next run puts the work back and resumes; from the second, an arbiter looks for a cause common to the batches set aside — one stops the plan' },
    { title: 'Final check', detail: 'every test suite run whole once, integration included, after the last batch, in the checkout and in each other repo a batch was committed in: reported, never blocking' },
    { title: 'Security', detail: 'one read-only pass over the batch commits of the plan: findings listed for review, never blocking' },
    { title: 'Merge', detail: 'whole plan delivered, spec written against the knowledge base: its merge drafted by knowledge-merger from the spec delta and written by the run — a refusal leaves it staged, /cctoolkit:knowledge-merge shows it and writes it on confirmation' },
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

const REPO = obj({ repo: str, checkout: bool, batches: arr(str), pack: arr(str), use: arr(str) })
const PREFLIGHT = obj({ ok: bool, failure: str, plan: str, root: str, kit: str, runRoot: str, stamp: str, parallel: int, repos: arr(REPO), feed: str }, ['parallel', 'repos', 'feed'])
const NEXT = obj({
  kind: { type: 'string', enum: ['END', 'WAITING', 'BATCHES', 'ERROR'] },
  line: str,
  batches: arr(obj({ batch: str, repo: str, sheet: str, packageFrom: arr(obj({ batch: str, repo: str })), pack: bool }, ['packageFrom', 'pack'])),
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
const FAILURE_GROUP = obj({ message: str, tests: arr(str) })
const FINAL = obj({ suites: arr(obj({ name: str, exit: int, report: obj({ failed: int, total: int, listed: int, fromRunner: bool, setup: arr(FAILURE_GROUP), assertion: arr(FAILURE_GROUP) }, ['total']), last: arr(str), stalled: bool }, ['report', 'last', 'stalled'])) })
const BREAKER = obj({ commonCause: bool, cause: str, batches: arr(str), fixBeforeRelaunch: str })
const PREPARED = obj({ exit: int, nothing: str, refused: arr(str) })
const APPLIED = obj({ exit: int, lines: arr(str) })
const MERGED = obj({ staged: bool, stagedLine: str, files: arr(str), warnings: arr(str), blocked: str })
const PAIR = obj({ batches: arr(obj({ batch: str, repo: str, sheet: str })), apart: arr(obj({ batch: str, reason: str })) })
const WORKTREE = obj({ ok: bool, path: str, detail: str })
const LANDED = obj({ landed: bool, commit: str, from: str, detail: str })
const CARRIED = obj({ ok: bool, plan: str, outside: arr(str), carried: bool, detail: str, branch: str, switched: str }, ['branch', 'switched'])
const READY = obj({ ok: bool, failure: str, branch: str }, ['branch'])
const PACKED = obj({ ok: bool, version: str, detail: str })
const BROUGHT = obj({ ok: bool, back: arr(str), merged: arr(str), conflict: arr(str), kept: arr(str), detail: str })
// A whole IntegrationTests run measured 602 s downstream (2026-09-10): past 25 min the suite hangs.
const FINAL_TIMEOUT_MIN = 25
// A suite whose log has not grown for this long hangs: one line per test, a test past 5 min flagged
// (`commands.finalCheck`). 2026-10-26: IntegrationTests silent from minute 2, stopped at the ceiling, 23 min idle.
const FINAL_SILENT_MIN = 10

// One suite of the final check, counted once: the `To validate` entry, the `## Final check` table, the last line and
// the result all read these numbers. `failed` is the runner's (`suites-plan --failures`), never a count of relayed names.
const testsIn = groups => (groups || []).reduce((n, g) => n + g.tests.length, 0)
const finalCounts = x => ({
  failed: x.report ? x.report.failed : 0,
  total: x.report && Number.isInteger(x.report.total) ? x.report.total : null,
  listed: x.report ? x.report.listed : 0,
  didNotRun: x.report ? testsIn(x.report.setup) : 0,
  onTest: x.report ? testsIn(x.report.assertion) : 0,
})
const ofTotal = n => (n.total === null ? `${n.failed}` : `${n.failed} of ${n.total}`)
const shortList = n => (n.listed !== n.failed ? `the log names ${n.listed} of them, the other ${n.failed - n.listed} unread` : '')
const NOT_VALIDATED = 'these tests did not run, so the code of the batches is not validated on them, whatever status a batch shows'

function finalText(x, job) {
  const n = finalCounts(x)
  const stop = x.exit === 124 ? (x.stalled ? ` (stopped: its log silent ${FINAL_SILENT_MIN} min)` : ` (stopped after ${FINAL_TIMEOUT_MIN} min)`) : ''
  const logLine = `log: \`${x.repo ? `cd '${x.repo}' && ` : ''}cctoolkit bg log ${job} --lines 40\``
  if (!n.failed && !n.listed) return `${x.name} exit=${x.exit}${stop}: no test result read from its log, the suite gives no verdict on the batches — ${logLine}`
  const causes = ((x.report || {}).setup || []).map(g => `"${g.message}" (${g.tests.length})`).join(' ; ')
  return [
    `${x.name} exit=${x.exit}${stop}: ${n.failed} failed${n.total === null ? '' : ` of ${n.total}`}${shortList(n) ? `, ${shortList(n)}` : ''}, listed under \`## Final check\``,
    n.didNotRun ? `${n.didNotRun} did not run, their fixture or environment setup failed: ${causes} — ${NOT_VALIDATED}` : '',
    n.onTest ? `${n.onTest} failed on an assertion — not attributed: a batch of this run or a failure already on the starting tree` : '',
    logLine,
  ].filter(Boolean).join(' ; ')
}

function finalSection(suites) {
  const rows = suites.map(x => {
    const n = finalCounts(x)
    return x.exit !== 0 && !x.report ? `| ${x.name} | ${x.exit} | — | — | — |` : `| ${x.name} | ${x.exit} | ${ofTotal(n)} | ${n.didNotRun} | ${n.onTest} |`
  })
  const groups = (title, gs) => (gs || []).flatMap(g => [`**${title}** — ${g.message}`, ...g.tests.map(t => `- \`${t}\``), ''])
  const details = suites.filter(x => x.report).flatMap(x => {
    const n = finalCounts(x)
    const lines = [
      ...(shortList(n) ? [`${x.name}: ${shortList(n)}.`, ''] : []),
      ...(n.didNotRun ? [`${x.name}: ${n.didNotRun} did not run — ${NOT_VALIDATED}.`, ''] : []),
      ...groups('Did not run, setup failed', x.report.setup),
      ...groups('Failed on an assertion', x.report.assertion),
    ]
    return lines.length ? [`### ${x.name}`, '', ...lines] : []
  })
  return ['| Suite | Exit | Failed | Did not run (setup) | Failed on an assertion |', '|---|---|---|---|---|', ...rows, ...(details.length ? ['', ...details] : [])].join('\n').trimEnd()
}

const finalRedNames = red => red.map(x => {
  const n = finalCounts(x)
  return n.failed ? `${x.name} (${n.failed} failed${n.didNotRun ? `, ${n.didNotRun} did not run` : ''})` : x.name
}).join(', ')

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
    `   Then in one message, from \`root\`: \`cctoolkit plan-next-batch <plan> --check\`, \`cctoolkit plan-next-batch <plan>${scope ? ' ' + scope : ''} --repos\` (→ \`repos\` = the \`repos\` array of the JSON line it prints, each object as-is; empty when it fails), \`cctoolkit config package-feed\` (→ \`feed\`, empty when nothing printed), \`cctoolkit doctor --quiet\`, \`cctoolkit config parallel-batches\` (→ \`parallel\`, 1 when it fails) and \`cctoolkit config command build\`, the build configured by kit-init (\`commands.build\`, empty for a stack without one).`,
    '   Then one call, from `root` (timeout 600000): the printed build command run literally, never through `eval` (the Bash guards read the command text) — `f=$(mktemp); <printed command> > "$f" 2>&1; echo "build=$?"; grep -m1 -iE \'(^|[^a-z])error([^a-z]|$)\' "$f"; rm -f "$f"`, nothing printed → `echo build=none` in its place —, followed by `; cctoolkit docker-up --wait 120`.',
    '3. `--check` exit ≠ 0, a doctor `FAIL` line, a `docker=` line other than `docker=ready…` or `docker=absent`, or `build` neither 0 nor `none` → `ok: false`, `failure` = the failing line verbatim (for the build: `build=<code>` followed by the first error line, the working tree must compile before any batch starts), `runRoot` and `stamp` empty, stop. No test suite runs here: each batch runs the tests its diff reaches, in its own global green.',
    `4. Otherwise \`stamp\` = \`$(date +%Y-%m-%d-%H%M)\`, \`runRoot\` = \`<plan folder>/run\` (absolute). One call: \`cctoolkit batch-repo prune >/dev/null; cctoolkit run-work purge <runRoot> <stamp> && cctoolkit run-validate apply <runRoot>/.work.jsonl && cctoolkit run-work journal <runRoot>/.work.jsonl <stamp> "start $(date '+%Y-%m-%d %H:%M') — plan <plan> — scope ${scope || 'whole plan'}"\` (batch-repo prune: a plan folder a stopped run left in another repo brought back; purge: older layouts migrated, lines no run needs dropped, the 3 most recent runs kept; run-validate: the answers given in the run-lot-pane mod written into the sheets). \`ok: true\`, \`failure\` empty.`,
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

// A batch run beside another, in a worktree of its own (`run.parallelBatches`), or in the plan's other repository
// its `Repo` column names: its gate, repair, commit and setting aside run in that tree `at` — each Bash call opens
// with the prefix run-lot gives the batch's agents. In another repository the plan folder is a copy carried there
// (`cctoolkit batch-repo carry`): the sheet the commit and the setting aside read is that copy's.
const rootOf = () => slashed(pre.root).replace(/\/$/, '')
const repoTrees = new Set()
const sheetIn = (b, at) => (at && repoTrees.has(at) ? inTree(b.sheet, at) : b.sheet)
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
      `Batch ${b.batch} passed its gate. One call: \`cctoolkit batch-baseline commit ${work} ${b.batch} --sheet ${sheetIn(b, at)}; echo "exit=$?"\`.`,
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
      `1. \`cctoolkit batch-baseline restore ${work} ${b.batch} --save ${patch} --sheet ${sheetIn(b, at)}\` (the script alone touches the source and test roots; it keeps the work under a git ref with the fingerprint of the sheet's \`## Cycles\` block — a sheet changed before the next run and the work is not put back —,or drops the saved cycles when it could not). Exit ≠ 0 → \`ok: false\`, \`detail\` = its output verbatim, stop.`,
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
  const entry = { batch: b.batch, status: result.status, reason: result.reason, report: result.report, audit: result.audit || null, hypotheses: result.hypotheses || [], minors: result.minors || [], ...(together ? { with: together } : {}), ...(samePath(b.repo || pre.root, pre.root) ? {} : { repo: slashed(b.repo).replace(/\/$/, '') }), ...(b.branch ? { branch: b.branch } : {}) }
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
  if ((!at || repoTrees.has(at)) && (!back || !back.ok)) {
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
  if (!at || repoTrees.has(at)) log(`→ ${b.batch} ✅ (${ran.length})${s && s.ok ? ` — ${s.commit.split(':')[0]}` : ' — not committed'}${at ? ` in ${at}` : ''}`)
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
  if (!first || first.batch !== b.batch || !second || serialOnly.has(second.batch) || !samePath(second.repo, pre.root) || packaged(second)) return null
  return second
}

// A batch that packs or pins a package runs alone in its tree: the pair's landing would rebuild what was packed.
const packaged = x => !!(x.pack || (x.packageFrom || []).length)

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

// A batch that never started — its repository refused it, or the package it consumes was not packed: set aside,
// nothing to restore, its dependents held.
async function unrun(o, why) {
  record(o, { status: BLOCKED, reason: why, report: null })
  aside.push({ batch: o.batch, reason: why, patch: null, report: null, restored: '' })
  log(`→ ${o.batch} set aside — ${why}`)
  await journal(`${o.batch} ✗ — set aside — ${why}`)
}

// Preflight of one repository of the plan (`plan-next-batch --repos`), before any batch: another repository is
// checked as the checkout is — kit.config.json, doctor, build — and on the checkout's branch rule (`batch-repo branch
// --check`); any repository that packs or pins a package (`F1(package)`) has the commands and the feed that needs.
// The failure, or null.
async function repoReady(r) {
  const repo = slashed(r.repo).replace(/\/$/, '')
  const at = `cd '${repo}' && export CLAUDE_PROJECT_DIR='${repo}' &&`
  const pkg = r.pack.length || r.use.length
  const roles = [r.batches.length ? `batches ${r.batches.join(', ')}` : '', r.pack.length ? `packs ${r.pack.join(', ')}` : '', r.use.length ? `consumes a package in ${r.use.join(', ')}` : ''].filter(Boolean).join(', ')
  const check = `${r.checkout ? '' : `${at} `}cctoolkit batch-package check${r.pack.length ? ' --pack' : ''}${r.use.length ? ' --use' : ''} --feed '${feed}'`
  const steps = r.checkout
    ? [`1. One call: \`${check}\`. Exit ≠ 0 → \`ok\` false, \`failure\` = \`${repo}: \` followed by its \`missing:\` lines joined by \`; \`, stop. \`ok\` true, \`failure\` empty.`]
    : [
        `1. One call: \`test -f '${repo}/.claude/kit.config.json' && echo config=ok || echo config=absent\`. \`config=absent\` → \`ok\` false, \`failure\` = \`${repo}: no .claude/kit.config.json — run /cctoolkit:kit-init in that repository\`, stop.`,
        `2. One call, from the checkout: \`cctoolkit batch-repo branch --repo ${repo} --check\`. It printed one JSON line: \`refused\` → \`ok\` false, \`failure\` = \`${repo}: \` followed by that field verbatim, stop. Otherwise \`branch\` = its \`branch\`.`,
        `3. One call: \`${at} cctoolkit doctor --quiet; cctoolkit config command build\`. A doctor \`FAIL\` line → \`ok\` false, \`failure\` = \`${repo}: \` followed by that line verbatim and \` — fix: /cctoolkit:kit-init in that repository\`, stop.`,
        `4. The build step 3 printed, nothing printed → skip: one call (timeout 600000), the command run literally, never through \`eval\`: \`${at} f=$(mktemp); <printed command> > "$f" 2>&1; echo "build=$?"; grep -m1 -iE '(^|[^a-z])error([^a-z]|$)' "$f"; rm -f "$f"\`. \`build\` other than 0 → \`ok\` false, \`failure\` = \`${repo}: build=<code>\` followed by the first error line (that repository must compile before its batch starts), stop.`,
        ...(pkg ? [`5. One call: \`${check}\`. Exit ≠ 0 → \`ok\` false, \`failure\` = \`${repo}: \` followed by its \`missing:\` lines joined by \`; \`, stop.`] : []),
        '`ok` true, `failure` empty.',
      ]
  const x = await agent(
    [FRAME, '', `Preflight of the repository \`${repo}\` of the plan (${roles}), before any batch. In this order, stop at the first failure:`, ...steps].join('\n'),
    { schema: READY, phase: 'Preflight', label: `preflight ${repo.replace(/^.*\//, '')}`, ...SHELL },
  ).catch(() => null)
  if (!x) return `${repo}: preflight agent without result`
  return x.ok ? null : x.failure
}

// A batch of the plan's other repository (`Repo` column), run from this checkout: that repository put on the
// checkout's branch and the plan folder carried there (`cctoolkit batch-repo carry`), its files modified outside the
// batch listed — its config, doctor and build were checked at the preflight. Its tree, or null: the batch set aside.
async function carried(o) {
  const repo = slashed(o.repo).replace(/\/$/, '')
  const c = await agent(
    [
      FRAME,
      '',
      `Batch ${o.batch} runs in another repository than the checkout: \`${repo}\`. In this order:`,
      `1. One call: \`cctoolkit batch-repo carry ${o.batch} --repo ${repo} --plan ${pre.plan}\`. It printed one JSON line: \`refused\` → \`ok\` false, \`carried\` false, \`detail\` = that field verbatim, stop. Otherwise \`carried\` true, \`plan\` = its \`plan\`, \`branch\` and \`switched\` = its fields.`,
      `2. One call: \`cctoolkit plan-next-batch ${pre.plan} --outside ${o.batch}\` → \`outside\` = the paths it printed, one per line (none: empty).`,
      `3. \`${journalLine(`${o.batch} launched — ${o.sheet} — repo ${repo}`)}\`. \`ok\` true, \`detail\` empty.`,
    ].join('\n'),
    { schema: CARRIED, phase: 'Batch', label: `carry ${o.batch}`, ...SHELL },
  ).catch(() => null)
  if (c && c.ok) {
    if (c.outside.length) toReview.push({ batch: o.batch, step: 'Start', text: `files modified in ${repo} outside the batch at launch, left out of the batch diff and commit: ${c.outside.join(', ')}` })
    if (c.branch) {
      o.branch = c.branch
      log(`${o.batch}: ${repo} on branch ${c.branch} (${c.switched || 'kept'})`)
    }
    repoTrees.add(repo)
    return repo
  }
  if (c && c.carried) await bringBack(o, repo)
  await unrun(o, `repo ${repo} not ready: ${c ? c.detail : 'agent without result'}`)
  return null
}

// A batch another repository's batch consumes as a package (`pack`): once its gate passed and before its commit, packed
// into the local feed under the run's prerelease (`cctoolkit batch-package version`: `<base>-kit.<stamp>.<n>`) by
// `commands.pack` — a failed pack sets it aside like a red gate, nothing committed. A producer committed by an earlier
// run is packed again from its repository's HEAD, on the run's branch, before its first consumer. The failure, or null.
const versions = {}
const unpacked = {}
async function packed(b, at, again = false) {
  if (again && at) {
    const br = await treeCall(`branch ${b.batch}`, [`One call: \`cctoolkit batch-repo branch --repo ${at}\`. It printed one JSON line: \`refused\` → \`ok\` false, \`detail\` = that field verbatim. Otherwise \`ok\` true, \`detail\` = its \`branch\`.`])
    if (!br || !br.ok) return `branch of ${at}: ${br ? br.detail : 'agent without result'}`
  }
  const p = await agent(
    [
      FRAME + treeLine(at),
      '',
      `Batch ${b.batch} feeds another repository's batch as a package: pack it into the local feed${again ? ' (committed by an earlier run: packed from HEAD)' : ''}. In this order, stop at the first failure:`,
      `1. One call: \`cctoolkit batch-package version ${b.batch} --stamp ${pre.stamp}\` → \`version\` = the line it printed.`,
      `2. One call: \`cctoolkit config command pack --version <version> --feed '${feed}'\` → the pack command. Nothing printed → \`ok\` false, \`detail\` \`commands.pack unset\`.`,
      `3. One call (timeout 600000), the printed command run literally, never through \`eval\`: \`f=$(mktemp); <printed command> > "$f" 2>&1; echo "pack=$?"; grep -m1 -iE '(^|[^a-z])error([^a-z]|$)' "$f"; rm -f "$f"\`. \`pack\` other than 0 → \`ok\` false, \`detail\` = \`pack=<code>\` followed by the first error line. Otherwise \`ok\` true, \`detail\` empty.`,
    ].join('\n'),
    { schema: PACKED, phase: 'Gate', label: `pack ${b.batch}`, ...SHELL },
  ).catch(() => null)
  if (!p || !p.ok || !p.version) return `pack: ${p ? p.detail || 'no version' : 'agent without result'}`
  versions[b.batch] = p.version
  log(`→ ${b.batch} packed ${p.version} into ${feed}`)
  await journal(`${b.batch} packed — ${p.version} — feed ${feed}`)
  return null
}

// The run-lot arguments that pin a consumer (`packageFrom`) to its producer's prerelease, packing a producer
// committed by an earlier run first; {} for a batch without one; null when the producer could not be packed — the
// consumer then set aside, never run against a version it was not planned on.
async function pinOf(b) {
  const from = (b.packageFrom || [])[0]
  if (!from) return {}
  if (!versions[from.batch]) {
    const fail = unpacked[from.batch] || (unpacked[from.batch] = await packed({ batch: from.batch, repo: from.repo }, samePath(from.repo, pre.root) ? null : slashed(from.repo).replace(/\/$/, ''), true))
    if (fail) {
      await unrun(b, `package of ${from.batch} not packed — ${fail}`)
      return null
    }
  }
  return { packages: { from: from.batch, version: versions[from.batch], feed } }
}

// The plan folder carried into another repository, brought back into the checkout: the plan heading and the
// sheet the batch wrote there, merged with what the checkout's batches wrote meanwhile.
async function bringBack(o, repo) {
  const r = await agent(
    [
      FRAME,
      '',
      `One call: \`cctoolkit batch-repo back ${o.batch} --repo ${repo}\`. It printed one JSON line: \`refused\` → \`ok\` false, \`detail\` = that field verbatim, the lists empty. Otherwise \`ok\` true, \`back\`, \`merged\`, \`conflict\` and \`kept\` = its fields, \`detail\` empty.`,
    ].join('\n'),
    { schema: BROUGHT, phase: 'Gate', label: `back ${o.batch}`, ...SHELL },
  ).catch(() => null)
  if (!r || !r.ok) toReview.push({ batch: o.batch, step: 'Gate', text: `plan folder not brought back from ${repo}: ${r ? r.detail : 'agent without result'} — \`cctoolkit batch-repo back ${o.batch} --repo ${repo}\`` })
  else if (r.conflict.length) toReview.push({ batch: o.batch, step: 'Gate', text: `plan files written on both sides, the checkout's kept: ${r.conflict.join(', ')} — the batch's copy: ${r.kept.join(', ')}` })
}

// A finished batch: its gate, then its commit or its setting aside. True when the plan stops.
async function settle(b, result, at = null) {
  const entry = record(b, result)
  let failure = result.status !== DONE || !result.report ? `${result.status} — ${result.reason}` : null
  if (!failure) failure = await gated(b, result, at)
  if (!failure && b.pack) failure = await packed(b, at)
  if (failure) return putAside(b, result, entry, failure, at)
  await sealed(b, entry, at)
  return false
}

// The batches `plan-next-batch` launches now in other repositories (one per repo), each carried there, run beside
// the checkout's batch `b` (if any): no tree, no build, no lock shared. Then one after the other: `b` as alone, each
// other gated and committed or set aside in its repo, its plan folder brought back. True when the plan stops.
async function runRepos(b, others) {
  const trees = []
  const pa = b ? await pinOf(b) : null
  if (!pa) b = null
  for (const o of others) {
    const pins = await pinOf(o)
    const at = pins ? await carried(o) : null
    if (at) trees.push({ o, at, pins })
  }
  if (!b && !trees.length) return !!stop
  log(`→ ${[...(b ? [b.batch] : []), ...trees.map(t => `${t.o.batch} in ${t.at}`)].join(', ')} launched`)
  const failed = e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null })
  const [ra, ...rs] = await Promise.all([
    b ? workflow('cctoolkit:run-lot', { sheet: slashed(b.sheet), commit: false, ...pa }).catch(failed) : null,
    ...trees.map(t => workflow('cctoolkit:run-lot', { sheet: inTree(t.o.sheet, t.at), commit: false, root: t.at, run: runRoot, ...t.pins }).catch(failed)),
  ])
  let halt = b ? await settle(b, ra) : false
  for (const [i, t] of trees.entries()) {
    halt = (await settle(t.o, rs[i], t.at)) || halt
    await bringBack(t.o, t.at)
  }
  return halt || !!stop
}

// Every repository of the plan other than the checkout, and any that packs or pins a package, checked before any
// batch: a failure stops the run there, its line and its fix in the result.
const feed = slashed(pre.feed || '').replace(/\/$/, '')
for (const r of pre.repos || []) {
  if (r.checkout && !r.pack.length && !r.use.length) continue
  const failure = await repoReady(r)
  if (failure) {
    stop = failure
    log(`preflight: ${failure}`)
    break
  }
}

while (!stop) {
  phase('Batch')
  const next = await nextBatches()
  if (!next) { stop = 'plan-next-batch without result'; break }
  held = next.held || []
  if (next.kind === 'END') break
  if (next.kind !== 'BATCHES') { stop = next.line; break }

  const b = next.batches.find(x => samePath(x.repo, pre.root))
  const others = next.batches.filter(x => !samePath(x.repo, pre.root))

  if (b && next.outsideBatch === b.batch && next.outsidePaths.length) {
    toReview.push({ batch: b.batch, step: 'Start', text: `files modified outside the batch at launch, left out of the batch diff and commit: ${next.outsidePaths.join(', ')}` })
  }

  if (others.length) {
    if (await runRepos(b, others)) break
    continue
  }

  const partner = PARALLEL > 1 && !serialOnly.has(b.batch) && !packaged(b) ? await partnerOf(b) : null
  const at = partner ? await worktreeFor(partner) : null
  if (at) {
    if (await runPair(b, partner, at)) break
    continue
  }

  const pins = await pinOf(b)
  if (!pins) continue
  log(`→ ${b.batch} launched`)
  const result = await workflow('cctoolkit:run-lot', { sheet: slashed(b.sheet), commit: false, ...pins }).catch(e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null }))
  if (await settle(b, result)) break
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

// Every suite of the checkout, then of each other repository a batch was committed in, its suites named `<repo>/<suite>`.
const finalWanted = ran.some(r => r.status === DONE) && !scope.startsWith('--only')
const finalIn = (at, label) => agent(
  [
    FRAME + treeLine(at),
    '',
    `Final check of the plan, after its last batch: every suite runs whole once, \`IntegrationTests\` included. The result is reported, never a stop: fix nothing.`,
    `1. One call: \`cctoolkit suites-plan --final ${pre.stamp}\`. It prints \`suites\` (each with \`name\`, \`job\`, \`start\`, \`log\`) and \`notRun\`: copy each line literally, never rebuild nor \`eval\` one — the suite's env prefix, the integration guard's \`KIT_FINAL_CHECK=1\` marker and the Docker start are in it. \`suites\` empty → \`suites\` empty, stop.`,
    '2. Every `start` line in a single message, one Bash call each: each suite runs detached, a `cctoolkit bg` job.',
    `3. Then each job in turn, Bash timeout 600000: \`cctoolkit bg wait <job> --seconds 540 --silent ${FINAL_SILENT_MIN * 60}\`. It prints \`DONE exit=<n>\`, \`FAILED exit=<n>\` (\`exit=none\`: the process died without an exit code), \`RUNNING <seconds>s\` or \`STALLED <seconds>s\` (its log silent ${FINAL_SILENT_MIN} min: the suite hangs). \`RUNNING\` under ${FINAL_TIMEOUT_MIN * 60} s → the same call again; ${FINAL_TIMEOUT_MIN * 60} s or more → \`cctoolkit bg stop <job>\`, that suite's \`exit\` = 124. \`STALLED\` → \`cctoolkit bg stop <job>\`, \`exit\` = 124, \`stalled\` = true. No other wait loop, no \`sleep\`.`,
    '4. One entry per suite: `name`, `exit` = the code `bg wait` printed (`exit=none` → 125), `report` = for an exit other than 0, the JSON `cctoolkit suites-plan --failures <log>` prints, verbatim, those calls in one message; none for a green suite. A suite at 124 also gets `last` = the lines `cctoolkit bg log <job> --lines 8` prints (the log fills test by test: they name the test the suite stopped on). Never open a log beyond that.',
  ].join('\n'),
  { schema: FINAL, phase: 'Final check', label, ...SHELL },
).catch(() => null)
let finalCheck = null
if (finalWanted) {
  phase('Final check')
  finalCheck = await finalIn(null, 'final check')
  if (!finalCheck) toReview.push({ batch: '—', step: 'Final check', text: 'final check agent without result: suites not run whole' })
  for (const repo of [...new Set(ran.filter(r => r.status === DONE && r.repo).map(r => r.repo))]) {
    const name = repo.replace(/^.*\//, '')
    const f = await finalIn(repo, `final check ${name}`)
    if (!f) toReview.push({ batch: '—', step: 'Final check', text: `final check agent without result in ${repo}: its suites not run whole` })
    else finalCheck = { suites: [...(finalCheck ? finalCheck.suites : []), ...f.suites.map(x => ({ ...x, name: `${name}/${x.name}`, suite: x.name, repo }))] }
  }
}
const finalRed = finalCheck ? finalCheck.suites.filter(x => x.exit !== 0) : []
for (const x of finalRed) toReview.push({ batch: '—', step: 'Final check', text: finalText(x, `final-${pre.stamp}-${x.suite || x.name}`), why: (x.last || []).join(' / ') })
if (finalRed.length) log(`final check red: ${finalRedNames(finalRed)}`)

// One security pass over what the plan committed, read-only, never a stop: the audits judge a batch
// against its sheet, none looks at the plan's changes for what an attacker can reach.
const SECURITY = obj({ findings: arr(obj({ severity: { type: 'string', enum: ['Blocking', 'Major'] }, finding: str, evidence: str, fix: str })) })
const committed = ran.map(r => [(/\bcommitted ([0-9a-f]{4,40}):/.exec(r.commit || '') || [])[1], r.repo]).filter(([c]) => c)
const commitsIn = committed.filter(([, repo]) => !repo).map(([c]) => c)
const commitsElsewhere = committed.filter(([, repo]) => repo).map(([c, repo]) => `${c} (\`git -C ${repo}\`)`)
const security = committed.length
  ? await (phase('Security'), agent(
      [
        'Workflow run-plan, security pass after the last batch. Autonomous mode: nobody answers. Read-only: never edit, never a Git command that writes, never build nor run a test. Return the findings through the structured output; prose follows `language.docs` of `kit.config.json`.',
        '',
        `Batch commits of the plan: ${[...commitsIn, ...commitsElsewhere].join(' ')}. Read them with \`git show --stat <commit>\`, then bounded \`git show <commit> -- <path>\` on production files only, never tests${commitsElsewhere.length ? ' — a commit of another repository read with the `git -C <repo>` given beside it' : ''}.`,
        'Look only for security defects these changes bring: authorisation missing, or checked on mere existence instead of the relationship that grants it; a resource of another organisation reachable; injection (SQL, command, path); a secret or personal data written to a log, a response or the repo; input reaching a query, a file path or an external call unvalidated; an unbounded read an anonymous caller can trigger.',
        'Each finding: `severity` Blocking (exploitable as written) or Major (exploitable under an assumption you name), `finding` one line, `evidence` `path:line`, `fix` one line. No evidence, no finding; hardening wishes and style are not findings. Nothing found → `findings` empty.',
      ].join('\n'),
      { schema: SECURITY, phase: 'Security', label: 'security', model: 'sonnet', effort: 'medium' },
    ).catch(() => null))
  : null
if (committed.length && !security) toReview.push({ batch: '—', step: 'Security', text: 'security pass without result: run /security-review on the plan commits' })
for (const f of security ? security.findings : []) toReview.push({ batch: '—', step: 'Security', text: `${f.severity} — ${f.finding}`, why: `${f.evidence} ; proposed fix: ${f.fix}` })
if (security && security.findings.length) log(`security: ${security.findings.length} finding(s) to validate`)

// The base changes once per feature, when its plan is delivered whole: the merge is drafted from the
// spec's delta and written here, autonomously — the spec was validated before the plan, nothing is left
// to arbitrate. The user reviews it in `git diff` with the code. A refusal or a block leaves it staged.
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
        'Workflow run-plan, knowledge-base merge after the last batch. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes, never `cctoolkit knowledge-write`: the workflow writes the staged merge itself after your report. Return the report fields through the structured output.',
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
  if (merge.state === 'staged') {
    const code = pre.plan.replace(/^.*[\\/]/, '').replace(/-PLAN\.md$/, '')
    const ap = await agent(
      [
        FRAME,
        '',
        `One call: \`cctoolkit knowledge-write apply --merge ${code} 2>&1; echo "exit=$?"\`.`,
        '`exit` = the code on the last line; `lines` = every other output line, verbatim.',
      ].join('\n'),
      { schema: APPLIED, phase: 'Merge', label: 'merge apply', ...SHELL },
    ).catch(() => null)
    merge = ap && ap.exit === 0
      ? { state: 'written', lines: [...merge.lines, ...ap.lines], warnings: merge.warnings, next: null }
      : { state: 'refused', lines: ap ? ap.lines : ['apply agent without result'], warnings: merge.warnings, next: skill }
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
    ...(ran.some(r => r.repo) ? ['- in that table, a batch carrying `repo` gets ` (<repo>, branch <branch>)` after its batch (` (<repo>)` without `branch`): it ran in that repository, on that branch, its commit and its patch are there'] : []),
    ...(breaker ? ['- `## Plan stopped — common cause` — from `breaker` of the second JSON: the cause, the batches it reached, what to fix in the spec or the plan before relaunching (`fixBeforeRelaunch`), then the relaunch: a new `/run-plan` skips the batches ✅ DONE'] : []),
    `- \`## To validate\` — from the second JSON, everything the run decided without the user (marked \`${TO_REVIEW}\`), to review after the plan, one \`###\` per kind: \`### Stop\` (\`stop\` verbatim, only when not null), \`### Batches set aside\` (\`toReview\` entries of step \`Set aside\`), \`### Start\` (\`toReview\` entries of step \`Start\`), \`### Final check\` (\`toReview\` entries of step \`Final check\`, their numbers verbatim, never recounted), \`### Security\` (\`toReview\` entries of step \`Security\`),\`### Audits to redo\` (\`audit\` = \`to redo\`: batch, report, command \`/verify-ddd-tdd batch FX\`), \`### Audit gaps carried\` (\`toReview\` entries of step \`Audit\`, and \`audit\` = \`GAPS carried\`), \`### Arbiter and design decisions\` (other \`toReview\` entries, step and why kept), \`### Assumptions\` (every \`h\`). One bullet per entry, prefixed by its batch; \`None.\` for an empty section. Last, when \`decidedAlone\` is not empty, one line after the sections: \`Decided alone, nothing to do: <total> — section Decided alone of the batch reports (<FX n, …>).\``,
    '- `## Minor` — every minor of the first JSON, prefixed by its batch; `None.` when none',
    `- \`## Final check\` — this block, its numbers, table and test names verbatim, never recounted, its sentences in the docs language:\n${finalCheck ? finalSection(finalCheck.suites) : 'Not run.'}\n(end of the block)`,
    '- `## Knowledge base` — from `merge` of the second JSON: `state` written → its `lines` verbatim one bullet each, then its `warnings`, then the line `Written to the base: review \`git diff -- <knowledge root>\` and commit it with the code.`; refused, blocked or failed → its `lines` verbatim, then `Not staged: <next>.`; nothing → its line verbatim; `merge` null → `Not run.`',
    '- `## Journal` — the journal lines verbatim, in order',
    `\`lastLine\` = \`Plan stopped — <stop>\` when stop is not null, else \`Plan done — review of ${reportFile} required.\`${finalRed.length ? `, followed by \` — final check red: ${finalRedNames(finalRed)}\`` : ''}${merge && merge.state === 'written' ? ', followed by ` — knowledge base updated`' : ''}.`,
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
  finalCheck: finalCheck ? finalCheck.suites.map(x => { const n = finalCounts(x); return { name: x.name, exit: x.exit, failed: n.failed, ...(n.total === null ? {} : { total: n.total }), didNotRun: n.didNotRun, onTest: n.onTest } }) : null,
  ...(merge && merge.state !== 'nothing' ? { merge: { state: merge.state, lines: merge.lines, warnings: merge.warnings || [], ...(merge.next ? { next: `${merge.next} — the merge is staged, not written: it shows the diff and writes it` } : {}) } } : {}),
}
