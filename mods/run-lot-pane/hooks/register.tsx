import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, ModelUsage, Register, TurnStepChunk } from 'claude-code'

import type {
  AuditVerdict, ChildWorkflow, Journal, Navigation, Outcome, PhaseDeclaration, PhaseSample, PhaseSamples, RunStatus, Screen, SessionFigures, Sheet,
  PlanLot, Step, StreamKind, TddMarks, WorkflowAgent, WorkflowRun,
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
const CACHE_READ_WEIGHT = 0.1
const MAIN = '(main)'
const ALERT_MS = 10_000
const ALERT_REASON = 110
const PARALLEL_PHASES = [['Global green', 'Closing'], ['Audit', 'Review']]
const KEPT_JOURNALS = 8
const SCANNED_SESSIONS = 200
const DONE = '✅'
const COUNT_WIDTH = 6
const TIME_WIDTH = 7
const COST_WIDTH = 7
const MODEL_WIDTH = 14
const WIDE_COLUMNS = 56
const SHEET_PATTERN = /-PLAN-(F\d+)\.md$/
const LOT_PATTERN = /(?:^|\/)([^/]+?)-PLAN-(F\d+)\.md$/
const CHILD_CALL = /\bworkflow\(\s*(?:['"](?:[\w-]+:)?([\w.-]+)['"]|\{\s*scriptPath:[^)]*?\/([\w.-]+)\.js)/
const PROMPT_LOT = /Workflow run-lot, batch (F\d+)\.[\s\S]*?Batch sheet: (\S+?\.md)\./
const REVIEW_LOT = /^mode: (?:lot-suivant|next-batch) \S+ (\S*?-PLAN-(F\d+)\.md)/
const PLAN_SECTIONS = ['### Execution des lots', '### Batch execution']
const PLAN_DONE = /^### (?:Lot|Batch) (F\d+)\b.*✅ DONE/gm
const REPORT_STATUS = /^## (?:STATUT|STATUS) — (\S+)/
const LOT_DONE = ['TERMINÉ', 'DONE']
const LOT_WAITING = ['ATTENTE-RÉPONSE', 'AWAITING-ANSWER']
const WAITING_TONE = 'cyan'
const REPORT_NAMES = ['rapport', 'report']
const REPORT_PHASE = 'Report'
const PLAN_LOT_PATTERN = /^(F\d+)\s+@?((?:\S*\/)?([^/\s]+)\/PLAN\.md)$/

type Launched = { status?: string; runId?: string; scriptPath?: string; workflowName?: string; transcriptDir?: string }

const runs = atom({ plugin: 'run-lot-pane', key: 'runs' } as const, [] as WorkflowRun[])
const now = atom({ plugin: 'run-lot-pane', key: 'now' } as const, 0)
const HOME: Navigation = { screen: 'run', phase: null, agentId: null, back: 'run', toggled: [], lot: null }
const nav = atom({ plugin: 'run-lot-pane', key: 'nav' } as const, HOME)
const usage = atom({ plugin: 'run-lot-pane', key: 'usage' } as const, { context: null, percent: null, cost: null } as SessionFigures)
const history = atom({ plugin: 'run-lot-pane', key: 'history' } as const, {} as PhaseSamples)

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

const USER_WAITING = ['BLOQUÉ', 'BLOCKED', 'ATTENTE-RÉPONSE', 'AWAITING-ANSWER', 'RELECTURE-BLOQUANTE', 'REVIEW-BLOCKING']

export const headlineOf = (status: RunStatus, outcome: Outcome | null): { glyph: string; text: string; tone: string } =>
  status !== 'running' && outcome !== null && USER_WAITING.includes(outcome.label)
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

export const dollars = (usd: number): string => `$${usd.toFixed(2)}`

export const coarse = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

export const promptTokens = (used: ModelUsage): number =>
  used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens

export const weightOf = (used: ModelUsage): number =>
  used.input_tokens + used.cache_creation_input_tokens + used.output_tokens + CACHE_READ_WEIGHT * used.cache_read_input_tokens

export const splitCost = (spent: number, weights: Record<string, number>): Record<string, number> => {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  if (spent <= 0 || total <= 0) return {}
  return Object.fromEntries(Object.entries(weights).map(([payer, weight]) => [payer, (spent * weight) / total]))
}

export type Totals = { context: number; tokens: number; cost: number }

export const totalsOf = (agents: WorkflowAgent[]): Totals => {
  const running = agents.filter(agent => agent.state === 'running')
  return {
    context: Math.max(0, ...(running.length > 0 ? running : agents).map(agent => agent.context)),
    tokens: agents.reduce((sum, agent) => sum + agent.tokens, 0),
    cost: agents.reduce((sum, agent) => sum + agent.cost, 0),
  }
}

export const figuresLine = (totals: Totals): string =>
  `ctx ${kilo(totals.context)} · ${kilo(totals.tokens)} tok · ${dollars(totals.cost)}`

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

export type PhaseInsight = { totals: Totals; share: number | null; costliest: string | null; slowest: string | null }

export const phaseInsight = (phase: PhaseRow, run: WorkflowRun, at: number): PhaseInsight => {
  const totals = totalsOf(phase.agents)
  const runCost = totalsOf(run.agents).cost
  const top = (score: (agent: WorkflowAgent) => number): string | null =>
    phase.agents.length < 2 ? null : ([...phase.agents].sort((a, b) => score(b) - score(a))[0]?.id ?? null)
  return {
    totals,
    share: runCost > 0 ? Math.round((totals.cost / runCost) * 100) : null,
    costliest: totals.cost > 0 ? top(agent => agent.cost) : null,
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

const literalPrefixesOf = (expression: string): string[] =>
  [...expression.matchAll(/(['"`])((?:(?!\1).)*)\1/g)].map(found => (found[2] ?? '').split('${')[0] ?? '').filter(label => label !== '')

const forwardedLabelsOf = (script: string, lines: string[], at: number, parameter: string): string[] => {
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

export const labelPhasesOf = (script: string): Record<string, string> => {
  const lines = script.split('\n')
  return Object.fromEntries(
    lines.flatMap((text, at) => {
      const phase = /\bphase\s*:\s*(['"`])((?:(?!\1).)+)\1/.exec(text)?.[2]
      if (phase === undefined) return []
      const start = text.search(/\blabel\s*:/)
      const expression = start < 0 ? null : text.slice(start).replace(/^label\s*:/, '').split(/,\s*\w+\s*:/)[0] ?? ''
      const forwarded = expression === null ? (/\blabel\s*[,}]/.test(text) ? 'label' : null) : (/^\s*(\w+)\s*}?\s*$/.exec(expression)?.[1] ?? null)
      const labels = forwarded !== null ? forwardedLabelsOf(script, lines, at, forwarded) : literalPrefixesOf(expression ?? '')
      return labels.map(label => [label, phase])
    }),
  )
}

export const nestedPhaseOf = (child: ChildWorkflow | null, label: string, phase: string | null): string | null => {
  if (child === null || (phase !== null && !phase.startsWith('▸ '))) return phase
  const prefix = Object.keys(child.labels ?? {})
    .filter(one => label.startsWith(one))
    .sort((a, b) => b.length - a.length)[0]
  return prefix === undefined ? phase : (child.labels[prefix] ?? phase)
}

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
    return textOf(fields.fiche) ?? textOf(fields.plan)
  }
  return textOf(given)
}

const planLotOf = (argument: string | null): { lot: string; code: string; plan: string } | null => {
  const found = argument === null ? null : PLAN_LOT_PATTERN.exec(argument)
  return found?.[1] === undefined || found[2] === undefined || found[3] === undefined
    ? null
    : { lot: found[1], code: found[3], plan: found[2] }
}

export const lotOf = (argument: string | null): { lot: string; code: string } | null => {
  const inPlan = planLotOf(argument)
  if (inPlan !== null) return { lot: inPlan.lot, code: inPlan.code }
  const found = argument === null ? null : LOT_PATTERN.exec(argument)
  return found?.[1] === undefined || found[2] === undefined ? null : { lot: found[2], code: found[1] }
}

export const sheetPathOf = (argument: string | null): string | null =>
  planLotOf(argument)?.plan ?? (argument !== null && SHEET_PATTERN.test(argument) ? argument : null)

export const childWorkflowOf = (script: string): string | null => {
  const found = CHILD_CALL.exec(script)
  return found?.[1] ?? found?.[2] ?? null
}

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
  return table.slice(2).flatMap(line => {
    const cells = cellsOf(line)
    const lot = /F\d+/.exec(cells[lotAt] ?? '')?.[0]
    if (lot === undefined) return []
    const deps = depsAt < 0 ? [] : ((cells[depsAt] ?? '').match(/F\d+/g) ?? [])
    return [{ ...blankLot(lot), deps, isDone: done.has(lot) }]
  })
}

export const mergeLots = (known: PlanLot[], planned: PlanLot[]): PlanLot[] => [
  ...planned.map(one => {
    const seen = known.find(other => other.lot === one.lot)
    return seen === undefined ? one : { ...seen, deps: one.deps, isDone: one.isDone }
  }),
  ...known.filter(other => !planned.some(one => one.lot === other.lot)),
]

export const withLot = (lots: PlanLot[], lot: string, change: (one: PlanLot) => PlanLot): PlanLot[] =>
  lots.some(one => one.lot === lot) ? lots.map(one => (one.lot === lot ? change(one) : one)) : [...lots, change(blankLot(lot))]

export const reportPathsOf = (sheet: string, lot: string): string[] =>
  REPORT_NAMES.map(name => `${sheet.slice(0, sheet.lastIndexOf('/') + 1)}run/${lot}/${lot}-${name}.md`)

export const reportOutcomeOf = (text: string, path: string): Outcome | null => {
  const status = REPORT_STATUS.exec(text.split('\n')[0] ?? '')?.[1]
  if (status === undefined) return null
  const reason = /^(?:Raison|Reason)\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null
  return { label: status, reason: reason === null || reason === '—' ? null : reason, report: path }
}

export type LotState = RunStatus | 'pending' | 'done' | 'waiting'

export const lotStateOf = (run: WorkflowRun, entry: PlanLot): LotState => {
  const agents = run.agents.filter(agent => agent.lot === entry.lot)
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

export const lotRun = (run: WorkflowRun, lot: string): WorkflowRun => {
  const entry = run.lots.find(one => one.lot === lot) ?? blankLot(lot)
  const agents = run.agents
    .filter(agent => agent.lot === lot)
    .map(agent => ({ ...agent, phase: nestedPhaseOf(run.child, agent.label, agent.phase) }))
  const state = lotStateOf(run, entry)
  const status: RunStatus = state === 'pending' || state === 'done' || state === 'waiting' ? 'completed' : state
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
  return { label, reason: reason === '—' ? null : reason, report: textOf(fields.rapport) ?? textOf(fields.report) }
}

export const outcomeTone = (outcome: Outcome, status: RunStatus): 'success' | 'warning' | 'error' | typeof WAITING_TONE => {
  if (['TERMINÉ', 'DONE'].includes(outcome.label)) return 'success'
  if (LOT_WAITING.includes(outcome.label)) return WAITING_TONE
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

export type Sample = { phase: string; ms: number; tools: number | null; startedAt: number | null }

export const samplesOf = (text: string): Sample[] => {
  const raw = recordOf(text)
  if (raw === null) return []
  const isComplete = raw.status === 'completed'
  return (Array.isArray(raw.workflowProgress) ? raw.workflowProgress : []).flatMap(entry =>
    entry?.type === 'workflow_agent' && entry.state === 'done' && typeof entry.phaseTitle === 'string' && typeof entry.durationMs === 'number'
      ? [
          {
            phase: entry.phaseTitle as string,
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
    const found = bounds[sample.phase]
    const end = sample.startedAt + sample.ms
    bounds[sample.phase] = { from: Math.min(found?.from ?? sample.startedAt, sample.startedAt), to: Math.max(found?.to ?? end, end) }
  }
  return Object.entries(bounds).map(([phase, one]) => ({ phase, ms: one.to - one.from }))
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
  if (agent.streamKind === null || agent.firstChunkAt === null || agent.lastChunkAt === null) return null
  const span = agent.lastChunkAt - agent.firstChunkAt
  return span < 1000 ? null : agent.streamChars / CHARS_PER_TOKEN / (span / 1000)
}

export const liveSignalOf = (agent: WorkflowAgent, at: number): string | null => {
  if (agent.state !== 'running') return null
  if (agent.openCalls > 0) return agent.toolSince !== null && at - agent.toolSince > STALL_TOOL_MS ? 'outil long' : null
  if (agent.waitingSince !== null) return at - agent.waitingSince > STALL_WAIT_MS ? 'attente' : null
  const idle = at - Math.max(agent.lastActiveAt, agent.lastChunkAt ?? 0)
  if (idle > STALL_IDLE_MS) return `idle ${Math.floor(idle / 60_000)}m`
  const rate = throughputOf(agent)
  const span = (agent.lastChunkAt ?? 0) - (agent.firstChunkAt ?? at)
  return rate !== null && span > STALL_SLOW_MS && rate < SLOW_RATE ? 'lent' : null
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

const STREAM_LABELS: Record<StreamKind, string> = { thinking: 'réflexion', output: 'sortie', tool: 'outil' }

export const characters = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace('.', ',')}M car.`
  const tenths = Math.round(count / 100)
  if (tenths >= 100) return `${Math.round(count / 1000)}k car.`
  if (count >= 1000) return `${(tenths / 10).toFixed(1).replace('.', ',')}k car.`
  return `${count} car.`
}

export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`
}

export const activityOf = (agent: WorkflowAgent, at: number): string | null => {
  if (agent.state !== 'running') return null
  if (agent.openCalls > 0 && agent.toolSince !== null) return `outil ${agent.lastTool ?? '?'} ${elapsed(at - agent.toolSince)}`
  if (agent.waitingSince !== null) return `○ attente modèle ${elapsed(at - agent.waitingSince)}`
  if (agent.streamKind === null) return null
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

const LOT_STATE = /\s+—\s+(?:✅|⬜)\s*$/

export const parseLotSection = (text: string, lot: string): Sheet | null => {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => new RegExp(`^## Lot ${lot}\\b`).test(line))
  const heading = lines[start]
  if (heading === undefined) return null
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const name = heading.replace(LOT_STATE, '').split(' — ').slice(1).join(' — ')
  const steps: Step[] = []
  let section = ''
  let hypotheses = 0
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    if (line.startsWith('### ')) section = line.slice(4).trim()
    if (/^H[yi]poth[eè]ses/i.test(section) && /^\s*[-*]\s+\**H\d+\b/.test(line)) hypotheses += 1
    const step = /^#### [EÉ]tape (\S+) — (.+)$/.exec(line)
    if (step) {
      const title = step[2] ?? ''
      steps.push({ number: step[1] ?? '', title: title.replace(LOT_STATE, ''), isDone: /—\s+✅\s*$/.test(title), tdd: null, corrections: [] })
    }
  }
  const isDone = /—\s+✅\s*$/.test(heading) || (steps.length > 0 && steps.every(isStepDone))
  return { lot, name, isDone, steps, hypotheses }
}

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
  return { lot, name, isDone, steps, hypotheses }
}

export type PhaseRow = {
  title: string
  detail: string | null
  mark: 'done' | 'running' | 'pending'
  agents: WorkflowAgent[]
  span: number
}

const isLive = (agent: WorkflowAgent): boolean => agent.state !== 'interrupted'

export const isStaleReport = (agents: WorkflowAgent[], agent: WorkflowAgent): boolean =>
  agent.phase === REPORT_PHASE &&
  agent.endedAt !== null &&
  agents.some(other => other.phase !== REPORT_PHASE && isLive(other) && other.startedAt > (agent.endedAt ?? 0))

export const phaseRows = (run: WorkflowRun, at: number): PhaseRow[] => {
  const titles = [...run.phases]
  for (const agent of run.agents) {
    const title = agent.phase ?? NO_PHASE
    if (!titles.includes(title)) titles.push(title)
  }
  const current = run.agents.filter(agent => !isStaleReport(run.agents, agent))
  const reached = Math.max(-1, ...current.filter(isLive).map(agent => titles.indexOf(agent.phase ?? NO_PHASE)))
  return titles
    .map((title, index) => {
      const agents = current.filter(agent => (agent.phase ?? NO_PHASE) === title)
      const isRunning = agents.some(agent => agent.state === 'running')
      const starts = agents.map(agent => agent.startedAt)
      const ends = agents.map(agent => agent.endedAt ?? at)
      const span = agents.length === 0 ? 0 : Math.max(...ends) - Math.min(...starts)
      const mark: PhaseRow['mark'] = isRunning ? 'running' : index <= reached && agents.some(isLive) ? 'done' : 'pending'
      return { title, detail: run.details[title] ?? null, mark, agents, span }
    })
    .filter(row => row.title !== NO_PHASE || row.agents.length > 0)
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
  for (const row of rows.filter(one => one.mark !== 'done')) {
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

export const fit = (text: string, width: number): string =>
  width < 1 ? '' : text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text

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

const withCosts = (list: WorkflowRun[], shares: Record<string, number>) =>
  list.map(run =>
    run.status === 'running' && run.agents.some(agent => shares[agent.id] !== undefined)
      ? { ...run, agents: run.agents.map(agent => ({ ...agent, cost: agent.cost + (shares[agent.id] ?? 0) })) }
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
  tokens: 120_000 + index * 30_000, cost: 0.08 + index * 0.03,
  prompt: options.lot === null ? `Workflow run-plan, supervisor step. ${label}.` : `Workflow run-lot, batch ${options.lot ?? 'F4'}. ${label}.`,
  answer: state === 'running' || state === 'error' || state === 'interrupted' ? null : (options.answer ?? `${label}: done, tests green.`),
  toolCounts: { Read: 4 + index, Bash: index, Edit: index > 3 ? 3 : 0, Grep: 2 },
  files: index > 3 ? ['src/Acme.Application/Catalog/Products/CreateProduct/CreateProductCommandHandler.cs'] : [],
  lastError: state === 'error' ? 'Bash: dotnet test exited with code 1 (2 failed)' : null,
  ...options.live,
})

const demoSheet = (isFinished: boolean): Sheet => {
  const marks = (isReached: boolean): TddMarks => ({ red: isReached ? DONE : '⬜', green: isReached ? DONE : '⬜', cost: isReached ? DONE : '⬜' })
  const step = (number: string, title: string, tdd: TddMarks): Step => ({ number, title, isDone: false, tdd, corrections: [] })
  const partial = { red: DONE, green: '⬜', cost: '⬜' }
  return {
    lot: 'F4',
    name: 'Product lifecycle',
    isDone: isFinished,
    hypotheses: 2,
    steps: [
      step('1', 'Create the product', marks(true)),
      step('2', 'Refuse without catalog', marks(true)),
      { ...step('3', 'Publication lock', isFinished ? marks(true) : partial), corrections: [{ id: 'C1', finding: 'lock set after creation', tdd: marks(isFinished) }] },
      step('4', 'Remove a deleted item', marks(isFinished)),
      step('5', 'Product audit', marks(isFinished)),
    ],
  }
}

const inMs = (minutes: number, seconds = 0) => (minutes * 60 + seconds) * 1000

const sampled = (agentMs: number, tools: number, spanMs: number): PhaseSample => ({
  total: agentMs * 3, count: 3, tools: tools * 3, toolCount: 3, span: spanMs * 3, spanCount: 3,
})

export const demoHistory = (): PhaseSamples => ({
  Design: sampled(inMs(4), 20, inMs(4)),
  RED: sampled(inMs(1, 30), 14, inMs(2)),
  GREEN: sampled(inMs(1, 30), 14, inMs(8)),
  'Global green': sampled(inMs(1), 8, inMs(1, 10)),
  Closing: sampled(inMs(1, 40), 12, inMs(1, 40)),
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
    Design: 'earlier audit gaps, behaviours, waves, RED and GREEN contracts, declaratives',
    RED: 'tdd-test-author, one wave in parallel',
    GREEN: 'tdd-implementer, serial, TDD tick after COST',
    'Global green': 'whole or filtered suites per test-scope.md, beside closing',
    Closing: 'closing.md §1-2 then pre-audit.sh, beside global green',
    Audit: 'audit-capture.sh, ddd-tdd-auditor, two retries at most',
    Review: 'adversarial-reviewer on the next sheet, beside the audit',
    Report: 'FX-report.md, written even on stop',
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
    agent('d', 1, 'design', 'Design', 0, t(4, 30), 'done', 'Opus'),
    agent('r1', 2, 'RED 1 create', 'RED', t(4, 30), t(6, 18), 'done'),
    agent('r2', 3, 'RED 2 refusal', 'RED', t(4, 30), t(6, 10), 'done'),
    agent('r3', 14, 'RED 3 declaratives', 'RED', t(4, 30), t(5, 20), 'interrupted', 'Sonnet'),
    agent('g1', 4, 'GREEN 1 removal', 'GREEN', t(6, 20), t(7, 14), 'done', 'Sonnet', { type: 'tdd-implementer' }),
    agent('g2', 5, 'GREEN 2 lock', 'GREEN', t(7, 20), t(8, 32), 'error', 'Sonnet', { type: 'tdd-implementer' }),
    isFinished
      ? agent('g2b', 6, 'GREEN 2 lock', 'GREEN', t(8, 40), t(12), 'done', 'Sonnet', { type: 'tdd-implementer' })
      : agent('g2b', 6, 'GREEN 2 lock', 'GREEN', t(8, 40), null, 'running', 'Sonnet', {
          type: 'tdd-implementer', lastTool: 'Edit', tools: 48, activeAt: t(12, 35),
          live: { streamKind: 'thinking', streamChars: 4_200, firstChunkAt: at - 7_560, lastChunkAt: at - 1_000 },
        }),
  ]
  const closing = [
    agent('s', 7, 'suites', 'Global green', t(12, 5), t(13, 15), 'done', 'Haiku'),
    agent('c', 8, 'closing + pre-audit', 'Closing', t(12, 5), t(13, 45), 'done', 'Sonnet'),
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
            report: 'todo/catalog-lifecycle/run/F4/F4-report.md',
          }
        : null,
      audit: isFinished ? { verdict: 'GAPS', blocking: 1, major: 2 } : null,
      sheet: demoSheet(isFinished),
      agents: isFinished ? [...build, ...closing] : build,
    },
  ]
}

export const demoPlanRuns = (at: number, isFinished = false): WorkflowRun[] => {
  const t = inMs
  const total = t(48, 20)
  const begin = isFinished ? at - total : at - t(31, 10)
  const loadedAt = at
  const [lotRunTemplate] = demoRuns(at)
  const childPhases = lotRunTemplate?.phases ?? []
  const childDetails = lotRunTemplate?.details ?? {}
  const marks = (red: boolean, green: boolean, cost: boolean): TddMarks => ({ red: red ? DONE : '⬜', green: green ? DONE : '⬜', cost: cost ? DONE : '⬜' })
  const step = (number: string, title: string, tdd: TddMarks): Step => ({ number, title, isDone: false, tdd, corrections: [] })
  const sheet = (lot: string, name: string, steps: Step[], isDone: boolean): Sheet => ({ lot, name, isDone, hypotheses: 0, steps })
  const all = marks(true, true, true)
  const views: Record<string, Sheet> = {
    F1: sheet('F1', 'Create a product', [step('1', 'Create the product', all), step('2', 'Refuse a duplicate name', all)], true),
    F2: sheet('F2', 'Archive a product', [
      step('1', 'Archive the product', all),
      step('2', 'Refuse archiving twice', isFinished ? all : marks(true, true, false)),
      step('3', 'Hide archived items', isFinished ? all : marks(true, false, false)),
    ], isFinished),
    F3: sheet('F3', 'Restore a product', [step('1', 'Restore the product', marks(isFinished, isFinished, isFinished)), step('2', 'Refuse a deleted one', marks(isFinished, isFinished, isFinished))], isFinished),
    F4: sheet('F4', 'Product history', [step('1', 'List the events', marks(false, false, false)), step('2', 'Page the events', marks(false, false, false))], false),
  }
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
    return { ...made, cost: Math.round(weight * 22) / 100, tokens: Math.round(weight * 160_000), context: peak, contextPeak: peak }
  }
  const lotAgents = (lot: string, first: number, from: number, last: string | null, behaviours: string[], pace: number): WorkflowAgent[] => {
    const at = (minutes: number, seconds = 0) => Math.round(t(minutes, seconds) * pace)
    const steps: [string, string, number, string, string?][] = [
      ['design', 'Design', at(3, 40), 'Opus'],
      ...behaviours.map((one, index): [string, string, number, string] => [`RED ${index + 1} ${one}`, 'RED', at(1, 20 + index * 10), 'Sonnet']),
      ...behaviours.map((one, index): [string, string, number, string, string] => [`GREEN ${index + 1} ${one}`, 'GREEN', at(1, 10 + index * 30), 'Sonnet', 'tdd-implementer']),
      ['suites', 'Global green', at(1, 10), 'Haiku'],
      ['audit', 'Audit', at(2, 20), 'Opus', 'ddd-tdd-auditor'],
      ['report', 'Report', at(0, 30), 'Haiku'],
    ]
    let clock = from
    let redFrom = from
    const out: WorkflowAgent[] = []
    for (const [offset, [label, phase, length, model, type]] of steps.entries()) {
      const isLast = last === label
      const isWave = phase === 'RED'
      if (isWave && !label.startsWith('RED 1 ')) clock = redFrom
      if (label.startsWith('RED 1 ')) redFrom = clock
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
  const f1 = lotAgents('F1', 3, t(1, 10), null, ['create', 'duplicate name'], 1)
  const f1End = Math.max(...f1.map(one => (one.endedAt ?? 0) - begin))
  const f2Start = f1End + t(1, 40)
  const f2 = lotAgents('F2', 20, f2Start, isFinished ? null : 'GREEN 3 hide', ['archive', 'twice', 'hide'], 1.15)
  const f2End = Math.max(...f2.map(one => (one.endedAt ?? 0) - begin))
  const f3 = isFinished ? lotAgents('F3', 40, f2End + t(1, 40), null, ['restore', 'deleted'], 0.8) : []
  const f3End = f3.length > 0 ? Math.max(...f3.map(one => (one.endedAt ?? 0) - begin)) : 0
  const supervisors = [
    supervisor('pre', 1, 'preflight', 'Preflight', 0, t(0, 50)),
    supervisor('n1', 2, 'next batch', 'Batch', t(0, 50), t(0, 20)),
    supervisor('g1', 15, 'gate F1', 'Gate', f1End, t(1, 10)),
    supervisor('n2', 16, 'next batch', 'Batch', f1End + t(1, 10), t(0, 20)),
    ...(isFinished
      ? [
          supervisor('g2', 35, 'gate F2', 'Gate', f2End, t(1, 10)),
          supervisor('n3', 36, 'next batch', 'Batch', f2End + t(1, 10), t(0, 20)),
          supervisor('g3', 55, 'gate F3', 'Gate', f3End, t(1, 15)),
          supervisor('rp', 56, 'report', 'Report', f3End + t(1, 15), t(0, 40)),
        ]
      : []),
  ]
  const done = (lot: string): Outcome => ({ label: 'DONE', reason: null, report: `todo/product-archiving/run/${lot}/${lot}-report.md` })
  const lot = (id: string, deps: string[], outcome: Outcome | null): PlanLot => ({
    lot: id, sheet: `todo/product-archiving/PRD-ARCH-PLAN-${id}.md`, deps, isDone: false, outcome,
    audit: outcome === null ? null : { verdict: 'VALID', blocking: 0, major: 0 }, view: views[id] ?? null,
  })
  return [
    {
      runId: `${DEMO}plan`, name: 'run-plan', argument: 'todo/product-archiving/PRD-ARCH-PLAN.md --until F3',
      phases: ['Preflight', 'Batch', 'Gate', 'Report'],
      details: { Preflight: 'plan check, doctor, docker, kit root, run folder', Batch: 'next batch, out-of-batch check, run-lot', Gate: 'report status, plan heading, fast suites, out-of-batch, snapshot', Report: 'REPORT.md and notification' },
      transcriptDir: null, startedAt: begin, launchedAt: begin, durationMs: isFinished ? total : null, status: isFinished ? 'completed' : 'running',
      child: { name: 'run-lot', phases: childPhases, details: childDetails, labels: {} },
      plan: 'todo/product-archiving/PRD-ARCH-PLAN.md',
      lots: [lot('F1', [], done('F1')), lot('F2', ['F1'], isFinished ? done('F2') : null), lot('F3', ['F1'], isFinished ? done('F3') : null), lot('F4', ['F2', 'F3'], null)],
      outcome: isFinished ? { label: 'DONE', reason: 'F1, F2, F3 done, stopped at --until F3', report: 'todo/product-archiving/run/2026-10-10-0912/REPORT.md' } : null,
      audit: null,
      sheet: null,
      agents: [...supervisors, ...f1, ...f2, ...f3].sort((a, b) => a.index - b.index),
    },
  ]
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Workflow' }).catch(() => undefined)
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
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

async function refreshLots($: EngineInterface, run: WorkflowRun): Promise<void> {
  if (run.child === null || run.runId.startsWith(DEMO)) return
  const planText = run.plan === null ? null : await changedText($, run.plan)
  const planned = planText === null ? null : parsePlanLots(planText)
  const views: Record<string, Sheet> = {}
  const outcomes: Record<string, Outcome> = {}
  for (const entry of run.lots) {
    const agents = run.agents.filter(agent => agent.lot === entry.lot)
    if (entry.sheet === null || agents.length === 0) continue
    const text = await changedText($, entry.sheet)
    if (text !== null) views[entry.lot] = parseSheet(text, entry.sheet)
    if (entry.outcome === null && agents.some(agent => agent.phase === REPORT_PHASE && agent.state !== 'running' && !isStaleReport(agents, agent))) {
      for (const path of reportPathsOf(entry.sheet, entry.lot)) {
        const report = await readText($, path)
        const outcome = report === null ? null : reportOutcomeOf(report, path)
        if (outcome !== null) {
          outcomes[entry.lot] = outcome
          break
        }
      }
    }
  }
  if (planned === null && Object.keys(views).length === 0 && Object.keys(outcomes).length === 0) return
  await update($, runs, stored =>
    stored.map(one => {
      if (one.runId !== run.runId) return one
      const kept = completeRun(one)
      const lots = planned === null ? kept.lots : mergeLots(kept.lots, planned)
      return { ...kept, lots: lots.map(entry => ({ ...entry, view: views[entry.lot] ?? entry.view, outcome: outcomes[entry.lot] ?? entry.outcome })) }
    }),
  )
}

async function poll($: EngineInterface): Promise<void> {
  const list = (await read($, runs)).map(completeRun)
  for (const run of list) {
    if (run.status === 'running') await refreshLots($, run)
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
  let known: PhaseSamples = {}
  for (const journal of newest) {
    const text = await readText($, journal.path)
    if (text !== null) known = withSamples(known, samplesOf(text))
  }
  await update($, history, () => known)
}

let seenSheet: { path: string; mtimeMs: number } | null = null

async function refreshSheet($: EngineInterface, run: WorkflowRun): Promise<void> {
  const path = sheetPathOf(run.argument)
  if (path === null || run.runId.startsWith(DEMO)) return
  const stat = await $.fs.stat(path).catch(() => null)
  if (stat === null) return
  if (run.sheet !== null && seenSheet?.path === path && seenSheet.mtimeMs === stat.mtimeMs) return
  const text = await readText($, path)
  if (text === null) return
  seenSheet = { path, mtimeMs: stat.mtimeMs }
  const inPlan = planLotOf(run.argument)
  const sheet = inPlan === null ? parseSheet(text, path) : parseLotSection(text, inPlan.lot)
  if (sheet === null) return
  await update($, runs, stored => stored.map(one => (one.runId === run.runId ? { ...one, sheet } : one)))
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const figures = await $.session.usage().catch(() => null)
  if (figures === null) return
  await update($, usage, () => ({
    context: figures.context.tokens ?? null,
    percent: figures.context.percent ?? null,
    cost: figures.cost?.usd ?? null,
  }))
}

const tick = async ($: EngineInterface): Promise<void> => {
  const list = (await read($, runs)).map(completeRun)
  const last = list[list.length - 1]
  if (last !== undefined) await refreshSheet($, last)
  if (!list.some(run => run.status === 'running')) return
  const at = await $.clock.now()
  await update($, now, () => at)
  await refreshUsage($)
  await poll($)
}

export const blankAgent = (id: string, index: number, label: string, model: string, type: string, prompt: string, at: number): WorkflowAgent => ({
  id, index, label, phase: null, model, effort: null, type, startedAt: at, endedAt: null, lastActiveAt: at, openCalls: 0, ...QUIET, lastChunkAt: null, streamChars: 0, state: 'running',
  lastTool: null, tools: 0, context: 0, contextStart: 0, contextPeak: 0, tokens: 0, cost: 0, prompt: firstLine(prompt), answer: null,
  toolCounts: {}, files: [], lastError: null, lot: null,
})

export const errorOf = (tool: string, result: { deny?: string; isError?: boolean; text?: string }): string | null => {
  if (typeof result.deny === 'string') return `${tool}: ${firstLine(result.deny)}`
  if (result.isError === true) return `${tool}: ${firstLine(result.text ?? 'error')}`
  return null
}

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
  let bookedCost: number | null = null
  let requested: Record<string, number> = {}
  let root: string | null = null

  on('session.start', async ($, e, next) => {
    root = e.cwd
    await $.command.register({
      name: 'run-lot-pane',
      description: 'Open the Workflow progress pane (clear forgets the finished run, demo loads a sample run, demo end a finished one, demo plan and demo plan end a run-plan run)',
    })
    $.clock.every(TICK_MS, () => void tick($))
    for (const run of await read($, runs)) {
      if (run.child === null || run.child.labels !== undefined) continue
      const childScript = await readText($, `${e.cwd}/.claude/workflows/${run.child.name}.js`)
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
    const demo = /^demo( plan)?( end)?$/.exec(e.args.trim())
    if (demo !== null) {
      const at = await $.clock.now()
      const isFinished = demo[2] !== undefined
      const loaded = demo[1] === undefined ? demoRuns(at, isFinished) : demoPlanRuns(at, isFinished)
      await update($, runs, list => [...list.filter(run => !run.runId.startsWith(DEMO)), ...loaded].slice(-KEPT_RUNS))
      await update($, nav, state => ({ ...state, lot: null }))
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
        const audit = (e.tool as string) === 'StructuredOutput' ? auditOf(e) : null
        if (audit !== null) await update($, runs, list => withAudit(list, agentId, audit))
        const calledAt = await $.clock.now()
        await update($, runs, list =>
          withAgent(list, agentId, agent => ({
            ...agent,
            lastTool: e.tool,
            tools: agent.tools + 1,
            openCalls: agent.openCalls + 1,
            toolSince: agent.openCalls === 0 ? calledAt : agent.toolSince,
            lastActiveAt: calledAt,
            toolCounts: { ...agent.toolCounts, [e.tool]: (agent.toolCounts[e.tool] ?? 0) + 1 },
          })),
        )
        const answered = await next(e).catch(async (failure: unknown) => {
          await closeCall($, agentId)
          throw failure
        })
        await closeCall($, agentId)
        const error = errorOf(e.tool, answered)
        const path = editedPath(e.tool, e as unknown as Record<string, unknown>)
        if (error !== null || path !== null) {
          await update($, runs, list =>
            withAgent(list, agentId, agent => ({
              ...agent,
              lastError: error ?? agent.lastError,
              files: path !== null && error === null ? withFile(agent.files, relativePath(path, root)) : agent.files,
            })),
          )
        }
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
    const childScript = childName === null || root === null ? null : await readText($, `${root}/.claude/workflows/${childName}.js`)
    const childPhases = childScript === null ? [] : parsePhases(childScript)
    const child: ChildWorkflow | null =
      childName === null
        ? null
        : {
            name: childName,
            phases: childPhases.map(phase => phase.title),
            details: detailsOf(childPhases),
            labels: childScript === null ? {} : labelPhasesOf(childScript),
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
      if (used !== null) requested[agentId ?? MAIN] = (requested[agentId ?? MAIN] ?? 0) + weightOf(used)
      const figures = await $.session.usage().catch(() => null)
      const cost = figures?.cost?.usd ?? null
      let shares: Record<string, number> = {}
      if (cost !== null) {
        if (bookedCost === null) requested = {}
        else if (cost > bookedCost) {
          shares = splitCost(cost - bookedCost, requested)
          requested = {}
        }
        bookedCost = cost
      }
      const list = await read($, runs)
      const mine = agentId !== undefined && used !== null && isFollowed(list, agentId) ? agentId : null
      if (mine === null && Object.keys(shares).length === 0) return result
      const at = await $.clock.now()
      const effort = e.effort === undefined ? null : String(e.effort)
      await update($, runs, stored => withCosts(mine === null || used === null ? stored : withRequest(stored, mine, used, effort, at), shares))
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
    const agent = {
      ...blankAgent(agentId, agentIndex, e.description || e.subagentType, shortModel(spawned.model), e.subagentType, e.prompt, at),
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
      const audit = typeof answer === 'string' ? auditOf(jsonOf(answer)) : null
      if (audit !== null) await update($, runs, list => withAudit(list, agentId, audit))
      await update($, runs, list =>
        withAgent(list, agentId, agent => ({
          ...agent,
          state,
          endedAt: at,
          lastActiveAt: at,
          openCalls: 0,
          ...QUIET,
          answer: typeof answer === 'string' && answer.trim() !== '' ? firstLine(answer, 400) : agent.answer,
        })),
      )
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = (await read($, runs)).map(completeRun)
    const at = await read($, now)
    const session = await read($, usage)
    const where = await read($, nav)
    const known = await read($, history)
    const last = list[list.length - 1]
    const planRun = last !== undefined && last.child !== null ? last : null
    const lotInView = planRun !== null && where.lot !== null && planRun.lots.some(one => one.lot === where.lot) ? where.lot : null
    const current = planRun !== null && lotInView !== null ? lotRun(planRun, lotInView) : last
    const columns = e.props.bodyColumns
    const spin = spinnerFrame(at)
    const barWidth = Math.max(8, Math.min(40, columns - 28))
    const go = (change: Partial<Navigation>) => () => void update($, nav, state => ({ ...state, ...change }))
    const close = <Button key="close" label="✕" plain dimColor onPress={() => $.ui.close({ id: PANE })} />

    const row = (key: string, left: JSX.Element, right?: JSX.Element | JSX.Element[]) => (
      <Box key={key} height={1}>
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
        <Text bold>{title}</Text>
        {lines}
      </Box>
    )
    const line = (key: string, text: string, color?: string, wrap: 'truncate-end' | 'truncate-start' | 'wrap' = 'truncate-end') => (
      <Text key={key} color={color} wrap={wrap}>
        {'  '}
        {text}
      </Text>
    )

    const agentButton = (agent: WorkflowAgent, prefix: string, from: Screen, mark = '') => (
      <Box key={`agent-${agent.id}`} height={1}>
        <Text color="inactive">{prefix}</Text>
        <Button key={`open-${agent.id}`} plain onPress={go({ screen: 'agent', agentId: agent.id, back: from })}>
          <Text color={agentTone(agent)}>{agentGlyph(agent)} </Text>
          <Text color={agent.state === 'error' ? 'error' : agent.state === 'running' ? undefined : 'inactive'}>{agent.label}</Text>
          <Text color="inactive">
            {' '}
            · {agentAge(agent)}
            {activityOf(agent, at) === null ? '' : ` · ${activityOf(agent, at)}`}
            {agent.state === 'running' && agent.lastTool !== null ? ` · ${agent.lastTool} (${agent.tools})` : ''}
            {agent.tokens > 0 ? ` · ctx ${kilo(agent.context)} · ${dollars(agent.cost)}` : ''}
          </Text>
          {mark !== '' && <Text color="warning"> {mark}</Text>}
        </Button>
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
                  <Button key={`open-lot-${entry.lot}`} hotkey={index < 9 ? String(index + 1) : undefined} plain onPress={openLot(entry.lot)}>
                    {label}
                  </Button>
                ) : (
                  label
                )}
              </Box>
            )
          })}
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

    const rows = phaseRows(current, at)
    const agentInView = where.screen === 'agent' ? current.agents.find(agent => agent.id === where.agentId) : undefined
    const phaseInView = where.screen === 'phase' ? rows.find(one => one.title === where.phase) : undefined

    if (agentInView !== undefined) {
      const agent = agentInView
      const stalls = stallOf(agent)
      const outcome =
        agent.answer ??
        (agent.state === 'running'
          ? 'Still running…'
          : agent.state === 'error'
            ? 'Ended in error.'
            : agent.state === 'interrupted'
              ? 'Interrupted before it answered.'
              : 'No answer.')
      return (
        <Box flexDirection="column" marginTop={1}>
          {crumbs(`${current.name} › ${agent.phase ?? NO_PHASE}`, `agent ${agent.index}`)}
          {backBar(where.back)}
          {lotBar}
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
          {section('usage', 'Usage', [
            line(
              'ctx',
              agent.tokens === 0
                ? 'no model call yet'
                : `ctx ${kilo(agent.contextStart)} ↗ ${kilo(agent.contextPeak)} · now ${kilo(agent.context)}`,
            ),
            line('tok', `${kilo(agent.tokens)} tok · ${dollars(agent.cost)}`),
          ])}
          {section('tools', `Tools · ${agent.tools} call${agent.tools > 1 ? 's' : ''}`, [
            line('summary', agent.tools === 0 ? 'none yet' : toolSummary(agent.toolCounts)),
          ])}
          {agent.files.length > 0 &&
            section(
              'files',
              `Files modified · ${agent.files.length}`,
              agent.files.map(path => line(`file-${path}`, path, undefined, 'truncate-start')),
            )}
          {agent.lastError !== null && section('error', 'Last error', [line('error', agent.lastError, 'error', 'wrap')])}
          {section('prompt', 'Prompt', [line('prompt', agent.prompt === '' ? '—' : agent.prompt, 'inactive', 'wrap')])}
          {section('outcome', 'Outcome', [line('outcome', outcome, agent.state === 'error' ? 'error' : undefined, 'wrap')])}
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
              {insight.share !== null ? ` · ${insight.share}% of run cost` : ''}
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
                    [agent.id === insight.costliest ? '$ most expensive' : '', agent.id === insight.slowest ? '⏱ slowest' : '', ...stallOf(agent)]
                      .filter(one => one !== '')
                      .join(' · '),
                  ),
                ),
          )}
        </Box>
      )
    }

    const isRunning = current.status === 'running'
    const elapsed = current.durationMs ?? at - current.startedAt
    const counted = current.agents.filter(isLive)
    const done = counted.filter(agent => agent.state !== 'running').length
    const remaining = remainingMs(current, rows, known)
    const headline = headlineOf(current.status, current.outcome)
    const tone = headline.tone
    const reached = rows.filter(one => one.mark === 'done').length
    const step = currentStep(current, rows)
    const runTotals = totalsOf(current.agents)
    const lot = lotOf(current.argument)
    const outcome = current.outcome
    const sheet = current.sheet
    const isWide = columns >= WIDE_COLUMNS
    const figuresWidth = COUNT_WIDTH + TIME_WIDTH + COST_WIDTH
    const agentsRightWidth = figuresWidth + (isWide ? MODEL_WIDTH : 0)
    const isOpen = (phase: PhaseRow) => phase.agents.length > 0 && !where.toggled.includes(phase.title)
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
    const figureCells = (key: string, count: string, time: string, cost: string, timeColor = 'inactive') => [
      cell(`${key}-count`, COUNT_WIDTH, count, 'inactive'),
      cell(`${key}-time`, TIME_WIDTH, time, timeColor),
      cell(`${key}-cost`, COST_WIDTH, cost, 'inactive'),
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
      const retry = attempt > 1 ? ` ↻ ${attempt}` : ''
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
              <Button key={`open-${agent.id}`} plain onPress={go({ screen: 'agent', agentId: agent.id, back: 'run' })}>
                <Text color={agentTone(agent)}>{agentGlyph(agent)} </Text>
                <Text color={labelColor}>{fit(agent.label, labelWidth)}</Text>
                {retry !== '' && <Text color="warning">{retry}</Text>}
              </Button>
            </Box>,
            [
              ...(isWide ? [cell(`model-${agent.id}`, MODEL_WIDTH, modelLabel(agent), 'inactive', true)] : []),
              ...figureCells(`agent-${agent.id}`, '', agentAge(agent), agent.tokens > 0 ? dollars(agent.cost) : '', isSlowAgent ? 'warning' : 'inactive'),
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
      if (phase.detail === null || phase.mark === 'done' || room < 10) return null
      return (
        <Text color="inactive" wrap="truncate-end">
          {'  '}
          {fit(phase.detail, room - 2)}
        </Text>
      )
    }

    const phaseRow = (phase: PhaseRow) => {
      const hasAgents = phase.agents.length > 0
      const room = columns - 4 - phase.title.length - (hasAgents ? figuresWidth : 0)
      const attempts = attemptsOf(phase.agents)
      return (
        <Box key={`phase-${phase.title}`} flexDirection="column">
          {row(
            `phase-row-${phase.title}`,
            <Box flexShrink={1}>
              {hasAgents ? (
                <Button key={`toggle-${phase.title}`} plain dimColor onPress={toggle(phase.title)}>
                  {isOpen(phase) ? '▾' : '▸'}
                </Button>
              ) : (
                <Text> </Text>
              )}
              <Text> </Text>
              <Button key={`phase-${phase.title}`} plain onPress={go({ screen: 'phase', phase: phase.title })}>
                <Text color={markTone(phase.mark)}>{markGlyph(phase.mark)} </Text>
                <Text bold={phase.mark === 'running'} color={phase.mark === 'pending' ? 'inactive' : undefined}>
                  {phase.title}
                </Text>
              </Button>
              {phaseSuffix(phase, room)}
            </Box>,
            hasAgents ? figureCells(`phase-${phase.title}`, `${phase.agents.length}`, duration(phase.span), dollars(totalsOf(phase.agents).cost)) : undefined,
          )}
          {isOpen(phase) &&
            phase.agents.map(agent => agentRow(agent, attempts[agent.id] ?? 1, typicalMs(known, current.agents, agent)))}
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
                {isWide && <Text color="inactive">{label} </Text>}
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
              <Text bold={one === currentSheetStep} color={isDone || one === currentSheetStep ? undefined : 'inactive'}>
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

    if (planRun !== null && lotInView === null) {
      const states = planRun.lots.map(entry => ({ entry, state: lotStateOf(planRun, entry) }))
      const finished = states.filter(one => one.state === 'completed' || one.state === 'done').length
      const planHeadline = headlineOf(planRun.status, planRun.outcome)
      const planTone = planHeadline.tone
      const planElapsed = planRun.durationMs ?? at - planRun.startedAt
      const planTotals = totalsOf(planRun.agents)
      const supervisors = planRun.agents.filter(agent => agent.lot === null)
      const code = planRun.plan === null ? null : (planRun.plan.split('/').pop() ?? '').replace(/\.md$/, '')
      const planOutcome = planRun.outcome
      const lotDetail = (entry: PlanLot, state: LotState, agents: WorkflowAgent[]) => {
        if (entry.outcome !== null) return [entry.outcome.label, entry.outcome.reason ?? ''].filter(one => one !== '').join(' · ')
        if (state === 'running') {
          const active = [...agents].sort((a, b) => b.index - a.index).find(agent => agent.state === 'running') ?? agents[agents.length - 1]
          return active === undefined ? 'running' : `${active.phase ?? NO_PHASE} · ${active.label}`
        }
        if (state === 'done') return 'done before this run'
        if (state === 'pending') return entry.deps.length > 0 ? `after ${entry.deps.join(', ')}` : 'pending'
        return state
      }
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
              {planOutcome.reason !== null && <Text wrap="wrap">{planOutcome.reason}</Text>}
              {planOutcome.report !== null && (
                <Text color="inactive" wrap="wrap">
                  Report: {relativePath(planOutcome.report, root)}
                </Text>
              )}
            </Box>
          )}
          <Box marginTop={1} flexDirection="column">
            {figureRow(
              'session',
              'Session',
              `${session.context === null ? '—' : `ctx ${kilo(session.context)}`}${session.percent === null ? '' : ` (${session.percent}%)`}`,
              session.cost === null ? '' : dollars(session.cost),
            )}
            {figureRow('run', 'Plan', `${kilo(planTotals.tokens)} tok`, dollars(planTotals.cost))}
          </Box>
          <Box marginTop={1} flexDirection="column">
            {row(
              'lots-title',
              <Text bold>
                {'  '}
                LOTS
              </Text>,
              [
                cell('lots-count', COUNT_WIDTH, 'agents', 'inactive'),
                cell('lots-time', TIME_WIDTH, 'time', 'inactive'),
                cell('lots-cost', COST_WIDTH, 'cost', 'inactive'),
              ],
            )}
            {states.map(({ entry, state }) => {
              const agents = planRun.agents.filter(agent => agent.lot === entry.lot)
              const view = agents.length > 0 ? lotRun(planRun, entry.lot) : null
              const left = (
                <Text key={`plan-lot-text-${entry.lot}`} wrap="truncate-end">
                  {'  '}
                  <Text color={lotTone(state)}>{lotGlyph(state)} </Text>
                  <Text bold={state === 'running'}>{entry.lot}</Text>
                  <Text color={state === 'failed' ? 'error' : 'inactive'}> {lotDetail(entry, state, agents)}</Text>
                </Text>
              )
              return row(
                `plan-lot-${entry.lot}`,
                view === null ? (
                  left
                ) : (
                  <Button key={`plan-open-${entry.lot}`} plain onPress={openLot(entry.lot)}>
                    {left}
                  </Button>
                ),
                view === null
                  ? figureCells(`plan-lot-${entry.lot}`, '', '', '')
                  : figureCells(
                      `plan-lot-${entry.lot}`,
                      `${agents.length}`,
                      duration(view.durationMs ?? at - view.startedAt),
                      dollars(totalsOf(agents).cost),
                    ),
              )
            })}
          </Box>
          {supervisors.length > 0 &&
            section(
              'supervisor',
              'Supervisor',
              supervisors.map(agent => agentButton(agent, '  ', 'run')),
            )}
        </Box>
      )
    }

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
        {lotBar}
        <Text wrap="truncate-end">
          {'  '}
          <Text bold color={tone}>
            {isRunning ? spin : headline.glyph} {headline.text}
          </Text>
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
            {outcome.reason !== null && <Text wrap="wrap">{outcome.reason}</Text>}
            {outcome.report !== null && (
              <Text color="inactive" wrap="wrap">
                Report: {relativePath(outcome.report, root)}
              </Text>
            )}
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          {figureRow(
            'session',
            'Session',
            `${session.context === null ? '—' : `ctx ${kilo(session.context)}`}${session.percent === null ? '' : ` (${session.percent}%)`}`,
            session.cost === null ? '' : dollars(session.cost),
          )}
          {figureRow('run', 'Run', `${kilo(runTotals.tokens)} tok`, dollars(runTotals.cost))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {row(
            'phases-title',
            <Text bold>
              {'  '}
              PHASES
            </Text>,
            [
              cell('title-count', COUNT_WIDTH, 'agents', 'inactive'),
              cell('title-time', TIME_WIDTH, 'time', 'inactive'),
              cell('title-cost', COST_WIDTH, 'cost', 'inactive'),
            ],
          )}
          {rows.map(phaseRow)}
        </Box>
        {sheet !== null && (
          <Box key="sheet" marginTop={1} flexDirection="column">
            {row(
              'sheet-title',
              <Text wrap="truncate-end">
                <Text bold>
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
              <Text color={sheet.isDone ? 'success' : 'inactive'}>
                {sheet.steps.filter(isStepDone).length}/{sheet.steps.length} steps
              </Text>,
            )}
            {stepRows(sheet)}
          </Box>
        )}
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
