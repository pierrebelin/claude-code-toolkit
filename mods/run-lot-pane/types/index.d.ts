export type AgentState = 'running' | 'done' | 'error' | 'interrupted'

export type StreamKind = 'thinking' | 'output' | 'tool'

export type CallState = 'running' | 'ok' | 'error'

export type ToolTrace = {
  id: string
  tool: string
  brief: string
  at: number
  state: CallState
  error: string | null
}

export type WorkflowAgent = {
  id: string
  index: number
  label: string
  phase: string | null
  model: string
  effort: string | null
  type: string
  startedAt: number
  endedAt: number | null
  lastActiveAt: number
  openCalls: number
  toolSince: number | null
  waitingSince: number | null
  firstChunkAt: number | null
  lastChunkAt: number | null
  streamKind: StreamKind | null
  streamChars: number
  state: AgentState
  lastTool: string | null
  tools: number
  context: number
  contextStart: number
  contextPeak: number
  tokens: number
  prompt: string
  answer: string | null
  structured: string[] | null
  calls: ToolTrace[]
  toolCounts: Record<string, number>
  files: string[]
  lastError: string | null
  lot: string | null
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'killed'

// The knowledge-base merge a run-plan result carries: staged after a plan delivered whole, never
// written by the run — `next` is the skill that shows the diff and writes it on confirmation.
export type KnowledgeMerge = {
  state: 'staged' | 'refused' | 'blocked' | 'failed'
  lines: string[]
  warnings: string[]
  next: string | null
}

export type Outcome = {
  label: string
  reason: string | null
  report: string | null
  merge?: KnowledgeMerge
}

export type AuditVerdict = {
  verdict: 'VALIDE' | 'ECARTS' | 'ÉCARTS' | 'VALID' | 'GAPS'
  blocking: number
  major: number
}

export type PhaseDeclaration = {
  title: string
  detail: string | null
}

export type TddMarks = { red: string; green: string; cost: string }

export type Correction = { id: string; finding: string; tdd: TddMarks | null }

export type Step = {
  number: string
  title: string
  isDone: boolean
  tdd: TddMarks | null
  corrections: Correction[]
}

export type CycleState = 'pending' | 'red' | 'done'

export type SheetCycle = { id: string; behaviour: string; wave: number; guard: boolean; state: CycleState; unreachable: string[]; live?: 'RED' | 'GREEN' }

export type Sheet = { lot: string; name: string; isDone: boolean; steps: Step[]; hypotheses: number; cycles?: SheetCycle[] }

export type ChildWorkflow = { name: string; phases: string[]; details: Record<string, string>; labels: Record<string, string>; script?: string | null }

export type LotFigures = { agents: number; durationMs: number; tokens: number; endedAt: number }

export type PlanLot = {
  lot: string
  sheet: string | null
  deps: string[]
  isDone: boolean
  outcome: Outcome | null
  audit: AuditVerdict | null
  view: Sheet | null
  asking?: number
  past?: LotFigures | null
  title?: string
}

export type WorkflowRun = {
  runId: string
  name: string
  argument: string | null
  phases: string[]
  details: Record<string, string>
  transcriptDir: string | null
  startedAt: number
  launchedAt: number
  durationMs: number | null
  status: RunStatus
  outcome: Outcome | null
  audit: AuditVerdict | null
  sheet: Sheet | null
  agents: WorkflowAgent[]
  child: ChildWorkflow | null
  plan: string | null
  lots: PlanLot[]
  asking?: number
}

export type Journal = {
  status: RunStatus
  durationMs: number | null
  outcome: Outcome | null
  argument: string | null
  audit: AuditVerdict | null
  phases: string[]
  details: Record<string, string>
  agentPhases: Record<string, string>
}

export type PhaseSample = { total: number; count: number; tools: number; toolCount: number; span: number; spanCount: number }

export type PhaseSamples = Record<string, PhaseSample>

export type SessionFigures = {
  context: number | null
  percent: number | null
}

export type Screen = 'run' | 'phase' | 'agent' | 'timeline' | 'validate' | 'graph'

export type Prompted = { kind: 'reject' | 'amend' | 'note'; target: string }

export type RunFeed = { runId: string; root: string; work: string; pane: string; reports: Record<string, string> }

export type Navigation = {
  screen: Screen
  phase: string | null
  agentId: string | null
  back: Screen
  toggled: string[]
  lot: string | null
  prompted?: Prompted | null
  notice?: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'run-lot-pane': { runs: WorkflowRun[]; now: number; usage: SessionFigures; nav: Navigation; history: PhaseSamples; isShown: boolean; feed: RunFeed | null }
  }
}
