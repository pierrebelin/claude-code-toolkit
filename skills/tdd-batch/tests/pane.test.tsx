import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isStepDone, parseSheet, phaseLabel, sheetFromArgs } from '../hooks/register'

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

const world = (on: On, exists = true, sheet = () => SHEET) => {
  const store = new Map<string, unknown>()
  mock.clock(on)
  on('fs.exists', () => ({ value: exists }))
  on('fs.read', () => ({ value: sheet() }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('tool.call', ($, e) =>
    e.tool === 'Agent' && (e.input as { subagent_type?: string }).subagent_type === 'tdd-implementer'
      ? { result: { type: 'text' }, text: '## BLOQUÉ\nRaison : signature absente' }
      : { result: { type: 'text' }, text: 'ok' },
  )
}

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
    input: { skill: 'implement-tdd', args: 'lot F2 todo/package-configuration/PKG-CONF-PLAN.md' },
  })
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'a1',
    input: { subagent_type: 'tdd-test-author', description: 'RED applet vide', prompt: 'x' },
  })
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'a2',
    input: { subagent_type: 'tdd-implementer', description: 'GREEN applet vide', prompt: 'x' },
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

test('pane sans fiche suivie invite à nommer la fiche', async ($, on) => {
  world(on, false)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'tdd-batch', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Aucune fiche de lot suivie/ })).toBeDefined()
  await ui.unmount()
})

test('une écriture sur la fiche la rafraîchit', async ($, on) => {
  let text = SHEET
  world(on, true, () => text)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', input: { file_path: `/repo/${SHEET_PATH}`, old_string: 'a', new_string: 'b' } })
  text = SHEET.replace('TDD : RED ⬜ · GREEN ⬜ · COUT ⬜', 'TDD : RED ✅ · GREEN ✅ · COUT ✅').replace(
    'TDD : RED ✅ · GREEN ⬜ · COUT ⬜',
    'TDD : RED ✅ · GREEN ✅ · COUT ✅',
  )
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e2', input: { file_path: `/repo/${SHEET_PATH}`, old_string: 'a', new_string: 'b' } })

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
