import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { WorkflowAgent, WorkflowRun } from '../types'
import { blankAgent, demoHistory, demoPlanRuns, demoRuns, expectedPhases, lotRun, phaseRows, phaseTimeline, planTimeline, stepsOf, svgHeight, svgWidth } from '../hooks/register'

const AT = 10_000_000
const NEUTRAL = '#2a78d6'
const GOOD = '#0ca30c'
const WARNING = '#fab219'
const CRITICAL = '#d03b3b'

const titlesOf = (svg: string): string[] => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map(found => found[1] ?? '')

const bareRun = (agents: WorkflowAgent[], phases: string[]): WorkflowRun => ({
  runId: 'wf_1', name: 'run-lot', argument: 'todo/x/X-PLAN-F1.md', phases, details: {}, transcriptDir: null,
  startedAt: AT - 120_000, launchedAt: AT - 120_000, durationMs: null, status: 'running', outcome: null, audit: null,
  sheet: null, agents, child: null, plan: null, lots: [],
})

const rowLabel = (svg: string, label: string): string | undefined =>
  new RegExp(`<text class="([^"]+)" x="\\d+" y="[\\d.]+">${label}(?:<tspan[^>]*>  ([^<]+)</tspan>)?</text>`).exec(svg)?.slice(1).filter(one => one !== undefined).join(' ')

const ghostXs = (svg: string): number[] => [...svg.matchAll(/<rect class="ghost" x="([\d.]+)"/g)].map(found => Number(found[1]))

describe('phase timeline', () => {
  test('running demo: each phase heads its real steps, cycles named after the sheet, progress per phase', () => {
    const [run] = demoRuns(AT)
    const svg = phaseTimeline(run!, AT, demoHistory())
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(rowLabel(svg, 'Design')).toBe('ink head 2/2')
    expect(rowLabel(svg, 'RED')).toBe('ink head 2/5')
    expect(rowLabel(svg, 'GREEN')).toBe('ink head 1/5')
    for (const phase of ['Global green', 'Closing', 'Audit', 'Review', 'Report']) expect(rowLabel(svg, phase)).toBe('muted head')
    expect(rowLabel(svg, 'index CAT-LIFECYCLE-PLAN-F4.md')).toBe('ink')
    expect(rowLabel(svg, 'X1 Create the product')).toBe('ink')
    expect(rowLabel(svg, 'X3 Publication lock')).toBe('ink')
    expect(rowLabel(svg, 'X4 Remove a deleted item')).toBe('muted')
    expect(svg).toContain('>now</text>')
    expect(svg).toMatch(/>ETA ~\d+m<\/text>/)
    expect(svg).toContain(NEUTRAL)
    expect(svg).toContain(CRITICAL)
    expect(svg).toContain(WARNING)
    expect(svg).toContain('↻ 2')
    expect(svg).toContain('⚠ 48 tools')
    expect(svg).toContain('⊘ interrupted')
    expect(svg).toContain('✗ error')
    const titles = titlesOf(svg)
    expect(titles.filter(title => !title.includes('expected&#10;'))).toHaveLength(run!.agents.length)
    const live = titles.find(title => title.startsWith('GREEN X3 lock') && title.includes('running'))
    expect(live).toContain('Sonnet · high')
    expect(live).toContain('$')
    expect(live).toContain('tool Edit (48)')
    expect(live).toMatch(/\d+m\d{2}/)
    expect(live).toMatch(/expected ~\d+m more/)
  })

  test('running demo: expected bars for the rest of the running phase and each phase to come, a live edge, a legend', () => {
    const svg = phaseTimeline(demoRuns(AT)[0]!, AT, demoHistory())
    const titles = titlesOf(svg)
    for (const phase of ['Global green', 'Closing', 'Audit', 'Review', 'Report']) expect(titles.some(title => title.startsWith(`${phase} · expected`))).toBe(true)
    expect(ghostXs(svg)).toHaveLength(6)
    expect(svg).toMatch(/class="live"/)
    expect(svg).toContain('prefers-reduced-motion')
    for (const entry of ['agent', 'running', 'expected']) expect(svg).toContain(`>${entry}</text>`)
  })

  test('expected phases follow one another from now, parallel phases side by side', () => {
    const run = demoRuns(AT)[0]!
    const expected = expectedPhases(phaseRows(run, AT), demoHistory(), AT)
    expect(expected.GREEN?.from).toBe(AT)
    expect(expected['Global green']?.from).toBe(expected.GREEN?.to)
    expect(expected.Closing?.from).toBe(expected['Global green']?.from)
    expect(expected.Audit?.from).toBe(Math.max(expected['Global green']?.to ?? 0, expected.Closing?.to ?? 0))
    expect(expected.Review?.from).toBe(expected.Audit?.from)
    expect(expected.Report?.from).toBe(Math.max(expected.Audit?.to ?? 0, expected.Review?.to ?? 0))
    expect(expected.Design).toBeUndefined()
  })

  test('steps: every cycle of the sheet, retries on the row of their cycle, other phases by agent label', () => {
    const run = demoRuns(AT)[0]!
    const rows = phaseRows(run, AT)
    const green = stepsOf(rows.find(row => row.title === 'GREEN')!, run.sheet)
    expect(green.map(step => step.name)).toEqual(['X1 Create the product', 'X2 Refuse without catalog', 'X3 Publication lock', 'X4 Remove a deleted item', 'X5 Product audit'])
    expect(green.map(step => step.agents.length)).toEqual([1, 0, 2, 0, 0])
    const design = stepsOf(rows.find(row => row.title === 'Design')!, run.sheet)
    expect(design.map(step => step.name)).toEqual(['index CAT-LIFECYCLE-PLAN-F4.md', 'declaratives'])
    const bare = stepsOf(rows.find(row => row.title === 'RED')!, null)
    expect(bare.map(step => step.name)).toEqual(['X1 create', 'X2 refusal', 'X3 lock'])
  })

  test('finished demo: axis ends at the run end, no now, ETA, expected bar nor legend; a phase of one step keeps one row', () => {
    const run = demoRuns(AT, true)[0]!
    const svg = phaseTimeline(run, AT, demoHistory())
    expect(svg).not.toContain('>now</text>')
    expect(svg).not.toContain('ETA')
    expect(svg).toContain('>19m35</text>')
    expect(ghostXs(svg)).toHaveLength(0)
    expect(svg).not.toContain('>agent</text>')
    expect(titlesOf(svg)).toHaveLength(run.agents.length)
    expect(rowLabel(svg, 'Audit')).toBe('ink head 3/3')
    expect(rowLabel(svg, 'Global green')).toBe('ink head')
    expect(rowLabel(svg, 'suites')).toBeUndefined()
    expect(svg).toMatch(/<text class="ink small"[^>]*>suites<\/text>/)
  })

  test('no data: nothing at all without phase nor agent, empty rows before the first agent', () => {
    expect(phaseTimeline(bareRun([], []), AT, {})).toBe('')
    const empty = phaseTimeline(bareRun([], ['Design', 'RED']), AT, {})
    expect(empty).toContain('>Design</text>')
    expect(titlesOf(empty)).toHaveLength(0)
    expect(empty).toContain('>now</text>')
  })

  test('one agent: one bar with its tooltip; text from the run is escaped', () => {
    const agent = { ...blankAgent('a1', 1, 'design <A & B>', 'Opus', 'general', '', AT - 60_000), phase: 'Design', effort: 'high', cost: 0.42, lastTool: 'Read', tools: 3 }
    const svg = phaseTimeline(bareRun([agent], ['Design']), AT, {})
    const titles = titlesOf(svg)
    expect(titles).toHaveLength(1)
    expect(titles[0]).toContain('design &lt;A &amp; B&gt;')
    expect(titles[0]).toContain('Opus · high')
    expect(titles[0]).toContain('1m00')
    expect(titles[0]).toContain('$0.42')
    expect(titles[0]).toContain('tool Read (3)')
    expect(svg).not.toContain('<A & B>')
  })

  test('height read off the markup', () => {
    expect(svgHeight('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="148" viewBox="0 0 560 148"></svg>')).toBe(148)
    expect(svgHeight('')).toBe(0)
  })
})

describe('plan timeline', () => {
  test('running plan: a row per batch named after its sheet, its state, the supervisor steps, a now marker', () => {
    const [run] = demoPlanRuns(AT)
    const svg = planTimeline(run!, AT)
    for (const lot of ['F1 Create a product', 'F2 Archive a product', 'Supervisor']) expect(rowLabel(svg, lot)).toBe('ink')
    for (const lot of ['F3 Restore a product', 'F4 Product history']) expect(rowLabel(svg, lot)).toBe('muted')
    expect(svg).toContain('✓ done')
    expect(svg).toContain('● running')
    expect(svg).toContain('⧗ after F1')
    expect(svg).toContain('⧗ after F2, F3')
    expect(svg).toContain(GOOD)
    expect(svg).toContain(NEUTRAL)
    expect(svg).toContain('>now</text>')
    const titles = titlesOf(svg)
    expect(titles.find(title => title.startsWith('F2'))).toMatch(/running · \d+ agents · \d+m\d{2} · \$\d+\.\d{2}/)
    expect(titles.find(title => title.startsWith('preflight'))).toContain('Haiku · high')
  })

  test('running plan: batches to come drawn as expected bars after their dependencies, the plan ETA', () => {
    const svg = planTimeline(demoPlanRuns(AT)[0]!, AT)
    const titles = titlesOf(svg)
    expect(titles.some(title => title.startsWith('F3 · expected'))).toBe(true)
    expect(titles.find(title => title.startsWith('F4 · expected'))).toContain('after F2, F3')
    const [f3, f4] = ghostXs(svg)
    expect(f4).toBeGreaterThan(f3 ?? Infinity)
    expect(svg).toMatch(/>ETA ~\d+m<\/text>/)
  })

  test('finished plan: three batches done, the last one still waiting on its dependencies, nothing expected', () => {
    const svg = planTimeline(demoPlanRuns(AT, true)[0]!, AT)
    expect(svg.match(/✓ done/g)).toHaveLength(3)
    expect(svg).toContain('⧗ after F2, F3')
    expect(svg).not.toContain('>now</text>')
    expect(ghostXs(svg)).toHaveLength(0)
  })

  test('no batch: nothing', () => {
    expect(planTimeline({ ...demoPlanRuns(AT)[0]!, lots: [] }, AT)).toBe('')
  })

  test('a batch opened from the plan draws the phase timeline of that batch, its cycles named from the agents', () => {
    const plan = demoPlanRuns(AT)[0]!
    const svg = phaseTimeline(lotRun(plan, 'F2'), AT, demoHistory())
    expect(rowLabel(svg, 'GREEN')).toMatch(/^ink head \d\/\d$/)
    expect(rowLabel(svg, 'C3 hide')).toBe('ink')
    expect(titlesOf(svg).some(title => title.startsWith('GREEN C3 hide'))).toBe(true)
  })
})

const world = (on: On, opened = new Set<string>()) => {
  mock.clock(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], cost: { usd: 1 } } }))
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
  on('fs.read', ($, e) => ({ deny: `ENOENT ${e.path}` }))
  on('fs.stat', ($, e) => ({ deny: `ENOENT ${e.path}` }))
  on('fs.list', ($, e) => ({ deny: `ENOENT ${e.path}` }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

const PANE = {
  component: 'Pane',
  requestId: 'run-lot-pane',
  props: { title: 'Workflow', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the desktop keeps the phase view and opens the timeline on demand; the terminal never offers it', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const alts: Record<string, RegExp> = {
    demo: /^Phase timeline of run-lot F4: running for 12m40, \d+ of 8 phases reached, \d+ agents, ETA ~\d+m, 1 retry, 1 stall, 1 interruption, 1 error\.$/,
    'demo end': /^Phase timeline of run-lot F4: completed in 19m35, 8 of 8 phases reached, 14 agents, 1 retry, 1 interruption, 1 error\.$/,
    'demo plan': /^Batch timeline of run-plan: 1 of 6 batches done, F2 running, F5 waiting for an answer, F3, F4 and F6 pending, 31m10 elapsed\.$/,
    'demo plan end': /^Batch timeline of run-plan: 3 of 6 batches done, F5 waiting for an answer, F4 and F6 pending, completed in 48m30\.$/,
  }
  for (const [args, alt] of Object.entries(alts)) {
    await $.command.run({ command: 'run-lot-pane', args } as Parameters<typeof $.command.run>[0])
    const desktop = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'desktop', ...PANE })
    expect(await desktop.find({ type: 'Svg' })).toBeUndefined()
    expect(await desktop.find({ type: 'Text', text: /^ {2}(PHASES|LOTS)$/ })).toBeDefined()
    expect((await desktop.find({ key: 'open-timeline' }))?.props.hotkey).toBe('t')
    await desktop.press({ key: 'open-timeline' })
    const svg = await desktop.find({ type: 'Svg' })
    expect(svg?.props.alt).toMatch(alt)
    expect(svg?.props.isInteractive).toBe(true)
    expect(String(svg?.props.source)).toMatch(/^<svg[\s\S]*<\/svg>$/)
    expect(svg?.props.height).toBe(svgHeight(String(svg?.props.source)))
  expect(svg?.props.width).toBe(svgWidth(String(svg?.props.source)))
  expect(svg?.props.width).toBeGreaterThan(0)
    expect(await desktop.find({ type: 'Text', text: /timeline$/ })).toBeDefined()
    expect(await desktop.find({ type: 'Text', text: /^ {2}(PHASES|LOTS)$/ })).toBeUndefined()
    await desktop.press({ key: 'back' })
    expect(await desktop.find({ type: 'Svg' })).toBeUndefined()
    expect(await desktop.find({ type: 'Text', text: /^ {2}(PHASES|LOTS)$/ })).toBeDefined()
    await desktop.unmount()
    const terminal = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
    expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
    expect(await terminal.find({ key: 'open-timeline' })).toBeUndefined()
    expect(await terminal.find({ type: 'Text', text: /✻ run-(lot|plan)/ })).toBeDefined()
    await terminal.unmount()
  }

  await $.command.run({ command: 'run-lot-pane', args: 'demo plan' } as Parameters<typeof $.command.run>[0])
  const desktop = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'desktop', ...PANE })
  await desktop.press({ key: 'open-lot-F2' })
  await desktop.press({ key: 'open-timeline' })
  expect((await desktop.find({ type: 'Svg' }))?.props.alt).toMatch(/^Phase timeline of run-lot F2: running for/)
  await desktop.press({ key: 'plan' })
  expect(await desktop.find({ type: 'Svg' })).toBeUndefined()
  expect(await desktop.find({ type: 'Text', text: /^ {2}LOTS$/ })).toBeDefined()
  await desktop.unmount()

  await $.command.run({ command: 'run-lot-pane', args: 'demo' } as Parameters<typeof $.command.run>[0])
  const left = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'desktop', ...PANE })
  await left.press({ key: 'open-timeline' })
  await left.unmount()
  const terminal = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await terminal.find({ type: 'Text', text: /^ {2}PHASES$/ })).toBeDefined()
  await terminal.unmount()
})

test('a touch of colour on the desktop: accent headings, RED in red and GREEN in green; the terminal keeps its colours', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'run-lot-pane', args: 'demo' } as Parameters<typeof $.command.run>[0])
  const colours = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface, ...PANE })
    const found = {
      phases: (await ui.find({ type: 'Text', text: /^ {2}PHASES$/ }))?.props.color,
      sheet: (await ui.find({ type: 'Text', text: /^ {2}SHEET F4$/ }))?.props.color,
      red: (await ui.find({ type: 'Text', text: /^RED$/ }))?.props.color,
      green: (await ui.find({ type: 'Text', text: /^GREEN$/ }))?.props.color,
      design: (await ui.find({ type: 'Text', text: /^Design$/ }))?.props.color,
      pending: (await ui.find({ type: 'Text', text: /^Audit$/ }))?.props.color,
      reached: (await ui.findAll({ type: 'Text', text: /^RED $/ })).map(one => one.props.color),
    }
    await ui.unmount()
    return found
  }
  expect(await colours('terminal')).toEqual({
    phases: undefined, sheet: undefined, red: undefined, green: undefined, design: undefined, pending: 'inactive',
    reached: ['inactive', 'inactive', 'inactive', 'inactive', 'inactive'],
  })
  expect(await colours('desktop')).toEqual({
    phases: 'claude', sheet: 'claude', red: 'error', green: 'success', design: 'inactive', pending: 'subtle',
    reached: ['error', 'error', 'error', 'inactive', 'inactive'],
  })
})

test('desktop rows keep their colours outside the native button, a trailing › opens them; the terminal presses the whole row', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'run-lot-pane', args: 'demo' } as Parameters<typeof $.command.run>[0])
  const desktop = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'desktop', ...PANE })
  const glyphOf = async (key: string) => ((await desktop.find({ key }))?.children[0] as { props?: { color?: string } } | undefined)?.props?.color
  expect(await glyphOf('open-demo-g1-row')).toBe('success')
  expect(await glyphOf('open-demo-g2b-row')).toBe('claude')
  expect(await glyphOf('phase-Design-row')).toBe('success')
  expect((await desktop.find({ type: 'Button', key: 'open-demo-g1' }))?.props.label).toBe('›')
  const styleOf = async (text: RegExp) => {
    const found = await desktop.find({ type: 'Text', text })
    return { color: found?.props.color, bold: found?.props.bold, italic: found?.props.italic }
  }
  expect(await styleOf(/^Design$/)).toEqual({ color: 'inactive', bold: undefined, italic: undefined })
  expect(await styleOf(/^GREEN$/)).toEqual({ color: 'success', bold: true, italic: undefined })
  expect(await styleOf(/^Audit$/)).toEqual({ color: 'subtle', bold: undefined, italic: true })
  expect(await styleOf(/^X1 Create the product$/)).toEqual({ color: 'inactive', bold: undefined, italic: undefined })
  expect(await styleOf(/^X3 Publication lock$/)).toEqual({ color: undefined, bold: true, italic: undefined })
  expect(await styleOf(/^X4 Remove a deleted item$/)).toEqual({ color: 'subtle', bold: undefined, italic: true })
  await desktop.press({ key: 'open-demo-g1' })
  expect(await desktop.find({ type: 'Text', text: /›/ })).toBeDefined()
  await desktop.unmount()
  const terminal = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await terminal.find({ key: 'open-demo-g1-row' })).toBeUndefined()
  expect((await terminal.find({ type: 'Button', key: 'open-demo-g1' }))?.props.label).toBeUndefined()
  await terminal.unmount()
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

test('a button above the prompt opens and closes the pane on the desktop, once there is a run; never on the terminal', async ($, on) => {
  const open = new Set<string>()
  world(on, open)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const empty = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'desktop', ...BAND })
  expect(await empty.find({ key: 'toggle-run-lot-pane' })).toBeUndefined()
  await empty.unmount()

  await $.command.run({ command: 'run-lot-pane', args: 'demo' } as Parameters<typeof $.command.run>[0])
  const terminal = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...BAND })
  expect(await terminal.find({ key: 'toggle-run-lot-pane' })).toBeUndefined()
  await terminal.unmount()

  const band = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'desktop', ...BAND })
  const button = async () => (await band.find({ key: 'toggle-run-lot-pane' }))?.props
  expect((await button())?.label).toBe('◫ Workflow')
  expect((await button())?.variant).toBe('primary')
  await band.press({ key: 'toggle-run-lot-pane' })
  expect(open.has('run-lot-pane')).toBe(false)
  expect((await button())?.variant).toBe('secondary')
  await band.press({ key: 'toggle-run-lot-pane' })
  expect(open.has('run-lot-pane')).toBe(true)
  expect((await button())?.variant).toBe('primary')
  await band.unmount()
})
