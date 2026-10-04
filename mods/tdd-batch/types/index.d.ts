export type Phase = { red: string; green: string; cost: string }

export type Correction = { id: string; finding: string; tdd: Phase | null }

export type Step = {
  number: string
  title: string
  isDone: boolean
  tdd: Phase | null
  corrections: Correction[]
}

export type Sheet = { lot: string; name: string; isDone: boolean; steps: Step[]; hypotheses: number }

export type AgentKind = 'RED' | 'GREEN' | 'AUDIT'

export type Run = { id: string; kind: AgentKind; description: string; startedAt: number }

export type Blocked = { kind: AgentKind; description: string }

export type Gate = { isGreen: boolean; failures: number }

export type Verdict = { isValid: boolean; blocking: number; major: number }

export type Audit = { passes: number; verdict: Verdict | null }

export type Batch = {
  path: string | null
  sheet: Sheet | null
  error: string | null
  wave: number
  running: Run[]
  blocked: Blocked[]
  startedAt: number | null
  gate: Gate | null
  audit: Audit
}

declare module 'claude-code' {
  interface PluginState {
    'tdd-batch': { batch: Batch; now: number }
  }
}
