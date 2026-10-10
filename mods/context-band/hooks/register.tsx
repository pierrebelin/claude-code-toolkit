import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Band, Contribution } from '../types'

const STEP_TOKENS = 150_000
const CEILING_TOKENS = 250_000
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_WARN_MS = 10 * 60 * 1000
const CACHE_RELEVANT_TOKENS = 30_000
const STREAK_SHOWN = 3
const SPARK_TURNS = 12
const TOP_TURNS = 5
const TOP_SHOWN = 2
const TOGGLE_GAP = 4
const LIST_ROWS = 10
const METER_CELLS = 10
const GROUP = ' │ '
const LABEL_CELLS = 18
const FIVE_HOUR = 'five_hour'
const HINT_INDENT = 4
const CHARS_PER_TOKEN = 4
const TICK_MS = 15_000
const GRAPHIFY_LOCK = '/tmp/graphify-autosync.lock'
const HOOKS_LABEL = 'hook reminders'
const TEXT_LABEL = 'text'

const EMPTY: Band = {
  startedAt: 0,
  readings: [],
  window: 0,
  lastTurnAt: null,
  streak: 0,
  turn: 0,
  contributions: [],
  cost: null,
  fiveHour: null,
}

const band = atom({ plugin: 'context-band', key: 'band' } as const, EMPTY)
const now = atom({ plugin: 'context-band', key: 'now' } as const, 0)
const isRebuilding = atom({ plugin: 'context-band', key: 'isRebuilding' } as const, false)
const isExpanded = atom({ plugin: 'context-band', key: 'isExpanded' } as const, false)

const complete = (stored: Band): Band => ({ ...EMPTY, ...stored })

export const kilo = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}

export const tokenColor = (tokens: number): string | undefined => {
  if (tokens >= CEILING_TOKENS) return 'red'
  if (tokens >= STEP_TOKENS) return 'magenta'
  if (tokens >= STEP_TOKENS - 50_000) return 'yellow'
  return undefined
}

export const stepLabel = (tokens: number): string => {
  if (tokens >= CEILING_TOKENS) return '250k ceiling passed: /clear with a handoff note'
  if (tokens >= STEP_TOKENS) return '150k step reached: /clear at the end of the phase (ceiling 250k)'
  return `/clear advised in ${kilo(STEP_TOKENS - tokens)} (step 150k, ceiling 250k)`
}

export type CacheState = { label: string; color?: string; detail?: string } | null

export const cacheState = (lastTurnAt: number | null, at: number, tokens: number): CacheState => {
  if (lastTurnAt === null || tokens < CACHE_RELEVANT_TOKENS) return null
  const left = CACHE_TTL_MS - (at - lastTurnAt)
  if (left <= 0) {
    return { label: 'Cache expired', color: 'red', detail: `next turn rereads ${kilo(tokens)} at full price` }
  }
  const minutes = Math.ceil(left / 60_000)
  return {
    label: `Cache (${minutes}m)`,
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
      return `Bash ${clip(input.description ?? input.command, 20)}`
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

export const replay = (
  messages: readonly SessionMessage[],
): { turn: number; streak: number; contributions: Contribution[] } => {
  let turn = 0
  let streak = 0
  let contributions: Contribution[] = []
  let toolsInStep = 0
  for (const message of messages) {
    if (message.role === 'user') {
      streak = nextStreak(streak, toolsInStep)
      toolsInStep = 0
    }
    const isPrompt = message.role === 'user' && message.text !== '' && (message.toolResults ?? []).length === 0
    if (isPrompt) turn += 1
    if (turn === 0) continue
    if (message.text !== '') contributions.push({ turn, label: TEXT_LABEL, tokens: estimate(message.text.length) })
    if (message.role !== 'assistant') continue
    toolsInStep += message.toolUses.length
    for (const use of message.toolUses) {
      contributions.push({
        turn,
        label: callLabel(use.tool, use.input),
        tokens: estimate(JSON.stringify(use.input).length + (use.text ?? '').length),
      })
    }
  }
  streak = nextStreak(streak, toolsInStep)
  contributions = contributions.filter(one => one.turn > turn - TOP_TURNS)
  return { turn, streak, contributions }
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

export const meter = (percent: number): string => {
  const filled = Math.min(METER_CELLS, Math.max(0, Math.floor((percent * METER_CELLS) / 100)))
  return '█'.repeat(filled) + '░'.repeat(METER_CELLS - filled)
}

export const meterColor = (percent: number): string => {
  if (percent >= 85) return 'red'
  if (percent >= 60) return 'yellow'
  return 'green'
}

export const span = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return `${Math.floor(Math.max(0, ms) / 1000)}s`
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

export const dollars = (usd: number): string => `$${usd.toFixed(2)}`

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

    const result = await next(e)
    if (complete(await read($, band)).turn === 0) {
      const usage = await $.session.usage()
      const replayed = replay(await $.session.messages())
      const tokens = usage.context.tokens
      await update($, band, () => ({
        ...EMPTY,
        ...replayed,
        startedAt: usage.startedAt,
        window: usage.context.window,
        readings: tokens === undefined || replayed.turn === 0 ? [] : [tokens],
        cost: usage.cost?.usd ?? null,
      }))
    }

    return result
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
      const limit = usage.rateLimits.find(one => one.kind === FIVE_HOUR)
      const resetsAt = limit?.resetsAt === undefined ? null : Date.parse(limit.resetsAt)
      const fiveHour = limit === undefined ? base.fiveHour : { percent: limit.percentUsed, resetsAt }
      if (tokens === undefined) return { ...base, cost, fiveHour, lastTurnAt: at }
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
        fiveHour,
        window: usage.context.window,
        readings: [...base.readings, tokens].slice(-SPARK_TURNS),
        contributions: [...base.contributions, ...added].filter(one => one.turn > turn - TOP_TURNS),
        lastTurnAt: at,
      }
    })
    await update($, now, () => at)

    return result
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const state = complete(await read($, band))
    if (state.readings.length === 0) return next(e)

    const hint = await next(e)
    const columns = e.viewport === undefined ? undefined : Math.max(0, e.viewport.columns - HINT_INDENT)

    const { Box, Button, Text } = $.ui.resolve(e)
    const at = await read($, now)
    const tokens = state.readings[state.readings.length - 1] ?? 0
    const previous = state.readings[state.readings.length - 2]
    const delta = previous === undefined ? 0 : tokens - previous
    const percent = state.window > 0 ? Math.round((tokens * 100) / state.window) : null
    const color = tokenColor(tokens)
    const cache = e.props.isWorking ? null : cacheState(state.lastTurnAt, at, tokens)
    const rebuilding = await read($, isRebuilding)
    const grouping = state.streak >= STREAK_SHOWN
    const limit = state.fiveHour
    const resetIn = limit?.resetsAt == null || limit.resetsAt <= at ? null : span(limit.resetsAt - at)
    const turns = Math.min(TOP_TURNS, state.turn)
    const all = topContributions(state.contributions, state.turn - TOP_TURNS + 1, Number.MAX_SAFE_INTEGER)
    const hidden = Math.max(0, all.length - TOP_SHOWN)
    const expanded = await read($, isExpanded)
    const shown = expanded ? all.slice(0, LIST_ROWS) : all.slice(0, TOP_SHOWN)
    const showsTop = all.length > 0
    const toggle = (
      <Button
        key="top-toggle"
        label={expanded ? '[Collapse]' : hidden > 0 ? `[Show all (+${hidden})]` : '[Show all]'}
        plain
        dimColor
        onPress={() => update($, isExpanded, value => !value)}
      />
    )
    const header = `Top ${turns === 1 ? 'last turn' : `${turns} turns`}`

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" width={columns}>
          <Box height={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">
                <Text dimColor>Context </Text>
                {percent !== null && <Text color={meterColor(percent)}>{meter(percent)} </Text>}
                <Text color={color} bold={color !== undefined}>{kilo(tokens)}</Text>
                {state.window > 0 && <Text dimColor>/{kilo(state.window)}</Text>}
                {delta !== 0 && <Text dimColor> ({delta > 0 ? '+' : '−'}{kilo(Math.abs(delta))} this turn)</Text>}
                {limit !== null && <Text dimColor>{GROUP}Lim 5h </Text>}
                {limit !== null && <Text color={meterColor(limit.percent)}>{meter(limit.percent)}</Text>}
                {limit !== null && <Text dimColor> {Math.round(limit.percent)}%{resetIn === null ? '' : ` ${resetIn}`}</Text>}
                {[
                  cache !== null && <Text key="cache" color={cache.color} dimColor={cache.color === undefined}>{cache.label}</Text>,
                  grouping && <Text key="grouping" color="yellow">{state.streak} turns</Text>,
                  rebuilding && <Text key="graph" dimColor>graph rebuilding</Text>,
                ].filter(Boolean).map((one, index) => (
                  <Text key={`advice-${index}`}>
                    <Text dimColor>{index === 0 ? GROUP : ' · '}</Text>
                    {one}
                  </Text>
                ))}
                <Text dimColor>{GROUP}Session {span(at - state.startedAt)} · {state.turn} turn{state.turn > 1 ? 's' : ''}</Text>
                {state.cost !== null && <Text dimColor> · {dollars(state.cost)}</Text>}
                {showsTop && !expanded && <Text dimColor>{GROUP}{header} : </Text>}
                {showsTop && !expanded && shown.map((one, index) => (
                  <Text key={`top-${index}`}>
                    {index > 0 && <Text dimColor> · </Text>}
                    <Text>{one.label} </Text>
                    <Text bold>{kilo(one.tokens)}</Text>
                  </Text>
                ))}
              </Text>
            </Box>
            <Box flexShrink={0} paddingLeft={TOGGLE_GAP}>{toggle}</Box>
          </Box>
          {expanded && (
            <Box flexDirection="column" paddingLeft={2}>
              <Box>
                <Box width={LABEL_CELLS} flexShrink={0}><Text dimColor>Step</Text></Box>
                <Text color={color} dimColor={color === undefined} wrap="truncate-end">{stepLabel(tokens)}</Text>
              </Box>
              {cache?.detail !== undefined && (
                <Box>
                  <Box width={LABEL_CELLS} flexShrink={0}><Text dimColor>Cache</Text></Box>
                  <Text color={cache.color} wrap="truncate-end">{cache.detail}</Text>
                </Box>
              )}
              {grouping && (
                <Box>
                  <Box width={LABEL_CELLS} flexShrink={0}><Text dimColor>Batch</Text></Box>
                  <Text color="yellow" wrap="truncate-end">
                    {`${state.streak} turns with a single tool call: send independent calls together (each turn resends the whole context)`}
                  </Text>
                </Box>
              )}
              {showsTop && (
                <Box>
                  <Box width={LABEL_CELLS} flexShrink={0}><Text dimColor>{header}</Text></Box>
                  <Box flexDirection="column">
                    {shown.map((one, index) => (
                      <Text key={`top-${index}`} wrap="truncate-end">
                        <Text dimColor>{index + 1}. </Text>
                        <Text>{one.label} </Text>
                        <Text bold>{kilo(one.tokens)}</Text>
                      </Text>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
        {hint}
      </Box>
    )
  })
}
