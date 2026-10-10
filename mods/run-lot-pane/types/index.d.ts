export type AgentState = 'running' | 'done' | 'error' | 'interrupted'

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
  state: AgentState
  lastTool: string | null
  tools: number
  context: number
  contextStart: number
  contextPeak: number
  tokens: number
  cost: number
  prompt: string
  answer: string | null
  toolCounts: Record<string, number>
  files: string[]
  lastError: string | null
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'killed'

export type Outcome = {
  label: string
  reason: string | null
  report: string | null
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

export type Sheet = { lot: string; name: string; isDone: boolean; steps: Step[]; hypotheses: number }

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
  cost: number | null
}

export type Screen = 'run' | 'phase' | 'agent'

export type Navigation = {
  screen: Screen
  phase: string | null
  agentId: string | null
  back: Screen
  toggled: string[]
  isAllExpanded: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'run-lot-pane': { runs: WorkflowRun[]; now: number; usage: SessionFigures; nav: Navigation; history: PhaseSamples }
  }
}
