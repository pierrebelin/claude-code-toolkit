import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  cacheState,
  calibrate,
  callLabel,
  dollars,
  kilo,
  nextStreak,
  sparkline,
  stepLabel,
  topContributions,
} from '../hooks/register'

const HOUR = 60 * 60 * 1000

describe('pure figures', () => {
  test('call label names the tool and its target', () => {
    expect(callLabel('Read', { file_path: '/repo/src/Handler.cs' })).toBe('Read Handler.cs')
    expect(callLabel('Bash', { command: 'dotnet test', description: 'Lance les tests unitaires' })).toBe('Bash Lance les tests unitaires')
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

  test('kilo and sparkline', () => {
    expect(kilo(950)).toBe('950')
    expect(kilo(68_240)).toBe('68.2k')
    expect(kilo(1_000_000)).toBe('1M')
    expect(sparkline([10, 20, 40])).toBe('▃▅█')
  })

  test('step label names the 150k step and the 250k ceiling', () => {
    expect(stepLabel(68_000)).toBe('/clear conseillé dans 82.0k (palier 150k)')
    expect(stepLabel(160_000)).toContain('palier 150k atteint')
    expect(stepLabel(260_000)).toContain('plafond 250k')
  })

  test('cache counts down from the last turn and turns red once expired', () => {
    expect(cacheState(0, 8 * 60 * 1000, 100_000)).toEqual({ label: 'cache chaud encore 52 min', color: undefined })
    expect(cacheState(0, 55 * 60 * 1000, 100_000)?.color).toBe('yellow')
    expect(cacheState(0, HOUR + 1, 100_000)?.label).toContain('cache froid')
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
  on('session.usage', () => ({ value: { startedAt: 1, context: { tokens, window: 1_000_000, percent: 7 }, rateLimits: [], cost: { usd: 4.126 } } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('turn.complete', () => ({ text: '' }))
  return clock
}

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 160, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

const turn = { reason: 'answer', answer: '', durationMs: 10, isAborted: false, turnId: 't1' } as const

test('band shows tokens, step and cache after a turn, on every surface', async ($, on) => {
  const clock = world(on, 160_000)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn)
  await clock.advance(50 * 60 * 1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /160\.0k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /palier 150k atteint/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cache chaud encore 10 min/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 tour\b/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /4,13 \$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('band yields when no turn has been measured', async ($, on) => {
  world(on, 0)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /palier/ })).toBeUndefined()
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
    expect(dollars(12.5)).toBe('12,50 $')
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
  expect(await ui.find({ type: 'Text', text: /\+3\.0k ce tour/ })).toBeDefined()
  await ui.unmount()
})
