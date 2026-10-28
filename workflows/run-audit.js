export const meta = {
  name: 'run-audit',
  description: 'Quality report of the main branch, in a throwaway worktree: tests, coverage, SonarQube, hotspots, traceability, suppressions, vulnerabilities, Stryker on demand, report and coherence checks',
  whenToUse: 'Launched by /quality-report once the Stryker mode is chosen. Argument: `--stryker off|full|since --date YYYY-MM-DD --checkout <absolute path of the main checkout> [--ref <branch|sha>]`; without `--ref` the main branch is audited.',
  phases: [
    { title: 'Preflight', detail: 'doctor, leftover jobs stopped, audit worktree of the main branch, stack, temp folder, Docker' },
    { title: 'Tests', detail: 'dependencies, build, every suite with coverage — alone: Testcontainers and Docker' },
    { title: 'Measures', detail: 'SonarQube + coverage, cctoolkit audit-collect (hotspots, traceability, suppressions, vulnerabilities, loop calls), inventory, git activity — in parallel' },
    { title: 'Stryker', detail: 'only when asked: starts after every measure that reads the sources, detached, waited 9 min at a time, bounded' },
    { title: 'Assemble', detail: 'Danger Zone × coverage × survivors (risk-cross), fragments merged into the report JSON (report-assemble)' },
    { title: 'Report', detail: 'the Markdown report written from the JSON, the template and the writing rules' },
    { title: 'Check', detail: 'quality-report-check, two repairs at most, then the judgement checks and two hotspot files by hand' },
    { title: 'Cleanup', detail: 'detached jobs stopped, worktree removed; the Stryker reports kept for a rerun on the same commit' },
  ],
}

// On Windows a path may come with `\` (Python, the engine, the user): Git Bash eats an unquoted one, and two
// spellings of one folder compare unequal. Paths are carried with `/`, compared with the drive's case aside.
const slashed = p => String(p || '').replace(/\\/g, '/')
const samePath = (a, b) => {
  const [x, y] = [slashed(a).replace(/\/$/, ''), slashed(b).replace(/\/$/, '')]
  return /^[A-Za-z]:/.test(x) ? x.toLowerCase() === y.toLowerCase() : x === y
}

const words = (typeof args === 'string' ? args : '').trim().split(/\s+/).filter(Boolean)
const flag = name => {
  if (args && typeof args === 'object') return args[name] || ''
  const i = words.indexOf(`--${name}`)
  return i >= 0 && i + 1 < words.length ? words[i + 1] : ''
}
const mode = flag('stryker') || 'off'
const date = flag('date')
const checkout = slashed(flag('checkout')).replace(/\/$/, '')
const ref = flag('ref')
if (!['off', 'full', 'since'].includes(mode) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[A-Za-z]:)?\//.test(checkout)) {
  throw new Error('expected argument: `--stryker off|full|since --date YYYY-MM-DD --checkout <absolute path of the main checkout> [--ref <branch|sha>]`')
}

const DONE = 'DONE'
const BLOCKED = 'BLOCKED'
const MEASURED = 'measured'
const MISSING = 'missing'
const SKIPPED = 'skipped'
const NOT_CONFIGURED = 'not_configured'
const WAIT_SECONDS = 540
const STRYKER_HOURS = mode === 'full' ? 4 : 1.5
const WAIT_ROUNDS = Math.ceil((STRYKER_HOURS * 3600) / WAIT_SECONDS)
const REPAIRS = 2

const str = { type: 'string' }
const int = { type: 'integer' }
const bool = { type: 'boolean' }
const arr = items => ({ type: 'array', items })
const obj = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
})
const status = (...values) => ({ type: 'string', enum: values })

const PREFLIGHT = obj({ ok: bool, failure: str, worktree: str, commit: str, branch: str, stack: status('dotnet'), project: str, tmp: str, cache: str, sinceTarget: str, startedAt: int, copied: arr(str) })
const FRAGMENT = obj({ status: status(MEASURED, MISSING, NOT_CONFIGURED), reason: str, file: str })
const SONAR = obj({ sonarStatus: status(MEASURED, MISSING, NOT_CONFIGURED), sonarReason: str, coverageStatus: status(MEASURED, MISSING, NOT_CONFIGURED), coverageReason: str, coverageFile: str, reused: bool, file: str })
const COLLECT = obj({ ok: bool, failure: str, statuses: arr(obj({ block: str, status: str, reason: str })) })
const ACTIVITY = obj({ ok: bool, failure: str, file: str, themes: str })
const STARTED = obj({ status: status('started', 'reused', NOT_CONFIGURED, MISSING), reason: str })
const WAITED = obj({ state: status('done', 'failed', 'running', 'unknown'), line: str })
const OK = obj({ ok: bool, detail: str })
const REPORT = obj({ path: str, atAGlance: str, summary: arr(obj({ dimension: str, status: str, value: str })), attention: arr(str), verdict: str })
const CHECKED = obj({ exit: int, lines: arr(str) })
const FIXED = obj({ fixed: arr(str), files: arr(str) })
const COHERENCE = obj({ fixed: arr(str), remaining: arr(str), byHand: arr(obj({ file: str, matches: bool, detail: str })) })
const CLEANED = obj({ ok: bool, endedAt: int, detail: str })

const SHELL = { model: 'haiku', effort: 'low' }
const STEP = { model: 'sonnet', effort: 'low' }
const KIT_DOC = '`<kit>` = the folder `cctoolkit root` prints; the stack commands are `<kit>/skills/quality-report/commands-dotnet.md` — read only the section a step names, e.g. `sed -n \'/^### Title/,/^### /p\'`, never the whole file.'
const RULE_MISSING = 'A tool that fails, times out or gives unreadable output: its block is `missing` with the reason, its numbers `null` — never 0, never a figure from another commit or an older report — and the step goes on.'

phase('Preflight')
const pre = await agent(
  [
    `Workflow run-audit, preflight. Main checkout: ${checkout}. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes outside \`cctoolkit audit-worktree\`. Run exactly the commands given, from \`${checkout}\`, and return their outputs through the structured output.`,
    '',
    '1. In one message: `cctoolkit doctor --quiet`, `date +%s` (→ `startedAt`) and `cctoolkit bg stop audit-stryker audit-sonar` (the jobs of an interrupted audit).',
    '   A doctor line starting `FAIL` → `ok: false`, `failure` = that line verbatim, every other field empty or 0, stop.',
    `2. \`cctoolkit audit-worktree create${ref ? ` --ref ${ref}` : ''}\` → its JSON line: \`worktree\` = \`path\`, \`commit\`, \`branch\`, \`copied\`. Exit ≠ 0 → \`ok: false\`, \`failure\` = its stderr, stop.`,
    '3. In one message, `C` = the commit\'s first 12 characters:',
    '   - stack: `cd <worktree> && if ls *.sln *.slnx >/dev/null 2>&1 || ls */*.csproj >/dev/null 2>&1; then echo dotnet; else echo none; fi` — `none` → `ok: false`, `failure` = `no .NET solution found`, stop;',
    '   - `project`: the `.sln` name without extension;',
    `   - \`tmp\` = \`cctoolkit run-work tmp audit-<C>\`, \`cache\` = \`cctoolkit run-work tmp stryker-<C>\`, both run from \`${checkout}\` (absolute paths, created: \`mkdir -p\`);`,
    `   - \`sinceTarget\`: \`metadata.commit\` of the newest \`${checkout}/docs/metrics/quality-report-*.json\` (else its \`stryker.since_target\`), else \`git -C <worktree> rev-list -1 HEAD~50\`, else empty;`,
    '   - Docker: `cctoolkit docker-up --wait 0 || true` (it boots during the build).',
    '4. `ok: true`, `failure` empty.',
  ].join('\n'),
  { schema: PREFLIGHT, phase: 'Preflight', label: 'preflight', ...SHELL },
)
if (!pre) throw new Error('preflight agent without result')
if (!pre.ok) return { status: BLOCKED, reason: pre.failure, report: null }
if (!pre.worktree || !pre.commit || !pre.tmp) {
  return { status: BLOCKED, reason: 'preflight answered ok without a worktree, a commit or a run folder — `cctoolkit audit-worktree create` did not run', report: null }
}

const wt = slashed(pre.worktree).replace(/\/$/, '')
const sha = pre.commit
const C = sha.slice(0, 12)
const stack = pre.stack
const tmp = slashed(pre.tmp).replace(/\/$/, '')
const cache = slashed(pre.cache).replace(/\/$/, '')
const reportBase = `${checkout}/docs/metrics/quality-report-${date}`
const jsonPath = `${reportBase}.json`
const mdPath = `${reportBase}.md`
log(`audit of ${pre.branch} at ${C} in ${wt}${pre.copied.length ? ` (copied: ${pre.copied.join(', ')})` : ''} — Stryker ${mode}`)

const FRAME = [
  `Workflow run-audit, quality report of \`${pre.branch}\` at \`${sha}\`, stack ${stack}. Audit worktree: ${wt}. Main checkout: ${checkout}. Run temp folder: ${tmp}.`,
  'Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes, never edit the main checkout except the report file a step names.',
  `Every Bash call starts with \`cd ${wt} && export CLAUDE_PROJECT_DIR=${wt} &&\`: the worktree is the repo measured — without the export, \`cctoolkit\` scripts resolve to the main checkout. Logs and outputs go under \`${tmp}\`, never \`/tmp\` directly nor the worktree.`,
  KIT_DOC,
  RULE_MISSING,
  '`docs/` is out of scope of every measure (`SKILL.md` § `docs/` is out of scope). A fragment file follows `<kit>/skills/quality-report/references/json-schema.md` for the blocks it holds, nothing else.',
  'Return through the structured output.',
].join('\n')

const evidence = {}
const nulls = {}
const proof = (block, s, reason, partial = false) => {
  const fallback = s === NOT_CONFIGURED ? 'not configured on this project' : 'agent without result'
  // A partial block is `measured` and keeps its `reason`: the suites that ran hold numbers, the others stay null.
  evidence[block] = { status: s, source: 'local', commit: s === MEASURED ? sha : null, reason: s === MEASURED ? (partial && reason ? reason : null) : reason || fallback }
  if (s !== MEASURED) nulls[block] = null
}
const fragments = []
let strykerMeasured = false
let collected = false
let coverageFile = ''
let themes = ''
let outcome = null

try {
  phase('Tests')
  const tests = await agent(
    [
      FRAME,
      '',
      'You run the build and the tests with coverage, nothing else.',
      `1. Section \`## Step 1\` of the stack commands (Docker) when the suites need it; then the dependencies: \`dotnet restore\`. A restore that fails → \`status: missing\`, \`reason\` = its error line, write \`{"build": {"duration_seconds": null}}\` into \`${tmp}/tests.json\`, stop.`,
      `2. Section \`## Step 2\`: the build, timed → \`build.duration_seconds\`; then every suite with coverage as written there, logs under \`${tmp}\` in place of \`/tmp/test-*.log\`, coverage files where the section puts them (the next step reads them). The command of every run that targets IntegrationTests starts with the marker \`KIT_FINAL_CHECK=1\` (\`KIT_FINAL_CHECK=1 dotnet-coverage collect ...\`, also inside a \`cctoolkit bg start\` string): this audit is the one whole run the guard allows, without \`--filter-class\`. The same command also carries the \`env\` of the \`IntegrationTests\` entry of \`commands.suites\` in \`${checkout}/.claude/kit.config.json\` (\`jq -r '[.commands.suites[] | select(.name=="IntegrationTests") | .env // empty][0] // empty'\`, e.g. \`KIT_FINAL_CHECK=1 STID_TEST_MODE=true dotnet-coverage collect ...\`): that variable sizes the test container pool, and a whole run without it starts twice the containers and databases on the same memory. Bash timeout 600000. A suite longer than that: \`cctoolkit bg start audit-tests -- '<its command>'\`, then \`cctoolkit bg wait audit-tests --seconds ${WAIT_SECONDS}\` (Bash timeout 600000) until it no longer prints \`RUNNING\`, 6 times at most.`,
      `3. Write \`${tmp}/tests.json\`: \`{"tests": {<type>: {"passed", "failed", "skipped", "duration_seconds"}}, "build": {"duration_seconds"}}\` — one key per suite type of the schema (\`unit\`, \`integration\`, \`contract\`, \`architecture\`, \`e2e\`, or the repo's own), durations rounded to whole seconds, no \`total\` (the assembly sums it). A suite that did not run: its key with \`null\` values.`,
      '`status`: `measured` when the suites that ran gave a result (failures included: a failing test is a result) — and then, if a suite did not run to the end (stopped, timed out, refused), its key stays `null` and `reason` names it and why (a partial result: the suites that ran are kept in the report). `missing` only when no suite gave a result (restore or build failed), with the reason. `file` = the fragment path.',
    ].join('\n'),
    { schema: FRAGMENT, phase: 'Tests', label: 'tests', ...STEP },
  ).catch(() => null)
  proof('tests', tests ? tests.status : MISSING, tests && tests.reason, true)
  if (tests && tests.file) fragments.push(tests.file)

  phase('Measures')
  const [sonar, collect, inventory, activity] = await parallel([
    () => agent(
      [
        FRAME,
        '',
        'You produce the `sonarqube` and `coverage` blocks.',
        '1. Coverage first, whatever SonarQube does: section `## Step 3` of the stack commands, the merged and aggregated coverage (3a and 3b, ReportGenerator). `coverageFile` = absolute path of the per-file coverage the section produces (`TestResults/MergedCoverage/SonarQube.xml`), empty when absent.',
        '2. SonarQube: `not_configured` when neither `~/.sonar-token` nor a server answering `curl -sf http://localhost:9000/api/system/status` exists; `missing` when one exists without the other. Before any scan, read the last analysis: `api/project_analyses/search?project=<key>&ps=1` — its `revision` equal to the report commit → reuse it (`reused: true`), no scan.',
        `   Otherwise the scan of the section, its commands written into \`${tmp}/run-sonar.sh\` (not \`/tmp\`) and launched as \`cctoolkit bg start audit-sonar -- 'bash ${tmp}/run-sonar.sh'\`, then \`cctoolkit bg wait audit-sonar --seconds ${WAIT_SECONDS}\` (Bash timeout 600000) until it no longer prints \`RUNNING\`, 3 times at most — never Monitor, never \`nohup\`. Then the metrics fetch of the section (\`resolved=false\` on every issue count), once the server task is done. An analysis whose \`revision\` is not the report commit is \`missing\`.`,
        `3. Write \`${tmp}/sonar.json\`: \`{"sonarqube": {…}, "coverage": {…}}\` per the schema. \`coverage.lines\` / \`branches\` are SonarQube whole-project figures: SonarQube missing → those two \`null\`, the ReportGenerator / Jest figures kept in their own fields.`,
        '`sonarStatus` / `coverageStatus` with their reasons (empty when measured); `coverage` is `measured` when at least the ReportGenerator figures exist. `file` = the fragment path.',
      ].join('\n'),
      { schema: SONAR, phase: 'Measures', label: 'sonarqube + coverage', ...STEP },
    ),
    () => agent(
      [
        FRAME,
        '',
        `Run the block of section \`### Collected by script\` of the stack commands once, with \`--ref ${sha} --out ${tmp}/collect.json\` and its stdout redirected to \`${tmp}/collect.stdout.json\` (Bash timeout 600000). Then \`jq -j .hotspots_markdown ${tmp}/collect.stdout.json > ${tmp}/hotspots.md\`.`,
        '`statuses` = one entry per block of the output (`activity.hotspots`, then each key of `codebase`): its `status` and `reason`, copied. Exit ≠ 0 → `ok: false`, `failure` = the last stderr line.',
      ].join('\n'),
      { schema: COLLECT, phase: 'Measures', label: 'audit-collect', ...SHELL },
    ),
    () => agent(
      [
        FRAME,
        '',
        'You produce the inventory: sections `### Test inventory`, `### API endpoint coverage`, `### Codebase health` and `### Code size (src / tests, per layer)` of the stack commands, at the report commit.',
        `Write \`${tmp}/inventory.json\`: \`{"tests": {<type>: {"files", "methods"}}, "api_endpoints": {…}, "codebase": {"source_files", "total_files", "todo_count", "skipped_tests", "size": {…}}}\` per the schema — only those fields: the run results are another agent's.`,
        '`status` = `measured` unless a command failed; `file` = the fragment path.',
      ].join('\n'),
      { schema: FRAGMENT, phase: 'Measures', label: 'inventory', ...STEP },
    ),
    () => agent(
      [
        FRAME,
        '',
        'You produce the git activity: sections `### Git activity (30 days)` and `### Change rate per period` of the stack commands, every window ending at the report commit date, `docs/` excluded.',
        `Write \`${tmp}/activity.json\`: \`{"activity": {…}}\` per the schema, without \`hotspots\` (another agent's).`,
        '`themes` = 2-3 lines on the main axes of the 30 days, read from the commit subjects (`git log --since=… --format=%s`): what changed, never a judgement. `ok: false` with `failure` when git fails.',
      ].join('\n'),
      { schema: ACTIVITY, phase: 'Measures', label: 'activity', ...STEP },
    ),
  ])
  proof('sonarqube', sonar ? sonar.sonarStatus : MISSING, sonar && sonar.sonarReason)
  proof('coverage', sonar ? sonar.coverageStatus : MISSING, sonar && sonar.coverageReason)
  if (sonar && sonar.file) fragments.push(sonar.file)
  coverageFile = sonar && sonar.coverageStatus === MEASURED ? sonar.coverageFile : ''
  collected = !!(collect && collect.ok)
  if (collected) fragments.push(`${tmp}/collect.json`)
  else log(`audit-collect failed: ${collect ? collect.failure : 'agent without result'} — hotspots and codebase blocks absent`)
  if (inventory && inventory.file) fragments.push(inventory.file)
  if (activity && activity.ok) {
    fragments.push(activity.file)
    themes = activity.themes
  }

  phase('Stryker')
  if (mode === 'off') {
    proof('stryker', SKIPPED, 'Stryker off for this run')
  } else {
    // Every measure that reads the sources is done: Stryker may rewrite them now.
    const started = await agent(
      [
        FRAME,
        '',
        `You launch Stryker, mode \`${mode}\`, from section \`### Stryker .NET (background)\` of the stack commands.`,
        '1. Not configured (no `stryker-config*.json` under the test roots) → `not_configured`, stop. Never install it here: the worktree is thrown away.',
        `2. \`${cache}/mode\` holds \`${mode} ${mode === 'since' ? pre.sinceTarget : '-'}\` and \`${cache}\` holds a \`*.json\` mutation report → \`reused\`, stop: those reports belong to this commit.`,
        `3. Mode in the configs of the worktree only: full → \`"since": { "enabled": false }\`; since → \`"since": { "enabled": true, "target": "${pre.sinceTarget}" }\`${pre.sinceTarget ? '' : ' — no target known: `missing`, reason `no since target`, stop'}. StrykerJS has no \`since\`: it runs full whatever the mode.`,
        `4. One call: \`rm -f ${cache}/*.json ${cache}/mode; cctoolkit bg start audit-stryker -- '<the commands of the section, in sequence, without nohup, pkill nor log redirection>'\`. \`STARTED\` → \`started\`; otherwise \`missing\` with its output.`,
      ].join('\n'),
      { schema: STARTED, phase: 'Stryker', label: 'stryker start', ...STEP },
    ).catch(() => null)
    let state = started ? started.status : MISSING
    let reason = started ? started.reason : 'agent without result'
    if (state === 'started') {
      let waited = null
      for (let round = 1; round <= WAIT_ROUNDS; round++) {
        waited = await agent(
          `${FRAME}\n\nRun \`cctoolkit bg wait audit-stryker --seconds ${WAIT_SECONDS}\` once, Bash timeout 600000, nothing else. \`state\`: exit 0 → \`done\`, 1 → \`failed\`, 3 → \`running\`, anything else → \`unknown\`. \`line\` = its first output line.`,
          { schema: WAITED, phase: 'Stryker', label: `stryker wait #${round}`, ...SHELL },
        ).catch(() => null)
        if (waited && waited.state !== 'running') break
      }
      if (!waited || waited.state === 'running') {
        await agent(`${FRAME}\n\nOne call: \`cctoolkit bg stop audit-stryker\`. \`ok\` true.`, { schema: OK, phase: 'Stryker', label: 'stryker stop', ...SHELL }).catch(() => null)
        state = MISSING
        reason = `Stryker exceeded ${STRYKER_HOURS} h — stopped`
      } else if (waited.state === 'done') {
        state = 'reused'
      } else {
        state = MISSING
        reason = `Stryker ${waited.state}: ${waited.line}`
      }
    }
    if (state === 'reused') {
      const read = await agent(
        [
          FRAME,
          '',
          'You read the Stryker results of this commit.',
          `1. Reports: when \`${cache}\` holds no \`*.json\`, copy each \`mutation-report.json\` this run wrote (the newest \`StrykerOutput/*/reports/mutation-report.json\` per config, named \`<config scope>.json\` — \`domain.json\`, \`application.json\`) into \`${cache}\`, then \`echo '${mode} ${mode === 'since' ? pre.sinceTarget : '-'}' > ${cache}/mode\`.`,
          `2. From those reports, write \`${tmp}/stryker.json\`: \`{"stryker": {…}}\` per the schema (\`date\` = ${date}, \`since_target\` = ${mode === 'since' ? `\`${pre.sinceTarget}\`` : '`null`'}, the scopes, \`fragile_files\` = the files with the most survivors).`,
          '`status` measured, `file` = the fragment path; no report found → `missing`.',
        ].join('\n'),
        { schema: FRAGMENT, phase: 'Stryker', label: 'stryker results', ...STEP },
      ).catch(() => null)
      state = read ? read.status : MISSING
      reason = read ? read.reason : 'agent without result'
      if (read && read.status === MEASURED) {
        fragments.push(read.file)
        strykerMeasured = true
      }
    }
    proof('stryker', state, reason)
  }

  phase('Assemble')
  const strykerSide = strykerMeasured
    ? `--stryker-dir ${cache}`
    : `--stryker-status ${evidence.stryker.status} --stryker-reason '${evidence.stryker.reason.replace(/'/g, '')}'`
  const coverageSide = coverageFile
    ? `--coverage ${coverageFile}`
    : `--coverage-status missing --coverage-reason '${(evidence.coverage.reason || 'no per-file coverage').replace(/'/g, '')}'`
  const metaBlock = {
    schema_version: '2.0',
    metadata: { date, updated_at: date, branch: pre.branch, stack, project_name: pre.project, commit: sha, evidence },
    ...nulls,
  }
  const sources = [...fragments, ...(collected ? [`codebase.hotspot_risk=${tmp}/risk.json`] : [])]
  const assemble = `cctoolkit report-assemble --out ${jsonPath} ${sources.join(' ')} --last ${tmp}/meta.json`
  const assembled = await agent(
    [
      FRAME,
      '',
      'These calls, in order, nothing else:',
      ...(collected ? [`- \`cctoolkit risk-cross --hotspots ${tmp}/collect.json ${coverageSide} ${strykerSide} --commit ${sha} > ${tmp}/risk.json\``] : []),
      `- the JSON below verbatim into \`${tmp}/meta.json\`, through a heredoc \`cat > ${tmp}/meta.json <<'META_JSON'\` … \`META_JSON\`;`,
      `- \`${assemble}\`.`,
      '`ok` = the last call exited 0; `detail` = its output line, or the failing call\'s error.',
      '',
      '```json',
      JSON.stringify(metaBlock, null, 1),
      '```',
    ].join('\n'),
    { schema: OK, phase: 'Assemble', label: 'assemble', ...SHELL },
  ).catch(() => null)
  if (!assembled || !assembled.ok) {
    outcome = { status: BLOCKED, reason: `report JSON not assembled: ${assembled ? assembled.detail : 'agent without result'}`, report: null, json: null, evidence }
  } else {
    phase('Report')
    const written = await agent(
      [
        FRAME,
        '',
        'You write the quality report. Your text is what the team reads: partial, non-complacent, precise.',
        `Read, in one message: \`${jsonPath}\` (every figure comes from it, none recomputed or invented), \`${tmp}/hotspots.md\` (the §2 Hotspots output, pasted as is), \`<kit>/skills/quality-report/report-template.md\` (structure copied verbatim) and \`<kit>/skills/quality-report/SKILL.md\` from \`## Report rules\` to the end (sections, evidence wording, writing tone, no trending).`,
        `Themes of the 30 days, from the activity agent: ${themes ? themes.replace(/\n/g, ' ') : '(none — say the themes could not be read)'}.`,
        `Stryker mode of this run: ${mode}${mode === 'since' ? ` (target ${pre.sinceTarget}: scores not comparable with a full run)` : ''}.`,
        `Write \`${mdPath}\` in one Write (replacing an older file of the same date: a report is a snapshot of its commit). Prose follows \`language.docs\` of \`kit.config.json\`; the template's anchors and table shapes stay.`,
        'Return `path`, `atAGlance` (the §1 sentence), `summary` (the §1 rows: dimension, status icon, value), `attention` (the HIGH actions of §8, each in one line) and `verdict` (the §9 sentence).',
      ].join('\n'),
      { schema: REPORT, phase: 'Report', label: 'report', model: 'opus', effort: 'medium' },
    ).catch(() => null)

    phase('Check')
    let checked = null
    for (let round = 0; round <= REPAIRS; round++) {
      checked = await agent(
        `${FRAME}\n\nRun \`cctoolkit quality-report-check ${jsonPath}\` once. \`exit\` = its exit code, \`lines\` = every output line verbatim.`,
        { schema: CHECKED, phase: 'Check', label: `check #${round + 1}`, ...SHELL },
      ).catch(() => null)
      if (!checked || checked.exit === 0 || round === REPAIRS) break
      await agent(
        [
          FRAME,
          '',
          `\`cctoolkit quality-report-check ${jsonPath}\` reports:`,
          ...checked.lines.map(l => `    ${l}`),
          `Each 🔴 line: find the cause in the fragment it comes from under \`${tmp}\` (a wrong sum, a figure in a block not measured, a percentage not recomputed), fix that fragment, re-run \`${assemble}\`, then fix the matching figures of \`${mdPath}\`. Never edit \`meta.json\`, never invent a figure: a value you cannot trace is \`null\`.`,
        ].join('\n'),
        { schema: FIXED, phase: 'Check', label: `repair #${round + 1}`, model: 'sonnet', effort: 'medium' },
      ).catch(() => null)
    }
    const coherence = written
      ? await agent(
          [
            FRAME,
            '',
            `You check \`${mdPath}\` against \`${jsonPath}\`: section \`### Coherence checks\` of \`<kit>/skills/quality-report/SKILL.md\`, every check but the arithmetic one (done by script). Fix the Markdown in place, one Edit per fix; the JSON is not yours to change.`,
            `For the hotspot check by hand, run its commands in the worktree (\`git log --follow …\`, \`lizard <file>\`): \`byHand\` = the two files, whether they match, the gap. A gap is said in §9, never corrected by hand in the figures.`,
            '`fixed` = what you changed, `remaining` = what you could not settle.',
          ].join('\n'),
          { schema: COHERENCE, phase: 'Check', label: 'coherence', model: 'sonnet', effort: 'medium' },
        ).catch(() => null)
      : null

    outcome = {
      status: written && checked && checked.exit === 0 ? DONE : BLOCKED,
      reason: !written ? 'Markdown report not written' : !checked ? 'check agent without result' : checked.exit === 0 ? '—' : `quality-report-check still red after ${REPAIRS} repairs`,
      report: written ? written.path : null,
      json: jsonPath,
      atAGlance: written ? written.atAGlance : '',
      summary: written ? written.summary : [],
      attention: written ? written.attention : [],
      verdict: written ? written.verdict : '',
      check: checked ? checked.lines : [],
      coherence,
      evidence,
    }
  }
} finally {
  phase('Cleanup')
  const cleaned = await agent(
    [
      `Workflow run-audit, cleanup. Autonomous mode. Run exactly these, from \`${checkout}\`, in one call: \`cctoolkit bg stop audit-stryker audit-sonar audit-tests; cctoolkit audit-worktree remove ${wt}; date +%s\`.`,
      `Then, only when told the run is DONE, \`cctoolkit run-work rm-tmp audit-${C}\` — never the \`stryker-${C}\` folder: a rerun on the same commit reuses its reports.`,
      `Run status: ${outcome && outcome.status === DONE ? 'DONE' : 'not DONE — keep the temp folder for the diagnosis'}.`,
      '`endedAt` = the epoch `date` printed; `ok` = the worktree was removed.',
    ].join('\n'),
    { schema: CLEANED, phase: 'Cleanup', label: 'cleanup', ...SHELL },
  ).catch(() => null)
  if (outcome && cleaned) outcome.minutes = Math.round((cleaned.endedAt - pre.startedAt) / 60)
  if (outcome && !(cleaned && cleaned.ok)) outcome.leftover = `worktree ${wt} not removed — cctoolkit audit-worktree prune`
}

return { ...outcome, stryker: mode, commit: sha, temp: outcome && outcome.status === DONE ? null : tmp }
