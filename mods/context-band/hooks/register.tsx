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
const TOGGLE_GAP = 3
const LIST_ROWS = 10
const METER_CELLS = 8
// The terminal sets its groups apart by space, not by a rule: a `│` between every figure read as noise.
const GROUP = '   '
const LABEL_CELLS = 18
const TERMINAL_LABEL = 15
const TOP_LABEL = 36
const TOP_FIGURE = 6
const FIVE_HOUR = 'five_hour'
const HINT_INDENT = 4
const CHARS_PER_TOKEN = 4
const TICK_MS = 15_000
const GRAPHIFY_LOCK = '/tmp/graphify-autosync.lock'
const GRAPHIFY_LOCK_NAME = 'graphify-autosync.lock'
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

// Colour tells a state, never a name: nothing below 100k, amber from there, red past the 250k ceiling.
export const tokenColor = (tokens: number): 'warning' | 'error' | undefined => {
  if (tokens >= CEILING_TOKENS) return 'error'
  if (tokens >= STEP_TOKENS - 50_000) return 'warning'
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
  typeof path === 'string' ? (path.split(/[\\/]/).pop() ?? path) : ''

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

// A meter's state: green at rest, amber from 60 %, red from 85 %.
export const meterColor = (percent: number): 'success' | 'warning' | 'error' => {
  if (percent >= 85) return 'error'
  if (percent >= 60) return 'warning'
  return 'success'
}

// The cache's named colours, read as the theme's status keys on the terminal.
const THEMED: Record<string, string> = { red: 'error', yellow: 'warning' }

// A contributor's row: its label cut to a column, its tokens right-aligned beside it, the rows of a list aligned.
export const topLine = (label: string, tokens: number, width: number): { label: string; tokens: string } => {
  const room = Math.max(4, width)
  const cut = label.length > room ? `${label.slice(0, room - 1)}…` : label
  return { label: cut.padEnd(room), tokens: kilo(tokens).padStart(TOP_FIGURE) }
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
    // graphify-autosync.sh takes its lock in Git Bash's /tmp, which on Windows is
    // %TEMP%: the engine would read `/tmp` as `C:\tmp`.
    const temp = /^[A-Za-z]:/.test($.plugin.root) ? await $.env.get('TEMP') : undefined
    const lock = temp === undefined ? GRAPHIFY_LOCK : `${temp}\\${GRAPHIFY_LOCK_NAME}`
    const tick = async () => {
      const at = await $.clock.now()
      await update($, now, () => at)
      const isLocked = await $.fs.exists(lock)
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

  // The terminal draws the band beside the prompt's hint line; a desktop draws no tail there,
  // so it goes into the band above the prompt, which the surface stacks plugin by plugin.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const state = complete(await read($, band))
    if (state.readings.length === 0 || e.surface === 'desktop') return next(e)
    const columns = e.viewport === undefined ? undefined : Math.max(0, e.viewport.columns - HINT_INDENT)
    return contextView($, e, state, e.props.isWorking, columns, await next(e))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = complete(await read($, band))
    if (state.readings.length === 0 || e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    return desktopView($, e, state, e.props.isWorking)
  })
}

// The desktop draws in a proportional face: block-glyph meters and `│` rules read as noise there.
// It gets drawn bars, the theme's status colours, a type scale and spacing instead of separators.
const BAR = { width: 64, height: 6 } as const
// A translucent grey: the details' surface reads on a light or a dark theme alike, no frame needed.
const SURFACE = '#80808014'
// A figure that asks for attention (the /clear step reached, the 5-hour limit or the cache running out) sits on a
// faint wash of its tone; every figure keeps the same padding, washed or not, so the band stays aligned.
const WASH: Record<string, string> = { warning: '#d99a1e24', error: '#d6454524' }
const BAR_INK = { ok: '#3fa66b', warning: '#d99a1e', high: '#d4652c', critical: '#d64545' } as const

const tone = (percent: number): keyof typeof BAR_INK => {
  if (percent >= 85) return 'critical'
  if (percent >= 60) return 'warning'
  return 'ok'
}

const tokenTone = (tokens: number): keyof typeof BAR_INK | null => {
  if (tokens >= CEILING_TOKENS) return 'critical'
  if (tokens >= STEP_TOKENS) return 'high'
  if (tokens >= STEP_TOKENS - 50_000) return 'warning'
  return null
}

const THEME_OF: Record<keyof typeof BAR_INK, string> = { ok: 'success', warning: 'warning', high: 'warning', critical: 'error' }

export const barSource = (percent: number, ink: string): string => {
  const { width, height } = BAR
  const filled = Math.round((Math.min(100, Math.max(0, percent)) * width) / 100)
  const radius = height / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" rx="${radius}" fill="${ink}" fill-opacity="0.18"/>`
    + (filled > 0 ? `<rect width="${Math.max(filled, height)}" height="${height}" rx="${radius}" fill="${ink}"/>` : '')
    + '</svg>'
}

async function desktopView(
  $: EngineInterface,
  e: Parameters<EngineInterface['ui']['resolve']>[0],
  state: Band,
  isWorking: boolean,
): Promise<JSX.Element> {
  const elements = $.ui.resolve(e)
  const { Box, Button, Text } = elements
  const Svg = 'Svg' in elements ? elements.Svg : undefined
  const at = await read($, now)
  const tokens = state.readings[state.readings.length - 1] ?? 0
  const percent = state.window > 0 ? Math.round((tokens * 100) / state.window) : null
  const stepTone = tokenTone(tokens)
  const cache = isWorking ? null : cacheState(state.lastTurnAt, at, tokens)
  const rebuilding = await read($, isRebuilding)
  const grouping = state.streak >= STREAK_SHOWN
  const limit = state.fiveHour
  const resetIn = limit?.resetsAt == null || limit.resetsAt <= at ? null : span(limit.resetsAt - at)
  const turns = Math.min(TOP_TURNS, state.turn)
  const all = topContributions(state.contributions, state.turn - TOP_TURNS + 1, Number.MAX_SAFE_INTEGER)
  const expanded = await read($, isExpanded)
  const shown = all.slice(0, LIST_ROWS)
  const cacheTone = cache?.color === 'red' ? 'error' : cache?.color === 'yellow' ? 'warning' : undefined

  const bar = (key: string, value: number, ink: keyof typeof BAR_INK, alt: string) =>
    Svg === undefined ? null : <Svg key={key} source={barSource(value, BAR_INK[ink])} alt={alt} width={BAR.width} height={BAR.height} />
  const label = (text: string) => <Text size="footnote" dimColor>{text}</Text>
  const metric = (key: string, children: (JSX.Element | null)[], theme?: string) => (
    <Box key={key} flexDirection="row" alignItems="center" gap="xs" flexShrink={0} paddingX={1} {...(theme !== undefined && WASH[theme] !== undefined ? { backgroundColor: WASH[theme] } : {})}>
      {children}
    </Box>
  )
  const detail = (key: string, name: string, value: JSX.Element) => (
    <Box key={key} flexDirection="row" gap="sm">
      <Box width={LABEL_CELLS} flexShrink={0}>{label(name)}</Box>
      <Box flexGrow={1} flexShrink={1}>{value}</Box>
    </Box>
  )

  const metrics = [
    metric('context', [
      label('Context'),
      ...(percent === null ? [] : [bar('context-bar', percent, stepTone ?? tone(percent), `context ${percent}% full`)]),
      <Text key="tokens" size="footnote" tabular weight={stepTone === null ? 'medium' : 'semibold'} color={stepTone === null ? undefined : THEME_OF[stepTone]}>
        {kilo(tokens)}
      </Text>,
      ...(state.window > 0 ? [<Text key="window" size="footnote" tabular dimColor>/ {kilo(state.window)}</Text>] : []),
    ], stepTone === null ? undefined : THEME_OF[stepTone]),
    ...(limit === null ? [] : [metric('limit', [
      label('5h limit'),
      bar('limit-bar', limit.percent, tone(limit.percent), `5-hour limit ${Math.round(limit.percent)}% used`),
      <Text key="limit-percent" size="footnote" tabular color={tone(limit.percent) === 'ok' ? undefined : THEME_OF[tone(limit.percent)]}>
        {`${Math.round(limit.percent)}%`}
      </Text>,
      ...(resetIn === null ? [] : [<Text key="reset" size="footnote" tabular dimColor>{`resets ${resetIn}`}</Text>]),
    ], tone(limit.percent) === 'ok' ? undefined : THEME_OF[tone(limit.percent)])]),
    ...(cache === null ? [] : [metric('cache', [
      <Text key="cache" size="footnote" tabular color={cacheTone} dimColor={cacheTone === undefined}>{cache.label}</Text>,
    ], cacheTone)]),
    ...(grouping ? [metric('streak', [<Text key="streak" size="footnote" color="warning">{`${state.streak} single-call turns`}</Text>], 'warning')] : []),
    ...(rebuilding ? [metric('graph', [<Text key="graph" size="footnote" dimColor>graph rebuilding</Text>])] : []),
    metric('session', [
      <Text key="session" size="footnote" tabular dimColor>
        {`${span(at - state.startedAt)} · ${state.turn} turn${state.turn > 1 ? 's' : ''}`}
      </Text>,
      ...(state.cost === null ? [] : [<Text key="cost" size="footnote" tabular weight="medium">{dollars(state.cost)}</Text>]),
    ]),
  ]

  return (
    <Box flexDirection="column" gap="xs" paddingX="xs">
      <Box flexDirection="row" alignItems="center" gap="md">
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="md" rowGap="xs" flexGrow={1} flexShrink={1}>
          {metrics}
        </Box>
        <Button
          key="top-toggle"
          label={expanded ? 'Hide details' : 'Details'}
          plain
          dimColor
          onPress={() => update($, isExpanded, value => !value)}
        />
      </Box>
      {expanded && (
        <Box flexDirection="column" gap="xs" paddingX={2} paddingY="sm" backgroundColor={SURFACE}>
          {detail('step', 'Next /clear', (
            <Text size="footnote" color={stepTone === null ? undefined : THEME_OF[stepTone]}>{stepLabel(tokens)}</Text>
          ))}
          {cache?.detail !== undefined && detail('cache', 'Cache', <Text size="footnote" color={cacheTone}>{cache.detail}</Text>)}
          {grouping && detail('batch', 'Batching', (
            <Text size="footnote" color="warning">
              {`${state.streak} turns with a single tool call: send independent calls together (each turn resends the whole context)`}
            </Text>
          ))}
          {all.length > 0 && detail('top', `Top ${turns === 1 ? 'last turn' : `${turns} turns`}`, (
            <Box flexDirection="column">
              {shown.map((one, index) => (
                <Box key={`top-${index}`} flexDirection="row" gap="sm">
                  <Box flexGrow={1} flexShrink={1}><Text size="footnote" wrap="truncate-end">{one.label}</Text></Box>
                  <Text size="footnote" tabular weight="medium">{kilo(one.tokens)}</Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// The terminal's band: one line of figures under the hint, each group a dim label and its value, set apart by
// space. Colour is kept for a figure asking for attention (amber, red); a figure at rest reads in the text colour.
async function contextView(
  $: EngineInterface,
  e: Parameters<EngineInterface['ui']['resolve']>[0],
  state: Band,
  isWorking: boolean,
  columns: number | undefined,
  below: JSX.Element | null,
): Promise<JSX.Element> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const at = await read($, now)
  const tokens = state.readings[state.readings.length - 1] ?? 0
  const percent = state.window > 0 ? Math.round((tokens * 100) / state.window) : null
  const color = tokenColor(tokens)
  const cache = isWorking ? null : cacheState(state.lastTurnAt, at, tokens)
  const cacheColor = cache?.color === undefined ? undefined : THEMED[cache.color]
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
      label={expanded ? '▾ details' : hidden > 0 ? `▸ details +${hidden}` : '▸ details'}
      plain
      dimColor
      onPress={() => update($, isExpanded, value => !value)}
    />
  )
  const header = `Top ${turns === 1 ? 'last turn' : `${turns} turns`}`
  // A meter whole in the colour of its state; the figure beside it coloured only when it asks for attention.
  const gauge = (key: string, value: number) => <Text key={key} color={meterColor(value)}>{meter(value)}</Text>
  const alarm = (value: number) => (meterColor(value) === 'success' ? undefined : meterColor(value))
  const labelOf = (text: string) => (
    <Box width={TERMINAL_LABEL} flexShrink={0}>
      <Text dimColor>{text}</Text>
    </Box>
  )
  const room = Math.max(...shown.map(one => one.label.length), 0)
  const topWidth = Math.min(TOP_LABEL, room, Math.max(4, (columns ?? 80) - 2 - TERMINAL_LABEL - TOP_FIGURE - 1))

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" width={columns}>
        <Box height={1}>
          {/* The toggle follows the figures, never pushed to the far edge; a line too long for the row is cut first. */}
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text dimColor>Context </Text>
              {percent !== null && gauge('context-meter', percent)}
              {percent !== null && <Text> </Text>}
              <Text color={color} bold={tokens >= STEP_TOKENS}>{kilo(tokens)}</Text>
              {state.window > 0 && <Text dimColor>/{kilo(state.window)}</Text>}
              {limit !== null && <Text dimColor>{GROUP}5h </Text>}
              {limit !== null && gauge('limit-meter', limit.percent)}
              {limit !== null && <Text color={alarm(limit.percent)}> {Math.round(limit.percent)}%</Text>}
              {limit !== null && resetIn !== null && <Text dimColor> {resetIn}</Text>}
              {cache !== null && (
                <Text key="cache">
                  <Text dimColor>{GROUP}</Text>
                  <Text color={cacheColor} dimColor={cacheColor === undefined}>{cache.label}</Text>
                </Text>
              )}
              {grouping && <Text key="grouping" color="warning">{`${GROUP}${state.streak} single calls`}</Text>}
              {rebuilding && <Text key="graph" dimColor>{`${GROUP}graph rebuilding`}</Text>}
              <Text dimColor>{GROUP}{span(at - state.startedAt)} · {state.turn} turn{state.turn > 1 ? 's' : ''}</Text>
              {state.cost !== null && <Text dimColor> · </Text>}
              {state.cost !== null && <Text>{dollars(state.cost)}</Text>}
              {showsTop && !expanded && <Text dimColor>{GROUP}Top </Text>}
              {showsTop && !expanded && shown.map((one, index) => (
                <Text key={`top-${index}`}>
                  {index > 0 && <Text dimColor> · </Text>}
                  <Text>{one.label} </Text>
                  <Text dimColor>{kilo(one.tokens)}</Text>
                </Text>
              ))}
            </Text>
          </Box>
          <Box flexShrink={0} paddingLeft={TOGGLE_GAP}>{toggle}</Box>
        </Box>
        {expanded && (
          <Box flexDirection="column" paddingLeft={2}>
            <Box height={1}>
              {labelOf('Step')}
              <Text color={color} wrap="truncate-end">{stepLabel(tokens)}</Text>
            </Box>
            {cache?.detail !== undefined && (
              <Box height={1}>
                {labelOf('Cache')}
                <Text color={cacheColor} wrap="truncate-end">{cache.detail}</Text>
              </Box>
            )}
            {grouping && (
              <Box height={1}>
                {labelOf('Batching')}
                <Text wrap="truncate-end">
                  <Text color="warning">{`${state.streak} turns with a single tool call`}</Text>
                  <Text dimColor>: send independent calls together, each turn resends the whole context</Text>
                </Text>
              </Box>
            )}
            {showsTop && (
              <Box>
                {labelOf(header)}
                <Box flexDirection="column">
                  {shown.map((one, index) => {
                    const cells = topLine(one.label, one.tokens, topWidth)
                    return (
                      <Text key={`top-${index}`} wrap="truncate-end">
                        <Text>{cells.label}</Text>
                        <Text>{cells.tokens}</Text>
                      </Text>
                    )
                  })}
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Box>
      {below}
    </Box>
  )
}
