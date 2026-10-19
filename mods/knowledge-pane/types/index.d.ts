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

export type Decision = {
  id: string
  header: string
  question: string
  options: string[]
  recommended: string | null
  answer: string | null
  note: string | null
  isPending: boolean
}

export type SpecItem = { id: string; name: string; tag: string | null; body: string }

// `anchor`: the `<!-- kit:<name> -->` ending the heading, when it carries one.
export type SpecSection = { number: string; title: string; anchor?: string; body: string }

export type OpenQuestion = { id: string; severity: string; question: string; impact: string; options: string }

export type SpecDoc = {
  title: string
  summary: string
  sections: SpecSection[]
  useCases: SpecItem[]
  rules: SpecItem[]
  openQuestions: OpenQuestion[]
}

// The `/business-spec` of the session: armed when it starts, its SPEC file followed once written.
export type Tracked = {
  isArmed: boolean
  topic: string | null
  path: string | null
  mtimeMs: number
  doc: SpecDoc | null
  readAt: number | null
}

export type SpecKind = 'useCase' | 'rule' | 'section' | 'openQuestion' | 'decision'

export type View =
  | { kind: 'home' }
  | { kind: 'context'; name: string }
  | { kind: 'object'; id: string }
  | { kind: 'merge'; code: string }
  | { kind: 'change'; code: string; id: string }
  | { kind: 'search' }
  | { kind: 'spec' }

// `seed`: the text the search field is drawn with, set as the search comes on top — never per keystroke, so a redraw cannot overwrite typing.
export type Navigation = { stack: View[]; query: string; seed: string; expanded: string[]; collapsed: string[] }

declare module 'claude-code' {
  interface PluginState {
    'knowledge-pane': {
      base: Base
      nav: Navigation
      full: Record<string, string>
      now: number
      isShown: boolean
      tracked: Tracked
      decisions: Decision[]
    }
  }
}
