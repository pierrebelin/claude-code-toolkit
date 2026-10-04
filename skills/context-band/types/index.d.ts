export type Contribution = { turn: number; label: string; tokens: number }

export type Band = {
  startedAt: number
  readings: number[]
  window: number
  lastTurnAt: number | null
  streak: number
  turn: number
  contributions: Contribution[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-band': { band: Band; now: number; isRebuilding: boolean }
  }
}
