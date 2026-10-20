import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Decision, OpenQuestion, SpecDoc } from '../types'
import {
  askedOf,
  fit,
  isAbsolutePath,
  isOffRecommendation,
  isSpecPath,
  isUnanswered,
  parseSpec,
  promptTopic,
  questionsTone,
  relativePath,
  sectionCounts,
  sectionKey,
  sectionLabel,
  specGauge,
  specGaugeAlt,
  svgHeight,
  svgWidth,
  withAnswers,
} from '../hooks/register'

const PATH = '/repo/todo/catalogue-groupes/SPEC-catalogue-groupes.md'

const SPEC = `# CAT — Produits par groupe

> Les produits viennent du Catalog, par groupe.

## 1. Contexte

Aujourd'hui les produits sont par organisation.

## 4. Cas d'usage

### CU-01 — Connaître ses produits
**Acteur** : tout utilisateur · **Intention** : savoir ce qui lui est ouvert
**Scénario nominal :**
1. L'utilisateur se connecte.

### CU-02 — Lister des éléments
**Acteur** : gestionnaire

## 5. Règles métier

### RM-01 — Catalog seule autorité
- **Énoncé** : le Catalog traduit les rôles. · **Origine** : produit · **Sévérité** : bloquant

### RM-02 — Filtre par groupe
- **Énoncé** : le filtre restreint. · **Origine** : produit · **Sévérité** : informatif

## 12. Questions ouvertes

| # | Sévérité | Question | Impact | Options |
|---|----------|----------|--------|---------|
| Q1 | Bloquant | Héritage des groupes ? | Disparition d'un coup | a) héritage ; b) groupes propres |
| Q2 | Majeur | Libellé d'un groupe supprimé ? | Affichage | a) id ; b) libellé figé |
`

const KIT_SPEC = `# CAT — Catalog

## 4. Use cases <!-- kit:use-cases -->

### CU-01 — Create a product
**Actor** : manager

## 5. Business rules <!-- kit:business-rules -->

### RM-01 — Publication lock
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
    options: [{ label: 'Catalog', description: 'x' }, { label: 'Studio', description: 'y' }],
  },
]

test('parseSpec reads title, summary, CU, RM with severity, sections and open questions', () => {
  const doc = parseSpec(SPEC)
  expect(doc.title).toBe('CAT — Produits par groupe')
  expect(doc.summary).toBe('Les produits viennent du Catalog, par groupe.')
  expect(doc.sections.map(one => `${one.number}. ${one.title}`)).toEqual(['1. Contexte', "4. Cas d'usage", '5. Règles métier', '12. Questions ouvertes'])
  expect(doc.useCases.map(one => `${one.id} ${one.name}`)).toEqual(['CU-01 Connaître ses produits', 'CU-02 Lister des éléments'])
  expect(doc.useCases[0]?.body).toContain("1. L'utilisateur se connecte.")
  expect(doc.rules.map(one => `${one.id} ${one.tag}`)).toEqual(['RM-01 bloquant', 'RM-02 informatif'])
  expect(doc.openQuestions.map(one => `${one.id} ${one.severity} ${one.question}`)).toEqual([
    'Q1 Bloquant Héritage des groupes ?',
    "Q2 Majeur Libellé d'un groupe supprimé ?",
  ])
  expect(doc.openQuestions[0]?.options).toBe('a) héritage ; b) groupes propres')
})

test('parseSpec also reads the toolkit English spec, kit markers included', () => {
  const doc = parseSpec(KIT_SPEC)
  expect(doc.sections.map(one => one.title)).toEqual(['Use cases', 'Business rules', 'Open questions'])
  expect(doc.rules[0]?.tag).toBe('blocking')
  expect(doc.openQuestions.map(one => `${one.id} ${one.severity}`)).toEqual(['Q1 Major'])
})

test('parseSpec reads knowledge-base ids and drops the delta anchor from the name', () => {
  const doc = parseSpec(`# PRD-ARCH — Product archiving

## 4. Use cases <!-- kit:use-cases -->

### CAT-CU-02 — Archive a product <!-- kit:new -->
**Actor** catalogue manager

### CAT-CU-01 — Consult products <!-- kit:modified -->
**Changes:** the listing applies CAT-RM-004.

## 5. Business rules <!-- kit:business-rules -->

### CAT-RM-003 — Only a published product can be archived <!-- kit:new -->
- **Statement**: refused · **Origin**: product choice · **Severity**: blocking

## 13. Decisions <!-- kit:decisions -->

### CAT-D-001 — Archive instead of delete <!-- kit:new -->
Choice: kept, hidden.
`)
  expect(doc.useCases.map(one => `${one.id}|${one.name}`)).toEqual(['CAT-CU-02|Archive a product', 'CAT-CU-01|Consult products'])
  expect(doc.rules.map(one => `${one.id}|${one.name}|${one.tag}`)).toEqual(['CAT-RM-003|Only a published product can be archived|blocking'])
  expect(doc.rules[0]?.body).not.toContain('Choice')
})

test('fit cuts to the width without wrapping', () => {
  expect(fit('Un profil lié\net un produit héritent-ils ?', 20)).toBe('Un profil lié et un…')
  expect(fit('court', 20)).toBe('court')
})

test('catalogue spec: SPEC.md, open questions in §10 without severity, found by their anchor only', () => {
  expect(isSpecPath('/repo/todo/catalogue/SPEC.md')).toBe(true)
  const spec = (heading: string) => `# Catalogue

## 5. Règles métier

### RM-01 — Un gestionnaire par catalogue
- **Énoncé** : un seul. · **Origine** : choix produit · **Concerne** : CU-01

${heading}
| # | Question | Impact | Options |
|---|---|---|---|
| Q1 | Choix caché en solo ? | Lisibilité | a) oui ; b) non |
`
  const doc = parseSpec(spec('## 10. Points en suspens <!-- kit:open-questions -->'))
  expect(doc.rules.map(one => one.name)).toEqual(['Un gestionnaire par catalogue'])
  expect(doc.openQuestions.map(one => `${one.id}|${one.severity}|${one.question}`)).toEqual(['Q1||Choix caché en solo ?'])
  // Without the anchor, only the `/plan-implementation` gate's title is read: `## 12. Questions ouvertes`.
  expect(parseSpec(spec('## 10. Questions ouvertes')).openQuestions).toEqual([])
})

test('open questions renumbered: the anchored section is read wherever it stands, not section 12', () => {
  const doc = parseSpec(`# CAT — Catalog

## 3. Open questions <!-- kit:open-questions -->

| # | Severity | Question | Impact | Options |
|---|----------|----------|--------|---------|
| Q1 | Blocking | Lock scope? | Deletion | a) org ; b) all |

## 12. Data <!-- kit:data -->

| # | Severity | Question | Impact | Options |
|---|----------|----------|--------|---------|
| X1 | Major | Not a question | — | — |
`)
  expect(doc.sections.map(one => `${one.number}|${one.anchor}`)).toEqual(['3|open-questions', '12|data'])
  expect(doc.openQuestions.map(one => `${one.id} ${one.severity} ${one.question}`)).toEqual(['Q1 Blocking Lock scope?'])
  expect(parseSpec('# X\n\n## 12. Questions ouvertes\n\n| # | Sévérité | Question |\n|---|---|---|\n| Q1 | Bloquant | Q ? |\n').openQuestions.map(one => one.id)).toEqual(['Q1'])
})

test('a section without a number is read, keyed by its position and shown by its title', () => {
  const doc = parseSpec(`# X

## 1. Business rules <!-- kit:business-rules -->

### RM-01 — Unique name

## Notes

### RM-02 — Not counted twice

## 2. Glossary
`)
  expect(doc.sections.map(sectionLabel)).toEqual(['1. Business rules', 'Notes', '2. Glossary'])
  expect(doc.sections.map(sectionKey)).toEqual(['1', '#2', '2'])
  expect(sectionCounts(doc)).toEqual({ '1': 1, '#2': 1, '2': 0 })
  expect(doc.rules.map(one => one.id)).toEqual(['RM-01', 'RM-02'])
})

test('item headings: the em dash only, as lib/knowledge.py reads an object heading', () => {
  const doc = parseSpec(`# X

## 5. Business rules <!-- kit:business-rules -->

### RM-01 — Em dash
### RM-02 – En dash
### RM-03 - Hyphen
### CAT-RM-004 — Base id <!-- kit:new -->
### CAT-RM-005 - Base id, hyphen
`)
  expect(doc.rules.map(one => `${one.id}|${one.name}`)).toEqual(['RM-01|Em dash', 'CAT-RM-004|Base id'])
})

test('spec path, typed command and expanded command', () => {
  expect(isSpecPath(PATH)).toBe(true)
  expect(isSpecPath('todo/x/SPEC-x.md')).toBe(true)
  expect(isSpecPath('/repo/todo/x/X-PLAN.md')).toBe(false)
  expect(promptTopic('/business-spec produits par groupe')).toBe('produits par groupe')
  expect(promptTopic('/business-spec')).toBeNull()
  expect(promptTopic('<command-name>/business-spec</command-name><command-args>produit</command-args>')).toBe('produit')
  expect(promptTopic('relis la /business-spec')).toBeUndefined()
})

test('Windows paths: a backslashed spec is followed, shown relative with `/`, the drive case aside', () => {
  expect(isSpecPath('C:\\repo\\todo\\x\\SPEC-x.md')).toBe(true)
  expect(isSpecPath('C:\\repo\\todo\\x\\X-PLAN.md')).toBe(false)
  expect(relativePath('C:\\repo\\todo\\x\\SPEC-x.md', 'c:/repo')).toBe('todo/x/SPEC-x.md')
  expect(relativePath('/repo/todo/x/SPEC-x.md', '/repo')).toBe('todo/x/SPEC-x.md')
  expect(relativePath('/Repo/todo/x/SPEC-x.md', '/repo')).toBe('/Repo/todo/x/SPEC-x.md')
  expect(isAbsolutePath('C:\\repo\\SPEC.md')).toBe(true)
  expect(isAbsolutePath('C:/repo/SPEC.md')).toBe(true)
  expect(isAbsolutePath('todo/x/SPEC.md')).toBe(false)
})

test('decision: recommended option, answer, gap from the recommendation', () => {
  const asked = askedOf('t1', QUESTIONS)
  expect(asked.map(one => one.recommended)).toEqual(['Lecture seule (recommandé)', 'Catalog'])
  const done = withAnswers(asked, {
    answers: { 'Livrer moins ?': 'Tout', 'Quelle autorité ?': 'Catalog' },
    annotations: { 'Quelle autorité ?': { notes: 'Studio aussi' } },
  })
  expect(done.map(one => [one.answer, one.isPending, isOffRecommendation(one)])).toEqual([
    ['Tout', false, true],
    ['Catalog', false, false],
  ])
  expect(done[1]?.note).toBe('Studio aussi')
})

const GOOD = '#0ca30c'
const WARNING = '#fab219'
const CRITICAL = '#d03b3b'

const squaresOf = (svg: string): string[] =>
  [...svg.matchAll(/<rect (?:class="(pending|none)" )?x="[\d.]+" y="[\d.]+" width="1[78]" height="1[78]" rx="4"(?: fill="(#[0-9a-f]{6})")?\/><text[^>]*>([^<]+)<\/text>/g)].map(
    found => `${found[2] ?? found[1]} ${found[3]}`,
  )

const titlesOf = (svg: string): string[] => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map(found => found[1] ?? '')

const decision = (id: string, answer: string | null, recommended = 'A'): Decision => ({
  id, header: id, question: `${id}?`, options: ['A', 'B'], recommended, answer, note: null, isPending: answer === null,
})

const question = (id: string, severity: string, text = `${id}?`): OpenQuestion => ({ id, severity, question: text, impact: '', options: '' })

const docOf = (openQuestions: OpenQuestion[]): SpecDoc => ({
  title: 'CAT — Catalog',
  summary: '',
  sections: ['1', '4', '5', '12'].map(number => ({ number, title: `S${number}`, body: '' })),
  useCases: [{ id: 'CU-01', name: 'Create a product', tag: null, body: '' }, { id: 'CU-02', name: 'List <items>', tag: null, body: '' }],
  rules: [{ id: 'RM-01', name: 'Publication lock', tag: 'blocking', body: '' }],
  openQuestions,
})

const OPEN = [question('Q1', 'Bloquant'), question('Q2', 'Major'), question('Q3', 'Blocking'), question('Q4', ''), question('Q5', 'Mineur'), question('Q6', 'Majeur')]
const DECISIONS = [decision('d1', 'A'), decision('d2', 'A, B'), decision('d3', 'B'), decision('d4', 'A'), decision('d5', null)]

describe('spec gauge', () => {
  test('one square per open question, ordered by severity, icon inside, in the colours of the list below, the question on hover', () => {
    const svg = specGauge(DECISIONS, docOf(OPEN))
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('>Open questions</text>')
    expect(svg).toContain('>6 open</text>')
    expect(squaresOf(svg).slice(0, 6)).toEqual([`${CRITICAL} ✖`, `${CRITICAL} ✖`, `${WARNING} ▲`, `${WARNING} ▲`, 'none ●', 'none ●'])
    expect(svg).toContain('✖ 2 blocking')
    expect(svg).toContain('▲ 2 major')
    expect(svg).toContain('● 2 other')
    const titles = titlesOf(svg)
    expect(titles).toContain('Q1 · blocking&#10;Q1?')
    expect(titles).toContain('Q6 · major&#10;Q6?')
  })

  test('one square per decision: recommended kept, other choice, pending, in the colours of the list below; question and answer on hover', () => {
    const svg = specGauge(DECISIONS, docOf(OPEN))
    expect(svg).toContain('>Decisions</text>')
    expect(svg).toContain('>4 of 5 answered</text>')
    expect(squaresOf(svg).slice(6)).toEqual([`${GOOD} ✓`, `${GOOD} ✓`, `${GOOD} ✓`, `${WARNING} ≠`, 'pending ?'])
    expect(svg).toContain('✓ 3 recommended kept')
    expect(svg).toContain('≠ 1 other choice')
    expect(svg).toContain('? 1 pending')
    const titles = titlesOf(svg)
    expect(titles).toContain('d3&#10;d3?&#10;answer: B&#10;recommended: A')
    expect(titles).toContain('d5&#10;d5?&#10;waiting for the answer&#10;recommended: A')
  })

  test('the counts of use cases, rules and sections stay out of the drawing: the sommaire carries them', () => {
    const svg = specGauge([], docOf(OPEN))
    expect(svg).not.toMatch(/use case|business rule|section|CU|RM/)
    expect(svg).not.toContain('>Decisions</text>')
  })

  test('text from the spec is escaped', () => {
    const svg = specGauge([], docOf([question('Q1', 'Blocking', 'Lock <all> & more?')]))
    expect(titlesOf(svg)).toContain('Q1 · blocking&#10;Lock &lt;all&gt; &amp; more?')
    expect(svg).not.toContain('<all>')
  })

  test('decisions only: no question block before the spec is written', () => {
    const svg = specGauge([decision('d1', null)], null)
    expect(svg).toContain('>Decisions</text>')
    expect(svg).toContain('>0 of 1 answered</text>')
    expect(svg).not.toContain('Open questions')
  })

  test('one open question is one square; none says so in words', () => {
    const one = specGauge([], docOf([question('Q1', 'Blocking')]))
    expect(one).toContain('✖ 1 blocking')
    expect(one).toContain('>1 open</text>')
    expect(one).not.toContain('major')
    const none = specGauge([], docOf([]))
    expect(none).toContain('no open question')
    expect(none).toContain(GOOD)
    expect(none).not.toContain(CRITICAL)
  })

  test('chrome in CSS classes with a dark block, a hit target wider than each square', () => {
    const svg = specGauge(DECISIONS, docOf(OPEN))
    expect(svg).toContain('@media (prefers-color-scheme: dark)')
    for (const color of ['#52514e', '#c3c2b7']) expect(svg).toContain(color)
    const hits = [...svg.matchAll(/<rect class="hit" x="[\d.-]+" y="[\d.-]+" width="([\d.]+)" height="([\d.]+)"/g)]
    expect(hits).toHaveLength(OPEN.length + DECISIONS.length)
    expect(hits.length).toBe(titlesOf(svg).length)
    for (const hit of hits) {
      expect(Number(hit[1])).toBeGreaterThan(18)
      expect(Number(hit[2])).toBeGreaterThan(18)
    }
  })

  test('open questions and decisions side by side, each on half the width; alone, a block takes the whole width', () => {
    const both = specGauge(DECISIONS, docOf(OPEN))
    const head = (svg: string, title: string) => new RegExp(`<text class="head" x="([\\d.]+)" y="([\\d.]+)">${title}</text>`).exec(svg)?.slice(1).map(Number)
    const [questionsX, questionsY] = head(both, 'Open questions') ?? []
    const [decisionsX, decisionsY] = head(both, 'Decisions') ?? []
    expect(questionsX).toBe(0)
    expect(decisionsY).toBe(questionsY)
    expect(decisionsX).toBeGreaterThan(250)
    expect(both).toMatch(/text-anchor="end">6 open<\/text>/)
    expect(Number(/x="([\d.]+)"[^>]*text-anchor="end">6 open</.exec(both)?.[1])).toBeLessThan(decisionsX ?? 0)
    const alone = specGauge([], docOf(OPEN))
    expect(Number(/x="([\d.]+)"[^>]*text-anchor="end">6 open</.exec(alone)?.[1])).toBe(560)
  })

  test('a legend wider than its column wraps onto a new line', () => {
    const svg = specGauge(DECISIONS, docOf(OPEN))
    const y = (text: string) => Number(new RegExp(`<text class="ink" x="[\\d.]+" y="([\\d.]+)">${text}</text>`).exec(svg)?.[1])
    expect(y('\\? 1 pending')).toBeGreaterThan(y('✓ 3 recommended kept'))
  })

  test('squares wrap onto a new row past the width', () => {
    const many = Array.from({ length: 40 }, (_, index) => question(`Q${index + 1}`, 'Major'))
    const tops = new Set([...specGauge([], docOf(many)).matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="18"/g)].map(found => found[1]))
    expect(tops.size).toBe(2)
    const half = new Set(
      [...specGauge(DECISIONS, docOf(many.slice(0, 13))).matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="18"[^>]*fill="#fab219"/g)]
        .filter(found => Number(found[1]) < 268)
        .map(found => found[2]),
    )
    expect(half.size).toBe(2)
  })

  test('a decision closed without an answer is neither kept nor answered: a grey square of its own', () => {
    const unanswered: Decision = { ...decision('d6', null), isPending: false }
    expect(isUnanswered(unanswered)).toBe(true)
    expect(isUnanswered(decision('d5', null))).toBe(false)
    expect(isUnanswered(decision('d1', 'A'))).toBe(false)
    const svg = specGauge([...DECISIONS, unanswered], docOf(OPEN))
    expect(svg).toContain('>4 of 6 answered</text>')
    expect(svg).toMatch(/<rect class="none" x="[\d.]+" y="[\d.]+" width="18" height="18" rx="4"\/><text[^>]*>–<\/text>/)
    expect(svg).toContain('– 1 no answer')
    expect(svg).toContain('✓ 3 recommended kept')
    expect(titlesOf(svg)).toContain('d6&#10;d6?&#10;no answer&#10;recommended: A')
    expect(specGaugeAlt([...DECISIONS, unanswered], null)).toBe(
      'Spec state: 6 decisions (3 recommended kept, 1 other choice, 1 without answer, 1 pending), spec not written yet.',
    )
  })

  test('alt says what the drawing shows in one sentence', () => {
    expect(specGaugeAlt(DECISIONS, docOf(OPEN))).toBe('Spec state: 6 open questions (2 blocking, 2 major, 2 other), 5 decisions (3 recommended kept, 1 other choice, 1 pending).')
    expect(specGaugeAlt([], docOf([]))).toBe('Spec state: no open question, no decision.')
  })
})

describe('sommaire counts', () => {
  test('each section counts its use cases, rules or open questions', () => {
    const doc = parseSpec(CATALOG_SPEC)
    expect(sectionCounts(doc)).toEqual({ '4': 1, '12': 1 })
  })

  test('the open questions count takes the tone of the most severe question, as the list does', () => {
    expect(questionsTone(OPEN)).toBe('error')
    expect(questionsTone([question('Q1', 'Majeur'), question('Q2', '')])).toBe('warning')
    expect(questionsTone([question('Q1', 'Mineur'), question('Q2', '')])).toBe('inactive')
  })
})

const CATALOG_PATH = '/repo/todo/catalog/SPEC-catalog.md'

const CATALOG_SPEC = `# CAT — Catalog

## 4. Use cases

### CU-01 — Create a product

## 12. Open questions

| # | Severity | Question | Impact | Options |
|---|----------|----------|--------|---------|
| Q1 | Blocking | Lock scope? | Deletion | a) org ; b) all |
`

const PANE = {
  component: 'Pane',
  requestId: 'knowledge-pane',
  props: { title: 'Knowledge', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// On Windows the engine hands the handlers a resolved native path (`/repo/x` arrives as `C:\repo\x`):
// brought back to the `/` form the files are keyed by.
const posix = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')
const world = (on: On, files: Record<string, string>, answers: Record<string, string> = {}, opened = new Set<string>()) => {
  const clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    opened.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    opened.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...opened].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('fs.read', ($, e) => (files[posix(e.path)] === undefined ? { deny: `ENOENT ${e.path}` } : { value: files[posix(e.path)] ?? '' }))
  on('fs.stat', ($, e) =>
    files[posix(e.path)] === undefined ? { deny: `ENOENT ${e.path}` } : { value: { kind: 'file', size: 1, mtimeMs: (files[posix(e.path)] ?? '').length, isLink: false } },
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

const SCOPE = { 'Scope?': 'Read only (recommended)' }

const call = (input: Record<string, unknown>) => input as never

test('pane follows decisions then the written spec, full content on click', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files, { 'Livrer moins ?': 'Tout', 'Quelle autorité ?': 'Catalog' })
  const copies: { text: string; surface?: string }[] = []
  on('ui.copy', ($, e) => {
    copies.push({ text: e.text, surface: e.surface })
    return { value: { isCopied: true } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ command: 'spec-pane', args: '' } as never)).text).toBe('Spec pane opened.')
  for (const surface of ['terminal', 'desktop'] as const) {
    const empty = await $.ui.mount({ plugin: 'knowledge-pane', surface, ...PANE })
    expect(await empty.find({ type: 'Text', text: /No \/business-spec in this session yet/ })).toBeDefined()
    await empty.unmount()
  }

  await $.tool.call(call({ tool: 'Skill', tool_use_id: 's1', skill: 'business-spec', args: 'produits par groupe' }))
  await $.tool.call(call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: QUESTIONS }))

  const before = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'terminal', ...PANE })
  expect(await before.find({ type: 'Text', text: /produits par groupe/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /waiting for the SPEC file/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /^Decisions$/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /Périmètre · Tout/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /^≠ $/ })).toBeDefined()
  await before.unmount()

  files[PATH] = SPEC
  await $.tool.call(call({ tool: 'Write', tool_use_id: 'w1', file_path: PATH, content: SPEC }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'knowledge-pane', surface, ...PANE })
    // The desktop draws a body as Markdown and an action as a labelled Button; the terminal as Text.
    const shown = async (text: RegExp) =>
      (await ui.find({ type: 'Text', text })) ?? (await ui.find({ type: 'Markdown', text })) ?? (await ui.find({ type: 'Button', text }))
    expect(await shown(/CAT — Produits par groupe/)).toBeDefined()
    expect(await shown(/todo\/catalogue-groupes\/SPEC-catalogue-groupes\.md/)).toBeDefined()
    expect(await shown(/^ ?2 · 1 blocking$/)).toBeDefined()
    // On a desktop the one blocking question takes a red wash; the other rows stay on the block's grey.
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Box' })).filter(one => one.props.backgroundColor === '#d6454524')).toHaveLength(1)
    expect(await shown(/^Connaître ses produits$/)).toBeDefined()
    expect(await shown(/^Héritage des groupes \?$/)).toBeDefined()
    expect(await shown(/^ bloquant$/)).toBeUndefined()
    expect(await shown(/^12\. Questions ouvertes$/)).toBeDefined()
    expect(await shown(/L'utilisateur se connecte/)).toBeUndefined()

    await ui.press({ key: 'open-useCase-CU-01' })
    expect(await shown(/L'utilisateur se connecte/)).toBeDefined()
    expect(await shown(/^Héritage des groupes \?$/)).toBeDefined()

    await ui.press({ key: 'open-openQuestion-Q1' })
    expect(await shown(/^Disparition d'un coup$/)).toBeDefined()
    expect(await shown(/L'utilisateur se connecte/)).toBeDefined()

    await ui.press({ key: 'open-decision-q1-1' })
    expect(await shown(/Quelle autorité \?/)).toBeDefined()
    expect(await shown(/✓ Catalog ★/)).toBeDefined()
    expect(await shown(/fold all \(3 open\)/i)).toBeDefined()

    await ui.press({ key: 'copy-openQuestion-Q1' })
    expect(copies.at(-1)?.surface).toBe(surface)
    expect(copies.at(-1)?.text).toMatch(/^Q1 — Héritage des groupes \?\n[\s\S]*Impact: Disparition d'un coup/)
    await ui.press({ key: 'copy-decision-q1-1' })
    expect(copies.at(-1)?.text).toMatch(/^Quelle autorité \?\n[\s\S]*- Catalog \(recommended\)/)

    await ui.press({ key: 'open-openQuestion-Q1' })
    expect(await shown(/^Disparition d'un coup$/)).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'copy-openQuestion-Q1' })).toBeUndefined()
    expect(await shown(/fold all \(2 open\)/i)).toBeDefined()

    await ui.press({ key: 'fold-all' })
    expect(await shown(/L'utilisateur se connecte/)).toBeUndefined()
    expect(await shown(/Quelle autorité \?/)).toBeUndefined()
    expect(await shown(/fold all/i)).toBeUndefined()

    await ui.press({ key: 'toggle-spec-rules' })
    expect(await shown(/^Catalog seule autorité$/)).toBeUndefined()
    await ui.press({ key: 'toggle-spec-rules' })
    await ui.unmount()
  }
})

test('questions outside /business-spec ignored, spec write followed alone', async ($, on) => {
  const files: Record<string, string> = { [PATH]: KIT_SPEC }
  const clock = world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call(call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: QUESTIONS }))
  await $.tool.call(call({ tool: 'Edit', tool_use_id: 'e1', file_path: PATH, old_string: 'a', new_string: 'b' }))

  const ui = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /CAT — Catalog/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Decisions$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^1$/ })).toBeDefined()
  await ui.unmount()

  files[PATH] = KIT_SPEC.replace('| Q1 | Major |', '| Q1 | Blocking |')
  await clock.advance(3_000)
  const later = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'terminal', ...PANE })
  expect(await later.find({ type: 'Text', text: /^1 · 1 blocking$/ })).toBeDefined()
  expect(await later.find({ type: 'Text', text: /read 0s ago/ })).toBeDefined()
  await later.unmount()
})

test('/spec-pane <path> follows an existing spec', async ($, on) => {
  const files: Record<string, string> = { [PATH]: SPEC }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'spec-pane', args: 'todo/x/X-PLAN.md' } as never)).text).toMatch(/Not a spec/)
  expect((await $.command.run({ command: 'spec-pane', args: 'todo/absente/SPEC-absente.md' } as never)).text).toMatch(/Spec not found/)
  expect((await $.command.run({ command: 'spec-pane', args: 'todo/catalogue-groupes/SPEC-catalogue-groupes.md' } as never)).text).toBe('Spec pane opened.')
  expect((await $.command.run({ command: 'spec-pane', args: '@todo/catalogue-groupes/SPEC-catalogue-groupes.md' } as never)).text).toBe('Spec pane opened.')
  const ui = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /CAT — Produits par groupe/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Connaître ses produits$/ })).toBeDefined()
  await ui.unmount()
})

test('a renumbered spec shows its anchored open questions and counts them on their own section', async ($, on) => {
  const renumbered = KIT_SPEC.replace('## 12. Open questions <!-- kit:open-questions -->', '## 7. Questions still open <!-- kit:open-questions -->')
  const files: Record<string, string> = { [PATH]: renumbered }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'spec-pane', args: 'todo/catalogue-groupes/SPEC-catalogue-groupes.md' } as never)).text).toBe('Spec pane opened.')
  const ui = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Lock scope\?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7\. Questions still open$/ })).toBeDefined()
  await ui.unmount()
})

test('the desktop draws the spec state once a decision is asked or the spec written, and counts in the sommaire; never the terminal', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files, SCOPE)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call(call({ tool: 'Skill', tool_use_id: 's1', skill: 'business-spec', args: 'catalog' }))

  const armed = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'desktop', ...PANE })
  expect(await armed.find({ type: 'Svg' })).toBeUndefined()
  await armed.unmount()

  await $.tool.call(
    call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Scope?', header: 'Scope', multiSelect: false, options: [{ label: 'Read only (recommended)' }, { label: 'All' }] }] }),
  )
  const asked = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'desktop', ...PANE })
  const first = await asked.find({ type: 'Svg' })
  expect(first?.props.alt).toBe('Spec state: 1 decision (1 recommended kept), spec not written yet.')
  expect(first?.props.isInteractive).toBe(true)
  await asked.unmount()

  files[CATALOG_PATH] = CATALOG_SPEC
  await $.tool.call(call({ tool: 'Write', tool_use_id: 'w1', file_path: CATALOG_PATH, content: CATALOG_SPEC }))
  const desktop = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'desktop', ...PANE })
  const svg = await desktop.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('Spec state: 1 open question (1 blocking), 1 decision (1 recommended kept).')
  expect(svg?.props.isInteractive).toBe(true)
  expect(svg?.props.height).toBe(svgHeight(String(svg?.props.source)))
  expect(svg?.props.width).toBe(svgWidth(String(svg?.props.source)))
  expect(svg?.props.width).toBeGreaterThan(0)
  expect(await desktop.find({ type: 'Text', text: /CAT — Catalog/ })).toBeDefined()
  expect((await desktop.findAll({ type: 'Text', text: /^ {2}1$/ })).map(one => one.props.color)).toEqual(['inactive', 'error'])
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'terminal', ...PANE })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: /CAT — Catalog/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^4\. Use cases$/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^ {2}1$/ })).toBeUndefined()
  await terminal.unmount()
})

test('a decision closed without an answer reads "no answer" in grey, never a kept recommendation, on every surface', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files, SCOPE)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call(call({ tool: 'Skill', tool_use_id: 's1', skill: 'business-spec', args: 'catalog' }))
  await $.tool.call(
    call({
      tool: 'AskUserQuestion',
      tool_use_id: 'q1',
      questions: [
        { question: 'Scope?', header: 'Scope', multiSelect: false, options: [{ label: 'Read only (recommended)' }, { label: 'All' }] },
        { question: 'Notify?', header: 'Notify', multiSelect: false, options: [{ label: 'Email (recommended)' }, { label: 'None' }] },
      ],
    }),
  )
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'knowledge-pane', surface, ...PANE })
    expect((await ui.findAll({ type: 'Text', text: /^✓ $/ })).map(one => one.props.color)).toEqual(['success'])
    expect((await ui.find({ type: 'Text', text: /^– $/ }))?.props.color).toBe('inactive')
    expect(await ui.find({ type: 'Text', text: /^Notify · no answer$/ })).toBeDefined()
    await ui.press({ key: 'open-decision-q1-1' })
    expect((await ui.find({ type: 'Text', text: /^No answer$/ }))?.props.color).toBe('inactive')
    await ui.press({ key: 'open-decision-q1-1' })
    await ui.unmount()
  }
  const desktop = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'desktop', ...PANE })
  expect((await desktop.find({ type: 'Svg' }))?.props.alt).toBe('Spec state: 2 decisions (1 recommended kept, 1 without answer), spec not written yet.')
  await desktop.unmount()
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

test('a button above the prompt opens and closes the pane on the desktop, once a spec is followed; never on the terminal', async ($, on) => {
  const open = new Set<string>()
  world(on, { [CATALOG_PATH]: CATALOG_SPEC }, {}, open)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const idle = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'desktop', ...BAND })
  expect(await idle.find({ key: 'toggle-knowledge-pane' })).toBeUndefined()
  await idle.unmount()

  await $.command.run({ command: 'spec-pane', args: 'todo/catalog/SPEC-catalog.md' } as Parameters<typeof $.command.run>[0])
  const terminal = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'terminal', ...BAND })
  expect(await terminal.find({ key: 'toggle-knowledge-pane' })).toBeUndefined()
  await terminal.unmount()

  const band = await $.ui.mount({ plugin: 'knowledge-pane', surface: 'desktop', ...BAND })
  const button = async () => (await band.find({ key: 'toggle-knowledge-pane' }))?.props
  expect((await button())?.label).toBe('◫ Spec')
  expect((await button())?.variant).toBe('primary')
  await band.press({ key: 'toggle-knowledge-pane' })
  expect(open.has('knowledge-pane')).toBe(false)
  expect((await button())?.variant).toBe('secondary')
  await band.press({ key: 'toggle-knowledge-pane' })
  expect(open.has('knowledge-pane')).toBe(true)
  expect((await button())?.variant).toBe('primary')
  await $.command.run({ command: 'knowledge-pane', args: '' } as Parameters<typeof $.command.run>[0])
  expect((await button())?.label).toBe('◫ Knowledge')
  await band.unmount()
})
