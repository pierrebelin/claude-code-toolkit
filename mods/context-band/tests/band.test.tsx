import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  cacheState,
  calibrate,
  callLabel,
  dollars,
  kilo,
  meter,
  meterColor,
  span,
  nextStreak,
  replay,
  stepLabel,
  topContributions,
} from '../hooks/register'

const HOUR = 60 * 60 * 1000

describe('pure figures', () => {
  test('call label names the tool and its target', () => {
    expect(callLabel('Read', { file_path: '/repo/src/Handler.cs' })).toBe('Read Handler.cs')
    expect(callLabel('Bash', { command: 'dotnet test', description: 'Lance les tests unitaires' })).toBe('Bash Lance les tests uni…')
    expect(callLabel('Agent', { description: 'Explore handlers', prompt: 'x' })).toBe('Agent Explore handlers')
    expect(callLabel('TodoWrite', {})).toBe('TodoWrite')
  })

  test('top contributions sum one label over the window and rank them', () => {
    const top = topContributions(
      [
        { turn: 1, label: 'Read a.cs', tokens: 9_000 },
        { turn: 4, label: 'Read b.cs', tokens: 3_000 },
        { turn: 5, label: 'Read b.cs', tokens: 2_500 },
        { turn: 5, label: 'Bash tests', tokens: 4_000 },
      ],
      2,
      4,
    )
    expect(top).toEqual([
      { label: 'Read b.cs', tokens: 5_500 },
      { label: 'Bash tests', tokens: 4_000 },
    ])
  })

  test('kilo, meter and span', () => {
    expect(kilo(950)).toBe('950')
    expect(kilo(68_240)).toBe('68.2k')
    expect(kilo(1_000_000)).toBe('1M')
    expect(meter(13)).toBe('█░░░░░░░░░')
    expect(meterColor(60)).toBe('yellow')
    expect(span(14 * 60_000 + 37_000)).toBe('14m')
    expect(span(65 * 60_000)).toBe('1h5m')
  })

  test('step label names the 150k step and the 250k ceiling', () => {
    expect(stepLabel(68_000)).toBe('/clear advised in 82.0k (step 150k, ceiling 250k)')
    expect(stepLabel(160_000)).toContain('150k step reached')
    expect(stepLabel(260_000)).toContain('250k ceiling')
  })

  test('cache counts down from the last turn and turns red once expired', () => {
    expect(cacheState(0, 8 * 60 * 1000, 100_000)).toEqual({ label: 'Cache (52m)', color: undefined })
    expect(cacheState(0, 55 * 60 * 1000, 100_000)?.color).toBe('yellow')
    expect(cacheState(0, HOUR + 1, 100_000)).toEqual({ label: 'Cache expired', color: 'red', detail: 'next turn rereads 100.0k at full price' })
    expect(cacheState(0, HOUR + 1, 10_000)).toBeNull()
  })

  test('streak grows on single-call steps, resets on a batched one, ignores text-only steps', () => {
    expect(nextStreak(2, 1)).toBe(3)
    expect(nextStreak(3, 0)).toBe(3)
    expect(nextStreak(3, 2)).toBe(0)
  })
})

const world = (on: On, tokens: number) => {
  const clock = mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { tokens, window: 1_000_000, percent: 7 }, rateLimits: [{ kind: 'five_hour', percentUsed: 49.6 }], cost: { usd: 4.126 } } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('turn.complete', () => ({ text: '' }))
  return clock
}

const BAND = {
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const turn = { reason: 'answer', answer: '', durationMs: 10, isAborted: false, turnId: 't1' } as const

test('band shows step and cache after a turn, on every surface', async ($, on) => {
  const clock = world(on, 160_000)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn)
  await clock.advance(50 * 60 * 1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /150k step/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Cache \(10m\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ 50%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 turn\b/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$4\.13/ })).toBeDefined()
    await ui.unmount()
  }
})

test('band yields when no turn has been measured', async ($, on) => {
  world(on, 0)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /step/ })).toBeUndefined()
  await ui.unmount()
})

describe('calibration', () => {
  test('estimates above the measured growth shrink to it, below it leave the rest to text', () => {
    const calls = [
      { label: 'Read a.cs', tokens: 6_000 },
      { label: 'Bash build', tokens: 2_000 },
    ]
    expect(calibrate(calls, 4_000)).toEqual({
      calls: [
        { label: 'Read a.cs', tokens: 3_000 },
        { label: 'Bash build', tokens: 1_000 },
      ],
      text: 0,
    })
    expect(calibrate(calls, 10_000)).toEqual({ calls, text: 2_000 })
    expect(calibrate(calls, null)).toEqual({ calls, text: 0 })
    expect(calibrate(calls, -5_000)).toEqual({ calls, text: 0 })
    expect(dollars(12.5)).toBe('$12.50')
  })
})

test('a tool call of the main thread lands in the top contributions', async ($, on) => {
  let tokens = 100_000
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { tokens, window: 1_000_000, percent: 10 }, rateLimits: [] } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { type: 'text' }, text: 'x'.repeat(40_000) }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn)
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/repo/src/Handler.cs' })
  tokens = 103_000
  await $.turn.complete({ ...turn, turnId: 't2' })

  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Read Handler\.cs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^3\.0k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+3\.0k/ })).toBeDefined()
  await ui.unmount()
})

test('top contributions show two above the engine hint, the toggle lists them all', async ($, on) => {
  let tokens = 100_000
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { tokens, window: 1_000_000, percent: 10 }, rateLimits: [] } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { type: 'text' }, text: 'x'.repeat(4_000) }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn)
  for (const name of ['A', 'B', 'C', 'D', 'E']) {
    await $.tool.call({ tool: 'Read', tool_use_id: name, file_path: `/repo/${name}.cs` })
  }
  tokens = 200_000
  await $.turn.complete({ ...turn, turnId: 't2' })

  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read A\.cs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read B\.cs/ })).toBeUndefined()
  expect(await ui.find({ key: 'top-toggle' })).toBeDefined()

  await ui.press({ key: 'top-toggle' })
  expect(await ui.find({ type: 'Text', text: /Read E\.cs/ })).toBeDefined()

  await ui.press({ key: 'top-toggle' })
  expect(await ui.find({ type: 'Text', text: /Read E\.cs/ })).toBeUndefined()
  await ui.unmount()
})

test('replay rebuilds turns, streak and contributions from the transcript', () => {
  const read = (id: string, file: string) => ({ tool_use_id: id, tool: 'Read', input: { file_path: `/repo/${file}` }, text: 'x'.repeat(400) })
  const result = replay([
    { role: 'user', text: 'premier', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [read('a', 'A.cs'), read('b', 'B.cs')] },
    { role: 'user', text: '', toolUses: [], toolResults: [] },
    { role: 'user', text: 'second', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [read('c', 'C.cs')] },
    { role: 'user', text: '', toolUses: [], toolResults: [] },
    { role: 'assistant', text: '', toolUses: [read('d', 'D.cs')] },
    { role: 'user', text: '', toolUses: [], toolResults: [] },
    { role: 'assistant', text: '', toolUses: [read('e', 'E.cs')] },
    { role: 'assistant', text: '', toolUses: [read('f', 'F.cs')] },
    { role: 'user', text: '', toolUses: [], toolResults: [] },
    { role: 'assistant', text: 'fini', toolUses: [] },
  ])
  expect(result.turn).toBe(2)
  expect(result.streak).toBe(0)
  expect(result.contributions.find(one => one.label === 'Read C.cs')?.turn).toBe(2)
  expect(result.contributions.some(one => one.label === 'Read A.cs')).toBe(true)
})

test('session start replays the transcript when the band is empty', async ($, on) => {
  mock.clock(on)
  on('fs.exists', () => ({ value: false }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { tokens: 90_000, window: 1_000_000, percent: 9 }, rateLimits: [] } }))
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'go', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: { file_path: '/repo/Big.cs' }, text: 'x'.repeat(8_000) }] },
  ] }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Read Big\.cs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 turn\b/ })).toBeDefined()
  await ui.unmount()
})
