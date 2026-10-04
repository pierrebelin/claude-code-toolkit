import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Contribution } from '../types'

const STEP_TOKENS = 150_000
const CEILING_TOKENS = 250_000
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_WARN_MS = 10 * 60 * 1000
const CACHE_RELEVANT_TOKENS = 30_000
const STREAK_SHOWN = 3
const SPARK_TURNS = 12
const SPARK_SHOWN = 3
const TOP_TURNS = 5
const TOP_SHOWN = 4
const CHARS_PER_TOKEN = 4
const TICK_MS = 15_000
const GRAPHIFY_LOCK = '/tmp/graphify-autosync.lock'
const SPARKS = '▁▂▃▄▅▆▇█'
const HOOKS_LABEL = 'rappels de hooks'
const TEXT_LABEL = 'texte (prompt, réponses)'

const EMPTY: Band = {
  startedAt: 0,
  readings: [],
  window: 0,
  lastTurnAt: null,
  streak: 0,
  turn: 0,
  contributions: [],
  cost: null,
}

const band = atom({ plugin: 'context-band', key: 'band' } as const, EMPTY)
const now = atom({ plugin: 'context-band', key: 'now' } as const, 0)
const isRebuilding = atom({ plugin: 'context-band', key: 'isRebuilding' } as const, false)

const complete = (stored: Band): Band => ({ ...EMPTY, ...stored })

export const kilo = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}

export const sparkline = (readings: number[]): string => {
  if (readings.length === 0) return ''
  const top = Math.max(...readings, 1)
  return readings
    .map(tokens => SPARKS[Math.min(SPARKS.length - 1, Math.floor((tokens / top) * SPARKS.length))])
    .join('')
}

export const tokenColor = (tokens: number): string | undefined => {
  if (tokens >= CEILING_TOKENS) return 'red'
  if (tokens >= STEP_TOKENS) return 'magenta'
  if (tokens >= STEP_TOKENS - 50_000) return 'yellow'
  return undefined
}

export const stepLabel = (tokens: number): string => {
  if (tokens >= CEILING_TOKENS) return 'plafond 250k dépassé : /clear avec note de reprise'
  if (tokens >= STEP_TOKENS) return 'palier 150k atteint : /clear en fin de phase'
  return `/clear conseillé dans ${kilo(STEP_TOKENS - tokens)} (palier 150k)`
}

export type CacheState = { label: string; color?: string } | null

export const cacheState = (lastTurnAt: number | null, at: number, tokens: number): CacheState => {
  if (lastTurnAt === null || tokens < CACHE_RELEVANT_TOKENS) return null
  const left = CACHE_TTL_MS - (at - lastTurnAt)
  if (left <= 0) {
    return { label: `cache froid : la reprise relit ${kilo(tokens)} à plein tarif`, color: 'red' }
  }
  const minutes = Math.ceil(left / 60_000)
  return {
    label: `cache chaud encore ${minutes} min`,
    color: left < CACHE_WARN_MS ? 'yellow' : undefined,
  }
}

export const nextStreak = (streak: number, toolsInStep: number): number => {
  if (toolsInStep === 1) return streak + 1
  if (toolsInStep > 1) return 0
  return streak
}

export const estimate = (chars: number): number => Math.round(chars / CHARS_PER_TOKEN)

const basename = (path: unknown): string =>
  typeof path === 'string' ? (path.split('/').pop() ?? path) : ''

const clip = (text: unknown, length: number): string => {
  if (typeof text !== 'string') return ''
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}

const host = (url: unknown): string =>
  typeof url === 'string' ? (url.replace(/^https?:\/\//, '').split('/')[0] ?? '') : ''

export const callLabel = (tool: string, input: Record<string, unknown>): string => {
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
      return `${tool} ${basename(input.file_path)}`
    case 'NotebookEdit':
      return `${tool} ${basename(input.notebook_path)}`
    case 'Bash':
      return `Bash ${clip(input.description ?? input.command, 32)}`
    case 'Grep':
    case 'Glob':
      return `${tool} ${clip(input.pattern, 24)}`
    case 'Agent':
      return `Agent ${clip(input.description ?? input.subagent_type, 28)}`
    case 'Skill':
      return `Skill ${clip(input.skill, 24)}`
    case 'WebFetch':
      return `WebFetch ${clip(host(input.url), 24)}`
    default:
      return tool
  }
}

export const topContributions = (
  contributions: Contribution[],
  sinceTurn: number,
  count: number,
): { label: string; tokens: number }[] => {
  const totals = new Map<string, number>()
  for (const one of contributions) {
    if (one.turn < sinceTurn) continue
    totals.set(one.label, (totals.get(one.label) ?? 0) + one.tokens)
  }
  return [...totals.entries()]
    .map(([label, tokens]) => ({ label, tokens }))
    .filter(one => one.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, count)
}

export const calibrate = (
  calls: { label: string; tokens: number }[],
  delta: number | null,
): { calls: { label: string; tokens: number }[]; text: number } => {
  const measured = calls.reduce((sum, one) => sum + one.tokens, 0)
  if (delta === null || delta <= 0) return { calls, text: 0 }
  if (measured <= delta) return { calls, text: delta - measured }
  const ratio = delta / measured
  return { calls: calls.map(one => ({ ...one, tokens: Math.round(one.tokens * ratio) })), text: 0 }
}

export const dollars = (usd: number): string => `${usd.toFixed(2).replace('.', ',')} $`

async function recordStep($: EngineInterface, tools: number): Promise<void> {
  await update($, band, current => {
    const full = complete(current)
    return { ...full, streak: nextStreak(full.streak, tools) }
  })
}

export const register: Register = on => {
  let toolsInStep = 0
  let pending: { label: string; tokens: number }[] = []

  on('session.start', async ($, e, next) => {
    const tick = async () => {
      const at = await $.clock.now()
      await update($, now, () => at)
      const isLocked = await $.fs.exists(GRAPHIFY_LOCK)
      await update($, isRebuilding, () => isLocked)
    }
    $.clock.every(TICK_MS, () => void tick())
    await tick()

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    toolsInStep += 1
    const result = await next(e)
    const input = e as unknown as Record<string, unknown>
    const output = typeof result.deny === 'string' ? result.deny : (result.text ?? '')
    pending.push({
      label: callLabel(e.tool, input),
      tokens: estimate(JSON.stringify(input).length + output.length),
    })
    const reminders = (result.context ?? []).reduce((sum, one) => sum + one.length, 0)
    if (reminders > 0) pending.push({ label: HOOKS_LABEL, tokens: estimate(reminders) })

    return result
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.index > 0) {
      await recordStep($, toolsInStep)
      toolsInStep = 0
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await recordStep($, toolsInStep)
    toolsInStep = 0
    const calls = pending
    pending = []
    const usage = await $.session.usage()
    const at = await $.clock.now()
    const tokens = usage.context.tokens
    await update($, band, stored => {
      const current = complete(stored)
      const base = current.startedAt === usage.startedAt ? current : { ...EMPTY, startedAt: usage.startedAt }
      const cost = usage.cost?.usd ?? base.cost
      if (tokens === undefined) return { ...base, cost, lastTurnAt: at }
      const turn = base.turn + 1
      const previous = base.readings[base.readings.length - 1]
      const calibrated = calibrate(calls, previous === undefined ? null : tokens - previous)
      const added: Contribution[] = [
        ...calibrated.calls.map(one => ({ turn, ...one })),
        ...(calibrated.text > 0 ? [{ turn, label: TEXT_LABEL, tokens: calibrated.text }] : []),
      ]
      return {
        ...base,
        turn,
        cost,
        window: usage.context.window,
        readings: [...base.readings, tokens].slice(-SPARK_TURNS),
        contributions: [...base.contributions, ...added].filter(one => one.turn > turn - TOP_TURNS),
        lastTurnAt: at,
      }
    })
    await update($, now, () => at)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = complete(await read($, band))
    const isMainView = e.props.view.agentId === undefined
    if (e.props.hasSurvey || !isMainView || state.readings.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const tokens = state.readings[state.readings.length - 1] ?? 0
    const previous = state.readings[state.readings.length - 2]
    const delta = previous === undefined ? 0 : tokens - previous
    const color = tokenColor(tokens)
    const cache = e.props.isWorking ? null : cacheState(state.lastTurnAt, await read($, now), tokens)
    const rebuilding = await read($, isRebuilding)
    const turns = Math.min(TOP_TURNS, state.turn)
    const top = topContributions(state.contributions, state.turn - TOP_TURNS + 1, TOP_SHOWN)
    const showsTop = e.props.maxRows >= 2 && top.length > 0

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Text wrap="truncate-end">
          <Text dimColor>Contexte </Text>
          <Text color={color} bold={color !== undefined}>{kilo(tokens)}</Text>
          {state.window > 0 && <Text dimColor> / {kilo(state.window)}</Text>}
          {state.readings.length >= SPARK_SHOWN && <Text dimColor> {sparkline(state.readings)}</Text>}
          {delta !== 0 && <Text dimColor> {delta > 0 ? '+' : '−'}{kilo(Math.abs(delta))} ce tour</Text>}
          <Text dimColor> · </Text>
          <Text color={color} dimColor={color === undefined}>{stepLabel(tokens)}</Text>
          {cache !== null && <Text dimColor> · </Text>}
          {cache !== null && <Text color={cache.color} dimColor={cache.color === undefined}>{cache.label}</Text>}
          {state.streak >= STREAK_SHOWN && <Text dimColor> · </Text>}
          {state.streak >= STREAK_SHOWN && <Text color="yellow">{state.streak} tours à un seul appel : grouper</Text>}
          {rebuilding && <Text dimColor> · graphe en reconstruction</Text>}
          <Text dimColor> · {state.turn} tour{state.turn > 1 ? 's' : ''}</Text>
          {state.cost !== null && <Text dimColor> · {dollars(state.cost)}</Text>}
        </Text>
        {showsTop && (
          <Text wrap="truncate-end">
            <Text dimColor>Plus gros apports ({turns === 1 ? 'dernier tour' : `${turns} derniers tours`}, ≈) : </Text>
            {top.map((one, index) => (
              <Text key={`top-${index}`}>
                {index > 0 && <Text dimColor> · </Text>}
                <Text>{one.label} </Text>
                <Text bold>{kilo(one.tokens)}</Text>
              </Text>
            ))}
          </Text>
        )}
      </Box>
    )
  })
}
