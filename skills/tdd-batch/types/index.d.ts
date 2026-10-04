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

export type Run = { id: string; kind: 'RED' | 'GREEN'; description: string }

export type Blocked = { kind: 'RED' | 'GREEN'; description: string }

export type Batch = {
  path: string | null
  sheet: Sheet | null
  error: string | null
  wave: number
  running: Run[]
  blocked: Blocked[]
}

declare module 'claude-code' {
  interface PluginState {
    'tdd-batch': { batch: Batch }
  }
}
