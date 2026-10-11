import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentSpawnInput, ModelUsage, On, TurnCompleteInput, TurnStepChunk, TurnStepInput } from 'claude-code'

import type { WorkflowAgent, WorkflowRun } from '../types'
import {
  alertOf, argumentOf, childWorkflowOf, lotRun, lotStateOf, mergeLots, parsePlanLots, planPathOf, promptLotOf, reportOutcomeOf, reportPathsOf, attemptsOf, auditLabel, auditOf, auditTone, blankAgent, coarse, completeRun, currentStep, demoHistory, demoRuns,
  callBrief, clockOf, closedCall, detailsOf, duration, editedPath, errorDetail, errorOf, errorsOf, promptBrief, structuredLines, withCall, headlineOf, figuresLine, firstLine, fit, oneLine, isSlow, isStepDone, journalPathOf, labelPhasesOf, lotOf, nestedPhaseOf, markOf, outcomeTone,
  parseJournal, parsePhases, parseSheet, phaseInsight, passesOf, phaseRows, remainingMs, samplesOf, sheetPathOf, shortModel, splitCost,
  liveSignalOf, stallReasons, throughputOf, toolSummary, totalsOf, typicalMs, typicalTools, weightOf, withFile, withSamples,
} from '../hooks/register'

const SESSION = '/home/u/.claude/projects/p/s1'
const PROJECT = '/home/u/.claude/projects/p'
const RUN = 'wf_5c0349cf-fb4'
const DIR = `${SESSION}/subagents/workflows/${RUN}`
const SHEET_PATH = 'todo/cycle-vie-produit-catalogue/CAT-CYCLE-PLAN-F4.md'
const REPORT_PATH = 'todo/cycle-vie-produit-catalogue/run/F4/F4-rapport.md'
const DEMO_REPORT = 'todo/catalog-lifecycle/run/F4/F4-report.md'
const DEMO_REASON = 'two fix rounds done, one blocking gap remains on the organization lock'
const REASON = 'la relecture du lot suivant porte au moins un Bloquant sur le verrou d’organisation de l’archivage'

const SCRIPT = `export const meta = {
  name: 'run-lot',
  description: 'Lot',
  phases: [
    { title: 'Design', detail: 'comportements' },
    { title: 'RED', detail: "tdd-test-author" },
    { title: 'GREEN', detail: 'tdd-implementer, serial' },
  ],
}
const x = [{ title: 'pas une phase' }]
const d = await agent(prompt, { schema: DESIGN, phase: 'Design', label: 'design' })
const r = await agent(prompt, { agentType: 'tdd-test-author', phase: 'RED', label: \`RED \${i + 1} \${short(c)}\` })
const a = await agent(prompt, { agentType: 'ddd-tdd-auditor', phase: 'Audit', label: retry ? \`audit retry \${retry.round}\` : 'audit' })
const f = await agent(prompt, { schema: FIX, phase: 'Audit', label: \`fix \${round}\`, model: 'sonnet' })
function reviewNext(label) {
  return agent(prompt, { agentType: 'adversarial-reviewer', phase: 'Review', label })
}
if (next) reviewing = reviewNext('next batch review')
const again = await reviewNext(\`next batch re-review \${n}\`)
`

const AUDIT_SCRIPT = `export const meta = {
  phases: [{ title: 'Audit', detail: 'ddd-tdd-auditor' }, { title: 'Report' }],
}
`

const SHEET = `# CAT-CYCLE-PLAN-F4 — Cycle de vie du produit

## Déroulement TDD

### Étape 1 — Créer le produit

TDD : RED ✅ · GREEN ✅ · COUT ✅

### Étape 2 — Refus sans catalogue

TDD : RED ✅ · GREEN ⬜ · COUT ⬜

#### Correction C1 — verrou posé après la création du produit

TDD : RED ⬜ · GREEN ⬜ · COUT ⬜

### Étape 3 — Verrou catalogue

TDD : RED ⬜ · GREEN ⬜ · COUT ⬜

### Étape 4 — Documentation — ✅ DONE (2026-10-10)

## Hypothèses

H1 — le verrou est posé à la création
H2 — le retrait est tracé
`

const JOURNAL = JSON.stringify({
  runId: RUN,
  status: 'completed',
  durationMs: 265913,
  args: SHEET_PATH,
  result: { status: 'BLOQUÉ', reason: REASON, verdict: 'ECARTS', gaps: [{ severity: 'Bloquant' }, { severity: 'Majeur' }], report: `/repo/${REPORT_PATH}` },
  phases: [{ title: 'Design', detail: 'comportements' }, { title: 'RED' }, { title: 'GREEN' }],
  workflowProgress: [
    { type: 'workflow_phase', index: 1, title: 'Design' },
    { type: 'workflow_agent', agentId: 'a1', phaseTitle: 'Design' },
    { type: 'workflow_agent', agentId: 'a2', phaseTitle: 'RED' },
  ],
})

const OLD_JOURNAL = JSON.stringify({
  status: 'completed',
  workflowProgress: [
    { type: 'workflow_agent', agentId: 'o1', phaseTitle: 'RED', state: 'done', durationMs: 20_000 },
    { type: 'workflow_agent', agentId: 'o2', phaseTitle: 'RED', state: 'done', durationMs: 20_000 },
    { type: 'workflow_agent', agentId: 'o3', phaseTitle: 'RED', state: 'error', durationMs: 1 },
    { type: 'workflow_agent', agentId: 'o4', phaseTitle: 'GREEN', state: 'done' },
  ],
})

const SPAN_JOURNAL = JSON.stringify({
  status: 'completed',
  workflowProgress: [
    { type: 'workflow_agent', agentId: 'h1', phaseTitle: 'Design', state: 'done', startedAt: 1_000, durationMs: 60_000, toolCalls: 10 },
    { type: 'workflow_agent', agentId: 'h2', phaseTitle: 'RED', state: 'done', startedAt: 61_000, durationMs: 100_000, toolCalls: 20 },
    { type: 'workflow_agent', agentId: 'h3', phaseTitle: 'RED', state: 'done', startedAt: 61_000, durationMs: 120_000, toolCalls: 30 },
    { type: 'workflow_agent', agentId: 'h4', phaseTitle: 'GREEN', state: 'done', startedAt: 181_000, durationMs: 240_000, toolCalls: 12 },
  ],
})

const KILLED_JOURNAL = JSON.stringify({ status: 'killed', durationMs: 5_000, args: SHEET_PATH })
const JOURNAL_PATH = `${SESSION}/workflows/${RUN}.json`

const agentOf = (id: string, phase: string, state: WorkflowAgent['state'], extra: Partial<WorkflowAgent> = {}): WorkflowAgent => ({
  ...blankAgent(id, 1, id, 'Opus', 'x', '', 0), phase, state, endedAt: state === 'running' ? null : 10, ...extra,
})

const runOf = (agents: WorkflowAgent[], overrides: Partial<WorkflowRun> = {}): WorkflowRun =>
  completeRun({
    runId: RUN, name: 'run-lot', phases: ['Design', 'RED', 'GREEN'], transcriptDir: DIR, startedAt: 0,
    durationMs: null, status: 'running', agents, ...overrides,
  } as WorkflowRun)

describe('reading the run', () => {
  test('agent detail: sorted tools, edited paths, errors, first line', () => {
    expect(toolSummary({ Read: 3, Bash: 5, Edit: 3 })).toBe('Bash 5 · Edit 3 · Read 3')
    expect(editedPath('Edit', { file_path: '/r/a.cs' })).toBe('/r/a.cs')
    expect(editedPath('Read', { file_path: '/r/a.cs' })).toBeNull()
    expect(withFile(['a', 'b'], 'a')).toEqual(['b', 'a'])
    expect(errorOf('Bash', { isError: true, text: 'exit 1\ndétail' })).toBe('Bash: détail')
    expect(errorOf('Bash', { deny: 'refusé' })).toBe('Bash: denied · refusé')
    expect(errorOf('Bash', { text: 'ok' })).toBeNull()
    expect(firstLine('\n  Workflow run-lot\nsuite')).toBe('Workflow run-lot')
  })

  test('call trace: short argument per tool, error with exit code and last output line, recovered or final', () => {
    expect(callBrief('Bash', { description: 'Run the unit tests', command: 'dotnet test' }, '/r')).toBe('Run the unit tests')
    expect(callBrief('Bash', { command: 'grep -n foo src\nsecond' }, '/r')).toBe('grep -n foo src')
    expect(callBrief('Read', { file_path: '/r/src/a.cs' }, '/r')).toBe('src/a.cs')
    expect(callBrief('Grep', { pattern: 'Lock', path: '/r/src' }, '/r')).toBe('Lock in src')
    expect(callBrief('Skill', { tool: 'Skill', agentId: 'a1', skill: 'tests-unit-tests' }, '/r')).toBe('tests-unit-tests')
    expect(callBrief('StructuredOutput', { verdict: 'VALIDE' }, '/r')).toBe('')
    expect(errorDetail({ isError: true, text: 'Exit code 1' })).toBe('exit 1')
    expect(errorDetail({ isError: true, text: 'Exit code 1\nBuild started\nFailed: 2, Passed: 41\n' })).toBe('exit 1 · Failed: 2, Passed: 41')
    expect(errorOf('Bash', { isError: true, text: 'Exit code 2\nboom' }, 'Run the unit tests')).toBe('Bash · Run the unit tests: exit 2 · boom')
    expect(clockOf(127_400)).toBe('2:07')

    const trace = (id: string) => ({ id, tool: 'Bash', brief: id, at: 0, state: 'running' as const, error: null })
    const failed = closedCall(withCall(withCall([], trace('c1')), trace('c2')), 'c1', 'exit 1')
    const agent = { ...blankAgent('a1', 1, 'audit', 'Opus', 'ddd-tdd-auditor', 'x', 0), calls: failed }
    expect(errorsOf(agent)).toMatchObject({ count: 1, isRecovered: false })
    expect(errorsOf({ ...agent, calls: closedCall(failed, 'c2', null) })).toMatchObject({ count: 1, isRecovered: true, last: { id: 'c1' } })
    expect(errorsOf({ ...agent, state: 'error', calls: closedCall(failed, 'c2', null) }).isRecovered).toBe(false)
    expect(withCall(Array.from({ length: 300 }, (_, i) => trace(`c${i}`)), trace('last'))[0]?.id).toBe('c1')
  })

  test('structured answer: verdict label, every gap with severity and axis, scalars, empty lists; prompt without the workflow frame', () => {
    expect(structuredLines({
      tool: 'StructuredOutput', agentId: 'a1', verdict: 'ECARTS', block: '## Verdict\nlong',
      gaps: [{ severity: 'Blocking', axis: 'Correctness', gap: 'lock not checked', evidence: 'A.cs:4' }, { severity: 'Minor', axis: 'Reuse', gap: 'dup' }],
    })).toEqual(['ECARTS · 1 blocking', 'block: ## Verdict', 'gaps · 2', '  Blocking · Correctness · lock not checked', '  Minor · Reuse · dup'])
    expect(structuredLines({ result: 'CLEAR', questions: [] })).toEqual(['result: CLEAR', 'questions: none'])
    expect(structuredLines('text')).toBeNull()
    expect(structuredLines({ tool: 'StructuredOutput' })).toBeNull()
    expect(structuredLines({ items: Array.from({ length: 30 }, (_, i) => `i${i}`) })?.at(-1)).toBe('… 12 more lines')

    const frame = 'Workflow run-lot, batch F1. Global plan: p.md. Batch sheet: s.md.\nAutonomous mode: nobody answers.'
    expect(promptBrief(`${frame}\n\nmode: fast F1 s.md\n\nReturn the verdict.`)).toBe('mode: fast F1 s.md\nReturn the verdict.')
    expect(promptBrief('Workflow run-lot, batch F4. RED 1.')).toBe('Workflow run-lot, batch F4. RED 1.')
    expect(promptBrief('Write the test.\n\nThen stop.')).toBe('Write the test.\nThen stop.')
  })

  test('phases and their detail read from meta.phases only, bracket inside a detail included', () => {
    expect(parsePhases(SCRIPT)).toEqual([
      { title: 'Design', detail: 'comportements' },
      { title: 'RED', detail: 'tdd-test-author' },
      { title: 'GREEN', detail: 'tdd-implementer, serial' },
    ])
    expect(parsePhases('export const meta = { name: "x" }')).toEqual([])
    const bracketed = parsePhases("const meta = { phases: [{ title: 'A', detail: 'liste [x] ici' }, { title: 'B' }] }; const y = [{ title: 'C' }]")
    expect(bracketed).toEqual([{ title: 'A', detail: 'liste [x] ici' }, { title: 'B', detail: null }])
    expect(detailsOf(bracketed)).toEqual({ A: 'liste [x] ici' })
  })

  test('final journal: path, status, duration, argument, full outcome, verdict, phase per agent', () => {
    expect(journalPathOf(DIR, RUN)).toBe(`${SESSION}/workflows/${RUN}.json`)
    const journal = parseJournal(JOURNAL)
    expect(journal?.status).toBe('completed')
    expect(journal?.durationMs).toBe(265913)
    expect(journal?.argument).toBe(SHEET_PATH)
    expect(journal?.outcome).toEqual({ label: 'BLOQUÉ', reason: REASON, report: `/repo/${REPORT_PATH}` })
    expect(journal?.audit).toEqual({ verdict: 'ECARTS', blocking: 1, major: 1 })
    expect(journal?.details).toEqual({ Design: 'comportements' })
    expect(journal?.agentPhases).toEqual({ a1: 'Design', a2: 'RED' })
    expect(parseJournal('{')).toBeNull()
  })

  test('outcome: French or English keys, dash ignored, bare text, journal error, tone per status', () => {
    const french = parseJournal(JSON.stringify({ status: 'completed', result: { statut: 'TERMINÉ', raison: '—', rapport: 'r.md' } }))
    expect(french?.outcome).toEqual({ label: 'TERMINÉ', reason: null, report: 'r.md' })
    expect(parseJournal(JSON.stringify({ status: 'completed', result: 'fini\nsuite' }))?.outcome).toEqual({ label: 'fini', reason: null, report: null })
    expect(parseJournal(JSON.stringify({ status: 'failed', error: 'boom' }))?.outcome).toEqual({ label: 'failed', reason: 'boom', report: null })
    const tone = (label: string, status: 'completed' | 'failed' = 'completed') => outcomeTone({ label, reason: null, report: null }, status)
    expect([tone('TERMINÉ'), tone('ECARTS'), tone('RELECTURE-BLOQUANTE'), tone('BLOQUÉ'), tone('?', 'failed')]).toEqual([
      'success', 'warning', 'warning', 'error', 'error',
    ])
    expect([tone('DONE'), tone('GAPS'), tone('REVIEW-BLOCKING'), tone('BLOCKED')]).toEqual(['success', 'warning', 'warning', 'error'])
    expect([tone('ATTENTE-RÉPONSE'), tone('AWAITING-ANSWER')]).toEqual(['cyan', 'cyan'])
  })

  test('durations in whole minutes and short model names', () => {
    expect(duration(42_000)).toBe('0m42')
    expect(duration(252_000)).toBe('4m12')
    expect(duration(3_780_000)).toBe('1h03')
    expect(shortModel('claude-sonnet-5-5')).toBe('Sonnet')
    expect(shortModel('haiku')).toBe('Haiku')
    expect(shortModel('claude-fable-5-1')).toBe('Fable')
    expect(shortModel('claude-x-1-20250101')).toBe('x-1')
  })

  test('phase reached with no running agent: done; upcoming phase: pending, with its detail', () => {
    const rows = phaseRows(
      runOf([agentOf('a1', 'Design', 'done'), agentOf('a2', 'RED', 'running')], { details: { GREEN: 'serial' } }),
      30,
    )
    expect(rows.map(row => row.mark)).toEqual(['done', 'running', 'pending'])
    expect(rows.map(row => row.detail)).toEqual([null, null, 'serial'])
    expect(rows[1]?.span).toBe(30)
  })

  test('stop report then resume: Report phase pending again, no agent, no duration', () => {
    const stopped = agentOf('rep', 'Report', 'done', { startedAt: 5, endedAt: 10 })
    const phases = ['Design', 'RED', 'GREEN', 'Report']
    const resumed = phaseRows(runOf([agentOf('d', 'Design', 'done', { endedAt: 4 }), stopped, agentOf('g', 'GREEN', 'running', { startedAt: 20 })], { phases }), 30)
    expect(resumed.map(row => [row.title, row.mark, row.agents.length, row.span])).toEqual([
      ['Design', 'done', 1, 4], ['RED', 'pending', 0, 0], ['GREEN', 'running', 1, 10], ['Report', 'pending', 0, 0],
    ])
    expect(phaseRows(runOf([agentOf('d', 'Design', 'done', { endedAt: 4 }), stopped], { phases }), 30).at(-1)?.mark).toBe('done')
  })

  test('resume after an answer: phases past the restart pending again, previous pass kept apart', () => {
    const phases = ['Design', 'RED', 'GREEN', 'Global green', 'Closing', 'Audit', 'Review', 'Report']
    const first = [
      agentOf('d', 'Design', 'done', { startedAt: 0, endedAt: 4 }),
      agentOf('r1', 'RED', 'done', { label: 'RED 1', startedAt: 5, endedAt: 8 }),
      agentOf('g1', 'GREEN', 'done', { label: 'GREEN 1', startedAt: 9, endedAt: 12 }),
      agentOf('s', 'Global green', 'done', { startedAt: 13, endedAt: 14 }),
      agentOf('c', 'Closing', 'done', { startedAt: 13, endedAt: 16 }),
      agentOf('a', 'Audit', 'done', { startedAt: 17, endedAt: 20 }),
      agentOf('v', 'Review', 'done', { startedAt: 18, endedAt: 19 }),
      agentOf('a2', 'Audit', 'done', { label: 'audit retry 1', startedAt: 21, endedAt: 22 }),
    ]
    expect(passesOf(runOf(first, { phases }))).toEqual({ start: null, count: 1 })
    const run = runOf([...first, agentOf('r1b', 'RED', 'running', { label: 'RED 1', startedAt: 100 })], { phases })
    expect(passesOf(run)).toEqual({ start: 100, count: 2 })
    const rows = phaseRows(run, 130)
    expect(rows.map(row => [row.title, row.mark, row.agents.length, row.earlier.length, row.span])).toEqual([
      ['Design', 'done', 1, 0, 4], ['RED', 'running', 2, 0, 30], ['GREEN', 'pending', 0, 1, 0], ['Global green', 'pending', 0, 1, 0],
      ['Closing', 'pending', 0, 1, 0], ['Audit', 'pending', 0, 2, 0], ['Review', 'pending', 0, 1, 0], ['Report', 'pending', 0, 0, 0],
    ])
    expect(currentStep(run, rows)?.row.title).toBe('RED')
    expect(remainingMs(run, rows, { GREEN: spanned(60_000), Closing: spanned(100_000), Audit: spanned(50_000) })).toBe(210_000)
  })

  test('stop awaiting an answer: header reads waiting for user, not failed', () => {
    const outcome = (label: string) => ({ label, reason: null, report: null })
    expect(['BLOQUÉ', 'BLOCKED', 'ATTENTE-RÉPONSE', 'RELECTURE-BLOQUANTE'].map(label => headlineOf('failed', outcome(label)).text)).toEqual(Array(4).fill('waiting for user'))
    expect(headlineOf('completed', outcome('ATTENTE-RÉPONSE'))).toEqual({ glyph: '?', text: 'waiting for user', tone: 'cyan' })
    expect([headlineOf('failed', null).text, headlineOf('completed', outcome('TERMINÉ')).text, headlineOf('running', outcome('BLOQUÉ')).text]).toEqual(['failed', 'completed', 'running'])
  })

  test('current step: last running phase, else first pending, none once the run ends', () => {
    expect(figuresLine(totalsOf([{ ...agentOf('x', 'RED', 'done'), context: 1_500, tokens: 2_400_000, cost: 1.234 }]))).toBe('ctx 2k · 2.4M tok · $1.23')
    const red = [{ ...agentOf('r1', 'RED', 'done'), cost: 0.3 }, { ...agentOf('r2', 'RED', 'running'), cost: 0.1 }]
    const insight = phaseInsight(
      phaseRows(runOf(red), 30).find(row => row.title === 'RED')!,
      runOf([...red, { ...agentOf('g', 'GREEN', 'done'), cost: 0.6 }]),
      30,
    )
    expect([insight.share, insight.costliest, insight.slowest]).toEqual([40, 'r1', 'r2'])
    const step = (run: WorkflowRun) => currentStep(run, phaseRows(run, 30))

    const current = step(runOf([agentOf('a1', 'Design', 'done'), agentOf('a2', 'RED', 'done'), agentOf('a3', 'RED', 'running')]))
    expect([current?.row.title, current?.index, current?.total, current?.done, current?.running]).toEqual(['RED', 1, 3, 1, 1])
    expect(step(runOf([agentOf('a1', 'Design', 'done')]))?.row.title).toBe('RED')
    expect(step(runOf([agentOf('a1', 'Design', 'done')], { status: 'completed' }))).toBeNull()
  })

  test('columns: label truncated with an ellipsis', () => {
    expect(fit('GREEN 2 verrou', 14)).toBe('GREEN 2 verrou')
    expect(fit('GREEN 2 verrou', 8)).toBe('GREEN 2…')
    expect(fit('abc', 0)).toBe('')
    expect(oneLine('RED not 0 on\n  `dotnet test`\n')).toBe('RED not 0 on `dotnet test`')
  })

  test('batch named from the workflow argument, string or object', () => {
    expect(lotOf(SHEET_PATH)).toEqual({ lot: 'F4', code: 'CAT-CYCLE' })
    expect(lotOf('todo/x/notes.md')).toBeNull()
    expect(lotOf(null)).toBeNull()
    expect(argumentOf({ name: 'run-lot', args: `  ${SHEET_PATH} ` })).toBe(SHEET_PATH)
    expect(argumentOf({ args: { sheet: SHEET_PATH } })).toBe(SHEET_PATH)
    expect(argumentOf({ name: 'run-lot' })).toBeNull()
    expect(sheetPathOf(SHEET_PATH)).toBe(SHEET_PATH)
    expect(sheetPathOf('todo/x/X-PLAN.md')).toBeNull()
  })

  test('sheet: steps, TDD marks, fixes, assumptions, step closed by its title', () => {
    const sheet = parseSheet(SHEET, SHEET_PATH)
    expect(sheet.lot).toBe('F4')
    expect(sheet.name).toBe('Cycle de vie du produit')
    expect(sheet.hypotheses).toBe(2)
    expect(sheet.isDone).toBe(false)
    expect(sheet.steps.map(step => step.number)).toEqual(['1', '2', '3', '4'])
    expect(sheet.steps[0]?.tdd).toEqual({ red: '✅', green: '✅', cost: '✅' })
    expect(sheet.steps[1]?.corrections).toEqual([
      { id: 'C1', finding: 'verrou posé après la création du produit', tdd: { red: '⬜', green: '⬜', cost: '⬜' } },
    ])
    expect(sheet.steps.map(isStepDone)).toEqual([true, false, false, true])
    expect(sheet.steps[3]).toEqual({ number: '4', title: 'Documentation', isDone: true, tdd: null, corrections: [] })
    expect([markOf('✅'), markOf('⬜'), markOf('')]).toEqual(['✓', '·', '·'])
    expect(parseSheet('# X-PLAN-F5 — Verrous — ✅ DONE (2026-10-03)\n', 'todo/x/X-PLAN-F5.md').isDone).toBe(true)
    const english = parseSheet('# X-PLAN-F5 — Locks\n\n## TDD sequence\n\n### Step 1 — Create\n\nTDD: RED ✅ · GREEN ✅ · COST ✅\n', 'todo/x/X-PLAN-F5.md')
    expect(english.steps[0]?.tdd).toEqual({ red: '✅', green: '✅', cost: '✅' })
  })

  test('slow agent: beyond twice the mean of the phase’s finished agents, nothing without history', () => {
    const done = (id: string, ms: number) => agentOf(id, 'GREEN', 'done', { startedAt: 0, endedAt: ms })
    const peers = [done('p1', 40_000), done('p2', 60_000), agentOf('failed', 'GREEN', 'error', { startedAt: 0, endedAt: 1 })]
    const slow = agentOf('s', 'GREEN', 'running', { startedAt: 0 })
    expect(typicalMs({}, peers, slow)).toBe(50_000)
    expect(isSlow(slow, 50_000, 100_000)).toBe(false)
    expect(isSlow(slow, 50_000, 100_001)).toBe(true)
    expect(typicalMs({}, [slow], slow)).toBeNull()
    expect(isSlow(slow, null, 9_999_999)).toBe(false)

    const known = withSamples({}, samplesOf(OLD_JOURNAL))
    expect(known).toEqual({ RED: { total: 40_000, count: 2, tools: 0, toolCount: 0, span: 0, spanCount: 0 } })
    expect(typicalMs(known, [], agentOf('r', 'RED', 'running'))).toBe(20_000)
    expect(typicalMs(known, peers, slow)).toBe(50_000)
    expect(samplesOf('{')).toEqual([])
  })

  test('audit verdict: severities counted, minors ignored, label and tone', () => {
    const verdict = auditOf({ verdict: 'ECARTS', gaps: [{ severity: 'Bloquant' }, { severity: 'Majeur' }, { severity: 'Majeur' }, { severity: 'Mineur' }] })
    expect(verdict).toEqual({ verdict: 'ECARTS', blocking: 1, major: 2 })
    expect(verdict && auditLabel(verdict)).toBe('ECARTS · 1 blocking · 2 major')
    const english = auditOf({ verdict: 'GAPS', gaps: [{ severity: 'Blocking' }, { severity: 'Major' }, { severity: 'Minor' }] })
    expect(english).toEqual({ verdict: 'GAPS', blocking: 1, major: 1 })
    expect(english && auditLabel(english)).toBe('GAPS · 1 blocking · 1 major')
    expect(auditTone({ verdict: 'VALID', blocking: 0, major: 0 })).toBe('success')
    expect(verdict && auditTone(verdict)).toBe('error')
    const valid = auditOf({ verdict: 'VALIDE', gaps: [] })
    expect(valid && auditLabel(valid)).toBe('VALIDE')
    expect(valid && auditTone(valid)).toBe('success')
    expect(auditTone({ verdict: 'ECARTS', blocking: 0, major: 1 })).toBe('warning')
    expect(auditOf({ verdict: 'ÉCARTS', gaps: [{ severity: 'Majeur' }] })).toEqual({ verdict: 'ÉCARTS', blocking: 0, major: 1 })
    expect(outcomeTone({ label: 'ÉCARTS', reason: null, report: null }, 'completed')).toBe('warning')
    expect(auditOf({ verdict: 'none' })).toBeNull()
    expect(auditOf({ result: 'RAS' })).toBeNull()
    expect(auditOf(null)).toBeNull()
  })

  test('retry: an agent relaunched under the same label carries its attempt number', () => {
    const labelled = (id: string, label: string, startedAt: number) => agentOf(id, 'GREEN', 'done', { label, startedAt })
    expect(attemptsOf([labelled('c', 'GREEN 2', 300), labelled('a', 'GREEN 1', 100), labelled('b', 'GREEN 2', 200)])).toEqual({ a: 1, b: 1, c: 2 })
  })
})

const spanned = (ms: number) => ({ total: ms, count: 1, tools: 0, toolCount: 0, span: ms, spanCount: 1 })

describe('history, estimated end, stall, cost and alert', () => {
  test('finished journal: tools per agent and span of each phase, no span for a stopped run', () => {
    const known = withSamples({}, samplesOf(SPAN_JOURNAL))
    expect(known.RED).toEqual({ total: 220_000, count: 2, tools: 50, toolCount: 2, span: 120_000, spanCount: 1 })
    expect(known.Design?.span).toBe(60_000)
    expect(withSamples({}, samplesOf(SPAN_JOURNAL.replace('"completed"', '"killed"'))).RED).toEqual({
      total: 220_000, count: 2, tools: 50, toolCount: 2, span: 0, spanCount: 0,
    })
    const twice = withSamples(known, samplesOf(SPAN_JOURNAL))
    expect([twice.RED?.span, twice.RED?.spanCount]).toEqual([240_000, 2])
  })

  test('stall: tools beyond twice the phase mean (40 without history), context beyond 150k, idle beyond 1 min outside a running call', () => {
    const running = (extra: Partial<WorkflowAgent>) => agentOf('s', 'GREEN', 'running', { startedAt: 0, ...extra })
    expect(stallReasons(running({ tools: 40 }), null, 1_000)).toEqual([])
    expect(stallReasons(running({ tools: 41 }), null, 1_000)).toEqual(['⚠ 41 tools'])
    expect(stallReasons(running({ tools: 29 }), 14, 1_000)).toEqual(['⚠ 29 tools'])
    expect(stallReasons(running({ tools: 28 }), 14, 1_000)).toEqual([])
    expect(stallReasons(running({ context: 150_000 }), null, 1_000)).toEqual([])
    expect(stallReasons(running({ context: 160_000 }), null, 1_000)).toEqual(['⚠ ctx 160k'])
    expect(stallReasons(running({}), null, 60_000)).toEqual([])
    expect(stallReasons(running({}), null, 60_001)).toEqual(['⚠ idle 1m'])
    expect(stallReasons(running({ openCalls: 1 }), null, 600_000)).toEqual([])
    expect(stallReasons(agentOf('d', 'GREEN', 'done', { tools: 99 }), null, 600_000)).toEqual([])
    expect(stallReasons(running({ tools: 50, context: 160_000 }), null, 200_000)).toEqual(['⚠ idle 3m', '⚠ 50 tools', '⚠ ctx 160k'])
  })

  test('exclusive live signal: long tool, waiting, idle, slow; throughput on the current request', () => {
    const running = (extra: Partial<WorkflowAgent>) => agentOf('s', 'GREEN', 'running', { startedAt: 0, lastActiveAt: 0, ...extra })
    const streaming = (chars: number, span: number) => running({ streamKind: 'output', streamChars: chars, firstChunkAt: 0, lastChunkAt: span })
    expect(throughputOf(streaming(16_000, 100_000))).toBe(40)
    expect(throughputOf(streaming(600, 999))).toBeNull()
    expect(throughputOf(running({ streamChars: 600, firstChunkAt: 0, lastChunkAt: 5_000 }))).toBeNull()
    expect(liveSignalOf(streaming(1_600, 61_000), 61_000)).toBe('slow')
    expect(liveSignalOf(streaming(1_600, 60_000), 60_000)).toBeNull()
    expect(liveSignalOf(streaming(36_600, 61_000), 61_000)).toBeNull()
    expect(liveSignalOf(streaming(1_600, 61_000), 121_001)).toBe('idle 1m')
    expect(liveSignalOf(running({ waitingSince: 0 }), 120_000)).toBeNull()
    expect(liveSignalOf(running({ waitingSince: 0 }), 120_001)).toBe('waiting')
    expect(liveSignalOf(running({ openCalls: 1, toolSince: 0 }), 300_000)).toBeNull()
    expect(liveSignalOf(running({ openCalls: 1, toolSince: 0, waitingSince: 0 }), 300_001)).toBe('long tool')
    expect(liveSignalOf(agentOf('d', 'GREEN', 'done', { waitingSince: 0 }), 600_000)).toBeNull()
  })

  test('phase tool mean: history then the run’s finished agents', () => {
    const known = withSamples({}, samplesOf(SPAN_JOURNAL))
    const target = agentOf('r', 'RED', 'running')
    expect(typicalTools(known, [], target)).toBe(25)
    expect(typicalTools(known, [agentOf('p', 'RED', 'done', { tools: 40 })], target)).toBe(30)
    expect(typicalTools({}, [], target)).toBeNull()
  })

  test('estimated end: rest of the current phase and upcoming phases, parallel pair at its max, nothing without history', () => {
    const at = 1_000_000
    const demo = demoRuns(at)[0]!
    const rows = phaseRows(demo, at)
    expect(remainingMs(demo, rows, demoHistory())).toBe(530_000)
    expect(coarse(530_000)).toBe('9m')
    expect(remainingMs(demo, rows, {})).toBeNull()
    expect(remainingMs({ ...demo, status: 'completed' }, rows, demoHistory())).toBeNull()

    const pair = runOf([agentOf('d', 'Design', 'done')], { phases: ['Design', 'Global green', 'Closing'] })
    const pairRows = phaseRows(pair, 30)
    expect(remainingMs(pair, pairRows, { 'Global green': spanned(60_000), Closing: spanned(100_000) })).toBe(100_000)
    expect(remainingMs(pair, pairRows, { 'Global green': spanned(60_000) })).toBe(60_000)

    const serial = runOf([agentOf('d', 'Design', 'done')])
    expect(remainingMs(serial, phaseRows(serial, 30), { RED: spanned(60_000), GREEN: spanned(100_000) })).toBe(160_000)
    const overrun = runOf([agentOf('d', 'Design', 'done'), agentOf('r', 'RED', 'running', { startedAt: 0 })])
    expect(remainingMs(overrun, phaseRows(overrun, 90_000), { RED: spanned(60_000), GREEN: spanned(100_000) })).toBe(100_000)
    expect(remainingMs(serial, phaseRows(serial, 30), withSamples({}, samplesOf(OLD_JOURNAL)))).toBe(20_000)
  })

  test('interrupted agent: no retry attempt, not running, phase not reached', () => {
    const stopped = agentOf('a', 'GREEN', 'interrupted', { label: 'GREEN 2', startedAt: 100 })
    const failed = agentOf('c', 'GREEN', 'error', { label: 'GREEN 2', startedAt: 150 })
    const again = agentOf('b', 'GREEN', 'running', { label: 'GREEN 2', startedAt: 200 })
    expect(attemptsOf([stopped, again])).toEqual({ a: 1, b: 1 })
    expect(attemptsOf([stopped, failed, again])).toEqual({ a: 1, c: 1, b: 2 })
    const run = runOf([agentOf('d', 'Design', 'done'), agentOf('g', 'GREEN', 'interrupted')])
    expect(phaseRows(run, 30).map(row => row.mark)).toEqual(['done', 'pending', 'pending'])
    expect(totalsOf([agentOf('g', 'GREEN', 'interrupted', { context: 90_000 }), agentOf('d', 'Design', 'done', { context: 10_000 })]).context).toBe(90_000)
  })

  test('cost split by weighted tokens, cache reads weighted low, sum preserved', () => {
    const used = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2_000 }
    expect(weightOf(used)).toBe(7_500)
    const micros = (value: number | undefined) => Math.round((value ?? 0) * 1e6)
    const shares = splitCost(0.3, { a: 3_000, b: 1_000 })
    expect([micros(shares.a), micros(shares.b)]).toEqual([225_000, 75_000])
    const spread = splitCost(0.37, { a: 1, b: 2, c: 4 })
    expect(micros(Object.values(spread).reduce((sum, one) => sum + one, 0))).toBe(370_000)
    expect([splitCost(0, { a: 1 }), splitCost(0.3, {}), splitCost(0.3, { a: 0 })]).toEqual([{}, {}, {}])
  })

  test('end alert: batch, outcome, duration in minutes, reason truncated unless success', () => {
    const finished = (outcome: WorkflowRun['outcome'], status: WorkflowRun['status'] = 'completed') =>
      alertOf(runOf([], { argument: SHEET_PATH, status, durationMs: 27 * 60_000 + 5_000, outcome }))
    expect(finished({ label: 'TERMINÉ', reason: 'ignorée', report: null })).toBe('run-lot F4 · TERMINÉ · 27m')
    expect(finished({ label: 'BLOQUÉ', reason: REASON, report: null })).toBe(`run-lot F4 · BLOQUÉ · 27m · ${REASON}`)
    expect(finished({ label: 'ECARTS', reason: 'x'.repeat(200), report: null })).toBe(`run-lot F4 · ECARTS · 27m · ${'x'.repeat(109)}…`)
    expect(finished({ label: 'DONE', reason: 'ignored', report: null })).toBe('run-lot F4 · DONE · 27m')
    expect(finished({ label: 'BLOCKED', reason: 'gap on the lock', report: null })).toBe('run-lot F4 · BLOCKED · 27m · gap on the lock')
    expect(finished(null, 'killed')).toBe('run-lot F4 · STOPPED · 27m')
    expect(alertOf(runOf([], { status: 'completed', durationMs: 3_900_000, outcome: { label: 'TERMINÉ', reason: null, report: null } }))).toBe(
      'run-lot · TERMINÉ · 1h05',
    )
    expect([coarse(20_000), coarse(14 * 60_000 + 20_000)]).toEqual(['1m', '14m'])
  })
})

type Stamps = Record<string, number>
type Directory = Record<string, { name: string; kind: 'file' | 'dir'; mtimeMs?: number }[]>
type Options = {
  closed?: string[]
  stamps?: Stamps
  dirs?: Directory
  reads?: string[]
  toasts?: string[]
  price?: (agentId: string | undefined) => number
  usage?: (agentId: string | undefined) => Partial<ModelUsage> | undefined
  hold?: Promise<void>
  workflowName?: string
  stream?: (e: TurnStepInput) => AsyncIterable<TurnStepChunk>
  bashFails?: boolean
}

const world = (on: On, files: Record<string, string>, options: Options = {}) => {
  const { closed = [], stamps = {}, dirs = {}, reads = [], toasts = [] } = options
  const clock = mock.clock(on)
  let agents = 0
  let spent = 1
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], cost: { usd: spent } } }))
  on('turn.step', async function* ($, e) {
    if (options.stream !== undefined) yield* options.stream(e)
    spent += options.price?.(e.agentId) ?? 0.25
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use',
      usage: {
        input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2_000, model: 'claude-sonnet-5-5',
        ...options.usage?.(e.agentId),
      },
    }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const keyOf = (path: string) => Object.keys(files).find(key => key === path || (!key.startsWith('/') && path.endsWith(`/${key}`)))
  on('fs.read', ($, e) => {
    const key = keyOf(e.path)
    reads.push(key ?? e.path)
    return key === undefined ? { deny: `ENOENT ${e.path}` } : { value: files[key] ?? '' }
  })
  on('fs.stat', ($, e) => {
    const key = keyOf(e.path)
    return key === undefined
      ? { deny: `ENOENT ${e.path}` }
      : { value: { kind: 'file', size: 1, mtimeMs: stamps[key] ?? 1, isLink: false } }
  })
  on('fs.list', ($, e) => {
    const entries = dirs[e.path ?? '']
    return entries === undefined
      ? { deny: `ENOENT ${e.path}` }
      : { value: entries.map(entry => ({ name: entry.name, kind: entry.kind, size: 1, mtimeMs: entry.mtimeMs ?? 0, isLink: false })) }
  })
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash') await options.hold
    return e.tool === 'Workflow'
      ? {
          result: {
            status: 'async_launched',
            taskId: 't1',
            runId: RUN,
            workflowName: options.workflowName ?? 'run-lot',
            transcriptDir: DIR,
            scriptPath: `${SESSION}/workflows/scripts/run-lot-${RUN}.js`,
          },
          text: 'launched',
        }
      : e.tool === 'Bash' && options.bashFails === true
        ? { result: { type: 'text' }, text: 'Exit code 1\n', isError: true }
        : { result: { type: 'text' }, text: 'ok' }
  })
  on('agent.spawn', () => {
    agents += 1
    return { model: 'claude-sonnet-5-5', agentId: `a${agents}` }
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return clock
}

const PANE = {
  component: 'Pane',
  requestId: 'run-lot-pane',
  props: { title: 'Workflow', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const paneAt = (bodyColumns: number) => ({ ...PANE, props: { ...PANE.props, bodyColumns } })

type Finder = { find: (query: { key: string }) => Promise<{ children: unknown[] } | undefined> }

const colorOf = async (ui: Finder, key: string) =>
  ((await ui.find({ key }))?.children[0] as { props?: { color?: string } } | undefined)?.props?.color

const drain = async (stream: AsyncIterable<unknown>) => {
  for await (const _ of stream);
}

const spawn = (description: string, agentIndex: number, prompt = 'x') =>
  ({
    tool_use_id: 'w1', prompt, description, subagentType: 'tdd-test-author', provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5', background: true, fork: false, workflow: { runId: RUN, agentIndex },
  }) as AgentSpawnInput

const complete = (agentId: string, answer = 'fini') =>
  ({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't', agentId }) as unknown as TurnCompleteInput

const launch = ($: Engine, args: string | null = SHEET_PATH) =>
  $.tool.call({ tool: 'Workflow', tool_use_id: 'w1', name: 'run-lot', ...(args === null ? {} : { args }) } as Parameters<typeof $.tool.call>[0])

test('pane follows phases in columns, agents, sheet, slowness then the run outcome', async ($, on) => {
  const toasts: string[] = []
  const reads: string[] = []
  const stamps: Stamps = {}
  const files: Record<string, string> = {
    [`${SESSION}/workflows/scripts/run-lot-${RUN}.js`]: SCRIPT,
    [`${DIR}/agent-a1.meta.json`]: JSON.stringify({ description: 'design', workflowPhase: 'Design' }),
    [`${DIR}/agent-a2.meta.json`]: JSON.stringify({ description: 'RED 1 créer', workflowPhase: 'RED' }),
    [SHEET_PATH]: SHEET,
    [`${PROJECT}/s0/workflows/wf_old.json`]: OLD_JOURNAL,
  }
  const dirs: Directory = {
    [PROJECT]: [{ name: 's1', kind: 'dir' }, { name: 's0', kind: 'dir' }, { name: 'notes.jsonl', kind: 'file' }],
    [`${PROJECT}/s0/workflows`]: [{ name: 'wf_old.json', kind: 'file', mtimeMs: 5 }],
    [`${PROJECT}/s1/workflows`]: [{ name: `${RUN}.json`, kind: 'file', mtimeMs: 9 }],
  }
  const clock = world(on, files, { stamps, dirs, reads, toasts })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($)
  await $.agent.spawn(spawn('design', 1))
  await $.turn.complete(complete('a1'))
  await $.agent.spawn(spawn('RED 1 créer', 2))
  await drain($.turn.step({ turnId: 'main', index: 0, model: 'claude-opus-5-5', messageCount: 1 }))
  await drain($.turn.step({ turnId: 'r', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, agentId: 'a2' }))
  await drain($.turn.step({ turnId: 'r', index: 1, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 2, agentId: 'a2' }))
  await $.tool.call({ tool: 'Edit', agentId: 'a2', file_path: 'f', old_string: 'a', new_string: 'b' } as Parameters<typeof $.tool.call>[0])
  await clock.advance(62_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /✻ run-lot · F4 · CAT-CYCLE/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /running\s+1m0\d\s+1\/2 agents/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /━+─+\s+1\/3 phases/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ {2}Session$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ctx 84k \(42%\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$1\.75$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ {2}Run$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^87k tok$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^agents$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^time$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^cost$/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /⏺ Design/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /[✢✳✶✻✽] RED(?! 1)/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /[✢✳✶✻✽] RED 1 créer/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /○ GREEN/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /tdd-test-author/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /tdd-implementer, serial/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /comportements/ })).toBeUndefined()
    expect((await ui.find({ key: 'model-a2' }))?.text).toBe('Sonnet · high')
    expect((await ui.find({ key: 'agent-a2-time' }))?.text).toMatch(/^1m0\d$/)
    expect(await colorOf(ui, 'agent-a2-time')).toBe('warning')
    expect((await ui.find({ key: 'agent-a2-cost' }))?.text).toBe('$0.50')
    expect(await ui.find({ type: 'Text', text: /^ {9}Edit \(1\) · ctx 43k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /SHEET F4 · 2 hypotheses/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2\/4 steps$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ 1 Créer le produit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◐ 2 Refus sans catalogue/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ 3 Verrou catalogue/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↳ C1 verrou posé/ })).toBeDefined()
    expect((await ui.find({ key: 'step-marks-1' }))?.text).toMatch(/RED ✓\s+GREEN ✓\s+COST ✓/)
    expect((await ui.find({ key: 'step-marks-3' }))?.text).toMatch(/RED ·\s+GREEN ·\s+COST ·/)
    expect(await ui.find({ key: 'outcome' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^─{40,}$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /phase \d\/\d · / })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /in progress/ })).toBeUndefined()
    await ui.unmount()
  }

  const sheetReads = () => reads.filter(path => path === SHEET_PATH).length
  const before = sheetReads()
  await clock.advance(4_000)
  expect(sheetReads()).toBe(before)
  files[SHEET_PATH] = SHEET.replace('TDD : RED ⬜ · GREEN ⬜ · COUT ⬜\n\n### Étape 4', 'TDD : RED ✅ · GREEN ✅ · COUT ✅\n\n### Étape 4')
  stamps[SHEET_PATH] = 2
  await clock.advance(2_000)
  expect(sheetReads()).toBe(before + 1)

  const nav = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await nav.find({ type: 'Text', text: /^3\/4 steps$/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /✓ 3 Verrou catalogue/ })).toBeDefined()
  await nav.press({ key: 'open-a2' })
  expect(await nav.find({ type: 'Text', text: /run-lot › RED › agent 2/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /Sonnet · high · tdd-test-author/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /ctx 43k ↗ 43k · now 43k/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /Activity · 1 call/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /✓ Edit f$/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /^  Edit 1$/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /Files modified · 1/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /Still running…/ })).toBeDefined()
  await nav.press({ key: 'back' })
  expect(await nav.find({ type: 'Text', text: /^ {2}Session$/ })).toBeDefined()
  await nav.press({ key: 'current' })
  expect(await nav.find({ type: 'Text', text: /Agents · 1/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /100% of run cost/ })).toBeDefined()
  expect(await nav.find({ type: 'Button', text: /RED 1 créer · 1m0\d · Edit \(1\) · ctx 43k · \$0\.50/ })).toBeDefined()
  await nav.press({ key: 'back' })
  expect(await nav.find({ type: 'Button', text: /✓ design/ })).toBeDefined()
  await nav.press({ key: 'toggle-Design' })
  expect(await nav.find({ type: 'Button', text: /✓ design/ })).toBeUndefined()
  await nav.unmount()

  files[`${SESSION}/workflows/${RUN}.json`] = JOURNAL
  await clock.advance(2_000)

  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /\? waiting for user\s+4m26/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /━+─+\s+2\/3 phases/ })).toBeDefined()
  const outcome = await ui.find({ key: 'outcome' })
  expect(outcome?.props.borderStyle).toBe('round')
  expect(outcome?.props.borderColor).toBe('error')
  expect(await ui.find({ type: 'Text', text: /^BLOQUÉ$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^BLOQUÉ$/ }))?.props.wrap).toBe('wrap')
  expect((await ui.find({ type: 'Text', text: /Bloquant sur le verrou/ }))?.text).toBe(REASON)
  expect((await ui.find({ type: 'Text', text: /Report:/ }))?.text).toBe(`Report: ${REPORT_PATH}`)
  expect(await ui.find({ type: 'Button', text: /[✢✳✶✻✽] RED 1/ })).toBeUndefined()
  await ui.unmount()
  await clock.advance(10_000)
  expect(toasts).toEqual([`run-lot F4 · BLOQUÉ · 4m · ${REASON}`])
})

test('audit verdict read from the audit agent’s structured answer, the last one wins', async ($, on) => {
  const files: Record<string, string> = {
    [`${SESSION}/workflows/scripts/run-lot-${RUN}.js`]: AUDIT_SCRIPT,
    [`${DIR}/agent-a1.meta.json`]: JSON.stringify({ description: 'audit', workflowPhase: 'Audit' }),
  }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($, null)
  await $.agent.spawn(spawn('audit', 1))
  const verdictRow = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface, ...paneAt(64) })
    const found = await ui.find({ type: 'Text', text: /VALIDE|ECARTS/ })
    await ui.unmount()
    return found
  }
  expect(await verdictRow('terminal')).toBeUndefined()

  await $.tool.call({
    tool: 'StructuredOutput', agentId: 'a1', verdict: 'ECARTS', gaps: [{ severity: 'Bloquant' }, { severity: 'Majeur' }, { severity: 'Mineur' }],
  } as unknown as Parameters<typeof $.tool.call>[0])
  for (const surface of ['terminal', 'desktop'] as const) {
    const found = await verdictRow(surface)
    expect(found?.text).toMatch(/ECARTS · 1 blocking · 1 major/)
    expect(found?.props.color).toBe('error')
  }

  await $.turn.complete(complete('a1', JSON.stringify({ verdict: 'VALIDE', gaps: [] })))
  const valid = await verdictRow('terminal')
  expect(valid?.text).toMatch(/VALIDE/)
  expect(valid?.props.color).toBe('success')
})

test('agent view: structured verdict as outcome, every call in order, recovered error greyed, prompt without the frame', async ($, on) => {
  const files: Record<string, string> = {
    [`${SESSION}/workflows/scripts/run-lot-${RUN}.js`]: AUDIT_SCRIPT,
    [`${DIR}/agent-a1.meta.json`]: JSON.stringify({ description: 'audit', workflowPhase: 'Audit' }),
  }
  world(on, files, { bashFails: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($, null)
  await $.agent.spawn(spawn('audit', 1, 'Workflow run-lot, batch F1. Global plan: p.md.\nAutonomous mode.\n\nmode: fast F1 s.md'))
  const call = (input: Record<string, unknown>) => $.tool.call({ agentId: 'a1', ...input } as unknown as Parameters<typeof $.tool.call>[0])
  await call({ tool: 'Bash', description: 'Find the handlers', command: 'grep -rn Lock src' })
  await call({ tool: 'Read', file_path: '/repo/src/A.cs' })
  await call({ tool: 'StructuredOutput', verdict: 'ECARTS', gaps: [{ severity: 'Blocking', axis: 'Correctness', gap: 'lock not checked' }] })
  await $.turn.complete(complete('a1', ''))

  const open = async () => {
    const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
    await ui.press({ key: 'open-a1' })
    return ui
  }
  const ui = await open()
  expect(await ui.find({ type: 'Text', text: /No answer/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}ECARTS · 1 blocking$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}Blocking · Correctness · lock not checked$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Errors · 1 · recovered/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^ {2}Bash · Find the handlers: exit 1$/ }))?.props.color).toBe('inactive')
  expect(await ui.find({ type: 'Text', text: /^ {2}mode: fast F1 s\.md$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Global plan/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Activity · 3 calls/ })).toBeDefined()
  const rows = (await ui.findAll({ type: 'Text', text: /^ {2} +\d+:\d{2} [✓✗]/ })).map(row => row.text)
  expect(rows).toHaveLength(3)
  expect(rows[0]).toMatch(/✗ Bash +Find the handlers$/)
  expect(rows[1]).toMatch(/✓ Read +src\/A\.cs$/)
  expect(rows[2]).toMatch(/✓ StructuredOutput/)
  await ui.unmount()
})

test('empty pane without a run, calls outside a workflow ignored, close button present', async ($, on) => {
  const closed: string[] = []
  world(on, {}, { closed })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...spawn('hors workflow', 1), workflow: undefined })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /No workflow run yet/ })).toBeDefined()
    await ui.press({ key: 'close' })
    await ui.unmount()
  }
  expect(closed).toEqual(['run-lot-pane', 'run-lot-pane'])
})

test('running demo: columns, model, retry, slow agent, stalled, interrupted, estimated end, all phases shown, sheet, narrow width', async ($, on) => {
  const toasts: string[] = []
  world(on, {}, { toasts })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'run-lot-pane', args: 'demo' } as Parameters<typeof $.command.run>[0])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /✻ run-lot · F4 · CAT-LIFECYCLE/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /running\s+12m40\s+5\/6 agents\s+ETA ~9m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /━+─+\s+2\/8 phases/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /GREEN 2 lock ↻ 2/ })).toBeDefined()
    expect((await ui.find({ key: 'model-demo-g1' }))?.text).toBe('Sonnet · high')
    expect(await colorOf(ui, 'agent-demo-g2b-time')).toBe('warning')
    expect(await colorOf(ui, 'agent-demo-g1-time')).toBe('inactive')
    expect(await ui.find({ type: 'Text', text: /^ {9}● thinking · 4.2k chars · 160 tok\/s · Edit \(48\) · ctx 36k · ⚠ 48 tools$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /tdd-implementer, ser/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /○ Global green/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /whole or filtered suites/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /○ Audit/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /○ Report/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ Audit · Review · Report/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /SHEET F4 · 2 hypotheses/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2\/5 steps$/ })).toBeDefined()
    expect(await ui.find({ key: 'outcome' })).toBeUndefined()
    await ui.unmount()
  }

  const narrow = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...paneAt(40) })
  expect(await narrow.find({ key: 'model-demo-g1' })).toBeUndefined()
  expect(await narrow.find({ type: 'Button', text: /GREEN 2… ↻ 2/ })).toBeDefined()
  expect((await narrow.find({ key: 'step-marks-1' }))?.text).toMatch(/^✓ +✓ +✓$/)
  await narrow.unmount()

  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Button', text: /⊘ RED 3 declaratives/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /⊘ RED 3 declaratives ↻/ })).toBeUndefined()
  expect(await colorOf(ui, 'open-demo-r3')).toBe('inactive')
  expect(await ui.find({ type: 'Text', text: /^ · ⚠ 48 tools$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^ · ⚠ 48 tools$/ }))?.props.color).toBe('warning')
  await ui.press({ key: 'open-demo-g2b' })
  expect((await ui.find({ type: 'Text', text: /^ {2}⚠ 48 tools$/ }))?.props.color).toBe('warning')
  await ui.unmount()
  expect(toasts).toEqual([])
})

test('finished demo: verdict on the Audit row, outcome in a coloured box, slow agent finished, sheet closed', async ($, on) => {
  const toasts: string[] = []
  world(on, {}, { toasts })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'run-lot-pane', args: 'demo end' } as Parameters<typeof $.command.run>[0])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface, ...paneAt(62) })
    expect(await ui.find({ type: 'Text', text: /✓ completed\s+19m35\s+13\/13 agents/ })).toBeDefined()
    const verdict = await ui.find({ type: 'Text', text: /GAPS · 1 blocking · 2 major/ })
    expect(verdict?.props.color).toBe('error')
    const outcome = await ui.find({ key: 'outcome' })
    expect(outcome?.props.borderStyle).toBe('round')
    expect(outcome?.props.borderColor).toBe('warning')
    expect((await ui.find({ type: 'Text', text: /^GAPS$/ }))?.props.color).toBe('warning')
    expect((await ui.find({ type: 'Text', text: /blocking gap remains/ }))?.text).toBe(DEMO_REASON)
    expect((await ui.find({ type: 'Text', text: /Report:/ }))?.text).toBe(`Report: ${DEMO_REPORT}`)
    expect(await colorOf(ui, 'agent-demo-g2b-time')).toBe('warning')
    expect(await ui.find({ type: 'Button', text: /GREEN 2 lock ↻ 2/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^5\/5 steps$/ }))?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: /○ Audit · Review · Report/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /ETA/ })).toBeUndefined()
    await ui.unmount()
  }
  expect(toasts).toEqual([])
  await $.command.run({ command: 'run-lot-pane', args: 'clear' } as Parameters<typeof $.command.run>[0])
  const empty = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await empty.find({ type: 'Text', text: /No workflow run yet/ })).toBeDefined()
  expect(demoRuns(0)).toHaveLength(1)
})

const phaseMeta = (ids: string[], phase: string): Record<string, string> =>
  Object.fromEntries(ids.map(id => [`${DIR}/agent-${id}.meta.json`, JSON.stringify({ workflowPhase: phase })]))

const SCRIPT_PATH = `${SESSION}/workflows/scripts/run-lot-${RUN}.js`

const step = (agentId?: string, index = 0) =>
  ({ turnId: agentId ?? 'main', index, model: 'claude-sonnet-5-5', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) }) as Parameters<
    Engine['turn']['step']
  >[0]

const call = (tool: string, agentId: string) => ({ tool, agentId, file_path: 'f' }) as unknown as Parameters<Engine['tool']['call']>[0]

test('stop read then resume: agent left running is interrupted, stale stopped journal ignored until rewritten, one alert per end', async ($, on) => {
  const toasts: string[] = []
  const stamps: Stamps = {}
  const files: Record<string, string> = { [SCRIPT_PATH]: SCRIPT, ...phaseMeta(['a1', 'a2'], 'GREEN') }
  const clock = world(on, files, { stamps, toasts })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(1_000)
  await launch($)
  await $.agent.spawn(spawn('GREEN 2 verrou', 1))
  files[JOURNAL_PATH] = KILLED_JOURNAL
  stamps[JOURNAL_PATH] = 1_500
  await clock.advance(4_000)

  const stopped = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await stopped.find({ type: 'Text', text: /⏹ killed/ })).toBeDefined()
  expect(await stopped.find({ type: 'Button', text: /⊘ GREEN 2 verrou/ })).toBeDefined()
  expect(await stopped.find({ type: 'Button', text: /✓ GREEN 2 verrou/ })).toBeUndefined()
  expect(await stopped.find({ type: 'Text', text: /0\/0 agents/ })).toBeDefined()
  await stopped.unmount()
  expect(toasts).toEqual(['run-lot F4 · STOPPED · 1m'])

  await clock.advance(2_000)
  await launch($)
  await $.agent.spawn(spawn('GREEN 2 verrou', 2))
  await $.tool.call(call('Read', 'a2'))
  await clock.advance(6_000)
  const resumed = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await resumed.find({ type: 'Text', text: /[✢✳✶✻✽] running\s+\S+\s+0\/1 agents/ })).toBeDefined()
  expect(await resumed.find({ type: 'Text', text: /ETA/ })).toBeUndefined()
  expect(await resumed.find({ type: 'Button', text: /⊘ GREEN 2 verrou/ })).toBeDefined()
  expect(await resumed.find({ type: 'Button', text: /[✢✳✶✻✽] GREEN 2 verrou/ })).toBeDefined()
  expect(await resumed.find({ type: 'Button', text: /↻/ })).toBeUndefined()
  expect(await resumed.find({ type: 'Text', text: /^ {9}Read \(1\)$/ })).toBeDefined()
  await resumed.unmount()
  expect(toasts).toHaveLength(1)

  files[JOURNAL_PATH] = JOURNAL
  stamps[JOURNAL_PATH] = 20_000
  await clock.advance(2_000)
  expect(toasts).toEqual(['run-lot F4 · STOPPED · 1m', `run-lot F4 · BLOQUÉ · 4m · ${REASON}`])
  const finished = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await finished.find({ type: 'Text', text: /\? waiting for user/ })).toBeDefined()
  await finished.unmount()
})

test('relaunch before the stop is read: running agent interrupted, journal older than the relaunch ignored, new agent followed', async ($, on) => {
  const stamps: Stamps = {}
  const files: Record<string, string> = { [SCRIPT_PATH]: SCRIPT, ...phaseMeta(['a1', 'a2'], 'GREEN') }
  const clock = world(on, files, { stamps })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(1_000)
  await launch($)
  await $.agent.spawn(spawn('GREEN 2 verrou', 1))
  files[JOURNAL_PATH] = KILLED_JOURNAL
  stamps[JOURNAL_PATH] = 1_200
  await clock.advance(500)
  await launch($)
  await $.agent.spawn(spawn('GREEN 2 verrou', 2))
  await clock.advance(5_000)
  await $.tool.call(call('Read', 'a2'))

  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /[✢✳✶✻✽] running/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /⊘ GREEN 2 verrou/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /[✢✳✶✻✽] GREEN 2 verrou(?! ↻)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {9}Read \(1\)$/ })).toBeDefined()
  await $.turn.complete(complete('a2'))
  expect(await ui.find({ type: 'Button', text: /✓ GREEN 2 verrou/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⏺ running\s+\S+\s+1\/1 agents/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /running\s+\S+\s+1\/1 agents/ })).toBeDefined()
  await ui.unmount()
})

test('cost per agent: session delta split among requesters by weighted tokens, main request included', async ($, on) => {
  const prices: Record<string, number> = {}
  const usages: Record<string, Partial<ModelUsage>> = {}
  const only = (field: keyof ModelUsage, tokens: number): Partial<ModelUsage> => ({
    input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, [field]: tokens,
  })
  const files: Record<string, string> = { [SCRIPT_PATH]: SCRIPT, ...phaseMeta(['a1', 'a2'], 'RED') }
  world(on, files, { price: id => prices[id ?? 'main'] ?? 0.25, usage: id => usages[id ?? 'main'] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($)
  await $.agent.spawn(spawn('RED 1', 1))
  await $.agent.spawn(spawn('RED 2', 2))
  await drain($.turn.step(step()))

  prices.a1 = 0
  usages.a1 = only('output_tokens', 2_000)
  await drain($.turn.step(step('a1')))
  prices.a2 = 0.3
  usages.a2 = only('output_tokens', 1_000)
  await drain($.turn.step(step('a2')))
  prices.main = 0.2
  usages.main = only('input_tokens', 1_000)
  await drain($.turn.step(step()))
  prices.a1 = 0.1
  usages.a1 = only('input_tokens', 1_000)
  await drain($.turn.step(step('a1', 1)))

  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect((await ui.find({ key: 'agent-a1-cost' }))?.text).toBe('$0.30')
  expect((await ui.find({ key: 'agent-a2-cost' }))?.text).toBe('$0.10')
  expect(await ui.find({ type: 'Text', text: /^\$0\.40$/ })).toBeDefined()
  await ui.unmount()

  prices.a1 = 0.25
  prices.a2 = 0.25
  delete usages.a1
  delete usages.a2
  await Promise.all([drain($.turn.step(step('a1', 2))), drain($.turn.step(step('a2', 1)))])
  const total = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await total.find({ type: 'Text', text: /^\$0\.90$/ })).toBeDefined()
  await total.unmount()
})

test('estimated end in the header from the phases of earlier runs', async ($, on) => {
  const files: Record<string, string> = {
    [SCRIPT_PATH]: SCRIPT,
    ...phaseMeta(['a1'], 'Design'),
    [`${PROJECT}/s0/workflows/wf_old.json`]: SPAN_JOURNAL,
  }
  const dirs: Directory = {
    [PROJECT]: [{ name: 's1', kind: 'dir' }, { name: 's0', kind: 'dir' }],
    [`${PROJECT}/s0/workflows`]: [{ name: 'wf_old.json', kind: 'file', mtimeMs: 5 }],
  }
  const clock = world(on, files, { dirs })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($)
  await $.agent.spawn(spawn('design', 1))
  await clock.advance(20_000)
  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /running\s+0m20\s+0\/1 agents\s+ETA ~7m/ })).toBeDefined()
  await ui.unmount()
})

test('stalling agent: yellow reason under the agent row and in its card, idle outside a running call', async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(resolve => {
    release = resolve
  })
  const files: Record<string, string> = { [SCRIPT_PATH]: SCRIPT, ...phaseMeta(['a1', 'a2', 'a3'], 'RED') }
  const clock = world(on, files, { hold, usage: id => (id === 'a2' ? { cache_read_input_tokens: 160_000 } : {}) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($)
  for (const index of [1, 2, 3]) await $.agent.spawn(spawn(`RED ${index}`, index))
  for (let count = 0; count < 41; count++) await $.tool.call(call('Read', 'a1'))
  await drain($.turn.step(step('a2')))
  await clock.advance(2_000)

  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^ {9}Read \(41\) · ⚠ 41 tools$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^ · ⚠ 41 tools$/ }))?.props.color).toBe('warning')
  expect(await ui.find({ type: 'Text', text: /^ {9}ctx 163k · ⚠ ctx 163k$/ })).toBeDefined()
  expect(((await ui.find({ key: 'open-a1' }))?.children[1] as { props?: { color?: string } } | undefined)?.props?.color).toBe('warning')
  expect(((await ui.find({ key: 'open-a3' }))?.children[1] as { props?: { color?: string } } | undefined)?.props?.color).toBeUndefined()
  await ui.press({ key: 'open-a1' })
  expect((await ui.find({ type: 'Text', text: /⚠ 41 tools/ }))?.props.color).toBe('warning')
  await ui.press({ key: 'back' })
  await ui.unmount()

  const pending = $.tool.call({ tool: 'Bash', agentId: 'a3', command: 'dotnet test' } as unknown as Parameters<typeof $.tool.call>[0])
  await clock.advance(190_000)
  const waiting = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await waiting.find({ type: 'Text', text: /^ {9}tool Bash 3 min · Bash \(1\)$/ })).toBeDefined()
  await waiting.unmount()
  await clock.advance(120_000)
  const long = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await long.find({ type: 'Text', text: /^ {9}tool Bash 5 min · Bash \(1\) · ⚠ long tool$/ })).toBeDefined()
  expect((await long.find({ type: 'Text', text: /^ · ⚠ long tool$/ }))?.props.color).toBe('warning')
  await long.unmount()

  release()
  await pending
  await clock.advance(190_000)
  const idle = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await idle.find({ type: 'Text', text: /^ {9}Bash \(1\) · ⚠ idle 3m$/ })).toBeDefined()
  await idle.unmount()
})

const thinking = (count: number): TurnStepChunk => ({ kind: 'thinking', index: 0, text: 'x'.repeat(count) })
const output = (count: number): TurnStepChunk => ({ kind: 'text', index: 1, text: 'x'.repeat(count) })

const activityLine = async ($: Engine): Promise<string | undefined> => {
  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  const found = await ui.find({ type: 'Text', text: /^ {9}\S/ })
  await ui.unmount()
  return found?.text.trim()
}

test('followed stream: waiting for the first chunk, thinking then output with characters and throughput, nothing once the request ends', async ($, on) => {
  const seen: (string | undefined)[] = []
  let clock: ReturnType<typeof world> | null = null
  const stream = async function* (): AsyncGenerator<TurnStepChunk> {
    await clock?.advance(40_000)
    seen.push(await activityLine($))
    yield thinking(0)
    for (let index = 0; index < 6; index++) {
      await clock?.advance(1_000)
      yield thinking(640)
    }
    seen.push(await activityLine($))
    await clock?.advance(1_000)
    yield output(640)
    seen.push(await activityLine($))
  }
  clock = world(on, { [SCRIPT_PATH]: SCRIPT, ...phaseMeta(['a1'], 'RED') }, { stream })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($)
  await $.agent.spawn(spawn('RED 1', 1))
  await drain($.turn.step(step('a1')))
  expect(seen).toEqual(['○ waiting model 40 s', '● thinking · 3.8k chars · 160 tok/s', '● output · 4.5k chars · 160 tok/s'])
  expect(await activityLine($)).toBe('ctx 43k')
})

test('followed stream: one write per second at most, never per chunk', async ($, on) => {
  const seen: (string | undefined)[] = []
  let clock: ReturnType<typeof world> | null = null
  const stream = async function* (): AsyncGenerator<TurnStepChunk> {
    for (let index = 0; index < 7; index++) {
      yield output(100)
      seen.push(await activityLine($))
      await clock?.advance(200)
    }
  }
  clock = world(on, { [SCRIPT_PATH]: SCRIPT, ...phaseMeta(['a1'], 'RED') }, { stream })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($)
  await $.agent.spawn(spawn('RED 1', 1))
  await drain($.turn.step(step('a1')))
  expect(seen).toEqual([...Array(5).fill('○ waiting model 0 s'), '● output · 600 chars · 150 tok/s', '● output · 600 chars · 150 tok/s'])
})

test('signals during a stream: slow at a sustained 4 tok/s, never idle nor slow at 150 tok/s, idle after 60 s without a chunk, waiting beyond 120 s', async ($, on) => {
  const seen: (string | undefined)[] = []
  let clock: ReturnType<typeof world> | null = null
  const steady = async function* (size: number): AsyncGenerator<TurnStepChunk> {
    yield output(0)
    for (let second = 1; second <= 70; second++) {
      await clock?.advance(1_000)
      yield output(size)
      if (second === 30 || second === 70) seen.push(await activityLine($))
    }
  }
  const stream = async function* (e: TurnStepInput): AsyncGenerator<TurnStepChunk> {
    if (e.index === 0) {
      yield* steady(16)
      await clock?.advance(62_000)
      seen.push(await activityLine($))
      return
    }
    if (e.index === 1) {
      await clock?.advance(100_000)
      seen.push(await activityLine($))
      await clock?.advance(30_000)
      seen.push(await activityLine($))
      return
    }
    yield* steady(600)
  }
  clock = world(on, { [SCRIPT_PATH]: SCRIPT, ...phaseMeta(['a1'], 'RED') }, { stream })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($)
  await $.agent.spawn(spawn('RED 1', 1))
  await drain($.turn.step(step('a1')))
  await drain($.turn.step(step('a1', 1)))
  await drain($.turn.step(step('a1', 2)))
  expect(seen).toEqual([
    '● output · 480 chars · 4 tok/s',
    '● output · 1.1k chars · 4 tok/s · ⚠ slow',
    '● output · 1.1k chars · 4 tok/s · ⚠ idle 1m',
    '○ waiting model 1 min · ctx 43k',
    '○ waiting model 2 min · ctx 43k · ⚠ waiting',
    '● output · 18k chars · 150 tok/s · ctx 43k',
    '● output · 42k chars · 150 tok/s · ctx 43k',
  ])
})

const RUN_PLAN_PATH = 'todo/cat/CAT-PLAN.md'
const RUN_PLAN = `# CAT-PLAN

### Execution des lots

| Lot | Depend de | Dépôt |
|---|---|---|
| F1 | — | . |
| F2 | F1 | . |
| F3 | F1, F2 | . |

### Lot F1 — Création — ⬜
### Lot F2 — Refus — ⬜
`
const lotPrompt = (lot: string) =>
  `Workflow run-lot, batch ${lot}. Global plan: /repo/todo/cat/CAT-PLAN.md. Batch sheet: /repo/todo/cat/CAT-PLAN-${lot}.md. Run folder: /repo/todo/cat/run/${lot}.\nAutonomous mode.`
const LOT_SHEET = (lot: string) => `# CAT-PLAN-${lot} — Lot\n\n## Déroulement TDD\n\n### Étape 1 — Créer\n\nTDD : RED ✅ · GREEN ⬜ · COUT ⬜\n`

describe('batch plan through run-plan', () => {
  test('child call, plan as argument, batch read from the agent prompt', () => {
    expect(childWorkflowOf("const r = await workflow('run-lot', b.sheet)")).toBe('run-lot')
    expect(childWorkflowOf('await agent("x")')).toBeNull()
    expect(childWorkflowOf("await workflow({ scriptPath: `${pre.kit}/workflows/run-lot.js` }, b.sheet)")).toBe('run-lot')
    expect(childWorkflowOf("await workflow('cctoolkit:run-lot', s)")).toBe('run-lot')
    expect(promptLotOf('mode: next-batch /r/X-PLAN-F3.md /r/X-PLAN-F2.md')).toEqual({ lot: 'F2', sheet: '/r/X-PLAN-F2.md' })
    expect(planPathOf('todo/cat/CAT-PLAN.md --only F2')).toBe('todo/cat/CAT-PLAN.md')
    expect(planPathOf('todo/cat/CAT-PLAN-F2.md')).toBeNull()
    expect(promptLotOf(lotPrompt('F2'))).toEqual({ lot: 'F2', sheet: '/repo/todo/cat/CAT-PLAN-F2.md' })
    expect(promptLotOf('mode: lot-suivant /repo/todo/cat/CAT-PLAN-F3.md /repo/todo/cat/CAT-PLAN-F2.md\n\nReturn')).toEqual({ lot: 'F2', sheet: '/repo/todo/cat/CAT-PLAN-F2.md' })
    expect(promptLotOf('Workflow run-plan, supervisor step. Gate of batch F2')).toBeNull()
  })

  test('execution table: batches, dependencies, DONE; merge keeps the known state', () => {
    const lots = parsePlanLots(RUN_PLAN.replace('### Lot F1 — Création — ⬜', '### Lot F1 — Création — ✅ DONE'))
    expect(lots.map(one => [one.lot, one.deps, one.isDone])).toEqual([['F1', [], true], ['F2', ['F1'], false], ['F3', ['F1', 'F2'], false]])
    const known = [{ ...lots[1]!, sheet: '/s/F2.md' }, { lot: 'F9', sheet: null, deps: [], isDone: false, outcome: null, audit: null, view: null }]
    const merged = mergeLots(known, parsePlanLots(RUN_PLAN))
    expect(merged.map(one => one.lot)).toEqual(['F1', 'F2', 'F3', 'F9'])
    expect(merged[1]?.sheet).toBe('/s/F2.md')
    const english = '### Batch execution\n\n| Batch | Intent | Depends on |\n|---|---|---|\n| F1 | a | — |\n| F2 | b | F1 |\n\n### Batch F1 — A — ✅ DONE\n'
    expect(parsePlanLots(english).map(one => [one.lot, one.deps, one.isDone])).toEqual([['F1', [], true], ['F2', ['F1'], false]])
  })

  test('batch report: status, reason, path next to the sheet', () => {
    const [path = '', english] = reportPathsOf('/repo/todo/cat/CAT-PLAN-F2.md', 'F2')
    expect([path, english]).toEqual(['/repo/todo/cat/run/F2/F2-rapport.md', '/repo/todo/cat/run/F2/F2-report.md'])
    expect(reportOutcomeOf('## STATUS — GAPS\nReason: two fix rounds\n', path)?.reason).toBe('two fix rounds')
    expect(reportOutcomeOf('## STATUT — BLOQUÉ\nRaison : GREEN refus — exit 1\n', path)).toEqual({ label: 'BLOQUÉ', reason: 'GREEN refus — exit 1', report: path })
    expect(reportOutcomeOf('## STATUT — TERMINÉ\nRaison : —\n', path)?.reason).toBeNull()
    expect(reportOutcomeOf('# autre chose', path)).toBeNull()
  })

  test('nested agent phase derived from its label in the child script', () => {
    const child = { name: 'run-lot', phases: ['Design', 'RED', 'Audit'], details: {}, labels: labelPhasesOf(SCRIPT) }
    expect(child.labels).toEqual({
      design: 'Design', 'RED ': 'RED', 'audit retry ': 'Audit', audit: 'Audit', 'fix ': 'Audit', 'next batch review': 'Review', 'next batch re-review ': 'Review',
    })
    expect(['design', 'RED 2 refus', 'audit', 'audit retry 1', 'fix 1', 'next batch review', 'inconnu'].map(label => nestedPhaseOf(child, label, '▸ run-lot #2'))).toEqual([
      'Design', 'RED', 'Audit', 'Audit', 'Audit', 'Review', '▸ run-lot #2',
    ])
    expect(nestedPhaseOf(child, 'design', 'Batch')).toBe('Batch')
    expect(nestedPhaseOf(null, 'design', '▸ run-lot')).toBe('▸ run-lot')
  })

  test('batch state and view cut from the plan run', () => {
    const agent = (id: string, index: number, lot: string | null, state: WorkflowAgent['state'], phase: string) => ({
      ...blankAgent(id, index, id, 'Sonnet', 'x', 'p', index * 1000), lot, state, phase, endedAt: state === 'running' ? null : index * 1000 + 500,
    })
    const run = {
      ...completeRun({ runId: 'wf_1', startedAt: 0 } as WorkflowRun),
      name: 'run-plan', status: 'running' as const,
      child: { name: 'run-lot', phases: ['Design', 'RED'], details: { Design: 'd' }, labels: {} },
      lots: parsePlanLots(RUN_PLAN),
      agents: [agent('s1', 1, null, 'done', 'Preflight'), agent('d1', 2, 'F1', 'done', 'Design'), agent('d2', 3, 'F2', 'running', 'Design')],
    }
    expect(run.lots.map(one => lotStateOf(run, one))).toEqual(['completed', 'running', 'pending'])
    const view = lotRun(run, 'F1')
    expect([view.name, view.status, view.phases, view.agents.map(one => one.id), view.durationMs]).toEqual(['run-lot', 'completed', ['Design', 'RED'], ['d1'], 500])
    const nested = lotRun({ ...run, child: { ...run.child, labels: { d3: 'Design' } }, agents: [agent('d3', 4, 'F3', 'running', '▸ run-lot')] }, 'F3')
    expect(nested.agents.map(one => one.phase)).toEqual(['Design'])
    expect(lotStateOf({ ...run, status: 'failed', agents: run.agents.map(one => ({ ...one, state: 'done' as const })) }, run.lots[1]!)).toBe('failed')
    const waiting = (lot: (typeof run.lots)[number]) => ({ ...lot, outcome: { label: 'ATTENTE-RÉPONSE', reason: null, report: null } })
    expect([lotStateOf(run, waiting(run.lots[2]!)), lotStateOf(run, waiting(run.lots[1]!))]).toEqual(['waiting', 'running'])
    const blocked = { ...run.lots[2]!, outcome: { label: 'BLOQUÉ', reason: null, report: null } }
    expect([lotStateOf(run, blocked), lotRun({ ...run, lots: [run.lots[0]!, run.lots[1]!, blocked] }, 'F3').status]).toEqual(['waiting', 'completed'])
  })
})

test('run-plan pane: plan view, batches, supervisor, navigation to a batch and back to the plan', async ($, on) => {
  const files: Record<string, string> = {
    [`${SESSION}/workflows/scripts/run-lot-${RUN}.js`]: `export const meta = {
  name: 'run-plan',
  description: 'Plan',
  phases: [{ title: 'Preflight' }, { title: 'Batch' }, { title: 'Gate' }, { title: 'Report' }],
}
const result = await workflow('run-lot', b.sheet)
`,
    '/repo/.claude/workflows/run-lot.js': SCRIPT,
    [RUN_PLAN_PATH]: RUN_PLAN,
    '/repo/todo/cat/CAT-PLAN-F1.md': LOT_SHEET('F1'),
    '/repo/todo/cat/CAT-PLAN-F2.md': LOT_SHEET('F2'),
    '/repo/todo/cat/run/F1/F1-rapport.md': '## STATUT — TERMINÉ\nRaison : —\n',
    [`${DIR}/agent-a1.meta.json`]: JSON.stringify({ workflowPhase: 'Preflight' }),
    [`${DIR}/agent-a2.meta.json`]: JSON.stringify({ workflowPhase: 'Design' }),
    [`${DIR}/agent-a3.meta.json`]: JSON.stringify({ workflowPhase: 'Report' }),
    [`${DIR}/agent-a4.meta.json`]: JSON.stringify({ workflowPhase: '▸ run-lot' }),
  }
  const clock = world(on, files, { workflowName: 'run-plan' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($, `${RUN_PLAN_PATH} --until F3`)
  await $.agent.spawn(spawn('preflight', 1, 'Workflow run-plan, supervisor step.'))
  await $.turn.complete(complete('a1'))
  await $.agent.spawn(spawn('design', 2, lotPrompt('F1')))
  await $.agent.spawn(spawn('report', 3, lotPrompt('F1')))
  await $.turn.complete(complete('a2'))
  await $.turn.complete(complete('a3'))
  await $.agent.spawn(spawn('design', 4, lotPrompt('F2')))
  await clock.advance(2_000)

  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^run-plan$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\/3 lots/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / TERMINÉ$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / Design · design$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / after F1, F2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Supervisor$/ })).toBeDefined()
  expect(await ui.find({ key: 'open-lot-F3' })).toBeUndefined()

  await ui.press({ key: 'open-lot-F2' })
  expect(await ui.find({ type: 'Text', text: /^F2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ run-lot/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /0\/3 phases/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^run-lot$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /SHEET F2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /LOTS/ })).toBeUndefined()

  await ui.press({ key: 'open-lot-F1' })
  expect(await ui.find({ type: 'Text', text: /completed/ })).toBeDefined()

  await ui.press({ key: 'plan' })
  expect(await ui.find({ type: 'Text', text: /LOTS/ })).toBeDefined()
  await ui.unmount()
})

test('plan demo: running plan view, batch opened, plan end', async ($, on) => {
  world(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'run-lot-pane', args: 'demo plan' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /1\/4 lots/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / GREEN · GREEN 3 hide$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / after F2, F3$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Supervisor$/ })).toBeDefined()
  await ui.press({ key: 'open-lot-F2' })
  expect(await ui.find({ type: 'Text', text: /SHEET F2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {9}tool Bash 2 min · Bash \(17\) · ctx \d+k$/ })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'run-lot-pane', args: 'demo plan end' } as Parameters<typeof $.command.run>[0])
  const end = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await end.find({ type: 'Text', text: /3\/4 lots/ })).toBeDefined()
  expect(await end.find({ key: 'outcome' })).toBeDefined()
  expect(await end.find({ type: 'Text', text: /LOTS/ })).toBeDefined()
  await end.unmount()
})
