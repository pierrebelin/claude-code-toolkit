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

export type SpecSection = { number: string; title: string; body: string }

export type OpenQuestion = { id: string; severity: string; question: string; impact: string; options: string }

export type SpecDoc = {
  title: string
  summary: string
  sections: SpecSection[]
  useCases: SpecItem[]
  rules: SpecItem[]
  openQuestions: OpenQuestion[]
}

export type Tracked = {
  isArmed: boolean
  topic: string | null
  path: string | null
  mtimeMs: number
  doc: SpecDoc | null
  readAt: number | null
}

export type Kind = 'useCase' | 'rule' | 'section' | 'openQuestion' | 'decision'

export type Navigation = { expanded: string[]; collapsed: string[] }

declare module 'claude-code' {
  interface PluginState {
    'spec-pane': { tracked: Tracked; decisions: Decision[]; nav: Navigation; now: number }
  }
}
