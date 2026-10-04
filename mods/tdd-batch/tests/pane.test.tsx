import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  duration,
  isSlow,
  isStepDone,
  parseGate,
  parseSheet,
  parseVerdict,
  phaseLabel,
  sheetFromArgs,
  verdictLabel,
} from '../hooks/register'

const SHEET_PATH = 'todo/package-configuration/PKG-CONF-PLAN-F2.md'

const SHEET = `# PKG-CONF-PLAN-F2 — Bundles signés par droit

> Lot F2 du plan \`PKG-CONF-PLAN.md\`.

## Intention

Générer un bundle par droit.

## Deroulement TDD

### Etape 1 — Générer le bundle d'un applet

| # | Test | Niveau | Projet | RM |
|---|------|--------|--------|-----|
| 1 | \`ShouldGenerateAssetBundle_WhenAppletIsGiven\` | TU | \`UnitTests\` | RM-10 |

TDD : RED ✅ · GREEN ✅ · COUT ✅

#### Correction C1 — applet et droit regroupés dans \`ConfigurationAsset\`

TDD : RED ✅ · GREEN ⬜ · COUT ⬜

### Etape 2 — Refuser un applet vide

TDD : RED ⬜ · GREEN ⬜ · COUT ⬜

### Etape 3 — Documentation des handlers — ✅ DONE (2026-10-03)

Pas de test.

## Hypotheses

H1 — le droit est unique par applet — à valider par le métier
H2 — le bundle reste sous 4 Mo
`

describe('fiche de lot', () => {
  test('lit le lot, les étapes, leurs états TDD, les corrections et les hypothèses', () => {
    const sheet = parseSheet(SHEET, SHEET_PATH)
    expect(sheet.lot).toBe('F2')
    expect(sheet.name).toBe('Bundles signés par droit')
    expect(sheet.isDone).toBe(false)
    expect(sheet.hypotheses).toBe(2)
    expect(sheet.steps.map(step => step.number)).toEqual(['1', '2', '3'])
    expect(sheet.steps[0]?.tdd).toEqual({ red: '✅', green: '✅', cost: '✅' })
    expect(sheet.steps[0]?.corrections).toEqual([
      { id: 'C1', finding: 'applet et droit regroupés dans `ConfigurationAsset`', tdd: { red: '✅', green: '⬜', cost: '⬜' } },
    ])
    expect(sheet.steps[2]).toEqual({ number: '3', title: 'Documentation des handlers', isDone: true, tdd: null, corrections: [] })
  })

  test('une étape verte reste ouverte tant qu’une correction ne l’est pas', () => {
    const [first, second, third] = parseSheet(SHEET, SHEET_PATH).steps
    expect(first && isStepDone(first)).toBe(false)
    expect(second && isStepDone(second)).toBe(false)
    expect(third && isStepDone(third)).toBe(true)
  })

  test('titre DONE ferme le lot', () => {
    const sheet = parseSheet('# X-PLAN-F5 — Verrous — ✅ DONE (2026-10-03)\n', 'todo/x/X-PLAN-F5.md')
    expect(sheet.isDone).toBe(true)
    expect(sheet.name).toBe('Verrous')
  })

  test('arguments de la skill donnent le chemin de la fiche', () => {
    expect(sheetFromArgs('lot F2 todo/package-configuration/PKG-CONF-PLAN.md')).toEqual({ path: SHEET_PATH, lot: 'F2' })
    expect(sheetFromArgs('lot F2 — correction: applet vide accepté')).toEqual({ path: null, lot: 'F2' })
    expect(sheetFromArgs(`lot F2 ${SHEET_PATH}`).path).toBe(SHEET_PATH)
    expect(phaseLabel(null)).toBe('—')
  })
})

const world = (on: On, exists = true, sheet = () => SHEET, answer?: Answer) => {
  const store = new Map<string, unknown>()
  const clock = mock.clock(on)
  on('fs.exists', () => ({ value: exists }))
  on('fs.read', () => ({ value: sheet() }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: e.path.replace(/\/$/, '').endsWith('todo')
      ? [{ name: 'package-configuration', kind: 'dir', size: 0, mtimeMs: 1, isLink: false }]
      : [
          { name: 'PKG-CONF-PLAN-F1.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false },
          { name: 'PKG-CONF-PLAN-F2.md', kind: 'file', size: 1, mtimeMs: 2, isLink: false },
        ],
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }))
  on('tool.call', ($, e) =>
    answer?.(e.tool, e as unknown as Record<string, unknown>) ??
    (e.tool === 'Agent' && (e as { subagent_type?: string }).subagent_type === 'tdd-implementer'
      ? { result: { type: 'text' }, text: '## BLOQUÉ\nRaison : signature absente' }
      : { result: { type: 'text' }, text: 'ok' }),
  )
  return clock
}

type Answer = (
  tool: string,
  input: Record<string, unknown>,
) => { result: { type: 'text' }; text: string } | Promise<{ result: { type: 'text' }; text: string }> | undefined

const PANE = {
  component: 'Pane',
  requestId: 'tdd-batch',
  props: {
    title: 'Lot TDD',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('pane suit la fiche dès le lancement de implement-tdd, sur chaque surface', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'Skill',
    tool_use_id: 's1',
    skill: 'implement-tdd', args: 'lot F2 todo/package-configuration/PKG-CONF-PLAN.md',
  })
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'a1',
    subagent_type: 'tdd-test-author', description: 'RED applet vide', prompt: 'x',
  })
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'a2',
    subagent_type: 'tdd-implementer', description: 'GREEN applet vide', prompt: 'x',
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tdd-batch', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Lot F2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/3 étapes/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /vague 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /C1 RED ✅ · GREEN ⬜ · COUT ⬜/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▸ 1\. RED ✅ · GREEN ✅ · COUT ✅ Générer le bundle/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /BLOQUÉ \(GREEN\) GREEN applet vide/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /PKG-CONF-PLAN-F2\.md/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pane suit les noms namespacés du plugin cctoolkit', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'Skill',
    tool_use_id: 's1',
    skill: 'cctoolkit:implement-tdd', args: 'lot F2 todo/package-configuration/PKG-CONF-PLAN.md',
  })
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'a1',
    subagent_type: 'cctoolkit:tdd-test-author', description: 'RED applet vide', prompt: 'x',
  })
  const ui = await $.ui.mount({ plugin: 'tdd-batch', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Lot F2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /vague 1/ })).toBeDefined()
  await ui.unmount()
})

test('pane sans fiche suivie invite à nommer la fiche', async ($, on) => {
  world(on, false)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'tdd-batch', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Aucune fiche de lot suivie/ })).toBeDefined()
  await ui.unmount()
})

test('/tdd-batch sans argument suit la fiche la plus récente', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({
    command: 'tdd-batch',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 160 },
  })
  expect(answer.text).toBe(`Pane ouvert sur ${SHEET_PATH}.`)
})

test('une écriture sur la fiche la rafraîchit', async ($, on) => {
  let text = SHEET
  world(on, true, () => text)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: `/repo/${SHEET_PATH}`, old_string: 'a', new_string: 'b' })
  text = SHEET.replace('TDD : RED ⬜ · GREEN ⬜ · COUT ⬜', 'TDD : RED ✅ · GREEN ✅ · COUT ✅').replace(
    'TDD : RED ✅ · GREEN ⬜ · COUT ⬜',
    'TDD : RED ✅ · GREEN ✅ · COUT ✅',
  )
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e2', file_path: `/repo/${SHEET_PATH}`, old_string: 'a', new_string: 'b' })

  const ui = await $.ui.mount({ plugin: 'tdd-batch', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /3\/3 étapes/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(SHEET_PATH.replace(/\./g, '\\.') + '$') })).toBeDefined()
  await ui.unmount()
})

test('fiche du toolkit en anglais', () => {
  const sheet = parseSheet(
    [
      '# DEMO-PLAN-F1 — Demo batch',
      '## TDD sequence',
      '### Step 1 — Create the order',
      'TDD: RED ✅ · GREEN ⬜ · COST ⬜',
      '#### Correction C1 — empty name accepted',
      'TDD: RED ⬜ · GREEN ⬜ · COST ⬜',
      '## Assumptions',
      '- H1 — one order per customer',
    ].join('\n'),
    'todo/demo/DEMO-PLAN-F1.md',
  )
  expect(sheet.steps[0]?.tdd).toEqual({ red: '✅', green: '⬜', cost: '⬜' })
  expect(sheet.steps[0]?.corrections[0]?.id).toBe('C1')
  expect(sheet.hypotheses).toBe(1)
})

const GATE_RED = `PRE-AUDIT — lot F2 — fiche todo/x/X-PLAN-F2.md
  ✓ identifiants classés
  ✗ commentaire ajouté sous src/
      src/A.cs:12
  ✗ fiche non close
PRE-AUDIT — lot F2 : ROUGE — corriger puis relancer, pas d'audit avant
`

const VERDICT_GAPS = `## Verdict — ECARTS

| Severite | Axe | Ecart | Preuve | Correction attendue |
|----------|-----|-------|--------|---------------------|
| Bloquant | Correction | Absence non geree | \`a.cs:1\` | Traiter |
| Majeur | Reutilisation | Second type | \`b.cs:2\` | Renommer |
| Majeur | Plan | Plan perime | \`c.md:3\` | Mettre a jour |

Validations : \`dotnet test\` — exit 1
`

describe('audit', () => {
  test('pré-audit : issue et nombre de contrôles en échec', () => {
    expect(parseGate(GATE_RED)).toEqual({ isGreen: false, failures: 2 })
    expect(parseGate("PRE-AUDIT — lot F2 : VERT — l'audit peut être délégué")).toEqual({ isGreen: true, failures: 0 })
    expect(parseGate('PRE-AUDIT — batch F1 : GREEN')).toEqual({ isGreen: true, failures: 0 })
    expect(parseGate('fiche introuvable')).toBeNull()
  })

  test('verdict : issue et écarts par sévérité', () => {
    const verdict = parseVerdict(VERDICT_GAPS)
    expect(verdict).toEqual({ isValid: false, blocking: 1, major: 2 })
    expect(verdict && verdictLabel(verdict)).toBe('ECARTS — 1 bloquant(s), 2 majeur(s)')
    expect(parseVerdict('## Verdict — VALIDE\n\n| RM | a | b |')).toEqual({ isValid: true, blocking: 0, major: 0 })
    expect(parseVerdict('pas de verdict')).toBeNull()
  })

  test('durées et lenteur au-delà du double du temps habituel', () => {
    expect(duration(45_000)).toBe('45 s')
    expect(duration(200_000)).toBe('3 min 20')
    expect(duration(3_900_000)).toBe('1 h 05')
    expect(isSlow('RED', 448_000)).toBe(false)
    expect(isSlow('RED', 449_000)).toBe(true)
    expect(isSlow('AUDIT', 600_000)).toBe(false)
  })
})

test('pane montre la durée du lot, l agent qui patine, le pré-audit et le verdict', async ($, on) => {
  let release = () => {}
  const clock = world(on, true, () => SHEET, (tool, input) => {
    if (tool === 'Bash') return { result: { type: 'text' }, text: GATE_RED }
    if (tool === 'Skill' && input.skill === 'verify-ddd-tdd') return { result: { type: 'text' }, text: VERDICT_GAPS }
    if (tool === 'Agent' && input.description === 'RED lent') {
      return new Promise(resolve => {
        release = () => resolve({ result: { type: 'text' }, text: 'ok' })
      })
    }
    return undefined
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Skill', tool_use_id: 's1', skill: 'implement-tdd', args: `lot F2 ${SHEET_PATH}` })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'bash .claude/scripts/pre-audit.sh F2 x.md' })
  await $.tool.call({ tool: 'Skill', tool_use_id: 's2', skill: 'verify-ddd-tdd', args: 'lot F2' })
  const pending = $.tool.call({
    tool: 'Agent',
    tool_use_id: 'a1',
    subagent_type: 'tdd-test-author', description: 'RED lent', prompt: 'x',
  })
  await clock.advance(500_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tdd-batch', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /8 min 20/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /RED lent — 8 min 20/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /habituel 3 min 44/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /pré-audit ROUGE \(2 contrôle\(s\)\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /passe 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ECARTS — 1 bloquant\(s\), 2 majeur\(s\)/ })).toBeDefined()
    await ui.unmount()
  }
  release()
  await pending
})
