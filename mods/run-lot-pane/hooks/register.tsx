import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, ModelUsage, Register, TurnStepChunk } from 'claude-code'

import type {
  AuditVerdict, ChildWorkflow, Journal, KnowledgeMerge, Navigation, Outcome, PhaseDeclaration, PhaseSample, PhaseSamples, RunStatus, Screen, SessionFigures, Sheet,
  LotFigures, PlanLot, Prompted, RunFeed, SheetCycle, Step, StreamKind, TddMarks, ToolTrace, WorkflowAgent, WorkflowRun,
} from '../types'

const PANE = 'run-lot-pane'
const TICK_MS = 2_000
const KEPT_RUNS = 1
const NO_PHASE = '—'
const AUDIT_PHASE = 'Audit'
const SLOW_FACTOR = 2
const STALL_TOOLS = 40
const STALL_CONTEXT = 150_000
const STALL_IDLE_MS = 60_000
const STALL_WAIT_MS = 120_000
const STALL_TOOL_MS = 300_000
const STALL_SLOW_MS = 60_000
const SLOW_RATE = 20
const CHARS_PER_TOKEN = 4
const STREAM_WRITE_MS = 1_000
const ALERT_MS = 10_000
const ALERT_REASON = 110
const PARALLEL_PHASES = [['Global green', 'Closing'], ['Audit', 'Review']]
const INTERLEAVED_PHASES = [['RED', 'GREEN']]
const CONDITIONAL_PHASES = ['Arbiter', 'Question']
const KEPT_JOURNALS = 8
const SCANNED_SESSIONS = 200
const DONE = '✅'
const COUNT_WIDTH = 6
const TIME_WIDTH = 7
const TOKENS_WIDTH = 7
const PANE_COLUMNS = 100
const MODEL_WIDTH = 14
const WIDE_COLUMNS = 56
const SHEET_PATTERN = /-PLAN-(F\d+)\.md$/
const LOT_PATTERN = /(?:^|\/)([^/]+?)-PLAN-(F\d+)\.md$/
const CHILD_PLUGIN = /\bworkflow\(\s*['"]([\w-]+):[\w.-]+['"]/
const CHILD_CALL = /\bworkflow\(\s*(?:['"](?:[\w-]+:)?([\w.-]+)['"]|\{\s*scriptPath:[^)]*?\/([\w.-]+)\.js)/
const PROMPT_LOT = /Workflow run-lot, batch (F\d+)\.[\s\S]*?Batch sheet: (\S+?\.md)\./
const REVIEW_LOT = /^mode: (?:lot-suivant|next-batch) \S+ (\S*?-PLAN-(F\d+)\.md)/
const PLAN_SECTIONS = ['### Execution des lots', '### Batch execution']
const PLAN_DONE = /^### (?:Lot|Batch) (F\d+)\b.*✅ DONE/gm
const PLAN_HEADING = /^### (?:Lot|Batch) (F\d+) — (.+?)(?:\s+(?:—\s+)?(?:✅ DONE.*|⬜))?\s*$/gm
const REPORT_STATUS = /^## (?:STATUT|STATUS) — (\S+)/
const LOT_DONE = ['TERMINÉ', 'DONE']
const WAITING_TONE = 'cyan'
const REPORT_NAMES = ['rapport', 'report']
const BATCH_REPORT_DIRS = ['batches', 'lots']
const WAVE_LABEL = /^RED \S+ w(\d+)\b/
const REPORT_PHASE = 'Report'
const CYCLES_SECTION = '## Cycles'
const RETIRED_LABELS = [/^tick /, /^closing \+ pre-audit$/]
const INTRODUCED_LABELS = [/^index /, /^declaratives$/, /^pre-audit$/]
const DROPPED_LABELS = [/^pre-design /]
const WAIT_SECONDS = 600
const PANE_FILE = '.pane.jsonl'
const FEED_KINDS = ['question', 'answer', 'audit-round', 'attempt', 'breaker', 'ack', 'journal']
const STEP_PHASES = ['Global green', 'Closing']
const ASIDE_LINE = /^(F\d+) ✗ — set aside — (.*?)(?: — patch (\S+))?$/
const KEPT_SECTIONS = ['## To validate', '## Plan stopped']

type Launched = { status?: string; runId?: string; scriptPath?: string; workflowName?: string; transcriptDir?: string }

const runs = atom({ plugin: 'run-lot-pane', key: 'runs' } as const, [] as WorkflowRun[])
const now = atom({ plugin: 'run-lot-pane', key: 'now' } as const, 0)
const HOME: Navigation = { screen: 'run', phase: null, agentId: null, back: 'run', toggled: [], lot: null }
const nav = atom({ plugin: 'run-lot-pane', key: 'nav' } as const, HOME)
const isShown = atom({ plugin: 'run-lot-pane', key: 'isShown' } as const, false)
const usage = atom({ plugin: 'run-lot-pane', key: 'usage' } as const, { context: null, percent: null } as SessionFigures)
const history = atom({ plugin: 'run-lot-pane', key: 'history' } as const, {} as PhaseSamples)
const feed = atom({ plugin: 'run-lot-pane', key: 'feed' } as const, null as RunFeed | null)

export const duration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

const SPINNER = ['✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳']

export const spinnerFrame = (at: number): string => SPINNER[Math.floor(at / TICK_MS) % SPINNER.length] ?? '✻'

export const statusTone = (status: RunStatus): 'claude' | 'success' | 'error' | 'warning' =>
  status === 'running' ? 'claude' : status === 'completed' ? 'success' : status === 'killed' ? 'warning' : 'error'

export const statusGlyph = (status: RunStatus): string =>
  status === 'running' ? '⏺' : status === 'completed' ? '✓' : status === 'killed' ? '⏹' : '✗'

const USER_WAITING = ['BLOQUÉ', 'BLOCKED', 'RELECTURE-BLOQUANTE', 'REVIEW-BLOCKING']

export const headlineOf = (status: RunStatus, outcome: Outcome | null, asking = 0): { glyph: string; text: string; tone: string } =>
  (status === 'running' && asking > 0) || (status !== 'running' && outcome !== null && USER_WAITING.includes(outcome.label))
    ? { glyph: '?', text: 'waiting for user', tone: WAITING_TONE }
    : { glyph: statusGlyph(status), text: status, tone: statusTone(status) }

export const progressBar =(reached: number, total: number, width: number) => {
  const filled = total === 0 ? 0 : Math.round((Math.min(reached, total) / total) * width)
  return [
    { key: 'filled', text: '━'.repeat(filled), isFilled: true },
    { key: 'rest', text: '─'.repeat(width - filled), isFilled: false },
  ]
}

export const kilo = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return `${tokens}`
}

export const coarse = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

export const promptTokens = (used: ModelUsage): number =>
  used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens

export type Totals = { context: number; tokens: number }

export const totalsOf = (agents: WorkflowAgent[]): Totals => {
  const running = agents.filter(agent => agent.state === 'running')
  return {
    context: Math.max(0, ...(running.length > 0 ? running : agents).map(agent => agent.context)),
    tokens: agents.reduce((sum, agent) => sum + agent.tokens, 0),
  }
}

export const lotFiguresOf = (agents: WorkflowAgent[]): LotFigures | null => {
  if (agents.length === 0) return null
  const startedAt = Math.min(...agents.map(agent => agent.startedAt))
  const endedAt = Math.max(...agents.map(agent => agent.endedAt ?? agent.lastActiveAt))
  const totals = totalsOf(agents)
  return { agents: agents.length, durationMs: endedAt - startedAt, tokens: totals.tokens, endedAt }
}

export const lotFiguresFrom = (value: unknown): LotFigures | null => {
  if (typeof value !== 'object' || value === null) return null
  const fields = value as Record<string, unknown>
  return ['agents', 'durationMs', 'tokens', 'endedAt'].every(key => typeof fields[key] === 'number') ? (fields as LotFigures) : null
}

export const figuresKeyOf = (transcriptDir: string | null, sheet: string | null): string | null => {
  const found = lotOf(sheet)
  if (found === null) return null
  const project = /\/projects\/([^/]+)\//.exec(transcriptDir ?? '')?.[1] ?? ''
  return `lot:${project}:${found.code}-${found.lot}`
}

export const figuresLine = (totals: Totals): string =>
  `ctx ${kilo(totals.context)} · ${kilo(totals.tokens)} tok`

export const firstLine = (text: string, length = 160): string => {
  const line = (text.split('\n').find(one => one.trim() !== '') ?? '').trim()
  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}

export const toolSummary = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tool, count]) => `${tool} ${count}`)
    .join(' · ')

export const relativePath = (path: string, root: string | null): string =>
  root !== null && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

const EDITING_TOOLS = ['Edit', 'Write', 'NotebookEdit']
const KEPT_FILES = 12

export const editedPath = (tool: string, input: Record<string, unknown>): string | null => {
  if (!EDITING_TOOLS.includes(tool)) return null
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' && path !== '' ? path : null
}

export const withFile = (files: string[], path: string): string[] =>
  [...files.filter(one => one !== path), path].slice(-KEPT_FILES)

const KEPT_CALLS = 300
const RESERVED_KEYS = ['tool', 'tool_use_id', 'consent', 'agentId', 'requestMeta']

const ownFields = (input: Record<string, unknown>): [string, unknown][] =>
  Object.entries(input).filter(([key]) => !RESERVED_KEYS.includes(key))

export const callBrief = (tool: string, input: Record<string, unknown>, root: string | null): string => {
  const text = (key: string) => textOf(input[key])
  const path = (key: string) => {
    const found = text(key)
    return found === null ? null : relativePath(found, root)
  }
  if (tool === 'Bash') return firstLine(text('description') ?? text('command') ?? '', 120)
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write') return path('file_path') ?? ''
  if (tool === 'NotebookEdit') return path('notebook_path') ?? ''
  if (tool === 'Grep') return [text('pattern'), path('path') ?? text('glob')].filter(part => part !== null).join(' in ')
  if (tool === 'StructuredOutput') return ''
  const first = ownFields(input).map(([, value]) => textOf(value)).find(value => value !== null)
  return first === undefined || first === null ? '' : firstLine(first, 120)
}

const EXIT_LINE = /^Exit code (\d+)$/

export const errorDetail = (result: { deny?: string; isError?: boolean; text?: string }): string | null => {
  if (typeof result.deny === 'string') return `denied · ${firstLine(result.deny, 200)}`
  if (result.isError !== true) return null
  const lines = (result.text ?? '').split('\n').map(one => one.trim()).filter(one => one !== '')
  const exit = lines.map(one => EXIT_LINE.exec(one)?.[1]).find(code => code !== undefined)
  const detail = lines.filter(one => !EXIT_LINE.test(one)).pop()
  const parts = [exit === undefined ? null : `exit ${exit}`, detail === undefined ? null : firstLine(detail, 200)].filter(part => part !== null)
  return parts.length === 0 ? 'error' : parts.join(' · ')
}

export const errorOf = (tool: string, result: { deny?: string; isError?: boolean; text?: string }, brief = ''): string | null => {
  const detail = errorDetail(result)
  return detail === null ? null : `${brief === '' ? tool : `${tool} · ${brief}`}: ${detail}`
}

export const withCall = (calls: ToolTrace[], trace: ToolTrace): ToolTrace[] => [...calls, trace].slice(-KEPT_CALLS)

export const closedCall = (calls: ToolTrace[], id: string, error: string | null): ToolTrace[] =>
  calls.map(call => (call.id === id ? { ...call, state: error === null ? 'ok' : 'error', error } : call))

export type ErrorSummary = { count: number; last: ToolTrace | null; isRecovered: boolean }

export const errorsOf = (agent: WorkflowAgent): ErrorSummary => {
  const failed = agent.calls.filter(call => call.state === 'error')
  const last = failed[failed.length - 1] ?? null
  if (last === null) return { count: 0, last: null, isRecovered: true }
  const after = agent.calls.slice(agent.calls.indexOf(last) + 1)
  return { count: failed.length, last, isRecovered: agent.state !== 'error' && after.some(call => call.state === 'ok') }
}

const KEPT_ANSWER_LINES = 20
const ITEM_KEYS = ['gap', 'question', 'behaviour', 'title', 'summary', 'name', 'path']

const itemLine = (item: unknown): string => {
  if (item === null || typeof item !== 'object') return firstLine(String(item), 200)
  const fields = item as Record<string, unknown>
  const head = [textOf(fields.severity), textOf(fields.axis)].filter(part => part !== null)
  const body = ITEM_KEYS.map(key => textOf(fields[key])).find(value => value !== null) ?? Object.values(fields).map(textOf).find(value => value !== null) ?? '…'
  return [...head, firstLine(body, 200)].join(' · ')
}

export const structuredLines = (value: unknown): string[] | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const audit = auditOf(value)
  const lines = audit === null ? [] : [auditLabel(audit)]
  for (const [key, field] of ownFields(value as Record<string, unknown>)) {
    if (audit !== null && key === 'verdict') continue
    if (Array.isArray(field)) {
      lines.push(field.length === 0 ? `${key}: none` : `${key} · ${field.length}`)
      lines.push(...field.map(item => `  ${itemLine(item)}`))
    } else if (field !== null && typeof field === 'object') {
      lines.push(`${key}: {…}`)
    } else if (field !== null && field !== undefined && String(field).trim() !== '') {
      lines.push(`${key}: ${firstLine(String(field), 200)}`)
    }
  }
  if (lines.length === 0) return null
  return lines.length > KEPT_ANSWER_LINES
    ? [...lines.slice(0, KEPT_ANSWER_LINES - 1), `… ${lines.length - KEPT_ANSWER_LINES + 1} more lines`]
    : lines
}

const KEPT_PROMPT_LINES = 6

export const promptBrief = (prompt: string): string => {
  const trimmed = prompt.trim()
  const split = trimmed.indexOf('\n\n')
  const body = /^Workflow run-/.test(trimmed) && split >= 0 ? trimmed.slice(split).trim() : trimmed
  return body
    .split('\n')
    .map(one => one.trim())
    .filter(one => one !== '')
    .slice(0, KEPT_PROMPT_LINES)
    .map(one => firstLine(one, 300))
    .join('\n')
}

export const clockOf = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export type PhaseInsight = { totals: Totals; share: number | null; heaviest: string | null; slowest: string | null }

export const phaseInsight = (phase: PhaseRow, run: WorkflowRun, at: number): PhaseInsight => {
  const totals = totalsOf(phase.agents)
  const runTokens = totalsOf(run.agents).tokens
  const top = (score: (agent: WorkflowAgent) => number): string | null =>
    phase.agents.length < 2 ? null : ([...phase.agents].sort((a, b) => score(b) - score(a))[0]?.id ?? null)
  return {
    totals,
    share: runTokens > 0 ? Math.round((totals.tokens / runTokens) * 100) : null,
    heaviest: totals.tokens > 0 ? top(agent => agent.tokens) : null,
    slowest: top(agent => (agent.endedAt ?? at) - agent.startedAt),
  }
}

export const shortModel = (model: string): string => {
  const family = /(opus|sonnet|haiku|fable)/i.exec(model)?.[1]
  if (family === undefined) return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()}`
}

export const modelLabel = (agent: WorkflowAgent): string =>
  agent.effort === null ? agent.model : `${agent.model} · ${agent.effort}`

const phasesBlock = (script: string): string => {
  const start = script.search(/\bphases\s*:\s*\[/)
  if (start < 0) return ''
  const open = script.indexOf('[', start)
  let depth = 0
  let quote = ''
  for (let index = open; index < script.length; index++) {
    const char = script.charAt(index)
    if (quote !== '') {
      if (char === '\\') index++
      else if (char === quote) quote = ''
    } else if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '[') depth++
    else if (char === ']' && --depth === 0) return script.slice(open, index)
  }
  return script.slice(open)
}

export const parsePhases = (script: string): PhaseDeclaration[] => {
  const block = phasesBlock(script)
  const titles = [...block.matchAll(/\btitle\s*:\s*(['"`])((?:(?!\1).)+)\1/g)]
  return titles.flatMap((found, index) => {
    const title = found[2]
    if (title === undefined) return []
    const segment = block.slice(found.index, titles[index + 1]?.index)
    const detail = /\bdetail\s*:\s*(['"`])((?:(?!\1).)+)\1/.exec(segment)?.[2] ?? null
    return [{ title, detail }]
  })
}

export const detailsOf = (phases: PhaseDeclaration[]): Record<string, string> =>
  Object.fromEntries(phases.flatMap(phase => (phase.detail === null ? [] : [[phase.title, phase.detail]])))

const OPENERS: Record<string, string> = { "'": "'", '"': '"', '`': '`', '{': '}', '(': ')', '[': ']' }

const closingOf = (text: string, from: number): number => {
  const open = text[from] ?? ''
  const close = OPENERS[open]
  let at = from + 1
  while (at < text.length && text[at] !== close) {
    const char = text[at] ?? ''
    if (char === '\\') at += 1
    else if (open === '`' && text.startsWith('${', at)) at = closingOf(text, at + 1)
    else if (open !== "'" && open !== '"' && open !== '`' && char in OPENERS) at = closingOf(text, at)
    at += 1
  }
  return at
}

const branchesOf = (expression: string): string[] | null => {
  let question = -1
  let nested = 0
  for (let at = 0; at < expression.length; at++) {
    const char = expression[at] ?? ''
    if (char in OPENERS) {
      at = closingOf(expression, at)
      continue
    }
    const isTernary = char === '?' && expression[at + 1] !== '.' && expression[at + 1] !== '?' && expression[at - 1] !== '?'
    if (isTernary && question < 0) question = at
    else if (isTernary) nested += 1
    else if (char === ':' && question >= 0 && nested > 0) nested -= 1
    else if (char === ':' && question >= 0) return [expression.slice(question + 1, at), expression.slice(at + 1)]
  }
  return null
}

const literalPrefixesOf = (expression: string): string[] => {
  const text = expression.trim()
  const branches = branchesOf(text)
  if (branches !== null) return branches.flatMap(literalPrefixesOf)
  const quote = text[0] ?? ''
  if (quote !== "'" && quote !== '"' && quote !== '`') return []
  const body = text.slice(1, closingOf(text, 0))
  const head = quote === '`' ? (body.split('${')[0] ?? '') : body
  if (head !== '') return [head]
  return quote === '`' && body.startsWith('${') ? literalPrefixesOf(text.slice(3, closingOf(text, 2))) : []
}

const forwardedValuesOf = (script: string, lines: string[], at: number, parameter: string): string[] => {
  const owner = lines
    .slice(0, at + 1)
    .reverse()
    .map(text => /\bfunction\s+(\w+)\s*\(([^)]*)\)|\bconst\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/.exec(text))
    .find(found => found !== null)
  const name = owner?.[1] ?? owner?.[3]
  const parameters = (owner?.[2] ?? owner?.[4] ?? '').split(',').map(one => one.trim().split(/\s*=/)[0])
  const position = parameters.indexOf(parameter)
  if (name === undefined || position < 0) return []
  return [...script.matchAll(new RegExp(`(?<![\\w.])${name}\\(([^)]*)\\)`, 'g'))].flatMap(call =>
    literalPrefixesOf((call[1] ?? '').split(',')[position] ?? ''),
  )
}

const calledPrefixesOf = (script: string, expression: string): string[] => {
  const name = /^\s*(\w+)\s*\(/.exec(expression)?.[1]
  if (name === undefined) return []
  const definition = new RegExp(
    `\\b(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*|\\bfunction\\s+${name}\\s*\\([^)]*\\)\\s*\\{\\s*return\\s+`,
  ).exec(script)
  if (definition === null) return []
  const body = script.slice(definition.index + definition[0].length)
  return (body[0] ?? '') in OPENERS ? literalPrefixesOf(body.slice(0, closingOf(body, 0) + 1)) : []
}

const labelPrefixesOf = (script: string, expression: string): string[] => {
  const literal = literalPrefixesOf(expression)
  return literal.length > 0 ? literal : calledPrefixesOf(script, expression)
}

const optionOf = (text: string, key: string): string | null => {
  const start = text.search(new RegExp(`\\b${key}\\s*:`))
  return start < 0 ? null : (text.slice(start).replace(new RegExp(`^${key}\\s*:`), '').split(/,\s*\w+\s*:/)[0] ?? '')
}

const identifierOf = (expression: string): string | null => /^\s*(\w+)\s*}?\s*$/.exec(expression)?.[1] ?? null

const literalOf = (expression: string): string | null => /^\s*(['"`])((?:(?!\1).)+)\1/.exec(expression)?.[2] ?? null

const phasesOf = (script: string, lines: string[], at: number, expression: string): string[] => {
  const branches = branchesOf(expression.trim())
  if (branches !== null) {
    const phases = branches.map(literalOf)
    return phases.every((one): one is string => one !== null) ? phases : []
  }
  const literal = literalOf(expression)
  if (literal !== null) return [literal]
  const parameter = identifierOf(expression)
  const forwarded = parameter === null ? [] : [...new Set(forwardedValuesOf(script, lines, at, parameter))]
  return forwarded.length === 1 ? forwarded : []
}

export const labelPhasesOf = (script: string): Record<string, string> => {
  const lines = script.split('\n')
  return Object.fromEntries(
    lines.flatMap((text, at) => {
      const phaseExpression = optionOf(text, 'phase')
      const phases = phaseExpression === null ? [] : phasesOf(script, lines, at, phaseExpression)
      if (phases.length === 0) return []
      const expression = optionOf(text, 'label')
      const forwarded = expression === null ? (/\blabel\s*[,}]/.test(text) ? 'label' : null) : identifierOf(expression)
      if (phases.length > 1) {
        const branches = expression === null || forwarded !== null ? null : branchesOf(expression.trim())
        if (branches === null || branches.length !== phases.length) return []
        return branches.flatMap((branch, index) => labelPrefixesOf(script, branch).map(label => [label, phases[index] ?? '']))
      }
      const labels = forwarded !== null ? forwardedValuesOf(script, lines, at, forwarded) : labelPrefixesOf(script, expression ?? '')
      return labels.map(label => [label, phases[0] ?? ''])
    }),
  )
}

const labelledPhaseOf = (labels: Record<string, string>, label: string, phase: string | null): string | null => {
  if (phase !== null && !phase.startsWith('▸ ')) return phase
  const prefix = Object.keys(labels)
    .filter(one => label.startsWith(one))
    .sort((a, b) => b.length - a.length)[0]
  return prefix === undefined ? phase : (labels[prefix] ?? phase)
}

export const nestedPhaseOf = (child: ChildWorkflow | null, label: string, phase: string | null): string | null =>
  child === null ? phase : labelledPhaseOf(child.labels ?? {}, label, phase)

export const journalPathOf =(transcriptDir: string, runId: string): string =>
  transcriptDir.replace(new RegExp(`/subagents/workflows/${runId}/?$`), `/workflows/${runId}.json`)

const STATUSES: RunStatus[] = ['completed', 'failed', 'killed']

const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

export const argumentOf = (input: Record<string, unknown>): string | null => {
  const given = input.args
  if (typeof given === 'object' && given !== null) {
    const fields = given as Record<string, unknown>
    return textOf(fields.sheet) ?? textOf(fields.plan)
  }
  return textOf(given)
}

export const lotOf = (argument: string | null): { lot: string; code: string } | null => {
  const found = argument === null ? null : LOT_PATTERN.exec(argument)
  return found?.[1] === undefined || found[2] === undefined ? null : { lot: found[2], code: found[1] }
}

export const sheetPathOf = (argument: string | null): string | null =>
  argument !== null && SHEET_PATTERN.test(argument) ? argument : null

export const childWorkflowOf = (script: string): string | null => {
  const found = CHILD_CALL.exec(script)
  return found?.[1] ?? found?.[2] ?? null
}

export const childPluginOf = (script: string): string | null => CHILD_PLUGIN.exec(script)?.[1] ?? null

export const claudeHomeOf = (path: string | null | undefined): string | null => {
  const at = path?.indexOf('/projects/') ?? -1
  return at > 0 ? path!.slice(0, at) : null
}

type Installed = { scope?: string; projectPath?: string; installPath?: string }

export const installPathOf = (installed: string, plugin: string, root: string): string | null => {
  try {
    const plugins = (JSON.parse(installed) as { plugins?: Record<string, Installed[]> }).plugins ?? {}
    const entries = Object.entries(plugins)
      .filter(([key]) => key.startsWith(`${plugin}@`))
      .flatMap(([, list]) => list)
    const chosen = entries.find(one => one.projectPath === root) ?? entries.find(one => one.scope === 'user')
    return chosen?.installPath ?? null
  } catch {
    return null
  }
}

export const childScriptPathsOf = (name: string, root: string, installPath: string | null): string[] => [
  ...(installPath === null ? [] : [`${installPath}/workflows/${name}.js`]),
  `${root}/.claude/workflows/${name}.js`,
]

export const planPathOf = (argument: string | null): string | null => {
  const path = argument?.trim().split(/\s+/)[0] ?? ''
  return /-PLAN\.md$/.test(path) ? path.replace(/^@/, '') : null
}

export const promptLotOf = (prompt: string): { lot: string; sheet: string } | null => {
  const framed = PROMPT_LOT.exec(prompt)
  if (framed?.[1] !== undefined && framed[2] !== undefined) return { lot: framed[1], sheet: framed[2] }
  const review = REVIEW_LOT.exec(prompt)
  return review?.[1] !== undefined && review[2] !== undefined ? { lot: review[2], sheet: review[1] } : null
}

const blankLot = (lot: string): PlanLot => ({ lot, sheet: null, deps: [], isDone: false, outcome: null, audit: null, view: null })

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())

export const parsePlanLots = (text: string): PlanLot[] => {
  const lines = text.split('\n')
  const start = lines.findIndex(line => PLAN_SECTIONS.includes(line.trim()))
  if (start < 0) return []
  const table: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|')) table.push(line)
    else if (table.length > 0 || line.startsWith('#')) break
  }
  const header = cellsOf(table[0] ?? '').map(cell => cell.toLowerCase())
  const lotAt = Math.max(header.indexOf('lot'), header.indexOf('batch'))
  const depsAt = Math.max(header.indexOf('depend de'), header.indexOf('depends on'))
  if (lotAt < 0) return []
  const done = new Set([...text.matchAll(PLAN_DONE)].map(found => found[1]))
  const titles = Object.fromEntries([...text.matchAll(PLAN_HEADING)].map(found => [found[1] ?? '', found[2] ?? '']))
  return table.slice(2).flatMap(line => {
    const cells = cellsOf(line)
    const lot = /F\d+/.exec(cells[lotAt] ?? '')?.[0]
    if (lot === undefined) return []
    const deps = depsAt < 0 ? [] : ((cells[depsAt] ?? '').match(/F\d+/g) ?? [])
    const title = titles[lot]
    return [{ ...blankLot(lot), deps, isDone: done.has(lot), ...(title === undefined || title === '' ? {} : { title }) }]
  })
}

export const mergeLots = (known: PlanLot[], planned: PlanLot[]): PlanLot[] => [
  ...planned.map(one => {
    const seen = known.find(other => other.lot === one.lot)
    return seen === undefined ? one : { ...seen, deps: one.deps, isDone: one.isDone, ...(one.title === undefined ? {} : { title: one.title }) }
  }),
  ...known.filter(other => !planned.some(one => one.lot === other.lot)),
]

export const withLot = (lots: PlanLot[], lot: string, change: (one: PlanLot) => PlanLot): PlanLot[] =>
  lots.some(one => one.lot === lot) ? lots.map(one => (one.lot === lot ? change(one) : one)) : [...lots, change(blankLot(lot))]

const runRootOf = (sheet: string): string => `${sheet.slice(0, sheet.lastIndexOf('/') + 1)}run`

export const reportPathsOf = (sheet: string, lot: string): string[] => [
  ...BATCH_REPORT_DIRS.map(dir => `${runRootOf(sheet)}/${dir}/${lot}.md`),
  ...REPORT_NAMES.map(name => `${runRootOf(sheet)}/${lot}/${lot}-${name}.md`),
]

export const workFileOf = (sheet: string): string => `${runRootOf(sheet)}/.work.jsonl`

type WorkLine = { kind?: unknown; batch?: unknown; id?: unknown; slug?: unknown; state?: unknown }

export const workLinesOf = (text: string): WorkLine[] =>
  text.split('\n').flatMap(line => {
    const record = jsonOf(line)
    return typeof record === 'object' && record !== null && !Array.isArray(record) ? [record as WorkLine] : []
  })

export const cycleStatesOf = (lines: WorkLine[], lot: string): Record<string, string> =>
  Object.fromEntries(
    lines.flatMap(line => (line.kind === 'cycle' && line.batch === lot && typeof line.slug === 'string' ? [[line.slug, JSON.stringify(line.state ?? null)]] : [])),
  )


export type PendingQuestion = { batch: string; id: string; count: number; endsAt: number }

const numberOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

// A question waits `waitSeconds` (600 on lines written before the field) before the run applies its
// recommendation; an answer line of the same id, written at or after it, answers it.
export const openQuestionsOf = (lines: WorkLine[]): PendingQuestion[] => {
  const records = lines as Record<string, unknown>[]
  return records.flatMap(line => {
    if (line.kind !== 'question') return []
    const at = numberOf(line.at) ?? 0
    if (records.some(other => other.kind === 'answer' && String(other.id) === String(line.id) && (numberOf(other.at) ?? Infinity) >= at)) return []
    const payload = fieldsOf(line.payload)
    const asked = Array.isArray(payload?.questions) ? payload.questions.length : 1
    return [{ batch: String(line.batch ?? payload?.batch ?? ''), id: String(line.id), count: Math.max(1, asked), endsAt: (at + (numberOf(payload?.waitSeconds) ?? WAIT_SECONDS)) * 1000 }]
  })
}

export const pendingQuestionsOf = (lines: WorkLine[], lot: string): string[] => openQuestionsOf(lines).filter(one => one.batch === lot).map(one => one.id)

export const reportOutcomeOf = (text: string, path: string): Outcome | null => {
  const status = REPORT_STATUS.exec(text.split('\n')[0] ?? '')?.[1]
  if (status === undefined) return null
  const reason = /^(?:Raison|Reason)\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null
  return { label: status, reason: reason === null || reason === '—' ? null : reason, report: path }
}

export type LotState = RunStatus | 'pending' | 'done' | 'waiting'

export type Wave = { wave: number; total: number }

export const waveOf = (run: WorkflowRun): Wave | null => {
  const seen = run.agents.flatMap(agent => {
    const found = WAVE_LABEL.exec(agent.label)?.[1]
    return found === undefined ? [] : [Number(found)]
  })
  if (seen.length === 0) return null
  const wave = Math.max(...seen)
  const indexed = Math.max(0, ...(run.sheet?.cycles ?? []).map(cycle => cycle.wave))
  return { wave, total: Math.max(wave, indexed) }
}

export const lotStateOf = (run: WorkflowRun, entry: PlanLot): LotState => {
  const agents = run.agents.filter(agent => agent.lot === entry.lot)
  if ((entry.asking ?? 0) > 0 && entry.outcome === null) return 'waiting'
  if (entry.outcome !== null && USER_WAITING.includes(entry.outcome.label)) {
    return agents.some(agent => agent.state === 'running') ? 'running' : 'waiting'
  }
  if (entry.outcome !== null) return LOT_DONE.includes(entry.outcome.label) ? 'completed' : 'failed'
  if (agents.length === 0) return entry.isDone ? 'done' : 'pending'
  if (agents.some(agent => agent.state === 'running')) return 'running'
  const latest = [...run.agents].filter(agent => agent.lot !== null).sort((a, b) => b.index - a.index)[0]?.lot
  if (latest !== entry.lot) return 'completed'
  return run.status
}

export const lotDetailOf = (run: WorkflowRun, entry: PlanLot, state: LotState, at: number): string => {
  if (entry.outcome !== null) return [entry.outcome.label, oneLine(entry.outcome.reason ?? '')].filter(one => one !== '').join(' · ')
  if (state === 'running') {
    const active = [...run.agents]
      .filter(agent => agent.lot === entry.lot && agent.state === 'running')
      .sort((a, b) => b.index - a.index)[0]
    if (active !== undefined) return `${active.phase ?? NO_PHASE} · ${active.label}`
    const rows = phaseRows(lotRun(run, entry.lot), at)
    const reached = rows.map(row => row.mark !== 'pending').lastIndexOf(true)
    const step = rows.slice(reached + 1).find(row => !CONDITIONAL_PHASES.includes(row.title))
    return step === undefined ? 'running' : step.title
  }
  if (state === 'waiting') return 'question awaiting an answer'
  if (state === 'done') return 'done before this run'
  if (state === 'pending') return entry.deps.length > 0 ? `after ${entry.deps.join(', ')}` : 'pending'
  return state
}

export const placedInPhases = (agents: WorkflowAgent[], phases: string[]): WorkflowAgent[] => {
  if (phases.length === 0) return agents
  let previous = phases[0] ?? null
  const placed = new Map(
    [...agents]
      .sort((a, b) => a.index - b.index)
      .map(agent => {
        if (agent.phase !== null && phases.includes(agent.phase)) previous = agent.phase
        return [agent.id, previous] as const
      }),
  )
  return agents.map(agent => ({ ...agent, phase: placed.get(agent.id) ?? agent.phase }))
}

export const lotRun = (run: WorkflowRun, lot: string): WorkflowRun => {
  const entry = run.lots.find(one => one.lot === lot) ?? blankLot(lot)
  const phases = run.child?.phases ?? []
  const resolved = run.agents
    .filter(agent => agent.lot === lot)
    .map(agent => ({ ...agent, phase: nestedPhaseOf(run.child, agent.label, agent.phase) }))
  const agents = placedInPhases(resolved, phases)
  const state = lotStateOf(run, entry)
  const asking = entry.outcome === null ? (entry.asking ?? 0) : 0
  const status: RunStatus = state === 'waiting' && asking > 0 ? 'running' : state === 'pending' || state === 'done' || state === 'waiting' ? 'completed' : state
  const startedAt = agents.length > 0 ? Math.min(...agents.map(agent => agent.startedAt)) : run.startedAt
  const endedAt = agents.length > 0 ? Math.max(...agents.map(agent => agent.endedAt ?? agent.lastActiveAt)) : startedAt
  return {
    ...run,
    runId: `${run.runId}#${lot}`,
    name: run.child?.name ?? run.name,
    argument: entry.sheet,
    phases: run.child?.phases ?? [],
    details: run.child?.details ?? {},
    startedAt,
    launchedAt: startedAt,
    durationMs: status === 'running' ? null : endedAt - startedAt,
    status,
    outcome: entry.outcome,
    audit: entry.audit,
    sheet: entry.view,
    agents,
    child: null,
    plan: null,
    lots: [],
    asking,
  }
}

const VERDICTS: AuditVerdict['verdict'][] = ['VALIDE', 'ECARTS', 'ÉCARTS', 'VALID', 'GAPS']

export const auditOf = (source: unknown): AuditVerdict | null => {
  if (source === null || typeof source !== 'object') return null
  const fields = source as Record<string, unknown>
  const verdict = VERDICTS.find(one => one === fields.verdict)
  if (verdict === undefined) return null
  const gaps = Array.isArray(fields.gaps) ? fields.gaps : []
  const count = (severities: string[]) => gaps.filter(gap => severities.includes(gap?.severity)).length
  return { verdict, blocking: count(['Bloquant', 'Blocking']), major: count(['Majeur', 'Major']) }
}

export const auditLabel = (audit: AuditVerdict): string =>
  [audit.verdict, audit.blocking > 0 ? `${audit.blocking} blocking` : '', audit.major > 0 ? `${audit.major} major` : '']
    .filter(part => part !== '')
    .join(' · ')

export const auditTone = (audit: AuditVerdict): 'success' | 'warning' | 'error' =>
  audit.verdict === 'VALIDE' || audit.verdict === 'VALID' ? 'success' : audit.blocking > 0 ? 'error' : 'warning'

const OUTCOME_KEYS = ['statut', 'status', 'verdict', 'summary']

const outcomeOf = (result: unknown): Outcome | null => {
  if (typeof result === 'string') {
    const label = firstLine(result, 120)
    return label === '' ? null : { label, reason: null, report: null }
  }
  if (result === null || typeof result !== 'object') return null
  const fields = result as Record<string, unknown>
  const label = OUTCOME_KEYS.map(key => textOf(fields[key])).find(found => found !== null) ?? null
  if (label === null) return null
  const reason = textOf(fields.raison) ?? textOf(fields.reason)
  const merge = mergeOf(fields.merge)
  return { label, reason: reason === '—' ? null : reason, report: textOf(fields.rapport) ?? textOf(fields.report), ...(merge === null ? {} : { merge }) }
}

const MERGE_STATES = ['staged', 'refused', 'blocked', 'failed'] as const

// `merge` of a run-plan result (workflows/run-plan.js): absent when the plan had nothing to merge.
export const mergeOf = (value: unknown): KnowledgeMerge | null => {
  if (value === null || typeof value !== 'object') return null
  const fields = value as Record<string, unknown>
  const state = MERGE_STATES.find(one => one === fields.state)
  if (state === undefined) return null
  const texts = (list: unknown): string[] => (Array.isArray(list) ? list.flatMap(one => (textOf(one) === null ? [] : [textOf(one) as string])) : [])
  const next = textOf(fields.next)
  return { state, lines: texts(fields.lines), warnings: texts(fields.warnings), next: next === null ? null : (next.split(' — ')[0] ?? next) }
}

// A staged merge waits for the user: the plan is green, the base is not written yet.
export const mergeRows = (merge: KnowledgeMerge): { text: string; tone: 'warning' | 'error' | 'inactive' | undefined; bold: boolean }[] => [
  merge.state === 'staged'
    ? { text: '◆ Knowledge base — merge staged, not written', tone: 'warning', bold: true }
    : { text: `✗ Knowledge base — merge ${merge.state}`, tone: 'error', bold: true },
  ...merge.lines.map(text => ({ text, tone: 'inactive' as const, bold: false })),
  ...merge.warnings.map(text => ({ text, tone: 'warning' as const, bold: false })),
  ...(merge.next === null ? [] : [{ text: `→ ${merge.next}`, tone: undefined, bold: false }]),
]

export const outcomeTone = (outcome: Outcome, status: RunStatus): 'success' | 'warning' | 'error' | typeof WAITING_TONE => {
  if (['TERMINÉ', 'DONE'].includes(outcome.label)) return 'success'
  if (['ECARTS', 'ÉCARTS', 'GAPS', 'RELECTURE-BLOQUANTE', 'REVIEW-BLOCKING'].includes(outcome.label)) return 'warning'
  if (['BLOQUÉ', 'BLOCKED'].includes(outcome.label)) return 'error'
  return status === 'completed' ? 'success' : status === 'killed' ? 'warning' : 'error'
}

const recordOf = (text: string): Record<string, unknown> | null => {
  const parsed = jsonOf(text)
  return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
}

export const parseJournal = (text: string): Journal | null => {
  const raw = recordOf(text)
  if (raw === null) return null
  const status = STATUSES.find(one => one === raw.status) ?? (raw.status === 'running' ? 'running' : 'failed')
  const declared = Array.isArray(raw.phases)
    ? raw.phases.flatMap(one => (typeof one?.title === 'string' ? [{ title: one.title as string, detail: textOf(one.detail) }] : []))
    : []
  const agentPhases: Record<string, string> = {}
  for (const entry of Array.isArray(raw.workflowProgress) ? raw.workflowProgress : []) {
    if (entry?.type === 'workflow_agent' && typeof entry.agentId === 'string' && typeof entry.phaseTitle === 'string') {
      agentPhases[entry.agentId] = entry.phaseTitle
    }
  }
  const failure = typeof raw.error === 'string' ? { label: status, reason: raw.error, report: null } : null
  return {
    status,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : null,
    outcome: outcomeOf(raw.result) ?? failure,
    argument: argumentOf({ args: raw.args }),
    audit: auditOf(raw.result),
    phases: declared.map(phase => phase.title),
    details: detailsOf(declared),
    agentPhases,
  }
}

export type Sample = { phase: string; ms: number; tools: number | null; startedAt: number | null; scope?: string; label?: string }

export const samplesOf = (text: string, labels: Record<string, string> = {}): Sample[] => {
  const raw = recordOf(text)
  if (raw === null) return []
  const isComplete = raw.status === 'completed'
  return (Array.isArray(raw.workflowProgress) ? raw.workflowProgress : []).flatMap(entry =>
    entry?.type === 'workflow_agent' && entry.state === 'done' && typeof entry.phaseTitle === 'string' && typeof entry.durationMs === 'number'
      ? [
          {
            phase: labelledPhaseOf(labels, typeof entry.label === 'string' ? entry.label : '', entry.phaseTitle as string) ?? (entry.phaseTitle as string),
            scope: entry.phaseTitle as string,
            label: typeof entry.label === 'string' ? entry.label : '',
            ms: entry.durationMs as number,
            tools: typeof entry.toolCalls === 'number' ? entry.toolCalls : null,
            startedAt: isComplete && typeof entry.startedAt === 'number' ? entry.startedAt : null,
          },
        ]
      : [],
  )
}

const spansOf = (samples: Sample[]): { phase: string; ms: number }[] => {
  const bounds: Record<string, { from: number; to: number }> = {}
  for (const sample of samples) {
    if (sample.startedAt === null) continue
    const key = JSON.stringify([sample.scope ?? sample.phase, sample.phase])
    const found = bounds[key]
    const end = sample.startedAt + sample.ms
    bounds[key] = { from: Math.min(found?.from ?? sample.startedAt, sample.startedAt), to: Math.max(found?.to ?? end, end) }
  }
  return Object.entries(bounds).map(([key, one]) => ({ phase: (JSON.parse(key) as string[])[1] ?? '', ms: one.to - one.from }))
}

const labelled = (patterns: RegExp[], sample: Sample): boolean => patterns.some(pattern => pattern.test(sample.label ?? ''))

export const currentShapeSamples = (shaped: Sample[][]): Sample[][] => {
  const journals = shaped.map(samples => samples.filter(one => !labelled(DROPPED_LABELS, one)))
  const isRecent = (samples: Sample[]): boolean => samples.some(one => labelled(INTRODUCED_LABELS, one))
  const recent = journals.filter(isRecent)
  if (recent.length === 0) return journals
  const reshaped = new Set(
    [...recent.flat().filter(one => labelled(INTRODUCED_LABELS, one)), ...journals.flat().filter(one => labelled(RETIRED_LABELS, one))].map(one => one.phase),
  )
  return journals.map(samples => (isRecent(samples) ? samples : samples.filter(one => !reshaped.has(one.phase))))
}

const NO_SAMPLE: PhaseSample = { total: 0, count: 0, tools: 0, toolCount: 0, span: 0, spanCount: 0 }

export const statsOf = (known: PhaseSamples, phase: string): PhaseSample => ({ ...NO_SAMPLE, ...known[phase] })

export const withSamples = (known: PhaseSamples, samples: Sample[]): PhaseSamples => {
  const merged: PhaseSamples = { ...known }
  for (const sample of samples) {
    const before = statsOf(merged, sample.phase)
    merged[sample.phase] = {
      ...before,
      total: before.total + sample.ms,
      count: before.count + 1,
      tools: before.tools + (sample.tools ?? 0),
      toolCount: before.toolCount + (sample.tools === null ? 0 : 1),
    }
  }
  for (const one of spansOf(samples)) {
    const before = statsOf(merged, one.phase)
    merged[one.phase] = { ...before, span: before.span + one.ms, spanCount: before.spanCount + 1 }
  }
  return merged
}

const peersOf = (agents: WorkflowAgent[], agent: WorkflowAgent): WorkflowAgent[] =>
  agents.filter(
    other =>
      other.id !== agent.id && (other.phase ?? NO_PHASE) === (agent.phase ?? NO_PHASE) && other.state === 'done' && other.endedAt !== null,
  )

export const typicalMs = (known: PhaseSamples, agents: WorkflowAgent[], agent: WorkflowAgent): number | null => {
  const stats = statsOf(known, agent.phase ?? NO_PHASE)
  const peers = peersOf(agents, agent)
  const count = stats.count + peers.length
  const own = peers.reduce((sum, other) => sum + ((other.endedAt ?? other.startedAt) - other.startedAt), 0)
  return count === 0 ? null : (stats.total + own) / count
}

export const typicalTools = (known: PhaseSamples, agents: WorkflowAgent[], agent: WorkflowAgent): number | null => {
  const stats = statsOf(known, agent.phase ?? NO_PHASE)
  const peers = peersOf(agents, agent)
  const count = stats.toolCount + peers.length
  const own = peers.reduce((sum, other) => sum + other.tools, 0)
  return count === 0 ? null : (stats.tools + own) / count
}

export const isSlow = (agent: WorkflowAgent, typical: number | null, at: number): boolean =>
  typical !== null && (agent.endedAt ?? at) - agent.startedAt > SLOW_FACTOR * typical

export const throughputOf = (agent: WorkflowAgent): number | null => {
  if (agent.streamKind === null || agent.firstChunkAt === null || agent.lastChunkAt === null || agent.streamChars === 0) return null
  const span = agent.lastChunkAt - agent.firstChunkAt
  return span < 1000 ? null : agent.streamChars / CHARS_PER_TOKEN / (span / 1000)
}

export const liveSignalOf = (agent: WorkflowAgent, at: number): string | null => {
  if (agent.state !== 'running') return null
  if (agent.openCalls > 0) return agent.toolSince !== null && at - agent.toolSince > STALL_TOOL_MS ? 'long tool' : null
  if (agent.waitingSince !== null) return at - agent.waitingSince > STALL_WAIT_MS ? 'waiting' : null
  const idle = at - Math.max(agent.lastActiveAt, agent.lastChunkAt ?? 0)
  if (idle > STALL_IDLE_MS) return `idle ${Math.floor(idle / 60_000)}m`
  const rate = throughputOf(agent)
  const span = (agent.lastChunkAt ?? 0) - (agent.firstChunkAt ?? at)
  return rate !== null && span > STALL_SLOW_MS && rate < SLOW_RATE ? 'slow' : null
}

export const stallReasons = (agent: WorkflowAgent, typical: number | null, at: number): string[] => {
  if (agent.state !== 'running') return []
  return [
    liveSignalOf(agent, at) ?? '',
    agent.tools > (typical === null ? STALL_TOOLS : SLOW_FACTOR * typical) ? `${agent.tools} tools` : '',
    agent.context > STALL_CONTEXT ? `ctx ${kilo(agent.context)}` : '',
  ]
    .filter(reason => reason !== '')
    .map(reason => `⚠ ${reason}`)
}

const STREAM_LABELS: Record<StreamKind, string> = { thinking: 'thinking', output: 'output', tool: 'tool' }

export const characters = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M chars`
  const tenths = Math.round(count / 100)
  if (tenths >= 100) return `${Math.round(count / 1000)}k chars`
  if (count >= 1000) return `${(tenths / 10).toFixed(1)}k chars`
  return `${count} chars`
}

export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`
}

export const activityOf = (agent: WorkflowAgent, at: number): string | null => {
  if (agent.state !== 'running') return null
  if (agent.openCalls > 0 && agent.toolSince !== null) return `tool ${agent.lastTool ?? '?'} ${elapsed(at - agent.toolSince)}`
  if (agent.waitingSince !== null) return `○ waiting model ${elapsed(at - agent.waitingSince)}`
  if (agent.streamKind === null) return null
  if (agent.streamChars === 0) return `● ${STREAM_LABELS[agent.streamKind]}${agent.firstChunkAt === null ? '' : ` · ${elapsed(at - agent.firstChunkAt)}`}`
  const rate = throughputOf(agent)
  return `● ${STREAM_LABELS[agent.streamKind]} · ${characters(agent.streamChars)}${rate === null ? '' : ` · ${Math.round(rate)} tok/s`}`
}

export const attemptsOf = (agents: WorkflowAgent[]): Record<string, number> => {
  const seen: Record<string, number> = {}
  const attempts: Record<string, number> = {}
  for (const agent of [...agents].sort((a, b) => a.startedAt - b.startedAt || a.index - b.index)) {
    if (agent.state !== 'interrupted') seen[agent.label] = (seen[agent.label] ?? 0) + 1
    attempts[agent.id] = seen[agent.label] ?? 1
  }
  return attempts
}

export const isPhaseDone = (tdd: TddMarks | null): boolean =>
  tdd !== null && tdd.red === DONE && tdd.green === DONE && tdd.cost === DONE

export const isStepDone = (step: Step): boolean =>
  (step.isDone || isPhaseDone(step.tdd)) && step.corrections.every(one => isPhaseDone(one.tdd))

export const isStepStarted = (step: Step): boolean =>
  [step.tdd, ...step.corrections.map(one => one.tdd)].some(
    tdd => tdd !== null && (tdd.red === DONE || tdd.green === DONE || tdd.cost === DONE),
  )

export const markOf = (value: string): string => (value === DONE ? '✓' : value === '' || value === '⬜' ? '·' : value)

export const parseSheet = (text: string, path: string): Sheet => {
  const lines = text.split(/\r?\n/)
  const title = lines.find(line => line.startsWith('# '))?.slice(2).trim() ?? ''
  const lot = SHEET_PATTERN.exec(path)?.[1] ?? /PLAN-(F\d+)/.exec(title)?.[1] ?? '?'
  const name = title
    .replace(/\s+—\s+✅ DONE.*$/, '')
    .split(' — ')
    .slice(1)
    .join(' — ')
  const steps: Step[] = []
  let section = ''
  let hypotheses = 0

  for (const line of lines) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim()
      continue
    }
    if (/^(H[yi]poth[eè]ses|Assumptions)/i.test(section) && /^\s*(?:[-*]\s+)?\**H\d+\b/.test(line)) hypotheses += 1
    if (!/^(D[eé]roulement TDD|TDD sequence)/i.test(section)) continue

    const step = /^### (?:[EÉ]tape|Step) (\S+) — (.+)$/.exec(line)
    if (step) {
      const heading = step[2] ?? ''
      steps.push({
        number: step[1] ?? '',
        title: heading.replace(/\s+—\s+✅ DONE.*$/, ''),
        isDone: heading.includes('✅ DONE'),
        tdd: null,
        corrections: [],
      })
      continue
    }
    const current = steps[steps.length - 1]
    if (current === undefined) continue

    if (line.startsWith('✅ DONE')) {
      current.isDone = true
      continue
    }

    const correction = /^(?:#{3,4} )?Correction (C\d+) — (.+)$/.exec(line)
    if (correction) {
      current.corrections.push({ id: correction[1] ?? '', finding: correction[2] ?? '', tdd: null })
      continue
    }
    const tdd = /^TDD ?: RED (\S+) · GREEN (\S+) · CO[US]T (\S+)/.exec(line)
    if (tdd) {
      const marks: TddMarks = { red: tdd[1] ?? '', green: tdd[2] ?? '', cost: tdd[3] ?? '' }
      const owner = current.corrections[current.corrections.length - 1] ?? current
      if (owner.tdd === null) owner.tdd = marks
    }
  }

  const isDone = title.includes('✅ DONE') || (steps.length > 0 && steps.every(isStepDone))
  const cycles = parseCycles(text)
  return { lot, name, isDone, steps, hypotheses, ...(cycles === null ? {} : { cycles }) }
}

export const parseCycles = (text: string): SheetCycle[] | null => {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === CYCLES_SECTION)
  if (start < 0) return null
  const end = lines.findIndex((line, at) => at > start && line.startsWith('## '))
  const fenced = /```json[ \t]*\n([\s\S]*?)\n```/.exec(lines.slice(start + 1, end < 0 ? undefined : end).join('\n'))?.[1]
  const block = fenced === undefined ? null : recordOf(fenced)
  const listed = Array.isArray(block?.cycles) ? (block.cycles as unknown[]) : []
  const cycles = listed.flatMap((one, at): SheetCycle[] => {
    const fields = one !== null && typeof one === 'object' ? (one as Record<string, unknown>) : null
    const behaviour = textOf(fields?.behaviour)
    if (fields === null || behaviour === null) return []
    return [
      {
        id: textOf(fields.id) ?? `${at + 1}`,
        behaviour,
        wave: typeof fields.wave === 'number' ? fields.wave : 1,
        guard: fields.guard === true,
        state: 'pending',
        unreachable: [],
      },
    ]
  })
  return cycles.length === 0 ? null : cycles
}

export const cycleSlugOf = (behaviour: string): string =>
  behaviour
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

const fieldsOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

export const cycleProgressOf = (cycle: SheetCycle, saved: string | null): SheetCycle => {
  const state = saved === null ? null : recordOf(saved)
  const red = fieldsOf(state?.red)
  if (red === null) return { ...cycle, state: 'pending', unreachable: [] }
  const green = fieldsOf(state?.green)
  const unreachable = (Array.isArray(red.unreachable) ? (red.unreachable as unknown[]) : []).flatMap(one => {
    const method = textOf(fieldsOf(one)?.method)
    return method === null ? [] : [method]
  })
  const isGreen = green?.status === 'GREEN' && green.exit === 0
  const needsNoGreen = red.status === 'ALREADY_GREEN' || cycle.guard || (Array.isArray(red.table) && red.table.length === 0)
  return { ...cycle, state: isGreen || needsNoGreen ? 'done' : 'red', unreachable }
}

export const withLiveCycles = (sheet: Sheet, agents: WorkflowAgent[]): Sheet => {
  if (sheet.cycles === undefined) return sheet
  const running = agents.filter(agent => agent.state === 'running').map(agent => agent.label)
  const isRunning = (phase: string, id: string) => running.some(label => label.startsWith(`${phase} ${id} `))
  const cycles = sheet.cycles.map((one): SheetCycle =>
    isRunning('RED', one.id)
      ? { ...one, state: 'pending', live: 'RED' }
      : isRunning('GREEN', one.id)
        ? { ...one, state: one.state === 'done' ? 'red' : one.state, live: 'GREEN' }
        : one,
  )
  return { ...sheet, cycles }
}

export const isSheetDone = (sheet: Sheet): boolean =>
  sheet.isDone || (sheet.cycles !== undefined && sheet.cycles.every(one => one.state === 'done'))

export type PhaseRow = {
  title: string
  detail: string | null
  mark: 'done' | 'running' | 'pending'
  agents: WorkflowAgent[]
  earlier: WorkflowAgent[]
  span: number
}

const isLive = (agent: WorkflowAgent): boolean => agent.state !== 'interrupted'

const phaseTitles = (run: WorkflowRun): string[] => {
  const titles = [...run.phases]
  for (const agent of run.agents) {
    const title = agent.phase ?? NO_PHASE
    if (!titles.includes(title)) titles.push(title)
  }
  return titles
}

export type Passes = { start: number | null; count: number }

export const passesOf = (run: WorkflowRun): Passes => {
  const titles = phaseTitles(run)
  const rank = (title: string): number => {
    const mates = [...PARALLEL_PHASES, ...INTERLEAVED_PHASES].find(group => group.includes(title)) ?? [title]
    const found = mates.map(one => titles.indexOf(one)).filter(index => index >= 0)
    return found.length === 0 ? -1 : Math.min(...found)
  }
  let top = -1
  let passes: Passes = { start: null, count: 1 }
  for (const agent of run.agents.filter(isLive).sort((a, b) => a.startedAt - b.startedAt || a.index - b.index)) {
    if (agent.phase === null || CONDITIONAL_PHASES.includes(agent.phase)) continue
    const one = rank(agent.phase)
    if (one < top) passes = { start: agent.startedAt, count: passes.count + 1 }
    top = one < top ? one : Math.max(top, one)
  }
  return passes
}

export const isStaleReport = (agents: WorkflowAgent[], agent: WorkflowAgent): boolean =>
  agent.phase === REPORT_PHASE &&
  agent.endedAt !== null &&
  agents.some(other => other.phase !== REPORT_PHASE && isLive(other) && other.startedAt > (agent.endedAt ?? 0))

export const phaseRows = (run: WorkflowRun, at: number): PhaseRow[] => {
  const titles = phaseTitles(run)
  const { start } = passesOf(run)
  const isCurrent = (agent: WorkflowAgent): boolean => start === null || agent.startedAt >= start
  const reached = Math.max(-1, ...run.agents.filter(agent => isLive(agent) && isCurrent(agent) && !CONDITIONAL_PHASES.includes(agent.phase ?? NO_PHASE)).map(agent => titles.indexOf(agent.phase ?? NO_PHASE)))
  const rows = titles
    .map((title, index) => {
      const all = run.agents.filter(agent => (agent.phase ?? NO_PHASE) === title)
      const isReached = index <= reached || CONDITIONAL_PHASES.includes(title)
      const agents = isReached ? all : all.filter(isCurrent)
      const earlier = isReached ? [] : all.filter(agent => !isCurrent(agent))
      const isRunning = agents.some(agent => agent.state === 'running')
      const timed = agents.some(isCurrent) ? agents.filter(isCurrent) : agents
      const starts = timed.map(agent => agent.startedAt)
      const ends = timed.map(agent => agent.endedAt ?? at)
      const span = timed.length === 0 ? 0 : Math.max(...ends) - Math.min(...starts)
      const mark: PhaseRow['mark'] = isRunning ? 'running' : isReached && agents.some(isLive) ? 'done' : 'pending'
      return { title, detail: run.details[title] ?? null, mark, agents, earlier, span }
    })
    .filter(row => row.title !== NO_PHASE || row.agents.length > 0 || row.earlier.length > 0)
  return besideInterrupted(rows)
}

const besideInterrupted = (rows: PhaseRow[]): PhaseRow[] => {
  const isConditional = (row: PhaseRow | undefined): boolean => row !== undefined && CONDITIONAL_PHASES.includes(row.title) && row.agents.length > 0
  const ordered = rows.filter(row => !isConditional(row))
  for (const row of rows.filter(isConditional)) {
    const from = Math.min(...row.agents.map(agent => agent.startedAt))
    const lastBefore = (other: PhaseRow): number => Math.max(-Infinity, ...other.agents.map(agent => agent.startedAt).filter(start => start <= from))
    const interrupted = ordered.filter(other => !CONDITIONAL_PHASES.includes(other.title)).sort((a, b) => lastBefore(b) - lastBefore(a))[0]
    let at = interrupted === undefined || lastBefore(interrupted) === -Infinity ? ordered.length : ordered.indexOf(interrupted) + 1
    while (isConditional(ordered[at])) at += 1
    ordered.splice(at, 0, row)
  }
  return ordered
}

export type CurrentStep = {
  row: PhaseRow
  index: number
  total: number
  done: number
  running: number
}

export const currentStep = (run: WorkflowRun, rows: PhaseRow[]): CurrentStep | null => {
  if (run.status !== 'running') return null
  const running = rows.map(row => row.mark).lastIndexOf('running')
  const index = running >= 0 ? running : rows.findIndex(row => row.mark === 'pending')
  const row = rows[index]
  if (row === undefined) return null
  const active = row.agents.filter(agent => agent.state === 'running').length
  return { row, index, total: rows.length, done: row.agents.length - active, running: active }
}

export const phaseTypical = (known: PhaseSamples, title: string): number | null => {
  const stats = statsOf(known, title)
  if (stats.spanCount > 0) return stats.span / stats.spanCount
  return stats.count > 0 ? stats.total / stats.count : null
}

export const remainingMs = (run: WorkflowRun, rows: PhaseRow[], known: PhaseSamples): number | null => {
  if (run.status !== 'running') return null
  const groups: PhaseRow[][] = []
  for (const row of rows.filter(one => one.mark === 'running' || (one.mark === 'pending' && !CONDITIONAL_PHASES.includes(one.title)))) {
    const mates = PARALLEL_PHASES.find(group => group.includes(row.title)) ?? []
    const placed = groups.find(group => group.some(other => mates.includes(other.title)))
    if (placed === undefined) groups.push([row])
    else placed.push(row)
  }
  const left = (row: PhaseRow): number | null => {
    const typical = phaseTypical(known, row.title)
    return typical === null ? null : row.mark === 'running' ? Math.max(0, typical - row.span) : typical
  }
  const parts = groups.flatMap(group => {
    const lefts = group.map(left).filter((one): one is number => one !== null)
    return lefts.length === 0 ? [] : [Math.max(...lefts)]
  })
  return parts.length === 0 ? null : parts.reduce((sum, part) => sum + part, 0)
}

export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

export const fit = (text: string, width: number): string =>
  width < 1 ? '' : text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text

export const wrapWords = (text: string, width: number): string[] => {
  if (width < 1) return []
  const lines: string[] = []
  let line = ''
  for (const word of oneLine(text).split(' ').filter(one => one !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`
    if (candidate.length <= width) {
      line = candidate
      continue
    }
    if (line !== '') lines.push(line)
    let rest = word
    while (rest.length > width) {
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    line = rest
  }
  return line === '' ? lines : [...lines, line]
}

export type ReasonLine = { text: string; kind: 'cause' | 'item' | 'context' }

const REASON_CONTEXT_LINES = 2
const REASON_ITEMS = 8
const REASON_CAUSE_LINES = 8
const LIST_ITEM_WORDS = 6

const OPENING = '([{«“'
const CLOSING = ')]}»”'

const topLevelItems = (text: string): string[] => {
  const items: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (char === '"') quoted = !quoted
    else if (OPENING.includes(char)) depth++
    else if (CLOSING.includes(char)) depth = Math.max(0, depth - 1)
    if (depth === 0 && !quoted && char === ',' && text[i + 1] === ' ') {
      items.push(current.trim())
      current = ''
      i++
      continue
    }
    current += char
  }
  return [...items, current.trim()].filter(one => one !== '')
}

const isList = (items: string[]): boolean =>
  items.length >= 2 && items.every(item => item.split(' ').length <= LIST_ITEM_WORDS && !/[.;:]\s/.test(item))

const capped = (lines: string[], max: number, width: number): string[] => {
  if (lines.length <= max) return lines
  const shown = lines.slice(0, max)
  const last = shown[max - 1]!
  shown[max - 1] = `${last.length < width ? last : last.slice(0, width - 1)}…`
  return shown
}

const proseLines = (text: string, width: number): string[] =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .flatMap(sentence => wrapWords(sentence, width))

const itemLines = (item: string, width: number): string[] =>
  wrapWords(item, width - 2).map((text, i) => `${i === 0 ? '• ' : '  '}${text}`)

export const reasonLines = (reason: string, width: number): ReasonLine[] => {
  const segments = oneLine(reason).split(' — ').filter(one => one !== '')
  if (segments.length === 0) return []
  const cause = segments[segments.length - 1]!
  const context = segments.slice(0, -1).join(' — ')
  const listed = /^([^:]{1,80}):\s+(.+)$/.exec(cause)
  const items = listed === null ? [] : topLevelItems(listed[2]!)
  const head: ReasonLine[] = isList(items)
    ? [
        ...wrapWords(`${listed![1]}:`, width).map(text => ({ text, kind: 'cause' as const })),
        ...items.slice(0, REASON_ITEMS).flatMap(item => itemLines(item, width).map(text => ({ text, kind: 'item' as const }))),
        ...(items.length > REASON_ITEMS ? [{ text: `  … ${items.length - REASON_ITEMS} more`, kind: 'item' as const }] : []),
      ]
    : capped(proseLines(cause, width), REASON_CAUSE_LINES, width).map(text => ({ text, kind: 'cause' as const }))
  const shown = capped(wrapWords(context, width), REASON_CONTEXT_LINES, width)
  return [...head, ...shown.map(text => ({ text, kind: 'context' as const }))]
}

export const withoutRepeated = (reason: string, repeated: string[]): string => {
  const quoted = repeated.map(oneLine).filter(one => one !== '')
  return quoted.reduce((text, one) => (text.endsWith(` — ${one}`) ? text.slice(0, -one.length - 3) : text), oneLine(reason))
}

const emptyRun = (runId: string, at: number): WorkflowRun => ({
  runId,
  name: 'workflow',
  argument: null,
  phases: [],
  details: {},
  transcriptDir: null,
  startedAt: at,
  launchedAt: at,
  durationMs: null,
  status: 'running',
  outcome: null,
  audit: null,
  sheet: null,
  agents: [],
  child: null,
  plan: null,
  lots: [],
})

const completeAgent = (agent: WorkflowAgent): WorkflowAgent => ({
  ...agent,
  lastActiveAt: agent.lastActiveAt ?? agent.startedAt,
  openCalls: agent.openCalls ?? 0,
  toolSince: agent.toolSince ?? null,
  waitingSince: agent.waitingSince ?? null,
  firstChunkAt: agent.firstChunkAt ?? null,
  lastChunkAt: agent.lastChunkAt ?? null,
  streamKind: agent.streamKind ?? null,
  streamChars: agent.streamChars ?? 0,
  structured: agent.structured ?? null,
  calls: agent.calls ?? [],
  lot: agent.lot ?? null,
})

const QUIET = { toolSince: null, waitingSince: null, firstChunkAt: null, streamKind: null } as const

export const completeRun = (run: WorkflowRun): WorkflowRun => {
  const outcome = run.outcome as Outcome | string | null | undefined
  return {
    ...emptyRun(run.runId, run.startedAt),
    ...run,
    outcome: typeof outcome === 'string' ? { label: outcome, reason: null, report: null } : (outcome ?? null),
    agents: (run.agents ?? []).map(completeAgent),
    child: run.child ?? null,
    plan: run.plan ?? null,
    lots: run.lots ?? [],
  }
}

const withRun = (list: WorkflowRun[], runId: string, at: number, change: (run: WorkflowRun) => WorkflowRun) => {
  const found = list.find(run => run.runId === runId)
  const changed = change(found === undefined ? emptyRun(runId, at) : completeRun(found))
  const rest = list.filter(run => run.runId !== runId)
  return [...rest, changed].slice(-KEPT_RUNS)
}

const withAgent = (list: WorkflowRun[], agentId: string, change: (agent: WorkflowAgent) => WorkflowAgent) =>
  list.map(run =>
    run.agents.some(agent => agent.id === agentId)
      ? { ...run, agents: run.agents.map(agent => (agent.id === agentId ? change(completeAgent(agent)) : agent)) }
      : run,
  )

const withRequest = (list: WorkflowRun[], agentId: string, used: ModelUsage, effort: string | null, at: number) =>
  withAgent(list, agentId, agent => ({
    ...agent,
    context: promptTokens(used),
    effort: effort ?? agent.effort,
    contextStart: agent.contextStart === 0 ? promptTokens(used) : agent.contextStart,
    contextPeak: Math.max(agent.contextPeak, promptTokens(used)),
    tokens: agent.tokens + promptTokens(used) + used.output_tokens,
    lastActiveAt: at,
  }))

const withInterrupted = (list: WorkflowRun[], runId: string, before: number) =>
  list.map(run =>
    run.runId === runId
      ? { ...run, agents: run.agents.map(agent => (agent.state === 'running' && agent.startedAt < before ? interrupted(agent) : agent)) }
      : run,
  )

const withAudit = (list: WorkflowRun[], agentId: string, audit: AuditVerdict) =>
  list.map(run => {
    const agent = run.agents.find(one => one.id === agentId)
    if (agent === undefined) return run
    const lot = agent.lot ?? null
    return lot === null || !run.child ? { ...run, audit } : { ...run, lots: withLot(run.lots ?? [], lot, one => ({ ...one, audit })) }
  })

const interrupted = (agent: WorkflowAgent): WorkflowAgent => {
  const kept = completeAgent(agent)
  return { ...kept, ...QUIET, state: 'interrupted', endedAt: kept.lastActiveAt, openCalls: 0 }
}

const isFollowed = (list: WorkflowRun[], agentId: string) =>
  list.some(run => run.status === 'running' && run.agents.some(agent => agent.id === agentId))

const SVG_WIDTH = 640
const LABEL_MIN = 40
const LABEL_MAX = 200
const INDENT = 12
const SVG_PAD = 10
const SVG_TOP = 32
const LANE = 16
const BAR = 10
const ROW_PAD = 4
const CHAR_PX = 6.2
const SMALL_PX = 5.6
const AGENT_CHARS = 16
const MIN_BAR = 3
const MIN_HIT = 12
const TICK_GAP = 60
const MARKER_GAP = 60
const TICK_STEPS = [30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000]
const NEUTRAL = '#2a78d6'
const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const
const SVG_STYLE =
  '<style>text{font:11px system-ui,-apple-system,"Segoe UI",sans-serif}text.small{font-size:10px}' +
  '.head{font-weight:600}.ink{fill:#52514e}.muted{fill:#52514e;opacity:.6}.rail{stroke:#e1e0d9}.mark{stroke:#52514e}.idle{fill:#52514e;opacity:.35}.span{fill:#52514e;opacity:.3}' +
  '.ghost{fill:#2a78d6;fill-opacity:.08;stroke:#2a78d6;stroke-opacity:.7;stroke-dasharray:3 2}' +
  '.hit{fill:#52514e;fill-opacity:0}g.bar:hover .hit{fill-opacity:.12}' +
  '.live{animation:live 1.6s ease-in-out infinite}@keyframes live{50%{opacity:.25}}@media (prefers-reduced-motion:reduce){.live{animation:none}}' +
  '@media (prefers-color-scheme: dark){.ink,.muted{fill:#c3c2b7}.rail{stroke:#2c2c2a}.mark{stroke:#c3c2b7}.idle,.hit,.span{fill:#c3c2b7}.ghost{fill-opacity:.14}}</style>'

export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const svgHeight = (source: string): number => Number(/<svg[^>]*\sheight="(\d+)"/.exec(source)?.[1] ?? 0)

export const svgWidth = (source: string): number => Number(/<svg[^>]*\swidth="(\d+)"/.exec(source)?.[1] ?? 0)

const px = (value: number): string => `${Math.round(value * 10) / 10}`

const textWidth = (text: string, size = CHAR_PX): number => [...text].length * size

export const tickLabel = (ms: number): string => {
  if (ms === 0) return '0'
  if (ms < 60_000) return `${ms / 1000}s`
  if (ms < 3_600_000) return `${ms / 60_000}m`
  const minutes = (ms % 3_600_000) / 60_000
  return `${Math.floor(ms / 3_600_000)}h${minutes === 0 ? '' : String(minutes).padStart(2, '0')}`
}

export const tickStep = (span: number, width: number): number => {
  const most = Math.max(1, Math.floor(width / TICK_GAP))
  return TICK_STEPS.find(step => span / step <= most) ?? TICK_STEPS[TICK_STEPS.length - 1] ?? 3_600_000
}

export const lanesOf = (spans: { from: number; to: number }[]): number[] => {
  const ends: number[] = []
  return spans.map(span => {
    const free = ends.findIndex(end => end <= span.from)
    const lane = free < 0 ? ends.length : free
    ends[lane] = span.to
    return lane
  })
}

type BarKind = 'done' | 'live' | 'ghost' | 'idle'

type TimelineBar = { from: number; to: number; tail?: number; fill: string; kind: BarKind; name: string; mark: string; title: string[] }

type TimelineRow = { label: string; level?: 0 | 1; count?: string; span?: { from: number; to: number }; isMuted: boolean; note: string; bars: TimelineBar[] }

type TimelineAxis = { start: number; end: number; now: number | null; eta: number | null; endLabel: string | null }

const cut = (text: string, chars: number): string => ([...text].length > chars ? `${[...text].slice(0, chars - 1).join('')}…` : text)

const LEGEND: [BarKind, string][] = [['done', 'agent'], ['live', 'running'], ['ghost', 'expected']]

const legendSvg = (kinds: Set<BarKind>, y: number, from: number): string => {
  let x = from
  const shown = LEGEND.filter(([kind]) => kinds.has(kind))
  if (shown.length < 2) return ''
  return shown
    .map(([kind, text]) => {
      const swatch =
        kind === 'ghost'
          ? `<rect class="ghost swatch" x="${x}" y="${y - 8}" width="14" height="8" rx="2"/>`
          : `<rect x="${x}" y="${y - 8}" width="14" height="8" rx="2" fill="${NEUTRAL}"/>` +
            (kind === 'live' ? `<rect class="live" x="${x + 12}" y="${y - 10}" width="3" height="12" rx="1.5" fill="${NEUTRAL}"/>` : '')
      const drawn = `${swatch}<text class="ink small" x="${x + 18}" y="${y}">${text}</text>`
      x += 18 + textWidth(text, SMALL_PX) + 16
      return drawn
    })
    .join('')
}

const timelineSvg = (rows: TimelineRow[], axis: TimelineAxis): string => {
  const labelWidth = Math.min(LABEL_MAX, Math.max(LABEL_MIN, ...rows.map(row => (row.level === 1 ? INDENT : 0) + textWidth(`${row.label}${row.count === undefined ? '' : `  ${row.count}`}`))))
  const left = labelWidth + 12
  const labelChars = (row: TimelineRow): number => Math.floor((labelWidth - (row.level === 1 ? INDENT : 0) - (row.count === undefined ? 0 : textWidth(`  ${row.count}`))) / CHAR_PX)
  const right = SVG_WIDTH - SVG_PAD
  const span = Math.max(60_000, axis.end - axis.start)
  const x = (at: number): number => left + ((Math.min(Math.max(at, axis.start), axis.start + span) - axis.start) / span) * (right - left)
  let y = SVG_TOP
  const kinds = new Set<BarKind>()
  const laid = rows.map(row => {
    const placed = row.bars
      .map(bar => {
        kinds.add(bar.kind)
        const from = x(bar.from)
        const width = Math.max(MIN_BAR, x(bar.to) - from)
        const tail = bar.tail === undefined ? 0 : Math.max(0, x(bar.tail) - from - width)
        const text = [bar.name, bar.mark].filter(one => one !== '').join('  ')
        const room = text === '' ? 0 : textWidth(text, SMALL_PX) + 6
        return { bar, from, width, tail, text, room, isAfter: from + width + tail + room <= right }
      })
      .sort((a, b) => a.from - b.from)
    const lanes = lanesOf(placed.map(one => ({ from: one.from - (one.isAfter ? 0 : one.room), to: one.from + one.width + one.tail + (one.isAfter ? one.room : 0) + 4 })))
    const height = Math.max(1, ...lanes.map(lane => lane + 1)) * LANE + 2 * ROW_PAD
    const top = y
    y += height
    return { row, placed, lanes, top, height }
  })
  const bottom = y
  const body: string[] = []
  const step = tickStep(span, right - left)
  for (let offset = 0; offset <= span; offset += step) {
    const at = x(axis.start + offset)
    body.push(`<line class="rail" x1="${px(at)}" y1="${SVG_TOP - 4}" x2="${px(at)}" y2="${bottom}"/>`)
    if (axis.endLabel === null || right - at > 44) body.push(`<text class="ink" x="${px(at)}" y="24" text-anchor="middle">${tickLabel(offset)}</text>`)
  }
  if (axis.endLabel !== null) body.push(`<text class="ink" x="${right}" y="24" text-anchor="end">${escapeXml(axis.endLabel)}</text>`)
  for (const [index, { row, placed, lanes, top, height }] of laid.entries()) {
    const baseline = px(top + ROW_PAD + LANE / 2 + 4)
    if (laid[index + 1]?.row.level !== 1) body.push(`<line class="rail" x1="0" y1="${top + height}" x2="${right}" y2="${top + height}"/>`)
    const isHead = row.level === 0 && rows.some(one => one.level === 1)
    body.push(`<text class="${row.isMuted ? 'muted' : 'ink'}${isHead ? ' head' : ''}" x="${row.level === 1 ? INDENT : 0}" y="${baseline}">${escapeXml(cut(row.label, labelChars(row)))}${row.count === undefined ? '' : `<tspan class="muted" font-weight="400">  ${escapeXml(row.count)}</tspan>`}</text>`)
    if (row.span !== undefined) body.push(`<rect class="span" x="${px(x(row.span.from))}" y="${px(top + ROW_PAD + LANE / 2 - 1)}" width="${px(Math.max(2, x(row.span.to) - x(row.span.from)))}" height="2" rx="1"/>`)
    if (row.note !== '') body.push(`<text class="muted" x="${left + 4}" y="${baseline}">${escapeXml(row.note)}</text>`)
    placed.forEach(({ bar, from, width, tail, text, isAfter }, order) => {
      const laneTop = top + ROW_PAD + (lanes[order] ?? 0) * LANE
      const barTop = laneTop + (LANE - BAR) / 2
      const hit = Math.max(MIN_HIT, width + 6)
      const shape =
        bar.kind === 'ghost'
          ? `<rect class="ghost" x="${px(from)}" y="${px(barTop)}" width="${px(width)}" height="${BAR}" rx="2"/>`
          : bar.kind === 'idle'
            ? `<rect class="idle" x="${px(from)}" y="${px(barTop)}" width="${px(width)}" height="${BAR}" rx="2"/>`
            : (tail > 0 ? `<rect class="ghost" x="${px(from + width - 2)}" y="${px(barTop)}" width="${px(tail + 2)}" height="${BAR}" rx="2"/>` : '') +
              `<rect x="${px(from)}" y="${px(barTop)}" width="${px(width)}" height="${BAR}" rx="2" fill="${bar.fill}"/>` +
              (bar.kind === 'live' ? `<rect class="live" x="${px(from + width - 3)}" y="${px(barTop - 2)}" width="3" height="${BAR + 4}" rx="1.5" fill="${bar.fill}"/>` : '')
      const label =
        text === ''
          ? ''
          : `<text class="${bar.kind === 'ghost' ? 'muted' : 'ink'} small" x="${px(isAfter ? from + width + tail + 5 : from - 5)}" y="${px(barTop + BAR - 1)}"${isAfter ? '' : ' text-anchor="end"'}>${escapeXml(text)}</text>`
      body.push(
        `<g class="bar"><title>${bar.title.map(escapeXml).join('&#10;')}</title>` +
          `<rect class="hit" x="${px(from + width / 2 - hit / 2)}" y="${px(laneTop)}" width="${px(hit)}" height="${LANE}" rx="2"/>${shape}${label}</g>`,
      )
    })
  }
  const markers = [
    ...(axis.now === null ? [] : [{ at: x(axis.now), label: 'now', dash: false }]),
    ...(axis.eta === null ? [] : [{ at: x(axis.eta), label: `ETA ~${coarse(axis.eta - (axis.now ?? axis.start))}`, dash: true }]),
  ]
  markers.forEach((marker, index) => {
    const other = markers[1 - index]
    const isClose = other !== undefined && Math.abs(other.at - marker.at) < MARKER_GAP
    const isLast = marker.at + textWidth(marker.label) / 2 > right
    const anchor = isLast || (isClose && marker.at <= (other?.at ?? 0)) ? 'end' : isClose ? 'start' : 'middle'
    const at = anchor === 'end' ? marker.at - (isClose ? 3 : 0) : anchor === 'start' ? marker.at + 3 : marker.at
    body.push(`<line class="mark" x1="${px(marker.at)}" y1="14" x2="${px(marker.at)}" y2="${bottom}"${marker.dash ? ' stroke-dasharray="3 3"' : ''}/>`)
    body.push(`<text class="ink" x="${px(Math.min(at, right))}" y="10" text-anchor="${anchor}">${escapeXml(marker.label)}</text>`)
  })
  const legend = legendSvg(kinds, bottom + 18, left)
  const height = Math.ceil(bottom + (legend === '' ? 4 : 24))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${height}" viewBox="0 0 ${SVG_WIDTH} ${height}">${SVG_STYLE}${body.join('')}${legend}</svg>`
}

const agentMarks = (agent: WorkflowAgent, attempt: number, stalls: string[]): string[] =>
  [
    attempt > 1 ? `↻ ${attempt}` : '',
    ...stalls,
    agent.state === 'interrupted' ? '⊘ interrupted' : '',
    agent.state === 'error' ? '✗ error' : '',
  ].filter(one => one !== '')

const agentBar = (agent: WorkflowAgent, attempt: number, stalls: string[], at: number): TimelineBar => {
  const marks = agentMarks(agent, attempt, stalls)
  const end = agent.endedAt ?? (agent.state === 'running' ? at : agent.lastActiveAt)
  return {
    from: agent.startedAt,
    to: end,
    fill: agent.state === 'error' ? STATUS.critical : stalls.length > 0 ? STATUS.warning : NEUTRAL,
    kind: agent.state === 'interrupted' ? 'idle' : agent.state === 'running' ? 'live' : 'done',
    name: '',
    mark: marks.join(' '),
    title: [
      agent.label,
      `${modelLabel(agent)} · ${agent.state}`,
      `${duration(end - agent.startedAt)} · ${kilo(agent.tokens)} tok`,
      agent.state === 'running' && agent.lastTool !== null ? `tool ${agent.lastTool} (${agent.tools})` : agent.tools > 0 ? `${agent.tools} tool calls` : '',
      ...marks,
    ].filter(one => one !== ''),
  }
}

const ghostBar = (from: number, to: number, title: string[], mark = ''): TimelineBar => ({ from, to, fill: NEUTRAL, kind: 'ghost', name: '', mark, title })

const stallsOf = (run: WorkflowRun, agent: WorkflowAgent, known: PhaseSamples, at: number): string[] =>
  stallReasons(agent, typicalTools(known, run.agents, agent), at)

const runEndOf = (run: WorkflowRun, at: number): number => (run.status === 'running' ? at : run.startedAt + (run.durationMs ?? at - run.startedAt))

export const expectedPhases = (rows: PhaseRow[], known: PhaseSamples, at: number): Record<string, { from: number; to: number }> => {
  const expected: Record<string, { from: number; to: number }> = {}
  let cursor = at
  for (const row of rows.filter(one => one.mark === 'running')) {
    const typical = phaseTypical(known, row.title)
    if (typical !== null && typical > row.span) {
      expected[row.title] = { from: at, to: at + typical - row.span }
      cursor = Math.max(cursor, at + typical - row.span)
    }
  }
  const pending = rows.filter(one => one.mark === 'pending' && !CONDITIONAL_PHASES.includes(one.title))
  for (let index = 0; index < pending.length; ) {
    const mates = PARALLEL_PHASES.find(group => group.includes(pending[index]?.title ?? '')) ?? []
    const group = [pending[index]!, ...pending.slice(index + 1).filter(one => mates.includes(one.title))]
    let longest = 0
    for (const row of group) {
      const typical = phaseTypical(known, row.title)
      if (typical === null) continue
      expected[row.title] = { from: cursor, to: cursor + typical }
      longest = Math.max(longest, typical)
    }
    cursor += longest
    index += group.length
  }
  return expected
}

const CYCLE_PHASES = INTERLEAVED_PHASES.flat()

const CYCLE_LABEL = new RegExp(`^(?:${CYCLE_PHASES.join('|')}) (\\S+)(?: w\\d+)? (.*?)(?: (?:haiku|sonnet|opus))?$`, 'i')

type TimelineStep = { key: string; name: string; agents: WorkflowAgent[] }

export const stepsOf = (phase: PhaseRow, sheet: Sheet | null): TimelineStep[] => {
  const agents = [...phase.earlier, ...phase.agents].sort((a, b) => a.startedAt - b.startedAt)
  const steps: TimelineStep[] = []
  const stepOf = (key: string, name: string): TimelineStep => {
    const found = steps.find(one => one.key === key)
    if (found !== undefined) return found
    const made = { key, name, agents: [] }
    steps.push(made)
    return made
  }
  const isCycles = CYCLE_PHASES.includes(phase.title) && (sheet?.cycles?.length ?? 0) > 0
  if (isCycles) for (const cycle of sheet?.cycles ?? []) stepOf(cycle.id, `${cycle.id} ${cycle.behaviour}`)
  for (const agent of agents) {
    const cycle = CYCLE_LABEL.exec(agent.label)
    const key = cycle === null ? agent.label : (cycle[1] ?? agent.label)
    const known = sheet?.cycles?.find(one => one.id === key)
    stepOf(key, cycle === null ? agent.label : known === undefined ? `${key} ${cycle[2] ?? ''}`.trim() : `${known.id} ${known.behaviour}`).agents.push(agent)
  }
  return steps
}

export const phaseTimeline = (run: WorkflowRun, at: number, known: PhaseSamples): string => {
  const phases = phaseRows(run, at)
  if (phases.length === 0) return ''
  const remaining = remainingMs(run, phases, known)
  const end = runEndOf(run, at)
  const isRunning = run.status === 'running'
  const expected = isRunning ? expectedPhases(phases, known, at) : {}
  const rows = phases.flatMap((phase): TimelineRow[] => {
    const attempts = attemptsOf(phase.agents)
    const guess = expected[phase.title]
    const isTail = guess !== undefined && phase.mark === 'running'
    const tailed = (bar: TimelineBar): TimelineBar =>
      isTail && bar.kind === 'live' && guess !== undefined ? { ...bar, tail: guess.to, title: [...bar.title, `expected ~${coarse(guess.to - guess.from)} more (typical of the past runs)`] } : bar
    const steps = stepsOf(phase, run.sheet)
    const all = [...phase.earlier, ...phase.agents]
    const done = steps.filter(step => step.agents.some(agent => agent.state === 'done')).length
    const head: TimelineRow = {
      label: phase.title,
      level: 0,
      isMuted: phase.mark === 'pending' && all.length === 0,
      note: '',
      ...(steps.length > 1 ? { count: `${done}/${steps.length}` } : {}),
      bars:
        guess === undefined || isTail
          ? []
          : [ghostBar(guess.from, guess.to, [`${phase.title} · expected`, `~${coarse(guess.to - guess.from)}`, 'typical of the past runs'], `~${coarse(guess.to - guess.from)}`)],
    }
    const only = steps.length === 1 ? steps[0] : undefined
    if (only !== undefined && only.agents.length > 0 && CYCLE_LABEL.exec(only.agents[0]?.label ?? '') === null) {
      const bars = only.agents.map(agent => ({ ...tailed(agentBar(agent, attempts[agent.id] ?? 1, stallsOf(run, agent, known, at), at)), name: cut(only.name, AGENT_CHARS) }))
      return [{ ...head, bars: [...bars, ...head.bars] }]
    }
    const span = all.length === 0 ? {} : { span: { from: Math.min(...all.map(agent => agent.startedAt)), to: Math.max(...all.map(agent => agent.endedAt ?? (agent.state === 'running' ? at : agent.lastActiveAt))) } }
    return [
      { ...head, ...span },
      ...steps.map((step): TimelineRow => ({
        label: step.name,
        level: 1,
        isMuted: step.agents.length === 0,
        note: '',
        bars: step.agents.map(agent => tailed(agentBar(agent, attempts[agent.id] ?? 1, stallsOf(run, agent, known, at), at))),
      })),
    ]
  })
  return timelineSvg(rows, {
    start: run.startedAt,
    end: isRunning && remaining !== null && remaining > 0 ? at + remaining : end,
    now: isRunning ? at : null,
    eta: isRunning && remaining !== null && remaining > 0 ? at + remaining : null,
    endLabel: isRunning ? null : duration(end - run.startedAt),
  })
}

const counted = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

export const phaseTimelineAlt = (run: WorkflowRun, at: number, known: PhaseSamples): string => {
  const phases = phaseRows(run, at)
  const live = run.agents.filter(agent => agent.state !== 'interrupted')
  const attempts = attemptsOf(run.agents)
  const remaining = remainingMs(run, phases, known)
  const lot = lotOf(run.argument)
  const time = run.status === 'running' ? `running for ${duration(at - run.startedAt)}` : `${run.status} in ${duration(runEndOf(run, at) - run.startedAt)}`
  const flags = [
    remaining !== null && remaining > 0 ? `ETA ~${coarse(remaining)}` : '',
    ...([
      [Object.values(attempts).filter(one => one > 1).length, 'retry', 'retries'],
      [run.agents.filter(agent => stallsOf(run, agent, known, at).length > 0).length, 'stall'],
      [run.agents.filter(agent => agent.state === 'interrupted').length, 'interruption'],
      [run.agents.filter(agent => agent.state === 'error').length, 'error'],
    ] as [number, string, string?][]).map(([count, one, many]) => (count > 0 ? counted(count, one, many) : '')),
  ].filter(one => one !== '')
  return `Phase timeline of ${run.name}${lot === null ? '' : ` ${lot.lot}`}: ${[
    time,
    `${phases.filter(phase => phase.mark === 'done').length} of ${phases.length} phases reached`,
    counted(live.length, 'agent'),
    ...flags,
  ].join(', ')}.`
}

const LOT_MARKS: Record<LotState, string> = {
  running: '● running', completed: '✓ done', done: '✓ done', failed: '✗ failed', killed: '⏹ stopped', waiting: '? question', pending: '⧗ pending',
}

const lotFill = (state: LotState): string =>
  state === 'completed' || state === 'done' ? STATUS.good : state === 'failed' ? STATUS.critical : state === 'killed' ? STATUS.serious : state === 'waiting' ? STATUS.warning : NEUTRAL

const lotNote = (entry: PlanLot, state: LotState): string =>
  state === 'pending' ? (entry.deps.length > 0 ? `⧗ after ${entry.deps.join(', ')}` : '⧗ pending') : state === 'done' ? '✓ done before this run' : LOT_MARKS[state]

export const planTimeline = (run: WorkflowRun, at: number): string => {
  if (run.lots.length === 0) return ''
  const isRunning = run.status === 'running'
  const spans = run.lots.map(entry => {
    const state = lotStateOf(run, entry)
    const agents = run.agents.filter(agent => agent.lot === entry.lot)
    if (agents.length === 0) return { entry, state, agents, view: null, from: 0, to: 0 }
    const view = lotRun(run, entry.lot)
    return { entry, state, agents, view, from: view.startedAt, to: view.status === 'running' ? at : view.startedAt + (view.durationMs ?? 0) }
  })
  const finished = spans.filter(one => one.view !== null && (one.state === 'completed' || one.state === 'done'))
  const typical = finished.length === 0 ? null : finished.reduce((sum, one) => sum + (one.to - one.from), 0) / finished.length
  const ends: Record<string, number> = {}
  for (const one of spans) if (one.view !== null) ends[one.entry.lot] = one.state === 'running' && typical !== null ? Math.max(at, one.from + typical) : one.to
  const guesses: Record<string, { from: number; to: number }> = {}
  if (isRunning && typical !== null) {
    for (const one of spans.filter(span => span.view === null && span.state === 'pending')) {
      const from = Math.max(at, ...one.entry.deps.map(dep => ends[dep] ?? at))
      guesses[one.entry.lot] = { from, to: from + typical }
      ends[one.entry.lot] = from + typical
    }
  }
  const lots: TimelineRow[] = spans.map(({ entry, state, agents, view, from, to }) => {
    const guess = guesses[entry.lot]
    const label = entry.view === null || entry.view.name === '' ? entry.lot : `${entry.lot} ${entry.view.name}`
    if (view === null) {
      return {
        label,
        isMuted: state === 'pending',
        note: guess === undefined ? lotNote(entry, state) : '',
        bars:
          guess === undefined
            ? []
            : [ghostBar(guess.from, guess.to, [`${entry.lot} · expected`, `~${coarse(typical ?? 0)}, typical of this plan's batches`, entry.deps.length > 0 ? `after ${entry.deps.join(', ')}` : ''].filter(one => one !== ''), lotNote(entry, state))],
      }
    }
    const active = [...agents].filter(agent => agent.state === 'running').sort((a, b) => b.index - a.index)[0]
    const mark = state === 'running' && active !== undefined ? `${LOT_MARKS.running} · ${active.phase ?? NO_PHASE}` : state === 'failed' && entry.outcome !== null ? `✗ ${entry.outcome.label}` : LOT_MARKS[state]
    const tail = state === 'running' && typical !== null && from + typical > at ? from + typical : undefined
    return {
      label,
      isMuted: false,
      note: '',
      bars: [
        {
          from,
          to,
          fill: lotFill(state),
          kind: state === 'running' ? 'live' : 'done',
          ...(tail === undefined ? {} : { tail }),
          name: '',
          mark,
          title: [
            [entry.lot, entry.view?.name ?? ''].filter(one => one !== '').join(' · '),
            `${state === 'completed' ? 'done' : state} · ${counted(agents.length, 'agent')} · ${duration(to - from)} · ${kilo(totalsOf(agents).tokens)} tok`,
            active === undefined ? '' : `now: ${active.label}${active.lastTool === null ? '' : ` · ${active.lastTool} (${active.tools})`}`,
            entry.audit === null ? '' : `audit ${auditLabel(entry.audit)}`,
          ].filter(one => one !== ''),
        },
      ],
    }
  })
  const supervisors = run.agents.filter(agent => agent.lot === null)
  const rows: TimelineRow[] =
    supervisors.length === 0
      ? lots
      : [...lots, { label: 'Supervisor', isMuted: false, note: '', bars: supervisors.map(agent => agentBar(agent, 1, [], at)) }]
  const end = runEndOf(run, at)
  const eta = isRunning ? Math.max(at, ...Object.values(ends)) : null
  return timelineSvg(rows, {
    start: run.startedAt,
    end: eta !== null && eta > at ? eta : end,
    now: isRunning ? at : null,
    eta: eta !== null && eta > at ? eta : null,
    endLabel: isRunning ? null : duration(end - run.startedAt),
  })
}

const listed = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`

export const planTimelineAlt = (run: WorkflowRun, at: number): string => {
  const states = run.lots.map(entry => ({ lot: entry.lot, state: lotStateOf(run, entry) }))
  const of = (...wanted: LotState[]) => states.filter(one => wanted.includes(one.state)).map(one => one.lot)
  const parts = [
    `${of('completed', 'done').length} of ${states.length} batches done`,
    ...([
      [of('running'), 'running'],
      [of('waiting'), 'waiting for an answer'],
      [of('failed'), 'failed'],
      [of('killed'), 'stopped'],
      [of('pending'), 'pending'],
    ] as [string[], string][]).flatMap(([lots, label]) => (lots.length === 0 ? [] : [`${listed(lots)} ${label}`])),
    run.status === 'running' ? `${duration(at - run.startedAt)} elapsed` : `${run.status} in ${duration(runEndOf(run, at) - run.startedAt)}`,
  ]
  return `Batch timeline of ${run.name}: ${parts.join(', ')}.`
}

// What the run files say beside the agents: the workflow's and its scripts' lines of
// `run/.work.jsonl`, the user's answers of `run/.pane.jsonl` (written by this mod alone, whole),
// the `## To validate` sections of the reports. Every view below reads them, never a copy of its own.
type Fields = Record<string, unknown>

const recordsOf = (lines: WorkLine[]): Fields[] => lines as Fields[]

export const paneFileOf = (root: string): string => `${root}/${PANE_FILE}`

export const runRootOfRun = (run: WorkflowRun): string | null => {
  const sheet = run.plan ?? sheetPathOf(run.argument)
  return sheet === null ? null : runRootOf(sheet)
}

export const questionBanner = (questions: PendingQuestion[], at: number): string | null => {
  const first = questions.filter(one => one.endsAt > at).sort((a, b) => a.endsAt - b.endsAt)[0]
  return first === undefined ? null : `? ${first.batch} — ${counted(first.count, 'question')} — recommendation applied in ${clockOf(first.endsAt - at)}`
}

export type Contest = { gap: string; harm: string; answer: string | null; text: string | null }

export type AuditRound = { round: number; open: number; after: number | null; files: number; contested: Contest[]; diverged: boolean }

const gapKey = (text: string): string => text.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

const isSameGap = (a: string, b: string): boolean => {
  const x = gapKey(a)
  const y = gapKey(b)
  return x !== '' && y !== '' && (x === y || x.startsWith(y.slice(0, 60)) || y.startsWith(x.slice(0, 60)))
}

// The last line of a (batch, round) wins: the fix writes it, the resume audit adds `after`.
export const auditRoundsOf = (lines: WorkLine[], batch: string): AuditRound[] => {
  const last = new Map<number, Fields>()
  for (const line of recordsOf(lines)) {
    const round = numberOf(line.round)
    if (line.kind === 'audit-round' && line.batch === batch && round !== null) last.set(round, line)
  }
  return [...last.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, line]) => {
      const responses = (Array.isArray(line.responses) ? (line.responses as unknown[]) : []).flatMap(one => (fieldsOf(one) === null ? [] : [fieldsOf(one)!]))
      const contested = (Array.isArray(line.contested) ? (line.contested as unknown[]) : []).flatMap((one): Contest[] => {
        const fields = fieldsOf(one)
        const gap = textOf(fields?.gap)
        if (gap === null) return []
        const response = responses.find(other => isSameGap(textOf(other.gap) ?? '', gap))
        return [{ gap, harm: textOf(fields?.harm) ?? '', answer: textOf(response?.answer), text: textOf(response?.text) }]
      })
      const files = Array.isArray(line.files) ? line.files.length : (numberOf(line.files) ?? 0)
      return { round, open: numberOf(line.open) ?? 0, after: numberOf(line.after), files, contested, diverged: line.diverged === true }
    })
}

export const roundLine = (round: AuditRound): string =>
  `R${round.round} findings ${round.open}${round.after === null ? '' : ` → ${round.after}`} · files ${round.files}${round.diverged ? ' · diverging, rounds stopped' : ''}`

export const contestLine = (contest: Contest): string =>
  `contested: ${contest.gap} — harm: ${contest.harm} → ${contest.answer === null ? 'no response' : `${contest.answer}${contest.text === null ? '' : `: ${contest.text}`}`}`

export type Attempt = { step: string; n: number; reason: string }

export const attemptLinesOf = (lines: WorkLine[], batch: string): Attempt[] =>
  recordsOf(lines).flatMap(line => {
    const step = textOf(line.step)
    const n = numberOf(line.n)
    return line.kind === 'attempt' && line.batch === batch && step !== null && n !== null ? [{ step, n, reason: textOf(line.reason) ?? '—' }] : []
  })

const bare = (text: string): string => text.replace(/…$/, '').trim().toLowerCase()

// An attempt names its step `RED <behaviour ≤60…>`, an agent its cycle `RED <id> w<wave> <behaviour ≤40…>`:
// the two behaviours, cut differently, meet on their common start. Other steps name the agent's label
// (`Design`, `Declaratives`) or its phase (`Global green`, `Closing`).
export const isAttemptOf = (step: string, agent: WorkflowAgent): boolean => {
  const cycle = /^(RED|GREEN) (.+)$/.exec(step)
  const label = CYCLE_LABEL.exec(agent.label)
  if (cycle === null) return label === null && (agent.label.toLowerCase() === step.toLowerCase() || (STEP_PHASES.includes(step) && agent.phase === step))
  if (label === null || !agent.label.toUpperCase().startsWith(`${cycle[1]} `)) return false
  const wanted = bare(cycle[2] ?? '')
  const named = bare(label[2] ?? '')
  return wanted !== '' && named !== '' && (wanted.startsWith(named) || named.startsWith(wanted))
}

export type Retry = { attempt: number; reasons: string[] }

// Attempt n carries why attempt n-1 was rejected: the k-th agent of a step lists the reasons of 2..k.
export const retryOf = (agents: WorkflowAgent[], agent: WorkflowAgent, attempts: Attempt[]): Retry | null => {
  const mine = attempts.filter(one => isAttemptOf(one.step, agent))
  if (mine.length === 0 || agent.state === 'interrupted') return null
  const peers = agents
    .filter(other => other.state !== 'interrupted' && mine.some(one => isAttemptOf(one.step, other)))
    .sort((a, b) => a.startedAt - b.startedAt || a.index - b.index)
  const attempt = peers.indexOf(agent) + 1
  const reasons = mine.filter(one => one.n <= attempt).sort((a, b) => a.n - b.n).map(one => one.reason)
  return attempt < 2 || reasons.length === 0 ? null : { attempt, reasons }
}

export type Breaker = { asides: string[]; cause: string }

export const breakerOf = (lines: WorkLine[]): Breaker | null => {
  const last = recordsOf(lines).filter(line => line.kind === 'breaker' && line.decision === 'stop').pop()
  if (last === undefined) return null
  return { asides: Array.isArray(last.asides) ? last.asides.map(String) : [], cause: textOf(last.cause) ?? '' }
}

export type Aside = { reason: string; patch: string | null }

export const asidesOf = (lines: WorkLine[]): Record<string, Aside> => {
  const found: Record<string, Aside> = {}
  for (const line of recordsOf(lines)) {
    const set = line.kind === 'journal' ? ASIDE_LINE.exec(textOf(line.text) ?? '') : null
    if (set?.[1] !== undefined) found[set[1]] = { reason: set[2] ?? '', patch: set[3] ?? null }
    if (line.kind === 'breaker' && Array.isArray(line.asides)) for (const lot of line.asides.map(String)) found[lot] = found[lot] ?? { reason: '', patch: null }
  }
  return found
}

export const paneLinesOf = (text: string): Fields[] =>
  recordsOf(workLinesOf(text)).filter(line => line.kind === 'pause' || line.kind === 'note' || line.kind === 'validation')

const acksOf = (work: WorkLine[]): Fields[] => recordsOf(work).filter(line => line.kind === 'ack')

export type PauseState = 'off' | 'requested' | 'spent'

// The last pause line wins; an `ack` of ref `pause` written after it says run-plan paused on it.
export const pauseStateOf = (pane: Fields[], work: WorkLine[]): PauseState => {
  const last = pane.filter(line => line.kind === 'pause').pop()
  if (last === undefined || last.on !== true) return 'off'
  const at = numberOf(last.at) ?? 0
  return acksOf(work).some(ack => ack.ref === 'pause' && (numberOf(ack.at) ?? 0) > at) ? 'spent' : 'requested'
}

export type Note = { id: string; batch: string; text: string; at: number; isTaken: boolean }

export const notesOf = (pane: Fields[], work: WorkLine[]): Note[] => {
  const taken = new Set(acksOf(work).flatMap(ack => (ack.what === 'note-taken' ? [String(ack.ref)] : [])))
  const last = new Map<string, Fields>()
  for (const line of pane) if (line.kind === 'note' && textOf(line.id) !== null) last.set(String(line.id), line)
  return [...last.values()].map(line => ({
    id: String(line.id), batch: String(line.batch ?? ''), text: textOf(line.text) ?? '', at: numberOf(line.at) ?? 0, isTaken: taken.has(String(line.id)),
  }))
}

export type Decision = 'keep' | 'reject' | 'amend'

export type Answer = { decision: Decision; text: string; at: number; applied: { relaunch: string | null } | null }

const DECISIONS: Decision[] = ['keep', 'reject', 'amend']

// The last validation line of an id wins; an `ack` of what `applied`, at or after it, applied it.
export const answersOf = (pane: Fields[], work: WorkLine[]): Record<string, Answer> => {
  const acks = acksOf(work).filter(ack => ack.what === 'applied')
  const answers: Record<string, Answer> = {}
  for (const line of pane) {
    const decision = DECISIONS.find(one => one === line.decision)
    if (line.kind !== 'validation' || textOf(line.id) === null || decision === undefined) continue
    const at = numberOf(line.at) ?? 0
    const ack = acks.filter(one => one.ref === line.id && (numberOf(one.at) ?? 0) >= at).pop()
    answers[String(line.id)] = { decision, text: textOf(line.text) ?? '', at, applied: ack === undefined ? null : { relaunch: textOf(ack.relaunch) } }
  }
  return answers
}

export type ValidateEntry = { id: string; batch: string; step: string; text: string; why: string | null; section: string | null; sheet: string | null }

export const shortHash = (text: string): string => {
  let hash = 0x811c9dc5
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

export const entryIdOf = (batch: string, step: string, text: string): string => `v-${shortHash(`${batch}|${step}|${text}`)}`

const sectionOf = (text: string, heading: string): string[] => {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim().startsWith(heading))
  if (start < 0) return []
  const end = lines.findIndex((line, at) => at > start && line.startsWith('## '))
  return lines.slice(start, end < 0 ? undefined : end)
}

// The sections the views read, all a report's state needs to keep.
export const keptSections = (text: string): string => KEPT_SECTIONS.map(heading => sectionOf(text, heading).join('\n')).filter(one => one !== '').join('\n\n')

// A batch report's bullets read `- <step> — <text> (<why>)`; the run report's, one `###` per kind,
// start with their batch.
export const toValidateOf = (text: string, batch: string | null, sheetOf: (batch: string) => string | null = () => null): ValidateEntry[] => {
  let section: string | null = null
  return sectionOf(text, '## To validate')
    .slice(1)
    .flatMap(line => {
      const heading = /^###\s+(.+)$/.exec(line)
      if (heading !== null) section = heading[1]?.trim() ?? null
      const bullet = /^[-*]\s+(.+)$/.exec(line)?.[1]?.trim()
      if (bullet === undefined || /^(None|Aucun)\b/i.test(bullet)) return []
      const prefixed = batch === null ? /^(F\d+)\b\s*(?:[—:–-]\s*)?(.*)$/.exec(bullet) : null
      const owner = batch ?? prefixed?.[1] ?? ''
      const rest = prefixed?.[2] ?? bullet
      const split = rest.indexOf(' — ')
      const step = split < 0 ? (section ?? 'Entry') : rest.slice(0, split).trim()
      const body = split < 0 ? rest : rest.slice(split + 3).trim()
      const why = /\s\(([^()]+)\)$/.exec(body)
      const said = why === null ? body : body.slice(0, why.index).trim()
      return [{ id: entryIdOf(owner, step, said), batch: owner, step, text: said, why: why?.[1] ?? null, section, sheet: owner === '' ? null : sheetOf(owner) }]
    })
}

export const reportLotOf = (path: string): string | null => /\/(F\d+)(?:-[\w]+)?\.md$/.exec(path)?.[1] ?? null

export type FeedView = {
  work: WorkLine[]
  pane: Fields[]
  questions: PendingQuestion[]
  breaker: Breaker | null
  asides: Record<string, Aside>
  pause: PauseState
  notes: Note[]
  answers: Record<string, Answer>
}

export const feedViewOf = (feed: RunFeed | null): FeedView => {
  const work = workLinesOf(feed?.work ?? '')
  const pane = paneLinesOf(feed?.pane ?? '')
  return {
    work, pane, questions: openQuestionsOf(work), breaker: breakerOf(work), asides: asidesOf(work),
    pause: pauseStateOf(pane, work), notes: notesOf(pane, work), answers: answersOf(pane, work),
  }
}

// The entries to validate: the reports' bullets first, then what the run files say before a report
// does (a divergence, a batch set aside, the breaker's stop), and the notes the run took.
export const validateEntriesOf = (feed: RunFeed | null, sheetOf: (batch: string) => string | null, lots: string[]): ValidateEntry[] => {
  if (feed === null) return []
  const view = feedViewOf(feed)
  const reported = Object.entries(feed.reports).flatMap(([path, text]) => toValidateOf(text, reportLotOf(path), sheetOf))
  const says = (batch: string | null, pattern: RegExp) =>
    reported.some(one => (batch === null || one.batch === batch) && (pattern.test(one.text) || pattern.test(one.section ?? '') || pattern.test(one.step)))
  const derived = (batch: string, step: string, text: string): ValidateEntry => ({ id: entryIdOf(batch, step, text), batch, step, text, why: null, section: null, sheet: sheetOf(batch) })
  const diverging = lots.flatMap(lot =>
    says(lot, /diverging/i) ? [] : auditRoundsOf(view.work, lot).filter(one => one.diverged).map(one => derived(lot, 'Audit', `round ${one.round} diverging: findings ${one.open}${one.after === null ? '' : ` → ${one.after}`}, files ${one.files} — rounds stopped`)),
  )
  const asides = Object.entries(view.asides).flatMap(([lot, aside]) =>
    says(lot, /set aside/i) || aside.reason === '' ? [] : [derived(lot, 'Set aside', `${aside.reason}${aside.patch === null ? '' : ` — patch ${aside.patch}`}`)],
  )
  const breaker = view.breaker
  const stopped = breaker === null || says(null, /common cause/i) ? [] : [derived(breaker.asides[breaker.asides.length - 1] ?? '', 'Plan stopped', `common cause across ${breaker.asides.join(', ')}: ${breaker.cause}`)]
  const notes = view.notes.filter(one => one.isTaken).map(one => ({ ...derived(one.batch, 'Note', one.text), id: `v-${one.id}` }))
  const all = [...reported, ...diverging, ...asides, ...stopped, ...notes]
  return all.filter((one, index) => all.findIndex(other => other.id === one.id) === index)
}

export const withPaneLine = (text: string, record: Fields): string => {
  const kept = text.replace(/\s+$/, '')
  return `${kept === '' ? '' : `${kept}\n`}${JSON.stringify(record)}\n`
}

export type GraphState = 'done' | 'running' | 'waiting' | 'question' | 'aside' | 'blocked' | 'failed'

export type GraphNode = { lot: string; name: string; deps: string[]; state: GraphState; layer: number; hover: string[] }

const GRAPH_WORDS: Record<GraphState, string> = {
  done: 'done', running: 'running', waiting: 'waiting', question: 'question', aside: 'set aside', blocked: 'blocked', failed: 'failed',
}

export const graphGlyph = (state: GraphState): string =>
  state === 'done' ? '✓' : state === 'running' ? '●' : state === 'waiting' ? '○' : state === 'question' ? '?' : state === 'blocked' ? '⊘' : '✗'

const graphFill = (state: GraphState): string =>
  state === 'done' ? STATUS.good : state === 'running' ? NEUTRAL : state === 'question' ? STATUS.warning : state === 'blocked' ? STATUS.serious : state === 'waiting' ? '#8c8b85' : STATUS.critical

// One node per batch of the plan table, placed one column past its deepest dependency.
export const graphNodesOf = (run: WorkflowRun, view: FeedView, at: number): GraphNode[] => {
  const known = new Set(run.lots.map(entry => entry.lot))
  const base: Record<string, GraphState> = {}
  for (const entry of run.lots) {
    const state = lotStateOf(run, entry)
    const isBlockedOutcome = entry.outcome !== null && ['BLOQUÉ', 'BLOCKED'].includes(entry.outcome.label)
    base[entry.lot] =
      entry.lot in view.asides || (run.child !== null && isBlockedOutcome && state !== 'running')
        ? 'aside'
        : state === 'completed' || state === 'done' ? 'done' : state === 'running' ? 'running' : state === 'waiting' ? 'question' : state === 'pending' ? 'waiting' : 'failed'
  }
  const asideAbove = (lot: string, seen: Set<string> = new Set()): string | null => {
    for (const dep of run.lots.find(entry => entry.lot === lot)?.deps ?? []) {
      if (!known.has(dep) || seen.has(dep)) continue
      seen.add(dep)
      if (base[dep] === 'aside') return dep
      const higher = asideAbove(dep, seen)
      if (higher !== null) return higher
    }
    return null
  }
  const layers: Record<string, number> = {}
  const layerOf = (lot: string, path: string[] = []): number => {
    if (layers[lot] !== undefined) return layers[lot]!
    const deps = (run.lots.find(entry => entry.lot === lot)?.deps ?? []).filter(dep => known.has(dep) && !path.includes(dep))
    const layer = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(dep => layerOf(dep, [...path, lot])))
    layers[lot] = layer
    return layer
  }
  const asideReason = (lot: string): string => {
    const reason = view.asides[lot]?.reason || run.lots.find(entry => entry.lot === lot)?.outcome?.reason || ''
    return reason === '' ? '' : ` — ${reason}`
  }
  return run.lots.map(entry => {
    const blocker = base[entry.lot] === 'waiting' ? asideAbove(entry.lot) : null
    const state: GraphState = blocker !== null ? 'blocked' : (base[entry.lot] ?? 'waiting')
    const deps = entry.deps.filter(dep => known.has(dep))
    const agents = run.agents.filter(agent => agent.lot === entry.lot)
    const span = agents.length > 0 ? lotRun(run, entry.lot) : null
    const name = entry.view?.name || entry.title || ''
    const open = deps.filter(dep => base[dep] !== 'done')
    const said =
      state === 'blocked' && blocker !== null
        ? `blocked: ${blocker} set aside${asideReason(blocker)}`
        : state === 'waiting'
          ? open.length > 0 ? `waiting on ${open.map(dep => `${dep} (${GRAPH_WORDS[base[dep] ?? 'waiting']})`).join(', ')}` : 'waiting to start'
          : state === 'aside'
            ? `set aside${asideReason(entry.lot)}`
            : state === 'done' && agents.length === 0 ? 'done before this run' : lotDetailOf(run, entry, lotStateOf(run, entry), at)
    const figures =
      span !== null
        ? `${duration(span.durationMs ?? at - span.startedAt)} · ${kilo(totalsOf(agents).tokens)} tok`
        : entry.past ? `${duration(entry.past.durationMs)} · ${kilo(entry.past.tokens)} tok` : ''
    return {
      lot: entry.lot, name, deps, state, layer: layerOf(entry.lot),
      hover: [[entry.lot, name].filter(one => one !== '').join(' · '), said, figures].filter(one => one !== ''),
    }
  })
}

// Edges out of a batch set aside, or out of one it blocks, are drawn red and dashed.
const isCutEdge = (from: GraphNode | undefined): boolean => from !== undefined && (from.state === 'aside' || from.state === 'blocked')

export type TreeLine = { lot: string; prefix: string; text: string; state: GraphState }

// The terminal's light tree: each batch under its first dependency, met again further down as `↑`.
export const graphTreeLines = (nodes: GraphNode[]): TreeLine[] => {
  const lines: TreeLine[] = []
  const shown = new Set<string>()
  const childrenOf = (lot: string) => nodes.filter(node => node.deps[0] === lot)
  const extraOf = (node: GraphNode, parent: string | null) => node.deps.filter(dep => dep !== parent)
  const walk = (node: GraphNode, parent: string | null, lead: string, isLast: boolean, isRoot: boolean) => {
    const branch = isRoot ? '' : isLast ? '└─ ' : '├─ '
    const extra = extraOf(node, parent)
    const status = node.hover[1] ?? GRAPH_WORDS[node.state]
    if (shown.has(node.lot)) {
      lines.push({ lot: node.lot, prefix: `${lead}${branch}`, text: `${node.lot} ↑`, state: node.state })
      return
    }
    shown.add(node.lot)
    lines.push({
      lot: node.lot, prefix: `${lead}${branch}`,
      text: `${graphGlyph(node.state)} ${node.lot}${node.name === '' ? '' : ` ${node.name}`} · ${status}${parent !== null && extra.length > 0 ? ` · also after ${extra.join(', ')}` : ''}`,
      state: node.state,
    })
    const children = childrenOf(node.lot)
    children.forEach((child, index) => walk(child, node.lot, `${lead}${isRoot ? '' : isLast ? '   ' : '│  '}`, index === children.length - 1, false))
  }
  for (const root of nodes.filter(node => node.deps.length === 0)) walk(root, null, '', true, true)
  for (const node of nodes.filter(one => !shown.has(one.lot))) walk(node, null, '', true, true)
  return lines
}

const NODE_WIDTH = 132
const NODE_HEIGHT = 36
const LAYER_GAP = 48
const NODE_GAP = 14
const GRAPH_STYLE =
  '<style>text{font:11px system-ui,-apple-system,"Segoe UI",sans-serif}text.small{font-size:10px}.head{font-weight:600}' +
  '.ink{fill:#52514e}.muted{fill:#52514e;opacity:.7}.edge{stroke:#52514e;stroke-opacity:.45;fill:none}.arrow{fill:#52514e;fill-opacity:.45}' +
  'g.node:hover rect.box{stroke-width:2}.live{animation:live 1.6s ease-in-out infinite}@keyframes live{50%{opacity:.35}}' +
  '@media (prefers-reduced-motion:reduce){.live{animation:none}}' +
  '@media (prefers-color-scheme: dark){.ink,.muted{fill:#c3c2b7}.edge{stroke:#c3c2b7}.arrow{fill:#c3c2b7}}</style>'

export const planGraph = (nodes: GraphNode[]): string => {
  if (nodes.length === 0) return ''
  const columns = Math.max(...nodes.map(node => node.layer)) + 1
  const width = NODE_WIDTH
  const rows: Record<number, number> = {}
  const placed = nodes.map(node => {
    const row = rows[node.layer] ?? 0
    rows[node.layer] = row + 1
    return { node, x: SVG_PAD + node.layer * (width + LAYER_GAP), y: SVG_TOP + row * (NODE_HEIGHT + NODE_GAP) }
  })
  const at = (lot: string) => placed.find(one => one.node.lot === lot)
  const body: string[] = []
  for (const { node, x, y } of placed) {
    for (const dep of node.deps) {
      const from = at(dep)
      if (from === undefined) continue
      const x1 = from.x + width
      const y1 = from.y + NODE_HEIGHT / 2
      const x2 = x - 4
      const y2 = y + NODE_HEIGHT / 2
      const mid = (x1 + x2) / 2
      const isCut = isCutEdge(from.node)
      const stroke = isCut ? ` stroke="${STATUS.critical}" stroke-opacity="1" stroke-dasharray="4 3"` : ''
      body.push(
        `<g class="edge-of-${escapeXml(dep)}-${escapeXml(node.lot)}"><title>${escapeXml(`${dep} → ${node.lot}${isCut ? ` · held back: ${dep} ${GRAPH_WORDS[from.node.state]}` : ''}`)}</title>` +
          `<path class="edge${isCut ? ' cut' : ''}" d="M${px(x1)} ${px(y1)} C${px(mid)} ${px(y1)} ${px(mid)} ${px(y2)} ${px(x2)} ${px(y2)}"${stroke}/>` +
          `<path class="arrow" d="M${px(x2)} ${px(y2 - 4)} L${px(x2 + 4)} ${px(y2)} L${px(x2)} ${px(y2 + 4)} Z"${isCut ? ` fill="${STATUS.critical}" fill-opacity="1"` : ''}/></g>`,
      )
    }
  }
  for (const { node, x, y } of placed) {
    const fill = graphFill(node.state)
    const chars = Math.floor((width - 16) / SMALL_PX)
    body.push(
      `<g class="node"><title>${node.hover.map(escapeXml).join('&#10;')}</title>` +
        `<rect class="box${node.state === 'running' ? ' live' : ''}" x="${px(x)}" y="${px(y)}" width="${px(width)}" height="${NODE_HEIGHT}" rx="6" fill="${fill}" fill-opacity=".14" stroke="${fill}"${node.state === 'blocked' ? ' stroke-dasharray="4 3"' : ''}/>` +
        `<text class="ink head" x="${px(x + 8)}" y="${px(y + 14)}">${escapeXml(`${graphGlyph(node.state)} ${node.lot}`)}<tspan class="muted" font-weight="400">  ${escapeXml(GRAPH_WORDS[node.state])}</tspan></text>` +
        `<text class="muted small" x="${px(x + 8)}" y="${px(y + 28)}">${escapeXml(cut(node.name || '—', chars))}</text></g>`,
    )
  }
  const states = (Object.keys(GRAPH_WORDS) as GraphState[]).filter(state => nodes.some(node => node.state === state))
  const height = SVG_TOP + Math.max(...Object.values(rows)) * (NODE_HEIGHT + NODE_GAP) + 8
  let lx = SVG_PAD
  const legend = states
    .map(state => {
      const drawn = `<rect x="${lx}" y="10" width="14" height="10" rx="3" fill="${graphFill(state)}" fill-opacity=".14" stroke="${graphFill(state)}"/><text class="ink small" x="${lx + 18}" y="19">${GRAPH_WORDS[state]}</text>`
      lx += 18 + textWidth(GRAPH_WORDS[state], SMALL_PX) + 14
      return drawn
    })
    .join('')
  const svgWidthPx = Math.ceil(Math.max(lx, SVG_PAD * 2 + columns * width + (columns - 1) * LAYER_GAP))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidthPx}" height="${Math.ceil(height)}" viewBox="0 0 ${svgWidthPx} ${Math.ceil(height)}">${GRAPH_STYLE}${legend}${body.join('')}</svg>`
}

export const planGraphAlt = (nodes: GraphNode[]): string =>
  `Batch graph: ${nodes.map(node => `${node.lot} ${GRAPH_WORDS[node.state]}${node.deps.length > 0 ? ` after ${node.deps.join(', ')}` : ''}`).join('; ')}.`

const DEMO = 'demo-'

type DemoLive = Pick<WorkflowAgent, 'openCalls' | 'toolSince' | 'waitingSince' | 'firstChunkAt' | 'lastChunkAt' | 'streamKind' | 'streamChars'>

type DemoAgentOptions = { type?: string; lastTool?: string; tools?: number; answer?: string; activeAt?: number; lot?: string | null; live?: Partial<DemoLive> }

const demoAgent = (
  id: string, index: number, label: string, phase: string, from: number, to: number | null,
  state: WorkflowAgent['state'], model = 'Sonnet', options: DemoAgentOptions = {},
): WorkflowAgent => ({
  id: `${DEMO}${id}`, index, label, phase, model, effort: 'high', type: options.type ?? 'tdd-test-author', startedAt: from, endedAt: to,
  lastActiveAt: options.activeAt ?? to ?? from, openCalls: 0, ...QUIET, lastChunkAt: null, streamChars: 0, state, lot: options.lot === undefined ? 'F4' : options.lot,
  lastTool: options.lastTool ?? null, tools: options.tools ?? (state === 'running' ? 0 : 10 + index),
  context: 18_000 + index * 3_000, contextStart: 11_000, contextPeak: 18_000 + index * 3_000,
  tokens: 120_000 + index * 30_000,
  prompt: options.lot === null ? `Workflow run-plan, supervisor step. ${label}.` : `Workflow run-lot, batch ${options.lot ?? 'F4'}. ${label}.`,
  answer: state === 'running' || state === 'error' || state === 'interrupted' ? null : (options.answer ?? `${label}: done, tests green.`),
  toolCounts: { Read: 4 + index, Bash: index, Edit: index > 3 ? 3 : 0, Grep: 2 },
  files: index > 3 ? ['src/Acme.Application/Catalog/Products/CreateProduct/CreateProductCommandHandler.cs'] : [],
  lastError: state === 'error' ? 'Bash · Run the unit tests: exit 1 · Failed: 2, Passed: 41' : null,
  structured: state === 'done' && (options.type ?? '').includes('auditor') ? DEMO_VERDICT : null,
  calls: demoCalls(`${DEMO}${id}`, index, from, to, state),
  ...options.live,
})

const DEMO_VERDICT = structuredLines({
  verdict: 'ECARTS',
  gaps: [
    { severity: 'Blocking', axis: 'Correctness', gap: 'organization lock not checked before deletion', evidence: 'DeleteProductCommandHandler.cs:41' },
    { severity: 'Minor', axis: 'Simplification', gap: 'duplicated guard in the aggregate', evidence: 'Product.cs:88' },
  ],
})

const DEMO_STEPS: [string, string][] = [
  ['Read', 'todo/catalog-lifecycle/CAT-CYCLE-PLAN-F4.md'],
  ['Grep', 'Product in src'],
  ['Bash', 'Find handlers touching the lock'],
  ['Read', 'src/Acme.Domain/Catalog/Products/Product.cs'],
  ['Edit', 'src/Acme.Application/Catalog/Products/CreateProduct/CreateProductCommandHandler.cs'],
  ['Bash', 'Run the unit tests'],
]

const demoCalls = (id: string, index: number, from: number, to: number | null, state: WorkflowAgent['state']): ToolTrace[] => {
  const count = state === 'running' ? 3 : DEMO_STEPS.length
  const span = (to ?? from + inMs(1)) - from
  return DEMO_STEPS.slice(0, count).map(([tool, brief], step) => {
    const isLast = step === count - 1
    const failed = (index % 3 === 0 && step === 2) || (state === 'error' && isLast)
    return {
      id: `${id}-${step}`, tool, brief, at: from + Math.round((span * step) / count),
      state: state === 'running' && isLast ? 'running' : failed ? 'error' : 'ok',
      error: failed ? (isLast ? 'exit 1 · Failed: 2, Passed: 41' : 'exit 1') : null,
    }
  })
}

const demoSheet = (isFinished: boolean): Sheet => {
  const cycle = (id: string, wave: number, behaviour: string, state: SheetCycle['state'], unreachable: string[] = []): SheetCycle => ({
    id, wave, behaviour, guard: false, state, unreachable,
  })
  return {
    lot: 'F4',
    name: 'Product lifecycle',
    isDone: isFinished,
    hypotheses: 2,
    steps: [],
    cycles: [
      cycle('X1', 1, 'Create the product', 'done'),
      cycle('X2', 1, 'Refuse without catalog', 'done', ['ProductTests.Refuse_WhenCatalogArchived']),
      cycle('X3', 1, 'Publication lock', isFinished ? 'done' : 'red'),
      cycle('X4', 2, 'Remove a deleted item', isFinished ? 'done' : 'pending'),
      { ...cycle('X5', 2, 'Product audit', isFinished ? 'done' : 'pending'), guard: true },
    ],
  }
}

const inMs = (minutes: number, seconds = 0) => (minutes * 60 + seconds) * 1000

const sampled = (agentMs: number, tools: number, spanMs: number): PhaseSample => ({
  total: agentMs * 3, count: 3, tools: tools * 3, toolCount: 3, span: spanMs * 3, spanCount: 3,
})

export const demoHistory = (): PhaseSamples => ({
  Design: sampled(inMs(1, 10), 8, inMs(2)),
  RED: sampled(inMs(1, 30), 14, inMs(2)),
  GREEN: sampled(inMs(1, 30), 14, inMs(8)),
  'Global green': sampled(inMs(1), 8, inMs(1, 10)),
  Closing: sampled(inMs(0, 50), 6, inMs(0, 50)),
  Audit: sampled(inMs(2), 16, inMs(5)),
  Review: sampled(inMs(2), 18, inMs(2, 30)),
  Report: sampled(inMs(0, 30), 4, inMs(0, 30)),
})

export const demoRuns = (at: number, isFinished = false): WorkflowRun[] => {
  const t = inMs
  const total = t(19, 35)
  const begin = isFinished ? at - total : at - t(12, 40)
  const phases = ['Design', 'RED', 'GREEN', 'Global green', 'Closing', 'Audit', 'Review', 'Report']
  const details = {
    Design: 'cycle index of the sheet; design writes the `## Cycles` block only when absent or invalid; declaratives',
    RED: 'tdd-test-author, waves in sequence, cycles of a wave in parallel',
    GREEN: 'tdd-implementer, serial, writes the cycle state',
    'Global green': 'whole or filtered suites per test-scope.md, beside the pre-audit gate',
    Closing: 'pre-audit.sh and what it lists, beside global green',
    Audit: 'audit-capture.sh, ddd-tdd-auditor, two retries at most',
    Review: 'adversarial-reviewer on the next sheet, beside the audit',
    Report: 'run/batches/FX.md, written even on stop',
  }
  const agent = (
    id: string, index: number, label: string, phase: string, from: number, to: number | null,
    state: WorkflowAgent['state'], model?: string, options: DemoAgentOptions = {},
  ) =>
    demoAgent(id, index, label, phase, begin + from, to === null ? null : begin + to, state, model, {
      ...options,
      ...(options.activeAt === undefined ? {} : { activeAt: begin + options.activeAt }),
    })
  const build = [
    agent('d', 1, 'index CAT-LIFECYCLE-PLAN-F4.md', 'Design', 0, t(0, 40), 'done', 'Haiku'),
    agent('dc', 15, 'declaratives', 'Design', t(0, 40), t(4, 30), 'done', 'Sonnet'),
    agent('r1', 2, 'RED X1 w1 create', 'RED', t(4, 30), t(6, 18), 'done'),
    agent('r2', 3, 'RED X2 w1 refusal', 'RED', t(4, 30), t(6, 10), 'done'),
    agent('r3', 14, 'RED X3 w1 lock', 'RED', t(4, 30), t(5, 20), 'interrupted', 'Sonnet'),
    agent('g1', 4, 'GREEN X1 create', 'GREEN', t(6, 20), t(7, 14), 'done', 'Sonnet', { type: 'tdd-implementer' }),
    agent('g2', 5, 'GREEN X3 lock', 'GREEN', t(7, 20), t(8, 32), 'error', 'Sonnet', { type: 'tdd-implementer' }),
    isFinished
      ? agent('g2b', 6, 'GREEN X3 lock', 'GREEN', t(8, 40), t(12), 'done', 'Sonnet', { type: 'tdd-implementer' })
      : agent('g2b', 6, 'GREEN X3 lock', 'GREEN', t(8, 40), null, 'running', 'Sonnet', {
          type: 'tdd-implementer', lastTool: 'Edit', tools: 48, activeAt: t(12, 35),
          live: { streamKind: 'thinking', streamChars: 4_200, firstChunkAt: at - 7_560, lastChunkAt: at - 1_000 },
        }),
  ]
  const closing = [
    agent('s', 7, 'suites', 'Global green', t(12, 5), t(13, 15), 'done', 'Haiku'),
    agent('c', 8, 'pre-audit', 'Closing', t(12, 5), t(13), 'done', 'Sonnet'),
    agent('a1', 9, 'audit', 'Audit', t(13, 50), t(15, 40), 'done', 'Opus', { type: 'ddd-tdd-auditor' }),
    agent('rv', 10, 'next batch review', 'Review', t(13, 50), t(16, 20), 'done', 'Opus', { type: 'adversarial-reviewer' }),
    agent('f1', 11, 'fix 1', 'Audit', t(15, 45), t(17, 45), 'done', 'Sonnet', { type: 'tdd-implementer' }),
    agent('a2', 12, 'audit retry 1', 'Audit', t(17, 50), t(19), 'done', 'Opus', { type: 'ddd-tdd-auditor' }),
    agent('rp', 13, 'report', 'Report', t(19, 5), total, 'done', 'Haiku'),
  ]
  return [
    {
      runId: `${DEMO}1`, name: 'run-lot', argument: 'todo/catalog-lifecycle/CAT-LIFECYCLE-PLAN-F4.md', phases, details,
      transcriptDir: null, startedAt: begin, launchedAt: begin, durationMs: isFinished ? total : null, status: isFinished ? 'completed' : 'running', child: null, plan: null, lots: [],
      outcome: isFinished
        ? {
            label: 'GAPS',
            reason: 'two fix rounds done, one blocking gap remains on the organization lock',
            report: 'todo/catalog-lifecycle/run/batches/F4.md',
          }
        : null,
      audit: isFinished ? { verdict: 'GAPS', blocking: 1, major: 2 } : null,
      sheet: demoSheet(isFinished),
      agents: isFinished ? [...build, ...closing] : build,
      ...(isFinished ? {} : { asking: 1 }),
    },
  ]
}

const DEMO_PLAN = 'todo/product-archiving/PRD-ARCH-PLAN.md'

const demoMarks = (red: boolean, green: boolean, cost: boolean): TddMarks => ({ red: red ? DONE : '⬜', green: green ? DONE : '⬜', cost: cost ? DONE : '⬜' })
const demoStep = (number: string, title: string, tdd: TddMarks): Step => ({ number, title, isDone: false, tdd, corrections: [] })
const demoPlanSheet = (lot: string, name: string, steps: Step[], isDone: boolean): Sheet => ({ lot, name, isDone, hypotheses: 0, steps })

// The phases run-plan declares (workflows/run-plan.js), each detail shortened.
const DEMO_PLAN_PHASES = ['Preflight', 'Batch', 'Gate', 'Aside', 'Final check', 'Merge', 'Report']
const DEMO_PLAN_DETAILS: Record<string, string> = {
  Preflight: 'plan check, doctor, docker, kit root, run folder',
  Batch: 'next batch, out-of-batch check, run-lot',
  Gate: 'report status, plan heading, fast suites, out-of-batch, snapshot',
  Aside: 'blocked batch: patch, tree restored, dependents skipped',
  'Final check': 'every suite run whole once after the last batch: reported, never blocking',
  Merge: 'whole plan delivered: knowledge-merger drafts and stages the merge, never writes it',
  Report: 'run report and notification',
}

// The agents of a demo plan, placed from its start: a supervisor step, or a batch's run-lot agents in phase order.
const demoPlanCast = (begin: number, loadedAt: number) => {
  const t = inMs
  const agent = (
    id: string, index: number, lot: string | null, label: string, phase: string, from: number, to: number | null,
    state: WorkflowAgent['state'], model = 'Sonnet', options: DemoAgentOptions = {},
  ) => {
    const made = demoAgent(`p-${id}`, index, label, phase, begin + from, to === null ? null : begin + to, state, model, {
      ...options,
      lot,
      ...(options.activeAt === undefined ? {} : { activeAt: begin + options.activeAt }),
    })
    const weight = lot === null ? 0.3 : model === 'Opus' ? 1.6 : model === 'Haiku' ? 0.3 : 1
    const peak = Math.round(lot === null ? 16_000 : 22_000 + weight * 14_000)
    return { ...made, tokens: Math.round(weight * 160_000), context: peak, contextPeak: peak }
  }
  const lotAgents = (lot: string, first: number, from: number, last: string | null, behaviours: string[], pace: number): WorkflowAgent[] => {
    const at = (minutes: number, seconds = 0) => Math.round(t(minutes, seconds) * pace)
    const steps: [string, string, number, string, string?][] = [
      ['design', 'Design', at(3, 40), 'Opus'],
      ...behaviours.map((one, index): [string, string, number, string] => [`RED C${index + 1} w1 ${one}`, 'RED', at(1, 20 + index * 10), 'Sonnet']),
      ...behaviours.map((one, index): [string, string, number, string, string] => [`GREEN C${index + 1} ${one}`, 'GREEN', at(1, 10 + index * 30), 'Sonnet', 'tdd-implementer']),
      ['suites', 'Global green', at(1, 10), 'Haiku'],
      ['audit', 'Audit', at(2, 20), 'Opus', 'ddd-tdd-auditor'],
      ['report', 'Report', at(0, 30), 'Haiku'],
    ]
    let clock = from
    let redFrom = from
    let wave: string | null = null
    const out: WorkflowAgent[] = []
    for (const [offset, [label, phase, length, model, type]] of steps.entries()) {
      const isLast = last === label
      const isWave = phase === 'RED'
      const labelWave = WAVE_LABEL.exec(label)?.[1] ?? null
      if (isWave && labelWave === wave) clock = redFrom
      if (isWave && labelWave !== wave) {
        redFrom = clock
        wave = labelWave
      }
      out.push(agent(`${lot}-${offset}`, first + offset, lot, label, phase, clock, isLast ? null : clock + length, isLast ? 'running' : 'done', model, {
        ...(type === undefined ? {} : { type }),
        ...(isLast ? { lastTool: 'Bash', tools: 17, activeAt: t(29, 10), live: { openCalls: 1, toolSince: loadedAt - t(2) } } : {}),
      }))
      if (isLast) break
      clock = isWave ? Math.max(clock + length, ...out.filter(one => one.phase === 'RED').map(one => (one.endedAt ?? 0) - begin)) : clock + length
    }
    return out
  }
  const supervisor = (id: string, index: number, label: string, phase: string, from: number, length: number) =>
    agent(id, index, null, label, phase, from, from + length, 'done', 'Haiku')
  const endOf = (agents: WorkflowAgent[]) => Math.max(0, ...agents.map(one => (one.endedAt ?? 0) - begin))
  return { agent, lotAgents, supervisor, endOf }
}

const demoPlanRun = (at: number, fields: Pick<WorkflowRun, 'runId' | 'argument' | 'startedAt' | 'durationMs' | 'status' | 'lots' | 'outcome' | 'agents'>): WorkflowRun => {
  const [lotRunTemplate] = demoRuns(at)
  return {
    name: 'run-plan', phases: DEMO_PLAN_PHASES, details: DEMO_PLAN_DETAILS, transcriptDir: null, launchedAt: fields.startedAt,
    child: { name: 'run-lot', phases: lotRunTemplate?.phases ?? [], details: lotRunTemplate?.details ?? {}, labels: {} },
    plan: DEMO_PLAN, audit: null, sheet: null, ...fields,
  }
}

export const demoPlanRuns = (at: number, isFinished = false): WorkflowRun[] => {
  const t = inMs
  const total = t(48, 30)
  const begin = isFinished ? at - total : at - t(31, 10)
  const { agent, lotAgents, supervisor, endOf } = demoPlanCast(begin, at)
  const all = demoMarks(true, true, true)
  const none = demoMarks(false, false, false)
  const views: Record<string, Sheet> = {
    F1: demoPlanSheet('F1', 'Create a product', [demoStep('1', 'Create the product', all), demoStep('2', 'Refuse a duplicate name', all)], true),
    F2: demoPlanSheet('F2', 'Archive a product', [
      demoStep('1', 'Archive the product', all),
      demoStep('2', 'Refuse archiving twice', isFinished ? all : demoMarks(true, true, false)),
      demoStep('3', 'Hide archived items', isFinished ? all : demoMarks(true, false, false)),
    ], isFinished),
    F3: demoPlanSheet('F3', 'Restore a product', [demoStep('1', 'Restore the product', demoMarks(isFinished, isFinished, isFinished)), demoStep('2', 'Refuse a deleted one', demoMarks(isFinished, isFinished, isFinished))], isFinished),
    F4: demoPlanSheet('F4', 'Product history', [demoStep('1', 'List the events', none), demoStep('2', 'Page the events', none)], false),
    F5: demoPlanSheet('F5', 'Export the products', [demoStep('1', 'Export the catalog', none)], false),
    F6: demoPlanSheet('F6', 'Export schedule', [demoStep('1', 'Schedule the export', none)], false),
  }
  const f1 = lotAgents('F1', 3, t(1, 10), null, ['create', 'duplicate name'], 1)
  const f1End = endOf(f1)
  // F5 stops at its design and is set aside: the plan goes on with F2, F6 held back behind it.
  const f5Start = f1End + t(1, 40)
  const f5 = [
    agent('F5-0', 17, 'F5', 'design', 'Design', f5Start, f5Start + t(1, 50), 'done', 'Opus'),
    agent('F5-1', 18, 'F5', 'report', 'Report', f5Start + t(1, 55), f5Start + t(2, 20), 'done', 'Haiku'),
  ]
  const f5End = f5Start + t(2, 20)
  const f2Start = f5End + t(1, 40)
  const f2 = lotAgents('F2', 20, f2Start, isFinished ? null : 'GREEN C3 hide', ['archive', 'twice', 'hide'], 1.15)
  const f2End = endOf(f2)
  const f3 = isFinished ? lotAgents('F3', 40, f2End + t(1, 40), null, ['restore', 'deleted'], 0.8) : []
  const f3End = endOf(f3)
  const supervisors = [
    supervisor('pre', 1, 'preflight', 'Preflight', 0, t(0, 50)),
    supervisor('n1', 2, 'next batch', 'Batch', t(0, 50), t(0, 20)),
    supervisor('g1', 15, 'gate F1', 'Gate', f1End, t(1, 10)),
    supervisor('n2', 16, 'next batch', 'Batch', f1End + t(1, 10), t(0, 20)),
    supervisor('as5', 19, 'aside F5', 'Aside', f5End, t(1, 10)),
    ...(isFinished
      ? [
          supervisor('g2', 35, 'gate F2', 'Gate', f2End, t(1, 10)),
          supervisor('n3', 36, 'next batch', 'Batch', f2End + t(1, 10), t(0, 20)),
          supervisor('g3', 55, 'gate F3', 'Gate', f3End, t(1, 15)),
          supervisor('rp', 56, 'report', 'Report', f3End + t(1, 15), t(0, 40)),
        ]
      : []),
  ]
  const done = (lot: string): Outcome => ({ label: 'DONE', reason: null, report: `todo/product-archiving/run/batches/${lot}.md` })
  const aside: Outcome = { label: 'BLOCKED', reason: DEMO_ASIDE, report: 'todo/product-archiving/run/batches/F5.md' }
  const lot = (id: string, deps: string[], outcome: Outcome | null): PlanLot => ({
    lot: id, sheet: `todo/product-archiving/PRD-ARCH-PLAN-${id}.md`, deps, isDone: false, outcome,
    audit: outcome === null ? null : { verdict: 'VALID', blocking: 0, major: 0 }, view: views[id] ?? null,
  })
  return [
    demoPlanRun(at, {
      runId: `${DEMO}plan`, argument: `${DEMO_PLAN} --until F3`,
      startedAt: begin, durationMs: isFinished ? total : null, status: isFinished ? 'completed' : 'running',
      lots: [
        lot('F1', [], done('F1')), lot('F2', ['F1'], isFinished ? done('F2') : null), lot('F3', ['F1'], isFinished ? done('F3') : null), lot('F4', ['F2', 'F3'], null),
        { ...lot('F5', ['F1'], aside), audit: null }, lot('F6', ['F5'], null),
      ],
      outcome: isFinished
        ? { label: 'BLOCKED', reason: 'batches set aside: F5 (holds back F6) — F1, F2, F3 done, paused by user before F4', report: DEMO_RUN_REPORT }
        : null,
      agents: [...supervisors, ...f1, ...f5, ...f2, ...f3].sort((a, b) => a.index - b.index),
    }),
  ]
}

// The `merge` a run-plan result carries once `stage` laid the drafts (scripts/knowledge-merge.py,
// agents/knowledge-merger.md): the `staged:` line, a `+n −n <file>` line per file, the WARN left.
const DEMO_MERGE = {
  state: 'staged',
  lines: [
    'staged: 7 file(s) — cctoolkit knowledge-write apply --merge PRD-ARCH',
    '+6 −2 docs/business/Catalog/OVERVIEW.md',
    '+7 −0 docs/business/Catalog/decisions.md (new)',
    '+3 −0 docs/business/Catalog/rules.md',
    '+2 −0 docs/business/Catalog/usecases/CAT-CU-01-consult-products.md',
    '+14 −0 docs/business/Catalog/usecases/CAT-CU-02-archive-product.md (new)',
    '+14 −0 docs/business/Catalog/usecases/CAT-CU-03-restore-product.md (new)',
    '+7 −0 docs/business/adr/ADR-001-soft-archive-through-a-status-column.md (new)',
  ],
  warnings: ['WARN CAT-CU-01: rewritten without a line removed — say what is no longer true'],
  next: `/cctoolkit:knowledge-merge ${DEMO_PLAN} — the knowledge base is not written yet: it shows the diff and writes it on the user's confirmation`,
}

// The plan delivered whole, as examples/ tells it: F1 archives, F2 restores and hides archived
// products; every batch DONE, so the final check runs and the merge is staged, never written.
export const demoMergeRuns = (at: number): WorkflowRun[] => {
  const t = inMs
  const cast = (begin: number) => {
    const { agent, lotAgents, supervisor, endOf } = demoPlanCast(begin, at)
    const f1 = lotAgents('F1', 3, t(1, 10), null, ['archive', 'refuse a draft', 'other organisation'], 1)
    const f1End = endOf(f1)
    const f2Start = f1End + t(1, 30)
    const f2 = lotAgents('F2', 20, f2Start, null, ['restore', 'refuse not archived', 'hide archived'], 1.1)
    const f2End = endOf(f2)
    const checkEnd = f2End + t(1, 10) + t(3, 20)
    const draftFrom = checkEnd + t(0, 40)
    const draft = agent('md', 40, null, 'merge draft', 'Merge', draftFrom, draftFrom + t(4, 10), 'done', 'Sonnet', {
      type: 'cctoolkit:knowledge-merger', answer: `merge draft: ${DEMO_MERGE.lines[0]}`,
    })
    const supervisors = [
      supervisor('pre', 1, 'preflight', 'Preflight', 0, t(0, 50)),
      supervisor('n1', 2, 'next batch', 'Batch', t(0, 50), t(0, 20)),
      supervisor('g1', 15, 'gate F1', 'Gate', f1End, t(1, 10)),
      supervisor('n2', 16, 'next batch', 'Batch', f1End + t(1, 10), t(0, 20)),
      supervisor('g2', 35, 'gate F2', 'Gate', f2End, t(1, 10)),
      supervisor('fc', 37, 'final check', 'Final check', f2End + t(1, 10), t(3, 20)),
      supervisor('mp', 38, 'merge prepare', 'Merge', checkEnd, t(0, 40)),
      { ...draft, effort: 'medium' },
      supervisor('rp', 41, 'report', 'Report', draftFrom + t(4, 10), t(0, 40)),
    ]
    const agents = [...supervisors, ...f1, ...f2].sort((a, b) => a.index - b.index)
    return { agents, total: endOf(agents) }
  }
  const { total } = cast(0)
  const begin = at - total
  const { agents } = cast(begin)
  const all = demoMarks(true, true, true)
  const views: Record<string, Sheet> = {
    F1: demoPlanSheet('F1', 'Archive a product', [
      demoStep('1', 'A manager archives a published product of their organisation', all),
      demoStep('2', 'Handler documentation', all),
      demoStep('3', 'Build + test verification', all),
    ], true),
    F2: demoPlanSheet('F2', 'Restore a product', [
      demoStep('1', 'A manager restores an archived product', all),
      demoStep('2', 'The catalogue listing hides archived products', all),
      demoStep('3', 'Build + test verification', all),
    ], true),
  }
  const lot = (id: string, deps: string[]): PlanLot => ({
    lot: id, sheet: `todo/product-archiving/PRD-ARCH-PLAN-${id}.md`, deps, isDone: false,
    outcome: { label: 'DONE', reason: null, report: `todo/product-archiving/run/batches/${id}.md` },
    audit: { verdict: 'VALID', blocking: 0, major: 0 }, view: views[id] ?? null,
  })
  const merge = mergeOf(DEMO_MERGE)
  return [
    demoPlanRun(at, {
      runId: `${DEMO}plan-merge`, argument: DEMO_PLAN, startedAt: begin, durationMs: total, status: 'completed',
      lots: [lot('F1', []), lot('F2', ['F1'])],
      outcome: { label: 'DONE', reason: null, report: DEMO_MERGE_REPORT, ...(merge === null ? {} : { merge }) },
      agents,
    }),
  ]
}

const DEMO_ASIDE = 'design blocked: no defensible export format, CSV or the catalog JSON feed'
const DEMO_STAMP = '2026-10-10-0912'
const DEMO_RUN_REPORT = `todo/product-archiving/run/${DEMO_STAMP}.md`
const DEMO_MERGE_STAMP = '2026-10-15-0840'
const DEMO_MERGE_REPORT = `todo/product-archiving/run/${DEMO_MERGE_STAMP}.md`
const DEMO_LOT_SHEET = 'todo/catalog-lifecycle/CAT-LIFECYCLE-PLAN-F4.md'

const DEMO_LOT_REPORT = `## STATUS — GAPS

Reason: two fix rounds done, one blocking gap remains on the organization lock

## To validate

- Design — the publication lock is set on the catalog, not on each product (no rule names the owner)
- RED Publication lock — unreachable guard, test not written, removal proposed: \`Product.EnsureCatalogOpen\` (the catalog check refuses the call first)
- Question design — unanswered, recommendation applied: lock on publication or on first sale? → on publication (RM-04 reads published)
- Audit — contest accepted, trade-off (round 1): duplicated guard in the aggregate — harm: none → the guard stays in the aggregate
- Audit — audit rounds stopped, diverging: round 2 changed 5 file(s) for 2 finding(s), 2 still open (Product.cs, DeleteProductCommandHandler.cs)
- Assumptions — H2: archived items keep their audit trail (tech lead)
`

const DEMO_PLAN_REPORTS: Record<string, string> = {
  F1: `## To validate

- Assumptions — H1: \`ArchivedAt\` comes from \`TimeProvider\`, not from the request (tech lead)
`,
  F5: `## To validate

- Design — export format undecided: CSV or the catalog JSON feed (no rule names one, both keep every RM/CU)
`,
  F2: `## To validate

- Design — archiving twice answers 409, not 204 (the spec says refused, not ignored)
`,
}

const DEMO_RUN_TEXT = `## To validate

### Batches set aside

- F5 — Set aside — ${DEMO_ASIDE} — patch run/${DEMO_STAMP}-aside-F5.patch

### Arbiter and design decisions

- F3 — Design — restoring keeps the archive date in the history (the audit trail is never rewritten)
`

const DEMO_MERGE_REPORTS: Record<string, string> = {
  F1: DEMO_PLAN_REPORTS.F1 ?? '',
  F2: `## To validate

- Design — a restored product goes back to Published, never to Draft (CAT-RM-005 names no other state)
`,
}

const DEMO_MERGE_TEXT = `## To validate

### Assumptions

- F1 — H1: \`ArchivedAt\` comes from \`TimeProvider\`, not from the request (tech lead)
`

const jsonLine = (record: Record<string, unknown>): string => JSON.stringify(record)

// The run files of each demo, as the workflow and the pane would have left them: the views read
// them like any run's; the pane's answers go into this copy, never to disk.
export const demoFeedOf = (run: WorkflowRun, at: number, isPlan: boolean, isFinished: boolean, isMerged = false): RunFeed => {
  const s = Math.floor(at / 1000)
  const root = runRootOfRun(run) ?? 'run'
  if (!isPlan) {
    const report = `${root}/batches/F4.md`
    const entries = isFinished ? toValidateOf(DEMO_LOT_REPORT, 'F4') : []
    const id = (index: number) => entries[index]?.id ?? ''
    const entry = (index: number) => ({ batch: 'F4', step: entries[index]?.step ?? '', text: entries[index]?.text ?? '', sheet: DEMO_LOT_SHEET })
    const work = [
      jsonLine({ kind: 'attempt', batch: 'F4', step: 'GREEN lock', n: 2, reason: 'tests modified at GREEN: tests/Acme.UnitTests/Catalog/Products/ProductTests.cs — granted: none', at: s - 300 }),
      ...(isFinished
        ? [
            jsonLine({ kind: 'audit-round', batch: 'F4', round: 1, open: 3, files: ['Product.cs', 'ProductTests.cs', 'DeleteProductCommandHandler.cs', 'DeleteProductTests.cs'], contested: [{ gap: 'duplicated guard in the aggregate', harm: 'none, the guard runs once per command' }], responses: [], at: s - 280 }),
            jsonLine({
              kind: 'audit-round', batch: 'F4', round: 1, open: 3, files: ['Product.cs', 'ProductTests.cs', 'DeleteProductCommandHandler.cs', 'DeleteProductTests.cs'],
              contested: [{ gap: 'duplicated guard in the aggregate', harm: 'none, the guard runs once per command' }],
              responses: [{ gap: 'duplicated guard in the aggregate', answer: 'Accept', text: 'trade-off kept, the guard stays in the aggregate' }], after: 2, at: s - 250,
            }),
            jsonLine({
              kind: 'audit-round', batch: 'F4', round: 2, open: 2, files: ['Product.cs', 'ProductTests.cs', 'DeleteProductCommandHandler.cs', 'DeleteProductTests.cs', 'Catalog.cs'],
              contested: [{ gap: 'organization lock not checked before deletion', harm: 'a member of another organization deletes the product' }],
              responses: [{ gap: 'organization lock not checked before deletion', answer: 'Escalate', text: 'needs the owner of the organization rule' }], after: 2, diverged: true, at: s - 120,
            }),
            jsonLine({ kind: 'ack', batch: 'F4', ref: 'n-demo-1', what: 'note-taken', at: s - 900 }),
            jsonLine({ kind: 'ack', batch: 'F4', ref: id(0), what: 'applied', at: s - 60 }),
            jsonLine({ kind: 'ack', batch: 'F4', ref: id(1), what: 'applied', relaunch: `/run-lot ${DEMO_LOT_SHEET}`, hn: 'H3', cycles: ['X3'], at: s - 60 }),
          ]
        : [
            jsonLine({
              kind: 'question', batch: 'F4', id: 'F4-design-1', at: s - 148,
              payload: {
                batch: 'F4', sheet: DEMO_LOT_SHEET, kind: 'design', context: 'publication lock owner', waitSeconds: WAIT_SECONDS,
                questions: [
                  { id: 'q1', severity: 'Major', question: 'Lock on publication or on first sale?', evidence: 'RM-04', options: ['publication', 'first sale'], recommendation: 'publication' },
                  { id: 'q2', severity: 'Minor', question: 'Archived catalog read-only?', evidence: 'RM-07', options: ['yes', 'no'], recommendation: 'yes' },
                ],
              },
            }),
            jsonLine({ kind: 'ack', batch: 'F4', ref: 'n-demo-1', what: 'note-taken', at: s - 600 }),
          ]),
    ]
    const pane = [
      jsonLine({ kind: 'note', id: 'n-demo-1', batch: 'F4', text: 'an archived catalog is read-only', at: s - 700 }),
      jsonLine({ kind: 'note', id: 'n-demo-2', batch: 'F4', text: 'keep the lock check in the aggregate, not the handler', at: s - 90 }),
      ...(isFinished
        ? [
            jsonLine({ kind: 'validation', id: id(0), entry: entry(0), decision: 'keep', text: '', at: s - 200 }),
            jsonLine({ kind: 'validation', id: id(1), entry: entry(1), decision: 'amend', text: 'write the test, the guard stays', at: s - 190 }),
            jsonLine({ kind: 'validation', id: id(2), entry: entry(2), decision: 'reject', text: 'lock on first sale, the spec is wrong here', at: s - 30 }),
          ]
        : []),
    ]
    return { runId: run.runId, root, work: work.join('\n'), pane: pane.join('\n'), reports: isFinished ? { [report]: keptSections(DEMO_LOT_REPORT) } : {} }
  }
  if (isMerged) {
    const merged = toValidateOf(DEMO_MERGE_REPORTS.F1 ?? '', 'F1')[0]
    const reports = Object.fromEntries(Object.entries(DEMO_MERGE_REPORTS).map(([lot, text]) => [`${root}/batches/${lot}.md`, text]))
    const work = [
      jsonLine({ kind: 'journal', run: DEMO_MERGE_STAMP, text: `knowledge base: merge staged — ${DEMO_MERGE.lines[0]}`, at: s - 60 }),
      jsonLine({ kind: 'ack', batch: 'F1', ref: 'n-demo-m1', what: 'note-taken', at: s - 1500 }),
      jsonLine({ kind: 'ack', batch: 'F1', ref: merged?.id ?? '', what: 'applied', at: s - 1400 }),
    ]
    const pane = [
      jsonLine({ kind: 'note', id: 'n-demo-m1', batch: 'F1', text: 'archiving keeps the product readable by its id', at: s - 1600 }),
      jsonLine({ kind: 'validation', id: merged?.id ?? '', entry: { batch: 'F1', step: merged?.step ?? '', text: merged?.text ?? '', sheet: `todo/product-archiving/PRD-ARCH-PLAN-F1.md` }, decision: 'keep', text: '', at: s - 1500 }),
    ]
    return { runId: run.runId, root, work: work.join('\n'), pane: pane.join('\n'), reports: { ...reports, [DEMO_MERGE_REPORT]: DEMO_MERGE_TEXT } }
  }
  const reports: Record<string, string> = Object.fromEntries(
    Object.entries(DEMO_PLAN_REPORTS)
      .filter(([lot]) => isFinished || lot !== 'F2')
      .map(([lot, text]) => [`${root}/batches/${lot}.md`, text]),
  )
  if (isFinished) reports[DEMO_RUN_REPORT] = DEMO_RUN_TEXT
  const f1 = toValidateOf(DEMO_PLAN_REPORTS.F1 ?? '', 'F1')[0]
  const work = [
    jsonLine({ kind: 'journal', run: DEMO_STAMP, text: `F5 ✗ — set aside — ${DEMO_ASIDE} — patch run/${DEMO_STAMP}-aside-F5.patch`, at: s - 900 }),
    jsonLine({ kind: 'ack', batch: 'F1', ref: 'n-demo-p1', what: 'note-taken', at: s - 1500 }),
    jsonLine({ kind: 'ack', batch: 'F1', ref: f1?.id ?? '', what: 'applied', at: s - 1400 }),
    ...(isFinished ? [jsonLine({ kind: 'ack', ref: 'pause', what: 'paused', at: s - 30 })] : []),
  ]
  const pane = [
    jsonLine({ kind: 'note', id: 'n-demo-p1', batch: 'F1', text: 'reuse the archived flag of the catalog', at: s - 1600 }),
    jsonLine({ kind: 'validation', id: f1?.id ?? '', entry: { batch: 'F1', step: f1?.step ?? '', text: f1?.text ?? '', sheet: 'todo/product-archiving/PRD-ARCH-PLAN-F1.md' }, decision: 'keep', text: '', at: s - 1500 }),
    jsonLine({ kind: 'note', id: 'n-demo-p2', batch: 'F2', text: 'the archived filter stays off by default', at: s - 240 }),
    jsonLine({ kind: 'pause', on: true, at: s - 120 }),
  ]
  return { runId: run.runId, root, work: work.join('\n'), pane: pane.join('\n'), reports }
}

// The plugin's own close never reaches its own ui.close hook: the flag is set here.
async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE }).catch(() => undefined)
  await update($, isShown, () => false)
}

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: 'Workflow', columns: PANE_COLUMNS }).catch(() => null)
  if (opened?.isPlaced) await update($, isShown, () => true)
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function childScriptOf(
  $: EngineInterface,
  script: string,
  name: string,
  root: string,
  sessionPath: string | undefined,
): Promise<{ path: string; text: string } | null> {
  const plugin = childPluginOf(script)
  const home = claudeHomeOf(sessionPath)
  const installed = plugin === null || home === null ? null : await readText($, `${home}/plugins/installed_plugins.json`)
  const installPath = installed === null ? null : installPathOf(installed, plugin!, root)
  for (const path of childScriptPathsOf(name, root, installPath)) {
    const text = await readText($, path)
    if (text !== null) return { path, text }
  }
  return null
}

async function metaPhase($: EngineInterface, transcriptDir: string, agentId: string): Promise<string | null> {
  const text = await readText($, `${transcriptDir}/agent-${agentId}.meta.json`)
  if (text === null) return null
  try {
    const phase = (JSON.parse(text) as { workflowPhase?: unknown }).workflowPhase
    return typeof phase === 'string' && phase !== '' ? phase : null
  } catch {
    return null
  }
}

export const alertOf = (run: WorkflowRun): string => {
  const lot = lotOf(run.argument)
  const outcome = run.outcome
  const reason = outcome !== null && outcomeTone(outcome, run.status) !== 'success' ? outcome.reason : null
  return [
    lot === null ? run.name : `${run.name} ${lot.lot}`,
    outcome?.label ?? (run.status === 'killed' ? 'STOPPED' : run.status === 'failed' ? 'FAILED' : 'COMPLETED'),
    coarse(run.durationMs ?? 0),
    ...(reason === null ? [] : [fit(firstLine(reason), ALERT_REASON)]),
  ].join(' · ')
}

const announced = new Set<string>()

async function announce($: EngineInterface, runId: string): Promise<void> {
  const run = (await read($, runs)).map(completeRun).find(one => one.runId === runId)
  if (run === undefined || run.status === 'running' || run.runId.startsWith(DEMO)) return
  const key = `${run.runId}@${run.launchedAt}`
  if (announced.has(key)) return
  announced.add(key)
  $.ui.toast(alertOf(run), { timeoutMs: ALERT_MS })
}

const seenFiles = new Map<string, number>()

async function changedText($: EngineInterface, path: string): Promise<string | null> {
  const stat = await $.fs.stat(path).catch(() => null)
  if (stat === null || seenFiles.get(path) === stat.mtimeMs) return null
  const text = await readText($, path)
  if (text !== null) seenFiles.set(path, stat.mtimeMs)
  return text
}

async function askingOf($: EngineInterface, sheet: string, lot: string): Promise<number> {
  return pendingQuestionsOf(workLinesOf((await readText($, workFileOf(sheet))) ?? ''), lot).length
}

async function refreshAsking($: EngineInterface, run: WorkflowRun): Promise<void> {
  const sheet = sheetPathOf(run.argument)
  const lot = lotOf(run.argument)
  if (sheet === null || lot === null || run.runId.startsWith(DEMO)) return
  const asking = await askingOf($, sheet, lot.lot)
  if (asking === (run.asking ?? 0)) return
  await update($, runs, stored => stored.map(one => (one.runId === run.runId ? { ...one, asking } : one)))
}

async function refreshLots($: EngineInterface, run: WorkflowRun): Promise<void> {
  if (run.child === null || run.runId.startsWith(DEMO)) return
  const planText = run.plan === null ? null : await changedText($, run.plan)
  const planned = planText === null ? null : parsePlanLots(planText)
  const views: Record<string, Sheet> = {}
  const outcomes: Record<string, Outcome> = {}
  const askings: Record<string, number> = {}
  const pasts: Record<string, LotFigures | null> = {}
  for (const entry of run.lots) {
    const agents = run.agents.filter(agent => agent.lot === entry.lot)
    const sheet = entry.sheet ?? (run.plan === null ? null : run.plan.replace(/\.md$/, `-${entry.lot}.md`))
    if (run.transcriptDir !== null && sheet !== null && agents.length === 0 && entry.isDone && entry.past === undefined) pasts[entry.lot] = await pastFiguresOf($, run, sheet)
    if (entry.sheet === null || agents.length === 0) continue
    const asking = await askingOf($, entry.sheet, entry.lot)
    if (asking !== (entry.asking ?? 0)) askings[entry.lot] = asking
    const text = await changedText($, entry.sheet)
    const parsed = text === null ? null : parseSheet(text, entry.sheet)
    const base = parsed ?? entry.view
    const view = base === null ? null : await withCycleProgress($, base, entry.sheet, entry.lot, parsed !== null)
    if (view !== null) views[entry.lot] = view
    if (entry.outcome === null && agents.some(agent => agent.phase === REPORT_PHASE && agent.state !== 'running' && !isStaleReport(agents, agent))) {
      for (const path of reportPathsOf(entry.sheet, entry.lot)) {
        const report = await readText($, path)
        const outcome = report === null ? null : reportOutcomeOf(report, path)
        if (outcome !== null) {
          outcomes[entry.lot] = outcome
          if (LOT_DONE.includes(outcome.label)) await keepFigures($, run, entry.sheet, agents)
          break
        }
      }
    }
  }
  if (planned === null && [views, outcomes, askings, pasts].every(found => Object.keys(found).length === 0)) return
  await update($, runs, stored =>
    stored.map(one => {
      if (one.runId !== run.runId) return one
      const kept = completeRun(one)
      const lots = planned === null ? kept.lots : mergeLots(kept.lots, planned)
      return { ...kept, lots: lots.map(entry => ({ ...entry, view: views[entry.lot] ?? entry.view, outcome: outcomes[entry.lot] ?? entry.outcome, asking: askings[entry.lot] ?? entry.asking, past: entry.lot in pasts ? pasts[entry.lot] : entry.past })) }
    }),
  )
}

async function pastFiguresOf($: EngineInterface, run: WorkflowRun, sheet: string): Promise<LotFigures | null> {
  const key = figuresKeyOf(run.transcriptDir, sheet)
  if (key === null) return null
  try {
    return lotFiguresFrom(await $.store.get(key))
  } catch {
    return null
  }
}

async function keepFigures($: EngineInterface, run: WorkflowRun, sheet: string | null, agents: WorkflowAgent[]): Promise<void> {
  const key = figuresKeyOf(run.transcriptDir, sheet)
  const figures = lotFiguresOf(agents)
  if (key === null || figures === null || run.runId.startsWith(DEMO)) return
  try {
    await $.store.set(key, figures)
  } catch {
    return
  }
}

async function poll($: EngineInterface): Promise<void> {
  const list = (await read($, runs)).map(completeRun)
  for (const run of list) {
    if (run.status === 'running') await (run.child === null ? refreshAsking($, run) : refreshLots($, run))
    if (run.status !== 'running' || run.transcriptDir === null) continue
    const dir = run.transcriptDir
    const journalPath = journalPathOf(dir, run.runId)
    const journalText = await readText($, journalPath)
    const journal = journalText === null ? null : parseJournal(journalText)
    const stamp = journal === null || journal.status === 'running' ? null : await $.fs.stat(journalPath).catch(() => null)
    const settled = journal !== null && journal.status !== 'running' && (stamp === null || stamp.mtimeMs >= run.launchedAt) ? journal : null
    const phases: Record<string, string> = { ...(journal?.agentPhases ?? {}) }
    for (const agent of run.agents) {
      if (agent.phase === null && phases[agent.id] === undefined) {
        const phase = await metaPhase($, dir, agent.id)
        if (phase !== null) phases[agent.id] = phase
      }
    }
    const at = await $.clock.now()
    await update($, runs, stored =>
      withRun(stored, run.runId, at, current => {
        const agents = current.agents.map(agent => {
          const phase = nestedPhaseOf(current.child, agent.label, agent.phase ?? phases[agent.id] ?? null)
          if (settled === null || agent.state !== 'running') return { ...agent, phase }
          return settled.status === 'completed'
            ? { ...agent, phase, state: 'done' as const, endedAt: at }
            : { ...interrupted(agent), phase }
        })
        const known = {
          argument: current.argument ?? journal?.argument ?? null,
          details: Object.keys(current.details).length > 0 ? current.details : (journal?.details ?? {}),
        }
        if (settled === null) return { ...current, ...known, agents }
        return {
          ...current,
          ...known,
          agents,
          status: settled.status,
          durationMs: settled.durationMs ?? at - current.startedAt,
          outcome: settled.outcome,
          audit: settled.audit ?? current.audit,
          phases: current.phases.length > 0 ? current.phases : settled.phases,
        }
      }),
    )
    if (settled !== null && run.child === null && settled.outcome !== null && LOT_DONE.includes(settled.outcome.label)) {
      await keepFigures($, run, sheetPathOf(run.argument ?? settled.argument), run.agents)
    }
    if (settled !== null) await announce($, run.runId)
  }
}

async function listDirectory($: EngineInterface, path: string): Promise<FsEntry[]> {
  try {
    return (await $.fs.list(path)) ?? []
  } catch {
    return []
  }
}

async function learnHistory($: EngineInterface, run: WorkflowRun): Promise<void> {
  if (run.transcriptDir === null) return
  const own = journalPathOf(run.transcriptDir, run.runId)
  const sessionDir = own.slice(0, own.lastIndexOf('/workflows/'))
  const projectDir = sessionDir.slice(0, sessionDir.lastIndexOf('/'))
  if (own === run.transcriptDir || projectDir === '') return
  const sessions = (await listDirectory($, projectDir)).filter(entry => entry.kind === 'dir').slice(0, SCANNED_SESSIONS)
  const journals: { path: string; mtimeMs: number }[] = []
  for (const session of sessions) {
    const folder = `${projectDir}/${session.name}/workflows`
    for (const entry of await listDirectory($, folder)) {
      const path = `${folder}/${entry.name}`
      if (entry.kind === 'file' && entry.name.endsWith('.json') && path !== own) journals.push({ path, mtimeMs: entry.mtimeMs })
    }
  }
  const newest = journals.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, KEPT_JOURNALS)
  const sampled: Sample[][] = []
  for (const journal of newest) {
    const text = await readText($, journal.path)
    if (text !== null) sampled.push(samplesOf(text, run.child?.labels ?? {}))
  }
  const known = currentShapeSamples(sampled).reduce(withSamples, {} as PhaseSamples)
  await update($, history, () => known)
}

let seenSheet: { path: string; mtimeMs: number } | null = null

async function refreshSheet($: EngineInterface, run: WorkflowRun): Promise<void> {
  const path = sheetPathOf(run.argument)
  if (path === null || run.runId.startsWith(DEMO)) return
  const stat = await $.fs.stat(path).catch(() => null)
  if (stat === null) return
  const isSeen = run.sheet !== null && seenSheet?.path === path && seenSheet.mtimeMs === stat.mtimeMs
  const text = isSeen ? null : await readText($, path)
  if (!isSeen && text === null) return
  if (!isSeen) seenSheet = { path, mtimeMs: stat.mtimeMs }
  const parsed = text === null ? null : parseSheet(text, path)
  const base = parsed ?? run.sheet
  const sheet = base === null ? null : await withCycleProgress($, base, path, base.lot, parsed !== null)
  if (sheet === null) return
  await update($, runs, stored => stored.map(one => (one.runId === run.runId ? { ...one, sheet } : one)))
}

const seenCycles = new Map<string, string>()

async function withCycleProgress($: EngineInterface, sheet: Sheet, path: string, lot: string, isFresh: boolean): Promise<Sheet | null> {
  if (sheet.cycles === undefined) return isFresh ? sheet : null
  const work = workFileOf(path)
  const stat = await $.fs.stat(work).catch(() => null)
  const key = `${work}#${lot}`
  const signature = stat === null ? 'none' : String(stat.mtimeMs)
  if (!isFresh && seenCycles.get(key) === signature) return null
  seenCycles.set(key, signature)
  const states = stat === null ? {} : cycleStatesOf(workLinesOf((await readText($, work)) ?? ''), lot)
  return { ...sheet, cycles: sheet.cycles.map(cycle => cycleProgressOf(cycle, states[cycleSlugOf(cycle.behaviour)] ?? null)) }
}

export const feedWorkOf = (text: string): string =>
  text
    .split('\n')
    .filter(one => FEED_KINDS.includes(String(recordOf(one)?.kind)))
    .join('\n')

// The run files a run's views read beside its work and pane files: the report of each batch, and
// the run report — named by the outcome, or by the stamp of the run's journal lines.
export const feedPathsOf = (run: WorkflowRun, runRoot: string, work: WorkLine[]): string[] => {
  const sheets =
    run.child === null
      ? [{ sheet: sheetPathOf(run.argument), lot: lotOf(run.argument)?.lot ?? null }]
      : run.lots.map(entry => ({ sheet: entry.sheet ?? (run.plan === null ? null : run.plan.replace(/\.md$/, `-${entry.lot}.md`)), lot: entry.lot }))
  const stamp = recordsOf(work).flatMap(line => (line.kind === 'journal' || line.kind === 'breaker') && textOf(line.run) !== null ? [textOf(line.run)!] : []).pop()
  return [
    ...new Set([
      ...sheets.flatMap(({ sheet, lot }) => (sheet === null || lot === null ? [] : reportPathsOf(sheet, lot))),
      ...(run.child === null ? [] : [run.outcome?.report ?? null, stamp === undefined ? null : `${runRoot}/${stamp}.md`].flatMap(path => (path === null ? [] : [path]))),
    ]),
  ]
}

const seenFeed = new Map<string, number>()

async function refreshFeed($: EngineInterface, run: WorkflowRun): Promise<void> {
  const runRoot = runRootOfRun(run)
  if (runRoot === null || run.runId.startsWith(DEMO)) return
  const kept = await read($, feed)
  const before = kept !== null && kept.runId === run.runId && kept.root === runRoot ? kept : null
  const fresh = async (path: string, previous: string | undefined, keep: (text: string) => string): Promise<string | undefined> => {
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat === null) return undefined
    if (previous !== undefined && seenFeed.get(path) === stat.mtimeMs) return previous
    const text = await readText($, path)
    if (text === null) return previous
    seenFeed.set(path, stat.mtimeMs)
    return keep(text)
  }
  const work = (await fresh(`${runRoot}/.work.jsonl`, before?.work, feedWorkOf)) ?? ''
  const pane = (await fresh(paneFileOf(runRoot), before?.pane, text => text)) ?? ''
  const reports: Record<string, string> = {}
  for (const path of feedPathsOf(run, runRoot, workLinesOf(work))) {
    const text = await fresh(path, before?.reports[path], keptSections)
    if (text !== undefined && text !== '') reports[path] = text
  }
  const next: RunFeed = { runId: run.runId, root: runRoot, work, pane, reports }
  if (before !== null && JSON.stringify(before) === JSON.stringify(next)) return
  await update($, feed, () => next)
}

// The pane file is the mod's alone: read whole, the line appended, written whole. A demo run has no
// files: its answers go into the demo's copy.
async function writePane($: EngineInterface, record: Record<string, unknown>, at?: number): Promise<void> {
  const run = (await read($, runs)).map(completeRun).pop()
  if (run === undefined) return
  const written = { ...record, at: at ?? Math.round(await $.clock.now()) / 1000 }
  if (run.runId.startsWith(DEMO)) {
    await update($, feed, kept => (kept === null || kept.runId !== run.runId ? kept : { ...kept, pane: withPaneLine(kept.pane, written) }))
    return
  }
  const runRoot = runRootOfRun(run)
  if (runRoot === null) return
  const path = paneFileOf(runRoot)
  await $.fs.write(path, withPaneLine((await readText($, path)) ?? '', written)).catch(() => undefined)
  await refreshFeed($, run)
}

async function bannerNow($: EngineInterface): Promise<string | null> {
  const last = (await read($, runs)).map(completeRun).pop()
  const kept = await read($, feed)
  if (last === undefined || last.status !== 'running' || kept === null || kept.runId !== last.runId) return null
  return questionBanner(feedViewOf(kept).questions, await read($, now))
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const figures = await $.session.usage().catch(() => null)
  if (figures === null) return
  await update($, usage, () => ({
    context: figures.context.tokens ?? null,
    percent: figures.context.percent ?? null,
  }))
}

const tick = async ($: EngineInterface): Promise<void> => {
  const list = (await read($, runs)).map(completeRun)
  const last = list[list.length - 1]
  if (last !== undefined) await refreshSheet($, last)
  if (last !== undefined && (last.status === 'running' || (await read($, isShown)))) await refreshFeed($, last)
  if (!list.some(run => run.status === 'running')) return
  const at = await $.clock.now()
  await update($, now, () => at)
  await refreshUsage($)
  await poll($)
}

export const blankAgent = (id: string, index: number, label: string, model: string, type: string, prompt: string, at: number): WorkflowAgent => ({
  id, index, label, phase: null, model, effort: null, type, startedAt: at, endedAt: null, lastActiveAt: at, openCalls: 0, ...QUIET, lastChunkAt: null, streamChars: 0, state: 'running',
  lastTool: null, tools: 0, context: 0, contextStart: 0, contextPeak: 0, tokens: 0, prompt: promptBrief(prompt), answer: null,
  structured: null, calls: [], toolCounts: {}, files: [], lastError: null, lot: null,
})

const closeCall = async ($: EngineInterface, agentId: string): Promise<void> => {
  const at = await $.clock.now()
  await update($, runs, list =>
    withAgent(list, agentId, agent => {
      const openCalls = Math.max(0, agent.openCalls - 1)
      return { ...agent, openCalls, toolSince: openCalls === 0 ? null : agent.toolSince, lastActiveAt: at }
    }),
  )
}

type Live = { kind: StreamKind | null; chars: number; firstChunkAt: number | null; lastChunkAt: number | null; writtenAt: number }

const streamKindOf = (chunk: TurnStepChunk): StreamKind | null =>
  chunk.kind === 'thinking' ? 'thinking' : chunk.kind === 'text' ? 'output' : chunk.kind === 'tool' || chunk.kind === 'input' ? 'tool' : null

const charactersOf = (chunk: TurnStepChunk): number =>
  chunk.kind === 'thinking' || chunk.kind === 'text' ? chunk.text.length : chunk.kind === 'input' ? chunk.json.length : 0

const writeLive = async ($: EngineInterface, agentId: string, live: Live, isOver: boolean): Promise<void> => {
  await update($, runs, list =>
    withAgent(list, agentId, agent => ({
      ...agent,
      waitingSince: isOver || live.lastChunkAt !== null ? null : agent.waitingSince,
      firstChunkAt: isOver ? null : live.firstChunkAt,
      lastChunkAt: live.lastChunkAt ?? agent.lastChunkAt,
      streamKind: isOver ? null : live.kind,
      streamChars: live.chars,
    })),
  )
}

const startStream = async ($: EngineInterface, agentId: string): Promise<Live | null> => {
  try {
    if (!isFollowed(await read($, runs), agentId)) return null
    const at = await $.clock.now()
    await update($, runs, list => withAgent(list, agentId, agent => ({ ...agent, waitingSince: at, firstChunkAt: null, streamKind: null, streamChars: 0 })))
    return { kind: null, chars: 0, firstChunkAt: null, lastChunkAt: null, writtenAt: at }
  } catch {
    return null
  }
}

const noteChunk = async ($: EngineInterface, agentId: string, live: Live, chunk: TurnStepChunk): Promise<void> => {
  try {
    const at = await $.clock.now()
    live.firstChunkAt = live.firstChunkAt ?? at
    live.lastChunkAt = at
    live.kind = streamKindOf(chunk) ?? live.kind
    live.chars += charactersOf(chunk)
    if (at - live.writtenAt < STREAM_WRITE_MS) return
    live.writtenAt = at
    await writeLive($, agentId, live, false)
  } catch {
    return
  }
}

const endStream = async ($: EngineInterface, agentId: string, live: Live): Promise<void> => {
  try {
    await writeLive($, agentId, live, true)
  } catch {
    return
  }
}

export const register: Register = on => {
  let root: string | null = null
  let sequence = 0

  // On a desktop, a button above the prompt opens and closes the pane: its tab has no way back
  // once closed but the command. The surface stacks each plugin's band: this one draws its own alone.
  // On every surface, a question of the run waiting for its answer shows there with its countdown.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const banner = await bannerNow($)
    const hasToggle = e.surface === 'desktop' && (await read($, runs)).length > 0
    if (!hasToggle && banner === null) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = await read($, isShown)
    return (
      <Box flexDirection="column">
        {banner !== null && (
          <Box key="question-banner">
            <Text bold color={WAITING_TONE} wrap="truncate-end">
              {banner}
            </Text>
          </Box>
        )}
        {hasToggle && (
          <Box key="toggle-row">
            <Button
              key="toggle-run-lot-pane"
              label="◫ Workflow"
              variant={shown ? 'primary' : 'secondary'}
              onPress={() => (shown ? closePane($) : openPane($))}
            />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) await update($, isShown, () => false)
    return result
  })

  on('session.start', async ($, e, next) => {
    const panes = await $.ui.panes().catch(() => [])
    await update($, isShown, () => panes.some(pane => pane.id === PANE))
    root = e.cwd
    await $.command.register({
      name: 'run-lot-pane',
      description: 'Open the Workflow progress pane (clear forgets the finished run, demo loads a sample run, demo end a finished one, demo plan and demo plan end a run-plan run, demo plan merge a plan delivered whole with its knowledge-base merge staged)',
    })
    $.clock.every(TICK_MS, () => void tick($))
    for (const run of await read($, runs)) {
      if (run.child === null || run.child.labels !== undefined) continue
      const childScript = await readText($, run.child.script ?? `${e.cwd}/.claude/workflows/${run.child.name}.js`)
      const labels = childScript === null ? {} : labelPhasesOf(childScript)
      await update($, runs, list => list.map(one => (one.runId === run.runId && one.child !== null ? { ...one, child: { ...one.child, labels } } : one)))
    }
    if ((await read($, runs)).some(run => run.status === 'running')) void openPane($)
    return next(e)
  })

  on('command.run', { command: 'run-lot-pane' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, runs, list => list.filter(run => run.status === 'running' && !run.runId.startsWith(DEMO)))
      return { text: 'Finished workflow run cleared.' }
    }
    const demo = /^demo(?: (end|plan|plan end|plan merge))?$/.exec(e.args.trim())
    if (demo !== null) {
      const at = await $.clock.now()
      const variant = demo[1] ?? ''
      const isPlan = variant.startsWith('plan')
      const isMerged = variant === 'plan merge'
      const isFinished = variant !== '' && variant !== 'plan'
      const loaded = isMerged ? demoMergeRuns(at) : isPlan ? demoPlanRuns(at, isFinished) : demoRuns(at, isFinished)
      await update($, runs, list => [...list.filter(run => !run.runId.startsWith(DEMO)), ...loaded].slice(-KEPT_RUNS))
      const shown = loaded[loaded.length - 1]
      if (shown !== undefined) await update($, feed, () => demoFeedOf(shown, at, isPlan, isFinished, isMerged))
      await update($, nav, state => ({ ...state, lot: null, screen: 'run' as const, prompted: null, notice: null }))
      await update($, history, () => demoHistory())
      await update($, now, () => at)
      await refreshUsage($)
      await openPane($)
      return { text: `Demo workflow run loaded${isFinished ? ' (finished)' : ''} (/run-lot-pane clear removes them).` }
    }
    await openPane($)
    return { text: 'Workflow pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const agentId = e.agentId
      if (isFollowed(await read($, runs), agentId)) {
        const isStructured = (e.tool as string) === 'StructuredOutput'
        const audit = isStructured ? auditOf(e) : null
        if (audit !== null) await update($, runs, list => withAudit(list, agentId, audit))
        const input = e as unknown as Record<string, unknown>
        const calledAt = await $.clock.now()
        const callId = typeof e.tool_use_id === 'string' && e.tool_use_id !== '' ? e.tool_use_id : `call-${(sequence += 1)}`
        const brief = callBrief(e.tool, input, root)
        const structured = isStructured ? structuredLines(input) : null
        await update($, runs, list =>
          withAgent(list, agentId, agent => ({
            ...agent,
            structured: structured ?? agent.structured,
            calls: withCall(agent.calls, { id: callId, tool: e.tool, brief, at: calledAt, state: 'running', error: null }),
            lastTool: e.tool,
            tools: agent.tools + 1,
            openCalls: agent.openCalls + 1,
            toolSince: agent.openCalls === 0 ? calledAt : agent.toolSince,
            lastActiveAt: calledAt,
            toolCounts: { ...agent.toolCounts, [e.tool]: (agent.toolCounts[e.tool] ?? 0) + 1 },
          })),
        )
        const answered = await next(e).catch(async (failure: unknown) => {
          const detail = failure instanceof Error ? firstLine(failure.message, 200) : 'failed'
          await update($, runs, list => withAgent(list, agentId, agent => ({ ...agent, calls: closedCall(agent.calls, callId, detail) })))
          await closeCall($, agentId)
          throw failure
        })
        await closeCall($, agentId)
        const detail = errorDetail(answered)
        const error = errorOf(e.tool, answered, brief)
        const path = editedPath(e.tool, input)
        await update($, runs, list =>
          withAgent(list, agentId, agent => ({
            ...agent,
            calls: closedCall(agent.calls, callId, detail),
            lastError: error ?? agent.lastError,
            files: path !== null && error === null ? withFile(agent.files, relativePath(path, root)) : agent.files,
          })),
        )
        return answered
      }
      return next(e)
    }
    if (e.tool !== 'Workflow') return next(e)

    const argument = argumentOf(e as unknown as Record<string, unknown>)
    const before = await $.clock.now()
    const result = await next(e)
    const launched = result.result as Launched | null | undefined
    if (!launched || launched.status !== 'async_launched' || launched.runId === undefined) return result
    const runId = launched.runId
    const script = launched.scriptPath === undefined ? null : await readText($, launched.scriptPath)
    const declared = script === null ? [] : parsePhases(script)
    const childName = script === null ? null : childWorkflowOf(script)
    const childFound = childName === null || root === null ? null : await childScriptOf($, script!, childName, root, launched.transcriptDir ?? launched.scriptPath)
    const childScript = childFound?.text ?? null
    const childPhases = childScript === null ? [] : parsePhases(childScript)
    const child: ChildWorkflow | null =
      childName === null
        ? null
        : {
            name: childName,
            phases: childPhases.map(phase => phase.title),
            details: detailsOf(childPhases),
            labels: childScript === null ? {} : labelPhasesOf(childScript),
            script: childFound?.path ?? null,
          }
    const plan = child === null ? null : planPathOf(argument)
    const planText = plan === null ? null : await readText($, plan)
    const at = await $.clock.now()
    await update($, runs, list =>
      withInterrupted(
        withRun(list, runId, at, run => ({
          ...run,
          name: launched.workflowName ?? run.name,
          argument: argument ?? run.argument,
          phases: declared.length > 0 ? declared.map(phase => phase.title) : run.phases,
          details: declared.length > 0 ? detailsOf(declared) : run.details,
          transcriptDir: launched.transcriptDir ?? run.transcriptDir,
          launchedAt: before,
          status: 'running',
          durationMs: null,
          outcome: null,
          audit: null,
          sheet: null,
          child,
          plan,
          lots: planText === null ? [] : parsePlanLots(planText),
        })),
        runId,
        before,
      ),
    )
    await update($, now, () => at)
    await refreshUsage($)
    await openPane($)
    const launchedRun = (await read($, runs)).find(run => run.runId === runId)
    if (launchedRun !== undefined) void learnHistory($, launchedRun)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const followed = e.agentId
    const live = followed === undefined ? null : await startStream($, followed)
    const stream = next(e)
    try {
      for await (const chunk of stream) {
        yield chunk
        if (live !== null && followed !== undefined) await noteChunk($, followed, live, chunk)
      }
    } finally {
      if (live !== null && followed !== undefined) await endStream($, followed, live)
    }
    const result = await stream.result
    try {
      const agentId = e.agentId
      const used = result.usage
      if (agentId === undefined || used === null || !isFollowed(await read($, runs), agentId)) return result
      const at = await $.clock.now()
      const effort = e.effort === undefined ? null : String(e.effort)
      await update($, runs, stored => withRequest(stored, agentId, used, effort, at))
    } catch {
      return result
    }
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (e.workflow === undefined || e.workflow.runId === '' || 'deny' in spawned || spawned.agentId === undefined) {
      return spawned
    }
    const { runId, agentIndex } = e.workflow
    const agentId = spawned.agentId
    const at = await $.clock.now()
    const found = promptLotOf(e.prompt)
    const label = e.description || e.subagentType
    const agent = {
      ...blankAgent(agentId, agentIndex, label, shortModel(spawned.model), e.subagentType, e.prompt, at),
      lot: found?.lot ?? null,
    }
    await update($, runs, list =>
      withRun(list, runId, at, run => ({
        ...run,
        status: 'running',
        agents: [...run.agents.filter(one => one.id !== agentId), agent],
        lots: found === null || run.child === null ? run.lots : withLot(run.lots, found.lot, one => ({ ...one, sheet: one.sheet ?? found.sheet })),
      })),
    )
    const owner = (await read($, runs)).find(run => run.runId === runId)
    const dir = owner?.transcriptDir
    if (dir) {
      const phase = nestedPhaseOf(owner.child, agent.label, await metaPhase($, dir, agentId))
      if (phase !== null) await update($, runs, list => withAgent(list, agentId, one => ({ ...one, phase })))
    }
    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined && isFollowed(await read($, runs), agentId)) {
      const at = await $.clock.now()
      const state = e.isAborted || e.reason === 'error' || e.reason === 'refusal' ? 'error' : 'done'
      const answer = (e as { answer?: unknown }).answer
      const parsed = typeof answer === 'string' ? jsonOf(answer) : null
      const structured = structuredLines(parsed)
      const audit = auditOf(parsed)
      if (audit !== null) await update($, runs, list => withAudit(list, agentId, audit))
      await update($, runs, list =>
        withAgent(list, agentId, agent => ({
          ...agent,
          state,
          endedAt: at,
          lastActiveAt: at,
          openCalls: 0,
          ...QUIET,
          structured: structured ?? agent.structured,
          answer: structured === null && typeof answer === 'string' && answer.trim() !== '' ? firstLine(answer, 400) : agent.answer,
        })),
      )
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    const Input = e.surface === 'terminal' || e.surface === 'desktop' || e.surface === 'vscode' ? $.ui.resolve(e).Input : undefined
    const accent = e.surface === 'desktop' ? 'claude' : undefined
    const tddTone = (label: string) => (e.surface !== 'desktop' ? undefined : label === 'RED' ? 'error' : label === 'GREEN' ? 'success' : undefined)
    // On a desktop a row's text tells its stage apart, not its glyph alone: done in grey,
    // running in bold, to come lighter and in italics. The terminal keeps its own styles.
    type Stage = 'done' | 'running' | 'pending'
    const staged = (stage: Stage, terminal: { color?: string; bold?: boolean }, tone?: string) =>
      e.surface !== 'desktop'
        ? terminal
        : stage === 'done'
          ? { color: tone ?? 'inactive' }
          : stage === 'running'
            ? { color: tone, bold: true }
            : { color: 'subtle', italic: true }
    const list = (await read($, runs)).map(completeRun)
    const at = await read($, now)
    const session = await read($, usage)
    const where = await read($, nav)
    const known = await read($, history)
    const kept = await read($, feed)
    const last = list[list.length - 1]
    const runFeed = kept !== null && last !== undefined && kept.runId === last.runId ? kept : null
    const steer = feedViewOf(runFeed)
    const banner = last?.status === 'running' ? questionBanner(steer.questions, at) : null
    const bannerRow =
      banner === null ? null : (
        <Box key="question-banner" height={1}>
          <Text bold color={WAITING_TONE} wrap="truncate-end">
            {'  '}
            {banner}
          </Text>
        </Box>
      )
    const planRun = last !== undefined && last.child !== null ? last : null
    const lotInView = planRun !== null && where.lot !== null && planRun.lots.some(one => one.lot === where.lot) ? where.lot : null
    const current = planRun !== null && lotInView !== null ? lotRun(planRun, lotInView) : last
    const columns = e.props.bodyColumns
    const spin = spinnerFrame(at)
    // A desktop's proportional font draws the bar wider than its columns: kept shorter there.
    const barWidth = Math.max(8, Math.min(e.surface === 'desktop' ? 28 : 40, columns - 28))
    const go = (change: Partial<Navigation>) => () => void update($, nav, state => ({ ...state, prompted: null, notice: null, ...change }))
    const close = <Button key="close" label="✕" plain dimColor onPress={() => closePane($)} />
    // A desktop draws a Button natively, its children's colours dropped: there the row keeps
    // its own colours and a trailing › opens it; the terminal presses the whole row.
    const pressable = (key: string, onPress: () => void, content: JSX.Element | JSX.Element[], hotkey?: string) =>
      e.surface === 'desktop' ? (
        <Box key={`${key}-row`}>
          {content}
          <Text> </Text>
          <Button key={key} label="›" hotkey={hotkey} plain dimColor onPress={onPress} />
        </Box>
      ) : (
        <Button key={key} hotkey={hotkey} plain onPress={onPress}>
          {content}
        </Button>
      )

    const mergeBlock = (key: string, merge: KnowledgeMerge) =>
      mergeRows(merge).map((row, index) => (
        <Text key={`${key}-${index}`} wrap="wrap" bold={row.bold} color={row.tone}>
          {row.text}
        </Text>
      ))

    const reasonBlock = (key: string, reason: string) =>
      reasonLines(reason, columns - 7).map((line, index) => (
        <Text
          key={`${key}-${index}`}
          wrap="truncate-end"
          bold={line.kind === 'cause'}
          color={line.kind === 'context' ? 'inactive' : undefined}
        >
          {line.text}
        </Text>
      ))
    const row = (key: string, left: JSX.Element, right?: JSX.Element | JSX.Element[], wraps = false) => (
      <Box key={key} {...(wraps ? { minHeight: 1 } : { height: 1 })}>
        <Box flexGrow={1} flexShrink={1}>
          {left}
        </Box>
        {right}
      </Box>
    )

    const agentTone = (agent: WorkflowAgent) =>
      agent.state === 'running' ? 'claude' : agent.state === 'error' ? 'error' : agent.state === 'interrupted' ? 'inactive' : 'success'
    const agentGlyph = (agent: WorkflowAgent) =>
      agent.state === 'running' ? spin : agent.state === 'error' ? '✗' : agent.state === 'interrupted' ? '⊘' : '✓'
    const stallOf = (agent: WorkflowAgent) => stallReasons(agent, typicalTools(known, current?.agents ?? [], agent), at)
    const agentAge = (agent: WorkflowAgent) => duration((agent.endedAt ?? at) - agent.startedAt)
    const markTone = (mark: PhaseRow['mark']) => (mark === 'running' ? 'claude' : mark === 'done' ? 'success' : 'inactive')
    const markGlyph = (mark: PhaseRow['mark']) => (mark === 'running' ? spin : mark === 'done' ? '⏺' : '○')

    const section = (key: string, title: string, lines: JSX.Element[]) => (
      <Box key={key} flexDirection="column" marginTop={1}>
        <Text bold color={accent}>
          {title}
        </Text>
        {lines}
      </Box>
    )
    const line = (key: string, text: string, color?: string, wrap: 'truncate-end' | 'truncate-start' | 'wrap' = 'truncate-end') => (
      <Text key={key} color={color} wrap={wrap}>
        {'  '}
        {text}
      </Text>
    )

    const callRows = (agent: WorkflowAgent, call: ToolTrace, width: number) => {
      const isStuck = call.state === 'running' && agent.state !== 'running'
      const recovered = call.state === 'error' && agent.calls.slice(agent.calls.indexOf(call) + 1).some(one => one.state === 'ok')
      const tone = call.state === 'ok' ? 'success' : call.state === 'error' ? (recovered ? 'warning' : 'error') : isStuck ? 'inactive' : 'claude'
      const glyph = call.state === 'ok' ? '✓' : call.state === 'error' ? '✗' : isStuck ? '⊘' : spin
      const rows = [
        <Text key={`call-${call.id}`} wrap="truncate-end">
          {'  '}
          <Text color="inactive">{clockOf(call.at - agent.startedAt).padStart(5)} </Text>
          <Text color={tone}>{glyph} </Text>
          {call.tool.padEnd(width)} <Text color="inactive">{call.brief}</Text>
        </Text>,
      ]
      if (call.error !== null) {
        rows.push(
          <Text key={`call-error-${call.id}`} color={recovered ? 'inactive' : 'error'} wrap="wrap">
            {'          ⎿ '}
            {call.error}
          </Text>,
        )
      }
      return rows
    }

    const agentButton = (agent: WorkflowAgent, prefix: string, from: Screen, mark = '') => (
      <Box key={`agent-${agent.id}`} height={1}>
        <Text color="inactive">{prefix}</Text>
        {pressable(
          `open-${agent.id}`,
          go({ screen: 'agent', agentId: agent.id, back: from }),
          [
            <Text key="glyph" color={agentTone(agent)}>{agentGlyph(agent)} </Text>,
            <Text key="label" color={agent.state === 'error' ? 'error' : agent.state === 'running' ? undefined : 'inactive'}>{agent.label}</Text>,
            <Text key="meta" color="inactive">
              {' '}
              · {agentAge(agent)}
              {activityOf(agent, at) === null ? '' : ` · ${activityOf(agent, at)}`}
              {agent.state === 'running' && agent.lastTool !== null ? ` · ${agent.lastTool} (${agent.tools})` : ''}
              {agent.tokens > 0 ? ` · ctx ${kilo(agent.context)} · ${kilo(agent.tokens)} tok` : ''}
            </Text>,
            ...(mark !== '' ? [<Text key="mark" color="warning"> {mark}</Text>] : []),
          ],
        )}
      </Box>
    )

    const crumbs = (trail: string, title: string) =>
      row(
        'header',
        <Text wrap="truncate-end">
          <Text color="inactive">{trail} › </Text>
          <Text bold>{title}</Text>
        </Text>,
        close,
      )

    const backBar = (target: Screen) => (
      <Box key="nav" height={1}>
        <Button key="back" hotkey="b" plain onPress={go({ screen: target })}>
          back
        </Button>
      </Box>
    )

    const isTimeline = Svg !== undefined && where.screen === 'timeline'
    const timelineButton =
      Svg === undefined ? null : (
        <Box key="timeline-bar" height={1}>
          <Text>{'  '}</Text>
          <Button key="open-timeline" hotkey="t" plain dimColor onPress={go({ screen: 'timeline' })}>
            ◫ timeline
          </Button>
        </Box>
      )

    const lotTone = (state: LotState) =>
      state === 'running' ? 'claude' : state === 'completed' ? 'success' : state === 'killed' ? 'warning' : state === 'failed' ? 'error' : state === 'waiting' ? WAITING_TONE : 'inactive'
    const lotGlyph = (state: LotState) =>
      state === 'running' ? spin : state === 'completed' || state === 'done' ? '✓' : state === 'pending' ? '○' : state === 'killed' ? '⏹' : state === 'waiting' ? '?' : '✗'
    const openLot = (lot: string | null) => go({ lot, screen: 'run', phase: null, agentId: null, toggled: [] })
    const lotBar =
      planRun === null ? null : (
        <Box key="lots" height={1}>
          <Button key="plan" hotkey="p" plain dimColor={lotInView !== null} onPress={openLot(null)}>
            plan
          </Button>
          {planRun.lots.map((entry, index) => {
            const state = lotStateOf(planRun, entry)
            const label = (
              <Text key={`label-${entry.lot}`}>
                <Text color={lotTone(state)}>{lotGlyph(state)} </Text>
                <Text bold={entry.lot === lotInView} color={entry.lot === lotInView ? undefined : 'inactive'}>
                  {entry.lot}
                </Text>
              </Text>
            )
            return (
              <Box key={`lot-${entry.lot}`}>
                <Text>{'  '}</Text>
                {planRun.agents.some(agent => agent.lot === entry.lot) ? (
                  pressable(`open-lot-${entry.lot}`, openLot(entry.lot), label, index < 9 ? String(index + 1) : undefined)
                ) : (
                  label
                )}
              </Box>
            )
          })}
        </Box>
      )

    const timelineScreen = (name: string, source: string, alt: string) => (
      <Box flexDirection="column" marginTop={1}>
        {crumbs(name, 'timeline')}
        {backBar('run')}
        {lotBar}
        {bannerRow}
        {Svg === undefined || source === '' ? (
          <Text key="timeline-empty" color="inactive">
            {'  ⎿  '}Nothing to draw yet.
          </Text>
        ) : (
          <Box key="timeline" marginTop={1}>
            <Svg key="timeline-svg" source={source} alt={alt} width={svgWidth(source)} height={svgHeight(source)} isInteractive />
          </Box>
        )}
      </Box>
    )

    if (current === undefined) {
      return (
        <Box flexDirection="column" marginTop={1}>
          {row(
            'header',
            <Text wrap="truncate-end">
              <Text color="claude">✻ </Text>
              <Text bold>Workflow</Text>
            </Text>,
            close,
          )}
          <Text color="inactive" wrap="truncate-end">
            {'  ⎿  '}No workflow run yet in this session.
          </Text>
        </Box>
      )
    }

    // What the run files say for the batch in view (a run-lot run's own batch), and the user's steering.
    const batchInView = lotInView ?? (planRun === null ? (lotOf(current.argument)?.lot ?? null) : null)
    const attempts = batchInView === null ? [] : attemptLinesOf(steer.work, batchInView)
    const retryFor = (agent: WorkflowAgent) => retryOf(current.agents, agent, attempts)
    const rounds = batchInView === null ? [] : auditRoundsOf(steer.work, batchInView)
    const sheetOfBatch = (batch: string): string | null => {
      if (planRun === null) return sheetPathOf(current.argument)
      const entry = planRun.lots.find(one => one.lot === batch)
      return entry?.sheet ?? (planRun.plan === null ? null : planRun.plan.replace(/\.md$/, `-${batch}.md`))
    }
    const entries = validateEntriesOf(runFeed, sheetOfBatch, planRun === null ? (batchInView === null ? [] : [batchInView]) : planRun.lots.map(one => one.lot)).filter(
      one => lotInView === null || one.batch === lotInView,
    )
    const unanswered = entries.filter(one => steer.answers[one.id] === undefined).length
    const notes = steer.notes.filter(one => lotInView === null || one.batch === lotInView)
    const isDoneLot = (entry: PlanLot) => ['completed', 'done'].includes(lotStateOf(planRun!, entry))
    const noteTarget =
      batchInView ??
      (planRun === null
        ? null
        : (planRun.lots.find(entry => lotStateOf(planRun, entry) === 'running') ??
            planRun.lots.find(entry => !isDoneLot(entry) && !(entry.lot in steer.asides)) ??
            planRun.lots[0])?.lot ?? null)
    const workPath = runFeed === null ? null : `${runFeed.root}/.work.jsonl`
    const absolute = (path: string) => (path.startsWith('/') || root === null ? path : `${root}/${path}`)
    const togglePause = () =>
      planRun === null
        ? update($, nav, state => ({ ...state, notice: 'pause applies to run-plan only' }))
        : writePane($, { kind: 'pause', on: steer.pause !== 'requested' })
    const ask = (prompted: Prompted) => () => update($, nav, state => ({ ...state, prompted, notice: null }))
    const submitNote = async (value: string) => {
      const text = value.trim()
      const aimed = planRun !== null && lotInView === null ? /^(F\d+)\s*:\s*([\s\S]+)$/.exec(text) : null
      const batch = aimed?.[1] ?? where.prompted?.target ?? ''
      const said = (aimed?.[2] ?? text).trim()
      if (said === '' || batch === '') return
      const stamp = Math.round(await $.clock.now()) / 1000
      await writePane($, { kind: 'note', id: `n-${stamp}`, batch, text: said }, stamp)
      await update($, nav, state => ({ ...state, prompted: null }))
    }
    const answer = async (entry: ValidateEntry, decision: Decision, text = '') => {
      const said = { batch: entry.batch, step: entry.step, text: entry.text, ...(entry.sheet === null ? {} : { sheet: entry.sheet }) }
      await writePane($, { kind: 'validation', id: entry.id, entry: said, decision, text })
      await update($, nav, state => ({ ...state, prompted: null }))
    }

    const isPlanView = planRun !== null && lotInView === null
    const gap = (key: string) => <Text key={key}>{'  '}</Text>
    const steerBar = (
      <Box key="steer-bar" height={1}>
        {gap('steer-gap')}
        <Button key="open-validate" hotkey="v" plain dimColor onPress={go({ screen: 'validate' })}>
          {`to validate${unanswered > 0 ? ` ${unanswered}` : ''}`}
        </Button>
        {isPlanView && gap('graph-gap')}
        {isPlanView && (
          <Button key="open-graph" hotkey="g" plain dimColor onPress={go({ screen: 'graph' })}>
            graph
          </Button>
        )}
        {gap('pause-gap')}
        <Button key="pause" hotkey="z" plain dimColor onPress={togglePause}>
          {steer.pause === 'requested' ? 'cancel pause' : 'pause'}
        </Button>
        {noteTarget !== null && gap('note-gap')}
        {noteTarget !== null && (
          <Button key="note" hotkey="n" plain dimColor onPress={ask({ kind: 'note', target: noteTarget })}>
            note
          </Button>
        )}
      </Box>
    )
    const steerLines = [
      ...(planRun !== null && steer.pause !== 'off'
        ? [
            <Text key="pause-state" bold={steer.pause === 'requested'} color={steer.pause === 'requested' ? 'warning' : 'inactive'} wrap="truncate-end">
              {'  '}
              {steer.pause === 'requested' ? '⏸ pause requested' : '⏸ paused by user'}
            </Text>,
          ]
        : []),
      ...(where.notice ? [line('notice', where.notice, 'inactive')] : []),
      ...(where.prompted?.kind === 'note' && Input !== undefined
        ? [
            <Box key="note-row" height={1}>
              {gap('note-input-gap')}
              <Input
                key="note-input"
                label={`note for ${where.prompted.target}: `}
                placeholder={isPlanView ? 'text, or F3: text for another batch' : 'text'}
                autoFocus
                onSubmit={value => submitNote(value)}
              />
            </Box>,
          ]
        : []),
    ]
    const notesSection =
      notes.length === 0
        ? null
        : section(
            'notes',
            `Notes · ${notes.length}`,
            notes.map(note => line(`note-${note.id}`, `${note.isTaken ? '✓' : '✎'} ${note.batch} · ${note.text} · ${note.isTaken ? 'consumed' : 'pending'}`, note.isTaken ? 'inactive' : 'warning')),
          )
    const roundRows = (indent: string) =>
      rounds.flatMap(round => [
        <Text key={`round-${round.round}`} bold={round.diverged} color={round.diverged ? 'error' : 'inactive'} wrap="truncate-end">
          {indent}
          {roundLine(round)}
        </Text>,
        ...round.contested.map((contest, index) => (
          <Text key={`round-${round.round}-contest-${index}`} color="inactive" wrap="wrap">
            {indent}
            {'  ↳ '}
            {contestLine(contest)}
          </Text>
        )),
      ])

    if (where.screen === 'validate') {
      const decided = (decision: Decision) => (decision === 'keep' ? 'kept' : decision === 'reject' ? 'rejected' : 'amended')
      const entryBlock = (entry: ValidateEntry) => {
        const given = steer.answers[entry.id]
        const said = given === undefined || given.text === '' ? '' : `: ${given.text}`
        const state =
          given === undefined
            ? { text: '○ pending answer', color: 'inactive' }
            : given.applied !== null
              ? { text: `✓ ${decided(given.decision)}${said} · applied`, color: 'success' }
              : { text: `● ${decided(given.decision)}${said} · answered, not applied yet`, color: 'warning' }
        const asked = where.prompted !== null && where.prompted !== undefined && where.prompted.target === entry.id && where.prompted.kind !== 'note' ? where.prompted.kind : null
        return (
          <Box key={`entry-${entry.id}`} flexDirection="column" marginTop={1}>
            <Text key={`entry-head-${entry.id}`} wrap="truncate-end">
              {'  '}
              <Text bold>{entry.batch === '' ? 'run' : entry.batch}</Text>
              <Text color="inactive"> · {entry.step}</Text>
            </Text>
            <Text key={`entry-text-${entry.id}`} wrap="wrap">
              {'    '}
              {entry.text}
              {entry.why === null ? '' : ` (${entry.why})`}
            </Text>
            <Text key={`entry-state-${entry.id}`} color={state.color} wrap="wrap">
              {'    '}
              {state.text}
            </Text>
            {given?.applied?.relaunch != null && line(`entry-relaunch-${entry.id}`, `  relaunch: ${given.applied.relaunch}`, 'inactive', 'wrap')}
            {given?.applied == null && (
              <Box key={`entry-actions-${entry.id}`} height={1}>
                <Text>{'    '}</Text>
                <Button key={`keep-${entry.id}`} label="✓ keep" plain dimColor onPress={() => answer(entry, 'keep')} />
                {gap(`reject-gap-${entry.id}`)}
                <Button key={`reject-${entry.id}`} label="✗ reject" plain dimColor onPress={ask({ kind: 'reject', target: entry.id })} />
                {gap(`amend-gap-${entry.id}`)}
                <Button key={`amend-${entry.id}`} label="✎ amend" plain dimColor onPress={ask({ kind: 'amend', target: entry.id })} />
              </Box>
            )}
            {asked !== null && Input !== undefined && (
              <Box key={`entry-input-${entry.id}`} height={1}>
                <Text>{'    '}</Text>
                <Input
                  key={`answer-${entry.id}`}
                  label={asked === 'reject' ? 'why reject: ' : 'amended to: '}
                  autoFocus
                  onSubmit={value => (value.trim() === '' ? undefined : answer(entry, asked, value.trim()))}
                />
              </Box>
            )}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" marginTop={1}>
          {crumbs(isPlanView ? planRun!.name : `${current.name}${batchInView === null ? '' : ` ${batchInView}`}`, 'to validate')}
          {backBar('run')}
          {lotBar}
          {bannerRow}
          {workPath !== null && line('apply-hint', `Applied at the next /run-plan or /run-lot start, or now with cctoolkit run-validate apply ${absolute(workPath)}`, 'inactive', 'wrap')}
          {entries.length === 0 && line('no-entry', 'Nothing to validate.', 'inactive')}
          {entries.map(entryBlock)}
        </Box>
      )
    }

    if (where.screen === 'graph' && planRun !== null && lotInView === null) {
      const nodes = graphNodesOf(planRun, steer, at)
      const source = planGraph(nodes)
      const graphTone = (state: GraphState) =>
        state === 'done' ? 'success' : state === 'running' ? 'claude' : state === 'question' ? WAITING_TONE : state === 'aside' || state === 'failed' ? 'error' : state === 'blocked' ? 'warning' : 'inactive'
      return (
        <Box flexDirection="column" marginTop={1}>
          {crumbs(planRun.name, 'graph')}
          {backBar('run')}
          {lotBar}
          {bannerRow}
          {Svg !== undefined && source !== '' ? (
            <Box key="graph" marginTop={1}>
              <Svg key="graph-svg" source={source} alt={planGraphAlt(nodes)} width={svgWidth(source)} height={svgHeight(source)} isInteractive />
            </Box>
          ) : (
            <Box key="graph-tree" flexDirection="column" marginTop={1}>
              {nodes.length === 0 && line('graph-empty', 'No batch in the plan table.', 'inactive')}
              {graphTreeLines(nodes).map((one, index) => (
                <Text key={`tree-${index}`} wrap="truncate-end">
                  <Text color="inactive">
                    {'  '}
                    {one.prefix}
                  </Text>
                  <Text color={graphTone(one.state)}>{one.text}</Text>
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const rows = phaseRows(current, at)
    const agentInView = where.screen === 'agent' ? current.agents.find(agent => agent.id === where.agentId) : undefined
    const phaseInView = where.screen === 'phase' ? rows.find(one => one.title === where.phase) : undefined

    if (agentInView !== undefined) {
      const agent = agentInView
      const stalls = stallOf(agent)
      const retry = retryFor(agent)
      const outcome =
        agent.answer ??
        (agent.state === 'running'
          ? 'Still running…'
          : agent.state === 'error'
            ? 'Ended in error.'
            : agent.state === 'interrupted'
              ? 'Interrupted before it answered.'
              : 'No answer.')
      const errors = errorsOf(agent)
      const outcomeColor = agent.state === 'error' ? 'error' : undefined
      const toolWidth = Math.min(10, Math.max(4, ...agent.calls.map(call => call.tool.length)))
      return (
        <Box flexDirection="column" marginTop={1}>
          {crumbs(`${current.name} › ${agent.phase ?? NO_PHASE}`, `agent ${agent.index}`)}
          {backBar(where.back)}
          {lotBar}
          {bannerRow}
          <Box marginTop={1}>
            <Text bold wrap="wrap">
              {agent.label}
            </Text>
          </Box>
          <Text wrap="truncate-end">
            {'  '}
            <Text color={agentTone(agent)}>
              {agentGlyph(agent)} {agent.state}
            </Text>
            <Text color="inactive">
              {' '}
              · {modelLabel(agent)} · {agent.type} · {agentAge(agent)}
            </Text>
          </Text>
          {activityOf(agent, at) !== null && (
            <Text wrap="truncate-end">
              {'  '}
              {activityOf(agent, at)}
            </Text>
          )}
          {stalls.length > 0 && (
            <Text color="warning" wrap="truncate-end">
              {'  '}
              {stalls.join(' · ')}
            </Text>
          )}
          {retry !== null &&
            section(
              'retries',
              `Retries · ↻ ${retry.attempt}`,
              retry.reasons.map((reason, index) => line(`retry-${index}`, `attempt ${index + 1} rejected: ${reason}`, 'warning', 'wrap')),
            )}
          {section('usage', 'Usage', [
            line(
              'ctx',
              agent.tokens === 0
                ? 'no model call yet'
                : `ctx ${kilo(agent.contextStart)} ↗ ${kilo(agent.contextPeak)} · now ${kilo(agent.context)}`,
            ),
            line('tok', `${kilo(agent.tokens)} tok`),
          ])}
          {section(
            'outcome',
            'Outcome',
            (agent.structured ?? [outcome]).map((text, index) =>
              line(`outcome-${index}`, text, index === 0 ? outcomeColor : undefined, 'wrap'),
            ),
          )}
          {errors.last !== null &&
            section(
              'error',
              `Errors · ${errors.count}${errors.isRecovered ? (errors.count > 1 ? ' · all recovered' : ' · recovered') : ''}`,
              [line('error', `${errors.last.tool}${errors.last.brief === '' ? '' : ` · ${errors.last.brief}`}: ${errors.last.error ?? 'error'}`, errors.isRecovered ? 'inactive' : 'error', 'wrap')],
            )}
          {errors.last === null && agent.lastError !== null && section('error', 'Last error', [line('error', agent.lastError, 'error', 'wrap')])}
          {agent.files.length > 0 &&
            section(
              'files',
              `Files modified · ${agent.files.length}`,
              agent.files.map(path => line(`file-${path}`, path, undefined, 'truncate-start')),
            )}
          {section(
            'prompt',
            'Prompt',
            (agent.prompt === '' ? ['—'] : agent.prompt.split('\n')).map((text, index) => line(`prompt-${index}`, text, 'inactive', 'wrap')),
          )}
          {section('tools', `Activity · ${agent.tools} call${agent.tools > 1 ? 's' : ''}`, [
            line('summary', agent.tools === 0 ? 'none yet' : toolSummary(agent.toolCounts), 'inactive'),
            ...[...agent.calls].reverse().flatMap(call => callRows(agent, call, toolWidth)),
            ...(agent.tools > agent.calls.length && agent.calls.length > 0
              ? [line('dropped', `… ${agent.tools - agent.calls.length} earlier calls not kept`, 'inactive')]
              : []),
          ])}
        </Box>
      )
    }

    if (phaseInView !== undefined) {
      const phase = phaseInView
      const insight = phaseInsight(phase, current, at)
      return (
        <Box flexDirection="column" marginTop={1}>
          {crumbs(current.name, phase.title)}
          {backBar('run')}
          {lotBar}
          {bannerRow}
          <Text wrap="truncate-end">
            {'  '}
            <Text color={markTone(phase.mark)}>
              {markGlyph(phase.mark)} {phase.mark}
            </Text>
            <Text color="inactive">
              {' '}
              · step {rows.indexOf(phase) + 1}/{rows.length}
              {phase.agents.length > 0 ? ` · ${duration(phase.span)}` : ''}
            </Text>
          </Text>
          {phase.agents.length > 0 && (
            <Text color="inactive" wrap="truncate-end">
              {'  '}
              {figuresLine(insight.totals)}
              {insight.share !== null ? ` · ${insight.share}% of run tokens` : ''}
            </Text>
          )}
          {section(
            'agents',
            `Agents · ${phase.agents.length}`,
            phase.agents.length === 0
              ? [line('none', 'No agent yet.', 'inactive')]
              : phase.agents.map(agent =>
                  agentButton(
                    agent,
                    '  ',
                    'phase',
                    [agent.id === insight.heaviest ? '▲ most tokens' : '', agent.id === insight.slowest ? '⏱ slowest' : '', ...stallOf(agent)]
                      .filter(one => one !== '')
                      .join(' · '),
                  ),
                ),
          )}
          {phase.title === AUDIT_PHASE && rounds.length > 0 && section('rounds', `Rounds · ${rounds.length}`, roundRows('  '))}
        </Box>
      )
    }

    const isRunning = current.status === 'running'
    const elapsed = current.durationMs ?? at - current.startedAt
    const counted = current.agents.filter(isLive)
    const done = counted.filter(agent => agent.state !== 'running').length
    const remaining = remainingMs(current, rows, known)
    const headline = headlineOf(current.status, current.outcome, current.asking ?? 0)
    const tone = headline.tone
    const reached = rows.filter(one => one.mark === 'done').length
    const step = currentStep(current, rows)
    const passes = passesOf(current)
    const runTotals = totalsOf(current.agents)
    const lot = lotOf(current.argument)
    const outcome = current.outcome
    const sheet = current.sheet === null ? null : withLiveCycles(current.sheet, current.agents)
    const isWide = columns >= WIDE_COLUMNS
    const figuresWidth = COUNT_WIDTH + TIME_WIDTH + TOKENS_WIDTH
    const agentsRightWidth = figuresWidth + (isWide ? MODEL_WIDTH : 0)
    const isOpen = (phase: PhaseRow) =>
      phase.agents.length > 0 ? !where.toggled.includes(phase.title) : phase.earlier.length > 0 && where.toggled.includes(phase.title)
    const toggle = (title: string) => () =>
      void update($, nav, state => ({
        ...state,
        toggled: state.toggled.includes(title) ? state.toggled.filter(one => one !== title) : [...state.toggled, title],
      }))

    const cell = (key: string, width: number, text: string, color?: string, isLeft = false) => (
      <Box key={key} width={width} flexShrink={0} justifyContent={isLeft ? 'flex-start' : 'flex-end'}>
        <Text color={color} wrap="truncate-end">
          {text}
        </Text>
      </Box>
    )
    const figureCells = (key: string, count: string, time: string, tokens: string, timeColor = 'inactive') => [
      cell(`${key}-count`, COUNT_WIDTH, count, 'inactive'),
      cell(`${key}-time`, TIME_WIDTH, time, timeColor),
      cell(`${key}-tokens`, TOKENS_WIDTH, tokens, 'inactive'),
    ]

    const figureRow = (key: string, label: string, first: string, second: string) => (
      <Box key={key} height={1}>
        <Box width={10} flexShrink={0}>
          <Text color="inactive">
            {'  '}
            {label}
          </Text>
        </Box>
        <Box width={17} flexShrink={0}>
          <Text wrap="truncate-end">{first}</Text>
        </Box>
        <Text wrap="truncate-end">{second}</Text>
      </Box>
    )

    const agentRow = (agent: WorkflowAgent, attempt: number, typical: number | null) => {
      const isSlowAgent = isSlow(agent, typical, at)
      const stalls = stallOf(agent)
      const labelColor =
        agent.state === 'error' ? 'error' : isSlowAgent || stalls.length > 0 ? 'warning' : agent.state === 'running' ? undefined : 'inactive'
      const said = retryFor(agent)
      const shown = said?.attempt ?? attempt
      const retry = shown > 1 ? ` ↻ ${shown}` : ''
      const labelWidth = columns - 7 - agentsRightWidth - retry.length - 1
      const live = [
        activityOf(agent, at) ?? '',
        agent.lastTool === null ? '' : `${agent.lastTool} (${agent.tools})`,
        agent.tokens > 0 ? `ctx ${kilo(agent.context)}` : '',
      ].filter(one => one !== '')
      return (
        <Box key={`agent-${agent.id}`} flexDirection="column">
          {row(
            `agent-row-${agent.id}`,
            <Box>
              <Text>{'     '}</Text>
              {pressable(
                `open-${agent.id}`,
                go({ screen: 'agent', agentId: agent.id, back: 'run' }),
                [
                  <Text key="glyph" color={agentTone(agent)}>{agentGlyph(agent)} </Text>,
                  <Text key="label" {...staged(agent.state === 'running' ? 'running' : 'done', { color: labelColor }, labelColor)}>
                    {fit(agent.label, labelWidth)}
                  </Text>,
                  ...(retry !== '' ? [<Text key="retry" color="warning">{retry}</Text>] : []),
                ],
              )}
            </Box>,
            [
              ...(isWide ? [cell(`model-${agent.id}`, MODEL_WIDTH, modelLabel(agent), 'inactive', true)] : []),
              ...figureCells(`agent-${agent.id}`, '', agentAge(agent), agent.tokens > 0 ? kilo(agent.tokens) : '', isSlowAgent ? 'warning' : 'inactive'),
            ],
          )}
          {agent.state === 'running' && (live.length > 0 || stalls.length > 0) && (
            <Text wrap="truncate-end">
              <Text color="inactive">
                {'         '}
                {live.join(' · ')}
              </Text>
              {stalls.length > 0 && <Text color="warning">{`${live.length > 0 ? ' · ' : ''}${stalls.join(' · ')}`}</Text>}
            </Text>
          )}
          {(said?.reasons ?? []).map((reason, index) => (
            <Text key={`retry-${agent.id}-${index}`} color="warning" wrap="truncate-end">
              {'         '}
              {`↻ attempt ${index + 1} rejected: ${reason}`}
            </Text>
          ))}
        </Box>
      )
    }

    const phaseSuffix = (phase: PhaseRow, room: number) => {
      if (phase.title === AUDIT_PHASE && current.audit !== null) {
        return (
          <Text bold color={auditTone(current.audit)}>
            {'  '}
            {fit(auditLabel(current.audit), room - 2)}
          </Text>
        )
      }
      if (phase.earlier.length > 0 && room >= 10) {
        const previous = totalsOf(phase.earlier)
        return (
          <Text color="inactive" wrap="truncate-end">
            {'  '}
            {fit(`↻ previous pass · ${phase.earlier.length} agents · ${kilo(previous.tokens)} tok`, room - 2)}
          </Text>
        )
      }
      const wave = phase.title === 'RED' ? waveOf(current) : null
      const waveText = wave === null ? '' : `wave ${wave.wave}/${wave.total}`
      const detail = phase.detail === null || phase.mark === 'done' ? '' : phase.detail
      const text = [waveText, detail].filter(one => one !== '').join(' · ')
      if (text === '' || room < 10) return null
      return (
        <Text {...(phase.mark === 'pending' ? staged('pending', { color: 'inactive' }) : { color: 'inactive' })} wrap="truncate-end">
          {'  '}
          {fit(text, room - 2)}
        </Text>
      )
    }

    const phaseRow = (phase: PhaseRow) => {
      const hasAgents = phase.agents.length > 0
      const isToggled = hasAgents || phase.earlier.length > 0
      const room = columns - 4 - phase.title.length - (hasAgents ? figuresWidth : 0)
      const attempts = attemptsOf(phase.agents)
      return (
        <Box key={`phase-${phase.title}`} flexDirection="column">
          {row(
            `phase-row-${phase.title}`,
            <Box flexShrink={1}>
              {isToggled ? (
                <Button key={`toggle-${phase.title}`} plain dimColor onPress={toggle(phase.title)}>
                  {isOpen(phase) ? '▾' : '▸'}
                </Button>
              ) : (
                <Text> </Text>
              )}
              <Text> </Text>
              {pressable(
                `phase-${phase.title}`,
                go({ screen: 'phase', phase: phase.title }),
                [
                  <Text key="glyph" color={markTone(phase.mark)}>{markGlyph(phase.mark)} </Text>,
                  <Text
                    key="title"
                    {...staged(
                      phase.mark,
                      { bold: phase.mark === 'running', color: phase.mark === 'pending' ? 'inactive' : tddTone(phase.title) },
                      tddTone(phase.title),
                    )}
                  >
                    {phase.title}
                  </Text>,
                ],
              )}
              {phaseSuffix(phase, room)}
            </Box>,
            hasAgents ? figureCells(`phase-${phase.title}`, `${phase.agents.length}`, duration(phase.span), kilo(totalsOf(phase.agents).tokens)) : undefined,
          )}
          {isOpen(phase) &&
            phase.agents.map(agent => agentRow(agent, attempts[agent.id] ?? 1, typicalMs(known, current.agents, agent)))}
          {isOpen(phase) && phase.earlier.map(agent => agentRow(agent, 1, null))}
          {phase.title === AUDIT_PHASE && roundRows('     ')}
        </Box>
      )
    }

    const marksWidth = isWide ? 22 : 7
    const marksCell = (key: string, tdd: TddMarks | null) => (
      <Box key={key} width={marksWidth} flexShrink={0} justifyContent="flex-end">
        {tdd !== null && (
          <Text wrap="truncate-end">
            {(
              [
                ['RED', tdd.red],
                ['GREEN', tdd.green],
                ['COST', tdd.cost],
              ] as const
            ).map(([label, value], index) => (
              <Text key={label}>
                {index > 0 ? '  ' : ''}
                {isWide && <Text color={value === DONE ? (tddTone(label) ?? 'inactive') : 'inactive'}>{label} </Text>}
                <Text color={value === DONE ? 'success' : 'inactive'}>{markOf(value)}</Text>
              </Text>
            ))}
          </Text>
        )}
      </Box>
    )

    const currentSheetStep = sheet?.steps.find(one => !isStepDone(one))
    const stepRows = (shown: Sheet) =>
      shown.steps.flatMap(one => {
        const isDone = isStepDone(one)
        const isStarted = isStepStarted(one)
        const titleWidth = columns - 6 - marksWidth - 1
        return [
          row(
            `step-${one.number}`,
            <Text wrap="truncate-end">
              {'  '}
              <Text color={isDone ? 'success' : isStarted ? 'claude' : 'inactive'}>{isDone ? '✓' : isStarted ? '◐' : '○'} </Text>
              <Text
                {...staged(isDone ? 'done' : one === currentSheetStep ? 'running' : 'pending', {
                  bold: one === currentSheetStep,
                  color: isDone || one === currentSheetStep ? undefined : 'inactive',
                })}
              >
                {fit(`${one.number} ${one.title}`, titleWidth)}
              </Text>
            </Text>,
            [marksCell(`step-marks-${one.number}`, one.tdd)],
          ),
          ...one.corrections.map(correction =>
            row(
              `correction-${one.number}-${correction.id}`,
              <Text wrap="truncate-end" color={isPhaseDone(correction.tdd) ? 'inactive' : 'warning'}>
                {'    ↳ '}
                {fit(`${correction.id} ${correction.finding}`, titleWidth - 4)}
              </Text>,
              [marksCell(`correction-marks-${one.number}-${correction.id}`, correction.tdd)],
            ),
          ),
        ]
      })

    const currentCycle = sheet?.cycles?.find(one => one.state !== 'done')
    const cycleMarks = (cycle: SheetCycle) => (
      <Box key={`cycle-marks-${cycle.id}`} width={marksWidth} flexShrink={0} justifyContent="flex-end">
        <Text wrap="truncate-end">
          {(
            [
              ['RED', cycle.state !== 'pending'],
              ['GREEN', cycle.state === 'done'],
            ] as const
          ).map(([label, isReached], index) => (
            <Text key={label}>
              {index > 0 ? '  ' : ''}
              {isWide && <Text color={isReached ? (tddTone(label) ?? 'inactive') : 'inactive'}>{label} </Text>}
              {cycle.live === label ? (
                <Text color="claude">{spin}</Text>
              ) : (
                <Text color={isReached ? 'success' : 'inactive'}>{isReached ? '✓' : '·'}</Text>
              )}
            </Text>
          ))}
        </Text>
      </Box>
    )
    const cycleRows = (cycles: SheetCycle[]) =>
      cycles.flatMap(one => {
        const isDone = one.state === 'done'
        const isStarted = one.state === 'red'
        const titleWidth = columns - 6 - marksWidth - 1
        return [
          row(
            `cycle-${one.id}`,
            <Text wrap="truncate-end">
              {'  '}
              <Text color={isDone ? 'success' : isStarted ? 'claude' : 'inactive'}>{isDone ? '✓' : isStarted ? '◐' : '○'} </Text>
              <Text
                {...staged(isDone ? 'done' : one === currentCycle ? 'running' : 'pending', {
                  bold: one === currentCycle,
                  color: isDone || one === currentCycle ? undefined : 'inactive',
                })}
              >
                {fit(`${one.id} ${one.behaviour}`, titleWidth)}
              </Text>
            </Text>,
            [cycleMarks(one)],
          ),
          ...one.unreachable.map(method =>
            row(
              `cycle-unreachable-${one.id}-${method}`,
              <Text wrap="truncate-end" color="warning">
                {'    '}
                {fit(`↳ unreachable, not written: ${method}`, columns - 6)}
              </Text>,
            ),
          ),
        ]
      })

    if (planRun !== null && lotInView === null) {
      if (isTimeline) return timelineScreen(planRun.name, planTimeline(planRun, at), planTimelineAlt(planRun, at))
      const states = planRun.lots.map(entry => ({ entry, state: lotStateOf(planRun, entry) }))
      const finished = states.filter(one => one.state === 'completed' || one.state === 'done').length
      const planHeadline = headlineOf(planRun.status, planRun.outcome, planRun.lots.reduce((sum, entry) => sum + (entry.outcome === null ? (entry.asking ?? 0) : 0), 0))
      const planTone = planHeadline.tone
      const planElapsed = planRun.durationMs ?? at - planRun.startedAt
      const planTotals = totalsOf(planRun.agents)
      const supervisors = planRun.agents.filter(agent => agent.lot === null)
      const code = planRun.plan === null ? null : (planRun.plan.split('/').pop() ?? '').replace(/\.md$/, '')
      const planOutcome = planRun.outcome
      const attention = states.filter(
        ({ entry, state }) => (state === 'waiting' || state === 'failed') && entry.outcome !== null && entry.outcome.reason !== null,
      )
      const planReason =
        planOutcome?.reason == null ? '' : withoutRepeated(planOutcome.reason, attention.map(({ entry }) => entry.outcome?.reason ?? ''))
      return (
        <Box flexDirection="column" marginTop={1}>
          {row(
            'header',
            <Text wrap="truncate-end">
              <Text color="claude">✻ </Text>
              <Text bold>{planRun.name}</Text>
              {code !== null && <Text color="inactive"> · {code}</Text>}
            </Text>,
            close,
          )}
          <Text wrap="truncate-end">
            {'  '}
            <Text bold color={planTone}>
              {planRun.status === 'running' ? spin : planHeadline.glyph} {planHeadline.text}
            </Text>
            <Text>
              {'   '}
              {duration(planElapsed)}
            </Text>
            <Text color="inactive">
              {'   '}
              {finished}/{states.length} lots
            </Text>
          </Text>
          {states.length > 0 && (
            <Text wrap="truncate-end">
              {'  '}
              {progressBar(finished, states.length, barWidth).map(part => (
                <Text key={part.key} color={part.isFilled ? planTone : 'inactive'}>
                  {part.text}
                </Text>
              ))}
            </Text>
          )}
          {lotBar}
          {bannerRow}
          {timelineButton}
          {steerBar}
          {steerLines}
          {steer.breaker !== null && (
            <Box key="breaker" flexDirection="column" marginTop={1} marginLeft={2} paddingX={1} borderStyle="round" borderColor="error">
              <Text bold color="error" wrap="wrap">
                ⛔ Plan stopped — common cause
              </Text>
              {reasonBlock('breaker-cause', steer.breaker.cause)}
              <Text color="inactive" wrap="wrap">
                set aside: {steer.breaker.asides.join(', ')}
              </Text>
            </Box>
          )}
          {planOutcome !== null && (
            <Box
              key="outcome"
              flexDirection="column"
              marginTop={1}
              marginLeft={2}
              paddingX={1}
              borderStyle="round"
              borderColor={outcomeTone(planOutcome, planRun.status)}
            >
              <Text bold color={outcomeTone(planOutcome, planRun.status)} wrap="wrap">
                {planOutcome.label}
              </Text>
              {planReason !== '' && reasonBlock('plan-reason', planReason)}
              {planOutcome.report !== null && (
                <Text color="inactive" wrap="wrap">
                  Report: {relativePath(planOutcome.report, root)}
                </Text>
              )}
              {planOutcome.merge !== undefined && mergeBlock('plan-merge', planOutcome.merge)}
            </Box>
          )}
          {attention.map(({ entry, state }) => (
            <Box
              key={`attention-${entry.lot}`}
              flexDirection="column"
              marginTop={1}
              marginLeft={2}
              paddingX={1}
              borderStyle="round"
              borderColor={lotTone(state)}
            >
              <Text bold color={lotTone(state)} wrap="wrap">
                {lotGlyph(state)} {entry.lot} · {entry.outcome?.label}
              </Text>
              {reasonBlock(`reason-${entry.lot}`, entry.outcome?.reason ?? '')}
              {entry.outcome?.report != null && (
                <Text color="inactive" wrap="wrap">
                  Report: {relativePath(entry.outcome.report, root)}
                </Text>
              )}
            </Box>
          ))}
          <Box marginTop={1} flexDirection="column">
            {figureRow(
              'session',
              'Session',
              `${session.context === null ? '—' : `ctx ${kilo(session.context)}`}${session.percent === null ? '' : ` (${session.percent}%)`}`,
              '',
            )}
            {figureRow('run', 'Plan', `${kilo(planTotals.tokens)} tok`, '')}
          </Box>
          <Box marginTop={1} flexDirection="column">
            {row(
              'lots-title',
              <Text bold color={accent}>
                {'  '}
                LOTS
              </Text>,
              [
                cell('lots-count', COUNT_WIDTH, 'agents', 'inactive'),
                cell('lots-time', TIME_WIDTH, 'time', 'inactive'),
                cell('lots-tokens', TOKENS_WIDTH, 'tokens', 'inactive'),
              ],
            )}
            {states.map(({ entry, state }) => {
              const agents = planRun.agents.filter(agent => agent.lot === entry.lot)
              const view = agents.length > 0 ? lotRun(planRun, entry.lot) : null
              const left = (
                <Text key={`plan-lot-text-${entry.lot}`} wrap="wrap">
                  {'  '}
                  <Text color={lotTone(state)}>{lotGlyph(state)} </Text>
                  <Text bold={state === 'running'}>{entry.lot}</Text>
                  <Text color={state === 'failed' ? 'error' : 'inactive'}> {lotDetailOf(planRun, entry, state, at)}</Text>
                </Text>
              )
              return row(
                `plan-lot-${entry.lot}`,
                view === null ? (
                  left
                ) : (
                  pressable(`plan-open-${entry.lot}`, openLot(entry.lot), left)
                ),
                view === null
                  ? state === 'done' && entry.past
                    ? figureCells(`plan-lot-${entry.lot}`, `${entry.past.agents}`, duration(entry.past.durationMs), kilo(entry.past.tokens))
                    : figureCells(`plan-lot-${entry.lot}`, '', '', '')
                  : figureCells(
                      `plan-lot-${entry.lot}`,
                      `${agents.length}`,
                      duration(view.durationMs ?? at - view.startedAt),
                      kilo(totalsOf(agents).tokens),
                    ),
                true,
              )
            })}
          </Box>
          {notesSection}
          {supervisors.length > 0 &&
            section(
              'supervisor',
              'Supervisor',
              supervisors.map(agent => agentButton(agent, '  ', 'run')),
            )}
        </Box>
      )
    }

    if (isTimeline) return timelineScreen(current.name, phaseTimeline(current, at, known), phaseTimelineAlt(current, at, known))

    return (
      <Box flexDirection="column" marginTop={1}>
        {row(
          'header',
          <Text wrap="truncate-end">
            <Text color="claude">✻ </Text>
            <Text bold>{current.name}</Text>
            {lot !== null && <Text color="inactive"> · </Text>}
            {lot !== null && <Text bold color="claude">{lot.lot}</Text>}
            {lot !== null && <Text color="inactive"> · {lot.code}</Text>}
          </Text>,
          close,
        )}
        <Text wrap="truncate-end">
          {'  '}
          <Text bold color={tone}>
            {isRunning ? spin : headline.glyph} {headline.text}
          </Text>
          {passes.count > 1 && <Text color="warning">{`  ↻ pass ${passes.count}`}</Text>}
          <Text>
            {'   '}
            {duration(elapsed)}
          </Text>
          <Text color="inactive">
            {'   '}
            {done}/{counted.length} agents
          </Text>
          {remaining !== null && remaining > 0 && (
            <Text color="inactive">{`   ETA ~${coarse(remaining)}`}</Text>
          )}
        </Text>
        {rows.length > 0 && (
          <Text wrap="truncate-end">
            {'  '}
            {progressBar(reached, rows.length, barWidth).map(part => (
              <Text key={part.key} color={part.isFilled ? tone : 'inactive'}>
                {part.text}
              </Text>
            ))}
            <Text color="inactive">
              {'  '}
              {reached}/{rows.length} phases
            </Text>
          </Text>
        )}
        {lotBar}
        {bannerRow}
        {timelineButton}
        {steerBar}
        {steerLines}
        {outcome !== null && (
          <Box
            key="outcome"
            flexDirection="column"
            marginTop={1}
            marginLeft={2}
            paddingX={1}
            borderStyle="round"
            borderColor={outcomeTone(outcome, current.status)}
          >
            <Text bold color={outcomeTone(outcome, current.status)} wrap="wrap">
              {outcome.label}
            </Text>
            {outcome.reason !== null && reasonBlock('reason', outcome.reason)}
            {outcome.report !== null && (
              <Text color="inactive" wrap="wrap">
                Report: {relativePath(outcome.report, root)}
              </Text>
            )}
            {outcome.merge !== undefined && mergeBlock('merge', outcome.merge)}
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          {figureRow(
            'session',
            'Session',
            `${session.context === null ? '—' : `ctx ${kilo(session.context)}`}${session.percent === null ? '' : ` (${session.percent}%)`}`,
            '',
          )}
          {figureRow('run', 'Run', `${kilo(runTotals.tokens)} tok`, '')}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {row(
            'phases-title',
            <Text bold color={accent}>
              {'  '}
              PHASES
            </Text>,
            [
              cell('title-count', COUNT_WIDTH, 'agents', 'inactive'),
              cell('title-time', TIME_WIDTH, 'time', 'inactive'),
              cell('title-tokens', TOKENS_WIDTH, 'tokens', 'inactive'),
            ],
          )}
          {rows.map(phaseRow)}
        </Box>
        {sheet !== null && (
          <Box key="sheet" marginTop={1} flexDirection="column">
            {row(
              'sheet-title',
              <Text wrap="truncate-end">
                <Text bold color={accent}>
                  {'  '}
                  SHEET {sheet.lot}
                </Text>
                {sheet.hypotheses > 0 && (
                  <Text color="inactive">
                    {' '}
                    · {sheet.hypotheses} {sheet.hypotheses > 1 ? 'hypotheses' : 'hypothesis'}
                  </Text>
                )}
              </Text>,
              sheet.cycles === undefined ? (
                <Text color={sheet.isDone ? 'success' : 'inactive'}>
                  {sheet.steps.filter(isStepDone).length}/{sheet.steps.length} steps
                </Text>
              ) : (
                <Text color={isSheetDone(sheet) ? 'success' : 'inactive'}>
                  {sheet.cycles.filter(one => one.state === 'done').length}/{sheet.cycles.length} cycles
                </Text>
              ),
            )}
            {sheet.cycles === undefined ? stepRows(sheet) : cycleRows(sheet.cycles)}
          </Box>
        )}
        {notesSection}
        {step !== null && (
          <Box key="actions" marginTop={1} height={1}>
            <Text>{'  '}</Text>
            <Button key="current" hotkey="c" plain dimColor onPress={go({ screen: 'phase', phase: step.row.title })}>
              current step
            </Button>
          </Box>
        )}
      </Box>
    )
  })
}
