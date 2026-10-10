import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { askedOf, fit, isOffRecommendation, isSpecPath, parseSpec, promptTopic, withAnswers } from '../hooks/register'

const PATH = '/repo/todo/droits-groupes/SPEC-droits-groupes.md'

const SPEC = `# DRG — Droits par groupe

> Les droits viennent de la Console, par groupe.

## 1. Contexte

Aujourd'hui les droits sont par organisation.

## 4. Cas d'usage

### CU-01 — Connaître ses droits
**Acteur** : tout utilisateur · **Intention** : savoir ce qui lui est ouvert
**Scénario nominal :**
1. L'utilisateur se connecte.

### CU-02 — Lister des éléments
**Acteur** : gestionnaire

## 5. Règles métier

### RM-01 — Console seule autorité
- **Énoncé** : la Console traduit les rôles. · **Origine** : produit · **Sévérité** : bloquant

### RM-02 — Filtre par groupe
- **Énoncé** : le filtre restreint. · **Origine** : produit · **Sévérité** : informatif

## 12. Questions ouvertes

| # | Sévérité | Question | Impact | Options |
|---|----------|----------|--------|---------|
| Q1 | Bloquant | Héritage des groupes ? | Disparition d'un coup | a) héritage ; b) groupes propres |
| Q2 | Majeur | Libellé d'un groupe supprimé ? | Affichage | a) id ; b) libellé figé |
`

const KIT_SPEC = `# PKG — Package

## 4. Use cases <!-- kit:use-cases -->

### CU-01 — Create a package
**Actor** : manager

## 5. Business rules <!-- kit:business-rules -->

### RM-01 — Firmware lock
- **Statement** : locked. · **Origin** : product · **Severity** : blocking

## 12. Open questions <!-- kit:open-questions -->

| # | Severity | Question | Impact | Options |
|---|----------|----------|--------|---------|
| Q1 | Major | Lock scope? | Deletion | a) org ; b) all |
`

const QUESTIONS = [
  {
    question: 'Livrer moins ?',
    header: 'Périmètre',
    multiSelect: false,
    options: [{ label: 'Lecture seule (recommandé)', description: 'x' }, { label: 'Tout', description: 'y' }],
  },
  {
    question: 'Quelle autorité ?',
    header: 'Autorité',
    multiSelect: false,
    options: [{ label: 'Console', description: 'x' }, { label: 'Configurateur', description: 'y' }],
  },
]

test('parseSpec reprend titre, résumé, CU, RM avec sévérité, sections et questions ouvertes', () => {
  const doc = parseSpec(SPEC)
  expect(doc.title).toBe('DRG — Droits par groupe')
  expect(doc.summary).toBe('Les droits viennent de la Console, par groupe.')
  expect(doc.sections.map(one => `${one.number}. ${one.title}`)).toEqual(['1. Contexte', "4. Cas d'usage", '5. Règles métier', '12. Questions ouvertes'])
  expect(doc.useCases.map(one => `${one.id} ${one.name}`)).toEqual(['CU-01 Connaître ses droits', 'CU-02 Lister des éléments'])
  expect(doc.useCases[0]?.body).toContain("1. L'utilisateur se connecte.")
  expect(doc.rules.map(one => `${one.id} ${one.tag}`)).toEqual(['RM-01 bloquant', 'RM-02 informatif'])
  expect(doc.openQuestions.map(one => `${one.id} ${one.severity} ${one.question}`)).toEqual([
    'Q1 Bloquant Héritage des groupes ?',
    "Q2 Majeur Libellé d'un groupe supprimé ?",
  ])
  expect(doc.openQuestions[0]?.options).toBe('a) héritage ; b) groupes propres')
})

test('parseSpec lit aussi la spec anglaise du toolkit, marqueurs kit compris', () => {
  const doc = parseSpec(KIT_SPEC)
  expect(doc.sections.map(one => one.title)).toEqual(['Use cases', 'Business rules', 'Open questions'])
  expect(doc.rules[0]?.tag).toBe('blocking')
  expect(doc.openQuestions.map(one => `${one.id} ${one.severity}`)).toEqual(['Q1 Major'])
})

test('fit coupe à la largeur sans retour à la ligne', () => {
  expect(fit('Un profil lié\net un paquet héritent-ils ?', 20)).toBe('Un profil lié et un…')
  expect(fit('court', 20)).toBe('court')
})

test('spec runemaze : SPEC.md, questions ouvertes en §10 sans sévérité', () => {
  expect(isSpecPath('/game/todo/batisseurs/SPEC.md')).toBe(true)
  const doc = parseSpec(`# Bâtisseurs

## 5. Règles métier

### RM-01 — Un bâtisseur par partie
- **Énoncé** : un seul. · **Origine** : choix produit · **Concerne** : CU-01

## 10. Questions ouvertes
| # | Question | Impact | Options |
|---|---|---|---|
| Q1 | Choix caché en solo ? | Lisibilité | a) oui ; b) non |
`)
  expect(doc.rules.map(one => one.name)).toEqual(['Un bâtisseur par partie'])
  expect(doc.openQuestions.map(one => `${one.id}|${one.severity}|${one.question}`)).toEqual(['Q1||Choix caché en solo ?'])
})

test('chemin de spec, commande tapée et commande développée', () => {
  expect(isSpecPath(PATH)).toBe(true)
  expect(isSpecPath('todo/x/SPEC-x.md')).toBe(true)
  expect(isSpecPath('/repo/todo/x/X-PLAN.md')).toBe(false)
  expect(promptTopic('/business-spec droits par groupe')).toBe('droits par groupe')
  expect(promptTopic('/business-spec')).toBeNull()
  expect(promptTopic('<command-name>/business-spec</command-name><command-args>paquet</command-args>')).toBe('paquet')
  expect(promptTopic('relis la /business-spec')).toBeUndefined()
})

test('décision : option recommandée, réponse, écart à la recommandation', () => {
  const asked = askedOf('t1', QUESTIONS)
  expect(asked.map(one => one.recommended)).toEqual(['Lecture seule (recommandé)', 'Console'])
  const done = withAnswers(asked, {
    answers: { 'Livrer moins ?': 'Tout', 'Quelle autorité ?': 'Console' },
    annotations: { 'Quelle autorité ?': { notes: 'SES aussi' } },
  })
  expect(done.map(one => [one.answer, one.isPending, isOffRecommendation(one)])).toEqual([
    ['Tout', false, true],
    ['Console', false, false],
  ])
  expect(done[1]?.note).toBe('SES aussi')
})

const PANE = {
  component: 'Pane',
  requestId: 'spec-pane',
  props: { title: 'Spec', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const world = (on: On, files: Record<string, string>, answers: Record<string, string>) => {
  const clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', ($, e) => (files[e.path] === undefined ? { deny: `ENOENT ${e.path}` } : { value: files[e.path] ?? '' }))
  on('fs.stat', ($, e) =>
    files[e.path] === undefined ? { deny: `ENOENT ${e.path}` } : { value: { kind: 'file', size: 1, mtimeMs: (files[e.path] ?? '').length, isLink: false } },
  )
  on('tool.call', ($, e) =>
    e.tool === 'AskUserQuestion' ? { result: { questions: [], answers }, text: 'answered' } : { result: { type: 'text' }, text: 'ok' },
  )
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return clock
}

const call = (input: Record<string, unknown>) => input as never

test('pane suit les décisions puis la spec écrite, contenu complet au clic', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files, { 'Livrer moins ?': 'Tout', 'Quelle autorité ?': 'Console' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const empty = await $.ui.mount({ plugin: 'spec-pane', surface, ...PANE })
    expect(await empty.find({ type: 'Text', text: /No \/business-spec in this session yet/ })).toBeDefined()
    await empty.unmount()
  }

  await $.tool.call(call({ tool: 'Skill', tool_use_id: 's1', skill: 'business-spec', args: 'droits par groupe' }))
  await $.tool.call(call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: QUESTIONS }))

  const before = await $.ui.mount({ plugin: 'spec-pane', surface: 'terminal', ...PANE })
  expect(await before.find({ type: 'Text', text: /droits par groupe/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /waiting for the SPEC file/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /^ Decisions$/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /Périmètre · Tout/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /^≠ $/ })).toBeDefined()
  await before.unmount()

  files[PATH] = SPEC
  await $.tool.call(call({ tool: 'Write', tool_use_id: 'w1', file_path: PATH, content: SPEC }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'spec-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /DRG — Droits par groupe/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /todo\/droits-groupes\/SPEC-droits-groupes\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ 2 · 1 blocking$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Connaître ses droits$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Héritage des groupes \?$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ bloquant$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^12\. Questions ouvertes$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /L'utilisateur se connecte/ })).toBeUndefined()

    await ui.press({ key: 'open-useCase-CU-01' })
    expect(await ui.find({ type: 'Text', text: /L'utilisateur se connecte/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Héritage des groupes \?$/ })).toBeDefined()

    await ui.press({ key: 'open-openQuestion-Q1' })
    expect(await ui.find({ type: 'Text', text: /^Disparition d'un coup$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /L'utilisateur se connecte/ })).toBeDefined()

    await ui.press({ key: 'open-decision-q1-1' })
    expect(await ui.find({ type: 'Text', text: /Quelle autorité \?/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ Console ★/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /fold all \(3 open\)/ })).toBeDefined()

    await ui.press({ key: 'open-openQuestion-Q1' })
    expect(await ui.find({ type: 'Text', text: /^Disparition d'un coup$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /fold all \(2 open\)/ })).toBeDefined()

    await ui.press({ key: 'fold-all' })
    expect(await ui.find({ type: 'Text', text: /L'utilisateur se connecte/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Quelle autorité \?/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /fold all/ })).toBeUndefined()

    await ui.press({ key: 'toggle-rules' })
    expect(await ui.find({ type: 'Text', text: /^Console seule autorité$/ })).toBeUndefined()
    await ui.press({ key: 'toggle-rules' })
    await ui.unmount()
  }
})

test('questions hors /business-spec ignorées, écriture de spec suivie seule', async ($, on) => {
  const files: Record<string, string> = { [PATH]: KIT_SPEC }
  const clock = world(on, files, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call(call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: QUESTIONS }))
  await $.tool.call(call({ tool: 'Edit', tool_use_id: 'e1', file_path: PATH, old_string: 'a', new_string: 'b' }))

  const ui = await $.ui.mount({ plugin: 'spec-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /PKG — Package/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ Decisions$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ 1$/ })).toBeDefined()
  await ui.unmount()

  files[PATH] = KIT_SPEC.replace('| Q1 | Major |', '| Q1 | Blocking |')
  await clock.advance(3_000)
  const later = await $.ui.mount({ plugin: 'spec-pane', surface: 'terminal', ...PANE })
  expect(await later.find({ type: 'Text', text: /^ 1 · 1 blocking$/ })).toBeDefined()
  expect(await later.find({ type: 'Text', text: /read 0s ago/ })).toBeDefined()
  await later.unmount()
})

test('/spec-pane <chemin> suit une spec existante', async ($, on) => {
  const files: Record<string, string> = { [PATH]: SPEC }
  world(on, files, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'spec-pane', args: 'todo/x/X-PLAN.md' } as never)).text).toMatch(/Not a spec/)
  expect((await $.command.run({ command: 'spec-pane', args: 'todo/absente/SPEC-absente.md' } as never)).text).toMatch(/Spec not found/)
  expect((await $.command.run({ command: 'spec-pane', args: 'todo/droits-groupes/SPEC-droits-groupes.md' } as never)).text).toBe('Spec pane opened.')
  expect((await $.command.run({ command: 'spec-pane', args: '@todo/droits-groupes/SPEC-droits-groupes.md' } as never)).text).toBe('Spec pane opened.')
  const ui = await $.ui.mount({ plugin: 'spec-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /DRG — Droits par groupe/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Connaître ses droits$/ })).toBeDefined()
  await ui.unmount()
})
