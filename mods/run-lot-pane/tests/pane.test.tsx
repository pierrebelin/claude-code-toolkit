import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentSpawnInput, ModelUsage, On, TurnCompleteInput } from 'claude-code'

import type { WorkflowAgent, WorkflowRun } from '../types'
import {
  alertOf, argumentOf, attemptsOf, auditLabel, auditOf, auditTone, blankAgent, coarse, completeRun, currentStep, demoHistory, demoRuns,
  detailsOf, duration, editedPath, errorOf, figuresLine, firstLine, fit, isSlow, isStepDone, journalPathOf, lotOf, markOf, outcomeTone,
  parseJournal, parseLotSection, parsePhases, parseSheet, phaseInsight, phaseLines, phaseRows, remainingMs, samplesOf, sheetPathOf, shortModel, splitCost,
  stallReasons, toolSummary, totalsOf, typicalMs, typicalTools, weightOf, withFile, withSamples,
} from '../hooks/register'

const SESSION = '/home/u/.claude/projects/p/s1'
const PROJECT = '/home/u/.claude/projects/p'
const RUN = 'wf_5c0349cf-fb4'
const DIR = `${SESSION}/subagents/workflows/${RUN}`
const SHEET_PATH = 'todo/cycle-vie-paquet-deploiement/PDD-CYCLE-PLAN-F4.md'
const REPORT_PATH = 'todo/cycle-vie-paquet-deploiement/run/F4/F4-rapport.md'
const DEMO_REPORT = 'todo/package-lifecycle/run/F4/F4-report.md'
const DEMO_REASON = 'two fix rounds done, one blocking gap remains on the organization lock'
const REASON = 'la relecture du lot suivant porte au moins un Bloquant sur le verrou d’organisation de la suppression'

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
`

const AUDIT_SCRIPT = `export const meta = {
  phases: [{ title: 'Audit', detail: 'ddd-tdd-auditor' }, { title: 'Report' }],
}
`

const SHEET = `# PDD-CYCLE-PLAN-F4 — Cycle de vie du paquet

## Déroulement TDD

### Étape 1 — Créer le paquet

TDD : RED ✅ · GREEN ✅ · COUT ✅

### Étape 2 — Refus sans firmware

TDD : RED ✅ · GREEN ⬜ · COUT ⬜

#### Correction C1 — verrou posé après la création du paquet

TDD : RED ⬜ · GREEN ⬜ · COUT ⬜

### Étape 3 — Verrou firmware

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

const PLAN_PATH = 'todo/ether-glaneurs-porte/PLAN.md'
const PLAN_ARGUMENT = `F2 ${PLAN_PATH}`

const PLAN = `# PLAN — Éther, glaneurs et Porte

## Avancement

| Lot | Intention | RM/CU | Dépend de | État |
|-----|-----------|-------|-----------|------|
| F1 | Glaneurs | RM-01 / CU-01 | — | ✅ |
| F2 | Envois en éther | RM-05 / CU-03 | F1 | ⬜ |

## Lot F1 — Glaneurs et éther — ✅

#### Étape 1 — Le joueur achète un glaneur — ✅

### Hypothèses
- H1 — hors lot F2

## Lot F2 — Envois payés en éther — ⬜

### Étapes et tests

#### Étape 1 — Le joueur envoie une créature contre de l'éther — ✅

#### Étape 2 — Le joueur voit les envois en éther — ⬜

#### Étape 3 — Vérification — ⬜

### Hypothèses
- H1 — suppression de \`income.ts\` reportée — à valider par l'utilisateur.
- H2 — fixtures d'envoi adaptées — à valider par l'utilisateur.

## Lot F10 — Porte — ⬜

#### Étape 1 — Le joueur achète un niveau de Porte — ⬜
`

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

describe('lecture du run', () => {
  test('détail agent : outils triés, chemins modifiés, erreurs, première ligne', () => {
    expect(toolSummary({ Read: 3, Bash: 5, Edit: 3 })).toBe('Bash 5 · Edit 3 · Read 3')
    expect(editedPath('Edit', { file_path: '/r/a.cs' })).toBe('/r/a.cs')
    expect(editedPath('Read', { file_path: '/r/a.cs' })).toBeNull()
    expect(withFile(['a', 'b'], 'a')).toEqual(['b', 'a'])
    expect(errorOf('Bash', { isError: true, text: 'exit 1\ndétail' })).toBe('Bash: exit 1')
    expect(errorOf('Bash', { deny: 'refusé' })).toBe('Bash: refusé')
    expect(errorOf('Bash', { text: 'ok' })).toBeNull()
    expect(firstLine('\n  Workflow run-lot\nsuite')).toBe('Workflow run-lot')
  })

  test('phases et leur detail lus depuis meta.phases seul, crochet dans un detail compris', () => {
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

  test('journal final : chemin, statut, durée, argument, issue complète, verdict, phase par agent', () => {
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

  test('issue : clés françaises ou anglaises, tiret ignoré, texte seul, erreur du journal, teinte par statut', () => {
    const french = parseJournal(JSON.stringify({ status: 'completed', result: { statut: 'TERMINÉ', raison: '—', rapport: 'r.md' } }))
    expect(french?.outcome).toEqual({ label: 'TERMINÉ', reason: null, report: 'r.md' })
    expect(parseJournal(JSON.stringify({ status: 'completed', result: 'fini\nsuite' }))?.outcome).toEqual({ label: 'fini', reason: null, report: null })
    expect(parseJournal(JSON.stringify({ status: 'failed', error: 'boom' }))?.outcome).toEqual({ label: 'failed', reason: 'boom', report: null })
    const tone = (label: string, status: 'completed' | 'failed' = 'completed') => outcomeTone({ label, reason: null, report: null }, status)
    expect([tone('TERMINÉ'), tone('ECARTS'), tone('RELECTURE-BLOQUANTE'), tone('BLOQUÉ'), tone('?', 'failed')]).toEqual([
      'success', 'warning', 'warning', 'error', 'error',
    ])
    expect([tone('DONE'), tone('GAPS'), tone('REVIEW-BLOCKING'), tone('BLOCKED')]).toEqual(['success', 'warning', 'warning', 'error'])
  })

  test('durées en minutes pleines et modèles abrégés', () => {
    expect(duration(42_000)).toBe('0m42')
    expect(duration(252_000)).toBe('4m12')
    expect(duration(3_780_000)).toBe('1h03')
    expect(shortModel('claude-sonnet-5-5')).toBe('Sonnet')
    expect(shortModel('haiku')).toBe('Haiku')
    expect(shortModel('claude-fable-5-1')).toBe('Fable')
    expect(shortModel('claude-x-1-20250101')).toBe('x-1')
  })

  test('phase atteinte sans agent en cours : faite ; phase à venir : en attente, avec son detail', () => {
    const rows = phaseRows(
      runOf([agentOf('a1', 'Design', 'done'), agentOf('a2', 'RED', 'running')], { details: { GREEN: 'serial' } }),
      30,
    )
    expect(rows.map(row => row.mark)).toEqual(['done', 'running', 'pending'])
    expect(rows.map(row => row.detail)).toEqual([null, null, 'serial'])
    expect(rows[1]?.span).toBe(30)
  })

  test('étape actuelle : dernière phase en cours, sinon première en attente, aucune une fois le run fini', () => {
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

  test('colonnes : libellé tronqué par une ellipse, phases à venir repliées au-delà de deux', () => {
    expect(fit('GREEN 2 verrou', 14)).toBe('GREEN 2 verrou')
    expect(fit('GREEN 2 verrou', 8)).toBe('GREEN 2…')
    expect(fit('abc', 0)).toBe('')
    const rows = phaseRows(runOf([agentOf('a1', 'Design', 'done')], { phases: ['Design', 'A', 'B', 'C', 'D'] }), 30)
    expect(phaseLines(rows, 2).map(line => line.map(row => row.title))).toEqual([['Design'], ['A'], ['B'], ['C', 'D']])
    expect(phaseLines(rows.slice(0, 4), 2).map(line => line.length)).toEqual([1, 1, 1, 1])
  })

  test('lot nommé depuis l’argument du workflow, chaîne ou objet', () => {
    expect(lotOf(SHEET_PATH)).toEqual({ lot: 'F4', code: 'PDD-CYCLE' })
    expect(lotOf('todo/x/notes.md')).toBeNull()
    expect(lotOf(null)).toBeNull()
    expect(argumentOf({ name: 'run-lot', args: `  ${SHEET_PATH} ` })).toBe(SHEET_PATH)
    expect(argumentOf({ args: { fiche: SHEET_PATH } })).toBe(SHEET_PATH)
    expect(argumentOf({ name: 'run-lot' })).toBeNull()
    expect(sheetPathOf(SHEET_PATH)).toBe(SHEET_PATH)
    expect(sheetPathOf('todo/x/PLAN.md')).toBeNull()
  })

  test('plan à lots : lot et dossier depuis `Fn todo/<slug>/PLAN.md`, chemin du plan suivi', () => {
    expect(lotOf(PLAN_ARGUMENT)).toEqual({ lot: 'F2', code: 'ether-glaneurs-porte' })
    expect(lotOf(`F2 @${PLAN_PATH}`)).toEqual({ lot: 'F2', code: 'ether-glaneurs-porte' })
    expect(sheetPathOf(PLAN_ARGUMENT)).toBe(PLAN_PATH)
    expect(sheetPathOf(`F2 /repo/${PLAN_PATH}`)).toBe(`/repo/${PLAN_PATH}`)
    expect(lotOf('F2 todo/x/notes.md')).toBeNull()
  })

  test('plan à lots : section `## Lot Fn` seule, étapes cochées par leur titre, hypothèses du lot', () => {
    const sheet = parseLotSection(PLAN, 'F2')
    expect(sheet).toEqual({
      lot: 'F2',
      name: 'Envois payés en éther',
      isDone: false,
      hypotheses: 2,
      steps: [
        { number: '1', title: "Le joueur envoie une créature contre de l'éther", isDone: true, tdd: null, corrections: [] },
        { number: '2', title: 'Le joueur voit les envois en éther', isDone: false, tdd: null, corrections: [] },
        { number: '3', title: 'Vérification', isDone: false, tdd: null, corrections: [] },
      ],
    })
    expect(parseLotSection(PLAN, 'F1')).toMatchObject({ isDone: true, hypotheses: 1, steps: [{ number: '1', isDone: true }] })
    expect(parseLotSection(PLAN, 'F10')?.steps.map(step => step.title)).toEqual(['Le joueur achète un niveau de Porte'])
    expect(parseLotSection(PLAN, 'F3')).toBeNull()
  })

  test('fiche : étapes, marques TDD, corrections, hypothèses, étape close par son titre', () => {
    const sheet = parseSheet(SHEET, SHEET_PATH)
    expect(sheet.lot).toBe('F4')
    expect(sheet.name).toBe('Cycle de vie du paquet')
    expect(sheet.hypotheses).toBe(2)
    expect(sheet.isDone).toBe(false)
    expect(sheet.steps.map(step => step.number)).toEqual(['1', '2', '3', '4'])
    expect(sheet.steps[0]?.tdd).toEqual({ red: '✅', green: '✅', cost: '✅' })
    expect(sheet.steps[1]?.corrections).toEqual([
      { id: 'C1', finding: 'verrou posé après la création du paquet', tdd: { red: '⬜', green: '⬜', cost: '⬜' } },
    ])
    expect(sheet.steps.map(isStepDone)).toEqual([true, false, false, true])
    expect(sheet.steps[3]).toEqual({ number: '4', title: 'Documentation', isDone: true, tdd: null, corrections: [] })
    expect([markOf('✅'), markOf('⬜'), markOf('')]).toEqual(['✓', '·', '·'])
    expect(parseSheet('# X-PLAN-F5 — Verrous — ✅ DONE (2026-10-03)\n', 'todo/x/X-PLAN-F5.md').isDone).toBe(true)
    const english = parseSheet('# X-PLAN-F5 — Locks\n\n## TDD sequence\n\n### Step 1 — Create\n\nTDD: RED ✅ · GREEN ✅ · COST ✅\n', 'todo/x/X-PLAN-F5.md')
    expect(english.steps[0]?.tdd).toEqual({ red: '✅', green: '✅', cost: '✅' })
  })

  test('agent lent : au-delà de deux fois la moyenne des agents terminés de la phase, sans historique rien', () => {
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

  test('verdict d’audit : sévérités comptées, mineurs ignorés, libellé et teinte', () => {
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

  test('reprise : un agent relancé sous le même libellé porte son numéro de tentative', () => {
    const labelled = (id: string, label: string, startedAt: number) => agentOf(id, 'GREEN', 'done', { label, startedAt })
    expect(attemptsOf([labelled('c', 'GREEN 2', 300), labelled('a', 'GREEN 1', 100), labelled('b', 'GREEN 2', 200)])).toEqual({ a: 1, b: 1, c: 2 })
  })
})

const spanned = (ms: number) => ({ total: ms, count: 1, tools: 0, toolCount: 0, span: ms, spanCount: 1 })

describe('historique, fin estimée, enlisement, coût et alerte', () => {
  test('journal terminé : outils par agent et étendue de chaque phase, rien pour l’étendue d’un run arrêté', () => {
    const known = withSamples({}, samplesOf(SPAN_JOURNAL))
    expect(known.RED).toEqual({ total: 220_000, count: 2, tools: 50, toolCount: 2, span: 120_000, spanCount: 1 })
    expect(known.Design?.span).toBe(60_000)
    expect(withSamples({}, samplesOf(SPAN_JOURNAL.replace('"completed"', '"killed"'))).RED).toEqual({
      total: 220_000, count: 2, tools: 50, toolCount: 2, span: 0, spanCount: 0,
    })
    const twice = withSamples(known, samplesOf(SPAN_JOURNAL))
    expect([twice.RED?.span, twice.RED?.spanCount]).toEqual([240_000, 2])
  })

  test('enlisement : outils au-delà de 2 fois la moyenne de la phase (40 sans historique), contexte au-delà de 150k, inactivité au-delà de 3 min hors appel en cours', () => {
    const running = (extra: Partial<WorkflowAgent>) => agentOf('s', 'GREEN', 'running', { startedAt: 0, ...extra })
    expect(stallReasons(running({ tools: 40 }), null, 1_000)).toEqual([])
    expect(stallReasons(running({ tools: 41 }), null, 1_000)).toEqual(['⚠ 41 tools'])
    expect(stallReasons(running({ tools: 29 }), 14, 1_000)).toEqual(['⚠ 29 tools'])
    expect(stallReasons(running({ tools: 28 }), 14, 1_000)).toEqual([])
    expect(stallReasons(running({ context: 150_000 }), null, 1_000)).toEqual([])
    expect(stallReasons(running({ context: 160_000 }), null, 1_000)).toEqual(['⚠ ctx 160k'])
    expect(stallReasons(running({}), null, 180_000)).toEqual([])
    expect(stallReasons(running({}), null, 180_001)).toEqual(['⚠ idle 3m'])
    expect(stallReasons(running({ openCalls: 1 }), null, 600_000)).toEqual([])
    expect(stallReasons(agentOf('d', 'GREEN', 'done', { tools: 99 }), null, 600_000)).toEqual([])
    expect(stallReasons(running({ tools: 50, context: 160_000 }), null, 200_000)).toEqual(['⚠ idle 3m', '⚠ 50 tools', '⚠ ctx 160k'])
  })

  test('moyenne d’outils de la phase : historique puis agents terminés du run', () => {
    const known = withSamples({}, samplesOf(SPAN_JOURNAL))
    const target = agentOf('r', 'RED', 'running')
    expect(typicalTools(known, [], target)).toBe(25)
    expect(typicalTools(known, [agentOf('p', 'RED', 'done', { tools: 40 })], target)).toBe(30)
    expect(typicalTools({}, [], target)).toBeNull()
  })

  test('fin estimée : reste de la phase en cours et phases à venir, paire parallèle au maximum, rien sans historique', () => {
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

  test('agent interrompu : ni tentative de reprise, ni en cours, ni phase atteinte', () => {
    const stopped = agentOf('a', 'GREEN', 'interrupted', { label: 'GREEN 2', startedAt: 100 })
    const failed = agentOf('c', 'GREEN', 'error', { label: 'GREEN 2', startedAt: 150 })
    const again = agentOf('b', 'GREEN', 'running', { label: 'GREEN 2', startedAt: 200 })
    expect(attemptsOf([stopped, again])).toEqual({ a: 1, b: 1 })
    expect(attemptsOf([stopped, failed, again])).toEqual({ a: 1, c: 1, b: 2 })
    const run = runOf([agentOf('d', 'Design', 'done'), agentOf('g', 'GREEN', 'interrupted')])
    expect(phaseRows(run, 30).map(row => row.mark)).toEqual(['done', 'pending', 'pending'])
    expect(totalsOf([agentOf('g', 'GREEN', 'interrupted', { context: 90_000 }), agentOf('d', 'Design', 'done', { context: 10_000 })]).context).toBe(90_000)
  })

  test('coût réparti au prorata des tokens pondérés, cache lu compté faiblement, somme conservée', () => {
    const used = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2_000 }
    expect(weightOf(used)).toBe(7_500)
    const micros = (value: number | undefined) => Math.round((value ?? 0) * 1e6)
    const shares = splitCost(0.3, { a: 3_000, b: 1_000 })
    expect([micros(shares.a), micros(shares.b)]).toEqual([225_000, 75_000])
    const spread = splitCost(0.37, { a: 1, b: 2, c: 4 })
    expect(micros(Object.values(spread).reduce((sum, one) => sum + one, 0))).toBe(370_000)
    expect([splitCost(0, { a: 1 }), splitCost(0.3, {}), splitCost(0.3, { a: 0 })]).toEqual([{}, {}, {}])
  })

  test('alerte de fin : lot, issue, durée en minutes, raison tronquée hors succès', () => {
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
}

const world = (on: On, files: Record<string, string>, options: Options = {}) => {
  const { closed = [], stamps = {}, dirs = {}, reads = [], toasts = [] } = options
  const clock = mock.clock(on)
  let agents = 0
  let spent = 1
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], cost: { usd: spent } } }))
  on('turn.step', async function* ($, e) {
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
            workflowName: 'run-lot',
            transcriptDir: DIR,
            scriptPath: `${SESSION}/workflows/scripts/run-lot-${RUN}.js`,
          },
          text: 'launched',
        }
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

const spawn = (description: string, agentIndex: number) =>
  ({
    tool_use_id: 'w1', prompt: 'x', description, subagentType: 'tdd-test-author', provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5', background: true, fork: false, workflow: { runId: RUN, agentIndex },
  }) as AgentSpawnInput

const complete = (agentId: string, answer = 'fini') =>
  ({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't', agentId }) as unknown as TurnCompleteInput

const launch = ($: Engine, args: string | null = SHEET_PATH) =>
  $.tool.call({ tool: 'Workflow', tool_use_id: 'w1', name: 'run-lot', ...(args === null ? {} : { args }) } as Parameters<typeof $.tool.call>[0])

test('pane suit phases en colonnes, agents, fiche, lenteur puis l’issue du run', async ($, on) => {
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
    expect(await ui.find({ type: 'Text', text: /✻ run-lot · F4 · PDD-CYCLE/ })).toBeDefined()
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
    expect(await ui.find({ type: 'Text', text: /✓ 1 Créer le paquet/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◐ 2 Refus sans firmware/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ 3 Verrou firmware/ })).toBeDefined()
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
  expect(await nav.find({ type: 'Text', text: /✓ 3 Verrou firmware/ })).toBeDefined()
  await nav.press({ key: 'open-a2' })
  expect(await nav.find({ type: 'Text', text: /run-lot › RED › agent 2/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /Sonnet · high · tdd-test-author/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /ctx 43k ↗ 43k · now 43k/ })).toBeDefined()
  expect(await nav.find({ type: 'Text', text: /Tools · 1 call/ })).toBeDefined()
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
  await nav.press({ key: 'toggle-Design' })
  expect(await nav.find({ type: 'Button', text: /✓ design/ })).toBeDefined()
  await nav.unmount()

  files[`${SESSION}/workflows/${RUN}.json`] = JOURNAL
  await clock.advance(2_000)

  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /✓ completed\s+4m26/ })).toBeDefined()
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

test('verdict d’audit lu dans la réponse structurée de l’agent d’audit, le dernier l’emporte', async ($, on) => {
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

test('plan à lots : fiche lue dans la section du lot, en-tête nommé par le dossier, sans phase Review', async ($, on) => {
  const reads: string[] = []
  const stamps: Stamps = {}
  const files: Record<string, string> = {
    [`${SESSION}/workflows/scripts/run-lot-${RUN}.js`]: `export const meta = {
  name: 'run-lot',
  description: 'Lot',
  phases: [{ title: 'Design' }, { title: 'RED' }, { title: 'GREEN' }, { title: 'Global green' }, { title: 'Audit' }, { title: 'Closing' }],
}
`,
    [PLAN_PATH]: PLAN,
  }
  const clock = world(on, files, { stamps, reads })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await launch($, PLAN_ARGUMENT)
  await $.agent.spawn(spawn('design', 1))
  await clock.advance(2_000)

  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /✻ run-lot · F2 · ether-glaneurs-porte/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /SHEET F2 · 2 hypotheses/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1\/3 steps$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ 1 Le joueur envoie une/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /○ 2 Le joueur voit les envois/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Review/ })).toBeUndefined()
  await ui.unmount()

  files[PLAN_PATH] = PLAN.replace('#### Étape 2 — Le joueur voit les envois en éther — ⬜', '#### Étape 2 — Le joueur voit les envois en éther — ✅')
  stamps[PLAN_PATH] = 2
  await clock.advance(2_000)
  const after = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await after.find({ type: 'Text', text: /^2\/3 steps$/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /✓ 2 Le joueur voit les envois/ })).toBeDefined()
  await after.unmount()
})

test('pane vide sans run, appels hors workflow ignorés, bouton de fermeture présent', async ($, on) => {
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

test('demo en cours : colonnes, modèle, reprise, agent lent, enlisé, interrompu, fin estimée, phases repliées, fiche, largeur étroite', async ($, on) => {
  const toasts: string[] = []
  world(on, {}, { toasts })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'run-lot-pane', args: 'demo' } as Parameters<typeof $.command.run>[0])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /✻ run-lot · F4 · PKG-LIFECYCLE/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /running\s+12m40\s+5\/6 agents\s+ETA ~9m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /━+─+\s+2\/8 phases/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /GREEN 2 lock ↻ 2/ })).toBeDefined()
    expect((await ui.find({ key: 'model-demo-g1' }))?.text).toBe('Sonnet · high')
    expect(await colorOf(ui, 'agent-demo-g2b-time')).toBe('warning')
    expect(await colorOf(ui, 'agent-demo-g1-time')).toBe('inactive')
    expect(await ui.find({ type: 'Text', text: /^ {9}Edit \(48\) · ctx 36k · ⚠ 48 tools$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /tdd-implementer, ser/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /○ Global green/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /whole or filtered suites/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ Audit · Review · Report/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /○ Audit/ })).toBeUndefined()
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
  await ui.press({ key: 'all' })
  expect(await ui.find({ type: 'Button', text: /○ Audit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /○ Audit · Review · Report/ })).toBeUndefined()
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

test('demo terminée : verdict sur la ligne Audit, issue en bloc coloré, agent lent terminé, fiche close', async ($, on) => {
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

test('arrêt lu puis reprise : agent resté en cours interrompu, journal arrêté périmé ignoré jusqu’à sa réécriture, une alerte par fin', async ($, on) => {
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
  await stopped.press({ key: 'all' })
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
  expect(await finished.find({ type: 'Text', text: /✓ completed/ })).toBeDefined()
  await finished.unmount()
})

test('relance avant que l’arrêt soit lu : agent en cours interrompu, journal plus ancien que la relance ignoré, nouvel agent suivi', async ($, on) => {
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
  await ui.press({ key: 'all' })
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

test('coût par agent : delta de session réparti entre les demandeurs au prorata de leurs tokens pondérés, requête principale comprise', async ($, on) => {
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

test('fin estimée dans l’en-tête d’après les phases des runs précédents', async ($, on) => {
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

test('agent qui s’enlise : motif jaune sous la ligne de l’agent et dans sa fiche, inactivité hors appel en cours', async ($, on) => {
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
  expect(await waiting.find({ type: 'Text', text: /^ {9}Bash \(1\)$/ })).toBeDefined()
  await waiting.unmount()

  release()
  await pending
  await clock.advance(190_000)
  const idle = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await idle.find({ type: 'Text', text: /^ {9}Bash \(1\) · ⚠ idle 3m$/ })).toBeDefined()
  await idle.unmount()
})
