export type Contribution = { turn: number; label: string; tokens: number }

export type Band = {
  startedAt: number
  readings: number[]
  window: number
  lastTurnAt: number | null
  streak: number
  turn: number
  contributions: Contribution[]
  cost: number | null
  fiveHour: { percent: number; resetsAt: number | null } | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-band': { band: Band; now: number; isRebuilding: boolean; isExpanded: boolean }
  }
}
