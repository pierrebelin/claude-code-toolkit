import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Decision, OpenQuestion, SpecDoc } from '../types'
import { isUnanswered, parseSpec, questionsTone, sectionCounts, specGauge, specGaugeAlt, svgHeight } from '../hooks/register'

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

const QUESTIONS = [question('Q1', 'Bloquant'), question('Q2', 'Major'), question('Q3', 'Blocking'), question('Q4', ''), question('Q5', 'Mineur'), question('Q6', 'Majeur')]
const DECISIONS = [decision('d1', 'A'), decision('d2', 'A, B'), decision('d3', 'B'), decision('d4', 'A'), decision('d5', null)]

describe('spec gauge', () => {
  test('nothing while no decision is asked and no spec is written', () => {
    expect(specGauge([], null)).toBe('')
  })

  test('one square per open question, ordered by severity, icon inside, in the colours of the list below, the question on hover', () => {
    const svg = specGauge(DECISIONS, docOf(QUESTIONS))
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
    const svg = specGauge(DECISIONS, docOf(QUESTIONS))
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
    const svg = specGauge([], docOf(QUESTIONS))
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
    const svg = specGauge(DECISIONS, docOf(QUESTIONS))
    expect(svg).toContain('@media (prefers-color-scheme: dark)')
    for (const color of ['#52514e', '#c3c2b7']) expect(svg).toContain(color)
    const hits = [...svg.matchAll(/<rect class="hit" x="[\d.-]+" y="[\d.-]+" width="([\d.]+)" height="([\d.]+)"/g)]
    expect(hits).toHaveLength(QUESTIONS.length + DECISIONS.length)
    expect(hits.length).toBe(titlesOf(svg).length)
    for (const hit of hits) {
      expect(Number(hit[1])).toBeGreaterThan(18)
      expect(Number(hit[2])).toBeGreaterThan(18)
    }
    expect(svgHeight(svg)).toBeGreaterThan(0)
  })

  test('open questions and decisions side by side, each on half the width; alone, a block takes the whole width', () => {
    const both = specGauge(DECISIONS, docOf(QUESTIONS))
    const head = (svg: string, title: string) => new RegExp(`<text class="head" x="([\\d.]+)" y="([\\d.]+)">${title}</text>`).exec(svg)?.slice(1).map(Number)
    const [questionsX, questionsY] = head(both, 'Open questions') ?? []
    const [decisionsX, decisionsY] = head(both, 'Decisions') ?? []
    expect(questionsX).toBe(0)
    expect(decisionsY).toBe(questionsY)
    expect(decisionsX).toBeGreaterThan(250)
    expect(both).toMatch(/text-anchor="end">6 open<\/text>/)
    expect(Number(/x="([\d.]+)"[^>]*text-anchor="end">6 open</.exec(both)?.[1])).toBeLessThan(decisionsX ?? 0)
    const alone = specGauge([], docOf(QUESTIONS))
    expect(Number(/x="([\d.]+)"[^>]*text-anchor="end">6 open</.exec(alone)?.[1])).toBe(560)
  })

  test('a legend wider than its column wraps onto a new line', () => {
    const svg = specGauge(DECISIONS, docOf(QUESTIONS))
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
    const svg = specGauge([...DECISIONS, unanswered], docOf(QUESTIONS))
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
    expect(specGaugeAlt(DECISIONS, docOf(QUESTIONS))).toBe('Spec state: 6 open questions (2 blocking, 2 major, 2 other), 5 decisions (3 recommended kept, 1 other choice, 1 pending).')
    expect(specGaugeAlt([decision('d1', 'A')], null)).toBe('Spec state: 1 decision (1 recommended kept), spec not written yet.')
    expect(specGaugeAlt([], docOf([]))).toBe('Spec state: no open question, no decision.')
  })
})

describe('sommaire counts', () => {
  test('each section counts its use cases, rules or open questions', () => {
    const doc = parseSpec(SPEC)
    expect(sectionCounts(doc)).toEqual({ '4': 1, '12': 1 })
  })

  test('the open questions count takes the tone of the most severe question, as the list does', () => {
    expect(questionsTone(QUESTIONS)).toBe('error')
    expect(questionsTone([question('Q1', 'Majeur'), question('Q2', '')])).toBe('warning')
    expect(questionsTone([question('Q1', 'Mineur'), question('Q2', '')])).toBe('inactive')
  })
})

const PATH = '/repo/todo/catalog/SPEC-catalog.md'

const SPEC = `# CAT — Catalog

## 4. Use cases

### CU-01 — Create a product

## 12. Open questions

| # | Severity | Question | Impact | Options |
|---|----------|----------|--------|---------|
| Q1 | Blocking | Lock scope? | Deletion | a) org ; b) all |
`

const PANE = {
  component: 'Pane',
  requestId: 'spec-pane',
  props: { title: 'Spec', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const world = (on: On, files: Record<string, string>) => {
  mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', ($, e) => (files[e.path] === undefined ? { deny: `ENOENT ${e.path}` } : { value: files[e.path] ?? '' }))
  on('fs.stat', ($, e) =>
    files[e.path] === undefined ? { deny: `ENOENT ${e.path}` } : { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } },
  )
  on('tool.call', ($, e) =>
    e.tool === 'AskUserQuestion' ? { result: { questions: [], answers: { 'Scope?': 'Read only (recommended)' } }, text: 'answered' } : { result: { type: 'text' }, text: 'ok' },
  )
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

const call = (input: Record<string, unknown>) => input as never

test('the desktop draws the spec state once a decision is asked or the spec written, and counts in the sommaire; never the terminal', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call(call({ tool: 'Skill', tool_use_id: 's1', skill: 'business-spec', args: 'catalog' }))

  const armed = await $.ui.mount({ plugin: 'spec-pane', surface: 'desktop', ...PANE })
  expect(await armed.find({ type: 'Svg' })).toBeUndefined()
  await armed.unmount()

  await $.tool.call(
    call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Scope?', header: 'Scope', multiSelect: false, options: [{ label: 'Read only (recommended)' }, { label: 'All' }] }] }),
  )
  const asked = await $.ui.mount({ plugin: 'spec-pane', surface: 'desktop', ...PANE })
  const first = await asked.find({ type: 'Svg' })
  expect(first?.props.alt).toBe('Spec state: 1 decision (1 recommended kept), spec not written yet.')
  expect(first?.props.isInteractive).toBe(true)
  await asked.unmount()

  files[PATH] = SPEC
  await $.tool.call(call({ tool: 'Write', tool_use_id: 'w1', file_path: PATH, content: SPEC }))
  const desktop = await $.ui.mount({ plugin: 'spec-pane', surface: 'desktop', ...PANE })
  const svg = await desktop.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('Spec state: 1 open question (1 blocking), 1 decision (1 recommended kept).')
  expect(svg?.props.isInteractive).toBe(true)
  expect(svg?.props.height).toBe(svgHeight(String(svg?.props.source)))
  expect(await desktop.find({ type: 'Text', text: /CAT — Catalog/ })).toBeDefined()
  expect((await desktop.findAll({ type: 'Text', text: /^ {2}1$/ })).map(one => one.props.color)).toEqual(['inactive', 'error'])
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'spec-pane', surface: 'terminal', ...PANE })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: /CAT — Catalog/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^4\. Use cases$/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^ {2}1$/ })).toBeUndefined()
  await terminal.unmount()
})

test('a decision closed without an answer reads "no answer" in grey, never a kept recommendation, on every surface', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files)
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
    const ui = await $.ui.mount({ plugin: 'spec-pane', surface, ...PANE })
    expect((await ui.findAll({ type: 'Text', text: /^✓ $/ })).map(one => one.props.color)).toEqual(['success'])
    expect((await ui.find({ type: 'Text', text: /^– $/ }))?.props.color).toBe('inactive')
    expect(await ui.find({ type: 'Text', text: /^Notify · no answer$/ })).toBeDefined()
    await ui.press({ key: 'open-decision-q1-1' })
    expect((await ui.find({ type: 'Text', text: /^No answer$/ }))?.props.color).toBe('inactive')
    await ui.press({ key: 'open-decision-q1-1' })
    await ui.unmount()
  }
  const desktop = await $.ui.mount({ plugin: 'spec-pane', surface: 'desktop', ...PANE })
  expect((await desktop.find({ type: 'Svg' }))?.props.alt).toBe('Spec state: 2 decisions (1 recommended kept, 1 without answer), spec not written yet.')
  await desktop.unmount()
})
