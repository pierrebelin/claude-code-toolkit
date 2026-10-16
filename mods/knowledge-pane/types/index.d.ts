export type Kind = 'CU' | 'RM' | 'D' | 'ADR'

export type Level = 'high' | 'medium' | 'low'

// One line of `<root>/.index/knowledge.jsonl`, written by the kit's `lib/knowledge_index.py`.
export type KObject = {
  id: string
  kind: Kind
  context: string
  title: string
  text: string
  level: Level | null
  path: string
  line: number
  end: number
  cites: string[]
  usecases: string[]
  handlers: string[]
  citedBy: string[]
  contexts: string[]
}

export type ContextRow = { name: string; prefix: string; usecases: number; rules: number; decisions: number; summary: string }

export type HistoryRow = { context: string; date: string; feature: string; delta: string[] }

export type MergeObject = { id: string; kind: string; change: string; context: string; title: string }

// `<root>/.merge/<CODE>/`: prepared while only `.drafts/` holds files, staged once `stage` laid the whole files.
export type Merge = { code: string; isPartial: boolean; isStaged: boolean; objects: MergeObject[]; after: Record<string, string> }

export type Sync = { context: string; files: string[] }

export type IndexState = 'ok' | 'missing' | 'stale'

export type Base = {
  repo: string
  root: string
  isDemo: boolean
  isPresent: boolean
  index: IndexState
  staleFiles: string[]
  contexts: ContextRow[]
  adrCount: number | null
  objects: KObject[]
  overviews: Record<string, string>
  history: HistoryRow[]
  merges: Merge[]
  syncs: Sync[]
  readAt: number | null
  signature: string
}

export type View =
  | { kind: 'home' }
  | { kind: 'context'; name: string }
  | { kind: 'object'; id: string }
  | { kind: 'merge'; code: string }
  | { kind: 'change'; code: string; id: string }
  | { kind: 'search' }

// `seed`: the text the search field is drawn with, set as the search comes on top — never per keystroke, so a redraw cannot overwrite typing.
export type Navigation = { stack: View[]; query: string; seed: string; expanded: string[]; collapsed: string[] }

declare module 'claude-code' {
  interface PluginState {
    'knowledge-pane': { base: Base; nav: Navigation; full: Record<string, string>; now: number; isShown: boolean }
  }
}
