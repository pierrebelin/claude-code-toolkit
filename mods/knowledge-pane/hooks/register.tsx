import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type {
  Base,
  ContextRow,
  Decision,
  HistoryRow,
  IndexState,
  KObject,
  Kind,
  Level,
  Merge,
  MergeObject,
  Navigation,
  OpenQuestion,
  SpecDoc,
  SpecItem,
  SpecKind,
  SpecSection,
  Sync,
  Tracked,
  View,
} from '../types'

const PANE = 'knowledge-pane'
const TITLE = 'Knowledge'
// Wider than any terminal: the dock opens at its ceiling, 45 % of the terminal's columns.
const PANE_COLUMNS = 1000
const SPEC_TITLE = 'Spec'
const TICK_MS = 3_000
const DEFAULT_ROOT = 'docs/business'
const CONFIG = '.claude/kit.config.json'
const INDEX_JSONL = '.index/knowledge.jsonl'
const INDEX_FILES = '.index/files.json'
const SKIPPED = ['INDEX.md', 'HISTORY.md']
const KINDS: Kind[] = ['CU', 'RM', 'D', 'ADR']
const LEVELS: Level[] = ['high', 'medium', 'low']
const KIND_NAMES: Record<Kind, string> = { CU: 'use case', RM: 'rule', D: 'decision', ADR: 'ADR' }
const HISTORY_SHOWN = 5
const RESULTS_SHOWN = 40
const ID_PATTERN = /^(?:[A-Z][A-Z0-9]{1,5}-(?:CU|RM|D)-[\w?]+|ADR-[\w?]+)$/
const INDEX_COMMAND = 'cctoolkit knowledge-index'
const SKILL = 'business-spec'
const SPEC_PATTERN = /(?:^|[\\/])todo[\\/][^\\/]+[\\/]SPEC(?:-[^\\/]+)?\.md$/
// The open questions: the section whose heading carries the anchor, else, in a spec written before
// the anchors, the title the `/plan-implementation` gate reads (`skills/plan-implementation/SKILL.md`).
const OPEN_QUESTIONS_ANCHOR = 'open-questions'
const OPEN_QUESTIONS_TITLE = /^12\. (?:Open questions|Questions ouvertes)/
// A spec's use cases and rules: `CU-01`, or a knowledge-base id `CAT-CU-01`.
const SPEC_ID = /^(?:[A-Z][A-Z0-9]{1,5}-(?:CU|RM)-\d+|(?:CU|RM)-[\w.]+)$/
const isRule = (id: string): boolean => /(?:^|-)RM-/.test(id)
const isUseCase = (id: string): boolean => /(?:^|-)CU-/.test(id)
const SEVERITY_PATTERN = /\*\*(?:s[ée]v[ée]rit[ée]|severity)\*\*\s*:?\s*([^·\n]+)/i
const RECOMMENDED_PATTERN = /\((?:recommand[ée]e?|recommended)\)/i
const EDITING_TOOLS = ['Edit', 'Write', 'MultiEdit']
const BLOCKING = ['bloquant', 'blocking']
const MAJOR = ['majeur', 'major', 'warning']

// The terminal's grid: the view's lines at two cells, a block's rows one level in, under its title.
const INDENT = '  '
const ROW = 4
const rule = (cells: number): string => '─'.repeat(Math.max(0, cells))

const HOME: Navigation = { stack: [{ kind: 'home' }], query: '', seed: '', expanded: [], collapsed: [] }
const IDLE: Tracked = { isArmed: false, topic: null, path: null, mtimeMs: 0, doc: null, readAt: null }

// The search field starts from the query each time the search comes back on top.
const seeded = (next: Navigation): Navigation => (next.stack[next.stack.length - 1]?.kind === 'search' ? { ...next, seed: next.query } : next)

export const emptyBase = (repo: string, root: string): Base => ({
  repo,
  root,
  isDemo: false,
  isPresent: false,
  index: 'missing',
  staleFiles: [],
  contexts: [],
  adrCount: null,
  objects: [],
  overviews: {},
  history: [],
  merges: [],
  syncs: [],
  readAt: null,
  signature: '',
})

const base = atom({ plugin: 'knowledge-pane', key: 'base' } as const, emptyBase('', DEFAULT_ROOT))
const nav = atom({ plugin: 'knowledge-pane', key: 'nav' } as const, HOME)
const full = atom({ plugin: 'knowledge-pane', key: 'full' } as const, {} as Record<string, string>)
const now = atom({ plugin: 'knowledge-pane', key: 'now' } as const, 0)
const isShown = atom({ plugin: 'knowledge-pane', key: 'isShown' } as const, false)
const tracked = atom({ plugin: 'knowledge-pane', key: 'tracked' } as const, IDLE)
const decisions = atom({ plugin: 'knowledge-pane', key: 'decisions' } as const, [] as Decision[])

export const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export const plain = (text: string): string => text.replace(/\*\*/g, '').replace(/`/g, '').replace(/<!--.*?-->/g, '').trimEnd()

export const fit = (text: string, width: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  const room = Math.max(1, width)
  return flat.length > room ? `${flat.slice(0, room - 1)}…` : flat
}

export const ago = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

const counted = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [])

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())

const isSeparator = (line: string): boolean => /^\|?\s*:?-{3,}/.test(line.trim())

// An object heading as `lib/knowledge.py` (`HEADING`) reads it: `<#…> <id> — <title>`, the em dash only.
// The anchor ending it (`<!-- kit:new -->`) is not part of the title.
const HEADING = /^(#{1,6})\s+(\S+)\s+—\s+(.*?)\s*(?:<!--.*-->)?\s*$/

export const headingOf = (line: string): { level: number; id: string; title: string } | null => {
  const found = HEADING.exec(line)
  return found === null ? null : { level: (found[1] ?? '').length, id: found[2] ?? '', title: (found[3] ?? '').trim() }
}

// A `## ` heading: its number when it has one, its title, the `<!-- kit:<name> -->` anchor ending it.
const SECTION = /^##\s+(?:(\d+)\.\s*)?(.*?)\s*(?:<!--\s*kit:([\w-]+)\s*-->|<!--.*-->)?\s*$/

export const sectionOf = (line: string): { number: string; title: string; anchor: string | undefined } | null => {
  const found = SECTION.exec(line)
  return found === null ? null : { number: found[1] ?? '', title: (found[2] ?? '').trim(), anchor: found[3] }
}

export const sectionLabel = (section: { number: string; title: string }): string => (section.number ? `${section.number}. ${section.title}` : section.title)

// Fields of `.index/knowledge.jsonl`, a frozen literal of the kit (`docs/FROZEN-LITERALS.md`).
export const parseIndex = (jsonl: string): KObject[] =>
  jsonl.split('\n').flatMap(line => {
    if (line.trim() === '') return []
    try {
      const row = JSON.parse(line) as Record<string, unknown>
      const kind = row.kind as Kind
      if (typeof row.id !== 'string' || !KINDS.includes(kind)) return []
      const level = LEVELS.includes(row.level as Level) ? (row.level as Level) : null
      return [
        {
          id: row.id,
          kind,
          context: textOf(row.context),
          title: textOf(row.title),
          text: textOf(row.text),
          level: row.status === 'observed' ? (level ?? 'medium') : null,
          path: textOf(row.path),
          line: typeof row.line === 'number' ? row.line : 0,
          end: typeof row.end === 'number' ? row.end : 0,
          cites: strings(row.cites),
          usecases: strings(row.usecases),
          handlers: strings(row.handlers),
          citedBy: strings(row.cited_by),
          contexts: strings(row.contexts),
        },
      ]
    } catch {
      return []
    }
  })

// The table under a `<!-- kit:cols … -->` anchor, header row dropped, read by position.
export const tableAfter = (text: string, cols: string): string[][] => {
  const lines = text.split('\n')
  const at = lines.findIndex(line => line.includes(`<!-- kit:cols ${cols} -->`))
  if (at < 0) return []
  const rows: string[][] = []
  for (const line of lines.slice(at + 1)) {
    if (!line.trim().startsWith('|')) {
      if (rows.length > 0 || line.trim() !== '') break
      continue
    }
    if (!isSeparator(line)) rows.push(cellsOf(line))
  }
  return rows.slice(1)
}

const numberOf = (cell: string | undefined): number => Number.parseInt(cell ?? '', 10) || 0

export const parseIndexMd = (text: string): { contexts: ContextRow[]; adrCount: number | null } => ({
  contexts: tableAfter(text, 'context,prefix,usecases,rules,decisions,summary').map(cells => ({
    name: (/^\[([^\]]+)\]/.exec(cells[0] ?? '')?.[1] ?? cells[0] ?? '').trim(),
    prefix: cells[1] ?? '',
    usecases: numberOf(cells[2]),
    rules: numberOf(cells[3]),
    decisions: numberOf(cells[4]),
    summary: cells[5] ?? '',
  })),
  adrCount: (() => {
    const found = /^ADR: (\d+)\.\s*$/m.exec(text)
    return found === null ? null : Number(found[1])
  })(),
})

export const parseHistory = (context: string, text: string): HistoryRow[] =>
  tableAfter(text, 'date,feature,delta').map(cells => ({
    context,
    date: cells[0] ?? '',
    feature: cells[1] ?? '',
    delta: (cells[2] ?? '').split(/\s+/).filter(token => token !== '' && token !== '—'),
  }))

export const deltaId = (token: string): string => token.replace(/^[+~-]/, '')

export const historyOf = (rows: HistoryRow[], id: string): HistoryRow[] => rows.filter(row => row.delta.some(token => deltaId(token) === id))

// An object's own lines, heading excluded: from its heading to the next heading of the same or a higher level.
export const sliceObject = (text: string, id: string): string | null => {
  const lines = text.split('\n')
  const at = lines.findIndex(line => headingOf(line)?.id === id)
  if (at < 0) return null
  const level = headingOf(lines[at] ?? '')?.level ?? 1
  const rest = lines.slice(at + 1)
  const stop = rest.findIndex(line => {
    const found = /^(#{1,6})\s/.exec(line)
    return found !== null && (found[1] ?? '').length <= level
  })
  return (stop < 0 ? rest : rest.slice(0, stop)).join('\n').trim()
}

// `[mtime_ns, size]` per base file in `.index/files.json`: a file whose stamp moved, or one not there, is not indexed yet.
export const staleOf = (files: { rel: string; size: number; mtimeMs: number }[], cache: unknown): string[] => {
  // Keys written on Windows by an older kit carry backslashes: read with `/`, as the walk names them.
  const known = Object.fromEntries(
    Object.entries(((cache ?? {}) as { files?: Record<string, { stamp?: unknown }> }).files ?? {}).map(([rel, one]) => [rel.replace(/\\/g, '/'), one]),
  )
  const seen = new Set(files.map(one => one.rel))
  const moved = files
    .filter(one => {
      const stamp = known[one.rel]?.stamp
      if (!Array.isArray(stamp)) return true
      const [ns, size] = stamp as number[]
      return size !== one.size || Math.abs((ns ?? 0) / 1e6 - one.mtimeMs) >= 1
    })
    .map(one => one.rel)
  return [...moved, ...Object.keys(known).filter(rel => !seen.has(rel))].sort()
}

export type AskTarget = { ids: string[] } | { handler: string }

export const askTarget = (command: string): AskTarget | null => {
  const asked = /\bcctoolkit\s+ask\b([^|;&\n]*)/.exec(command)
  if (asked === null) return null
  const args = (asked[1] ?? '').replace(/["']/g, ' ')
  const ids = /--id(?:=|\s+)([A-Za-z0-9?,-]+)/.exec(args)
  if (ids !== null) {
    const list = (ids[1] ?? '').split(',').filter(one => one !== '')
    return list.length > 0 ? { ids: list } : null
  }
  const handler = /--handler(?:=|\s+)([\w.]+)/.exec(args)
  return handler === null ? null : { handler: handler[1] ?? '' }
}

export const handlerTarget = (objects: KObject[], handler: string): KObject | undefined =>
  objects.find(one => one.kind === 'CU' && one.handlers.includes(handler)) ?? objects.find(one => one.handlers.includes(handler))

export const search = (objects: KObject[], query: string): KObject[] => {
  const words = fold(query).split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return []
  const scored = objects.flatMap(one => {
    const id = fold(one.id)
    const haystack = `${id} ${fold(one.title)} ${one.handlers.map(fold).join(' ')}`
    if (!words.every(word => haystack.includes(word))) return []
    const first = words[0] ?? ''
    const score = id === first ? 0 : id.includes(first) ? 1 : 2
    return [{ one, score }]
  })
  return scored.sort((a, b) => a.score - b.score || a.one.id.localeCompare(b.one.id)).map(entry => entry.one)
}

export const isOwnRule = (rule: KObject, cu: KObject): boolean => rule.kind === 'RM' && rule.path === cu.path

export const isSharedRule = (rule: KObject): boolean => rule.kind === 'RM' && /(?:^|[\\/])rules\.md$/.test(rule.path)

export const contextParts = (objects: KObject[], name: string) => {
  const mine = objects.filter(one => one.context === name)
  const usecases = mine.filter(one => one.kind === 'CU').sort((a, b) => a.id.localeCompare(b.id))
  return {
    usecases: usecases.map(cu => ({ cu, rules: mine.filter(one => isOwnRule(one, cu)).sort((a, b) => a.id.localeCompare(b.id)) })),
    shared: mine.filter(isSharedRule).sort((a, b) => a.id.localeCompare(b.id)),
    decisions: mine.filter(one => one.kind === 'D').sort((a, b) => a.id.localeCompare(b.id)),
    adrs: objects.filter(one => one.kind === 'ADR' && one.contexts.includes(name)).sort((a, b) => a.id.localeCompare(b.id)),
  }
}

export type OverviewPart = { title: string; body: string }

export const parseOverview = (text: string): { role: string; parts: OverviewPart[] } => {
  const parts: OverviewPart[] = []
  const role: string[] = []
  let current: { title: string; lines: string[] } | null = null
  let isTableHead = false
  for (const line of text.split('\n')) {
    if (/^#\s/.test(line)) continue
    const heading = sectionOf(line)
    if (heading !== null) {
      if (current !== null) parts.push({ title: current.title, body: current.lines.join('\n').trim() })
      current = { title: sectionLabel(heading), lines: [] }
      continue
    }
    if (/^\s*<!--.*-->\s*$/.test(line)) {
      isTableHead = line.includes('kit:cols')
      continue
    }
    let shown = line
    if (line.trim().startsWith('|')) {
      if (isSeparator(line)) continue
      if (isTableHead) {
        isTableHead = false
        continue
      }
      shown = cellsOf(line).join(' — ')
    }
    ;(current === null ? role : current.lines).push(shown)
  }
  if (current !== null) parts.push({ title: current.title, body: current.lines.join('\n').trim() })
  return { role: role.join('\n').trim(), parts }
}

export const isSpecPath = (path: string): boolean => SPEC_PATTERN.test(path)

// On Windows a tool's `file_path` comes as `C:\x\repo\todo\…`, the root maybe as `C:/x/repo`:
// both are compared with `/`, the drive's case aside.
const slashed = (path: string): string => path.replace(/\\/g, '/')
const isDrive = (path: string): boolean => /^[A-Za-z]:/.test(path)
export const isAbsolutePath = (path: string): boolean => /^(?:[A-Za-z]:)?[\\/]/.test(path)

export const relativePath = (path: string, root: string | null): string => {
  if (root === null) return path
  const [file, base] = [slashed(path), slashed(root).replace(/\/$/, '')]
  const cased = (one: string): string => (isDrive(base) ? one.toLowerCase() : one)
  return cased(file).startsWith(`${cased(base)}/`) ? file.slice(base.length + 1) : path
}

export const severityTone = (severity: string | null): 'error' | 'warning' | 'inactive' => {
  const folded = fold(severity ?? '')
  if (BLOCKING.some(word => folded.startsWith(word))) return 'error'
  if (MAJOR.some(word => folded.startsWith(word))) return 'warning'
  return 'inactive'
}

// A table read by its header names, folded.
export const parseTable = (body: string): Record<string, string>[] => {
  const rows = body.split('\n').filter(line => line.trim().startsWith('|') && !isSeparator(line))
  const [header, ...data] = rows
  if (header === undefined) return []
  const names = cellsOf(header).map(fold)
  return data.map(row => Object.fromEntries(cellsOf(row).map((cell, index) => [names[index] ?? `${index}`, cell])))
}

const cellOf = (row: Record<string, string>, ...names: string[]): string =>
  Object.entries(row).find(([name]) => names.some(one => name.startsWith(one)))?.[1] ?? ''

export const parseOpenQuestions = (body: string): OpenQuestion[] =>
  parseTable(body)
    .map(row => ({
      id: cellOf(row, '#'),
      severity: cellOf(row, 'sev'),
      question: cellOf(row, 'question'),
      impact: cellOf(row, 'impact'),
      options: cellOf(row, 'option'),
    }))
    .filter(question => question.question !== '')

const trimBlank = (lines: string[]): string => lines.join('\n').trim()

export const questionsSection = (sections: SpecSection[]): SpecSection | undefined =>
  sections.find(one => one.anchor === OPEN_QUESTIONS_ANCHOR) ??
  sections.find(one => one.anchor === undefined && OPEN_QUESTIONS_TITLE.test(`${one.number}. ${one.title}`))

// A use case or a rule of a spec: an object heading of level 3 with a spec id.
const specItemOf = (line: string) => {
  const found = headingOf(line)
  return found !== null && found.level === 3 && SPEC_ID.test(found.id) ? found : null
}

// A section without a number (`## Notes`) is keyed by its position, shown by its title alone.
export const sectionKey = (section: SpecSection, index: number): string => section.number || `#${index + 1}`

export const sectionCounts = (doc: SpecDoc): Record<string, number> => {
  const questions = questionsSection(doc.sections)
  return Object.fromEntries(
    doc.sections.map((section, index) => [
      sectionKey(section, index),
      section === questions ? doc.openQuestions.length : section.body.split('\n').filter(line => specItemOf(line) !== null).length,
    ]),
  )
}

export const parseSpec = (text: string): SpecDoc => {
  const lines = text.split('\n')
  const title = (lines.find(line => /^#\s/.test(line)) ?? '').replace(/^#\s+/, '').trim()
  const summary = lines
    .filter(line => line.startsWith('>'))
    .map(line => line.replace(/^>\s?/, '').trim())
    .join(' ')
    .trim()
  const sections: SpecSection[] = []
  const items: SpecItem[] = []
  let section: { number: string; title: string; anchor: string | undefined; lines: string[] } | null = null
  let item: { id: string; name: string; lines: string[] } | null = null
  const closeItem = () => {
    if (item === null) return
    const body = trimBlank(item.lines)
    const severity = isRule(item.id) ? (SEVERITY_PATTERN.exec(body)?.[1]?.trim() ?? null) : null
    items.push({ id: item.id, name: item.name, tag: severity, body })
    item = null
  }
  const closeSection = () => {
    closeItem()
    if (section !== null) sections.push({ number: section.number, title: section.title, ...(section.anchor === undefined ? {} : { anchor: section.anchor }), body: trimBlank(section.lines) })
    section = null
  }
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      closeSection()
      const heading = sectionOf(line)
      if (heading !== null) section = { ...heading, lines: [] }
      continue
    }
    if (section === null) continue
    section.lines.push(line)
    const found = specItemOf(line)
    if (found !== null) {
      closeItem()
      item = { id: found.id, name: found.title, lines: [] }
    } else if (/^###\s/.test(line)) closeItem()
    else if (item !== null) item.lines.push(line)
  }
  closeSection()
  const questions = questionsSection(sections)
  return {
    title,
    summary,
    sections,
    useCases: items.filter(one => isUseCase(one.id)),
    rules: items.filter(one => isRule(one.id)),
    openQuestions: questions === undefined ? [] : parseOpenQuestions(questions.body),
  }
}

export const isSpecSkill = (skill: unknown): boolean =>
  typeof skill === 'string' && (skill === SKILL || skill.endsWith(`:${SKILL}`))

export const promptTopic = (text: string): string | null | undefined => {
  const typed = /^\s*\/(?:[\w-]+:)?business-spec\b(.*)$/s.exec(text)
  if (typed !== null) return (typed[1] ?? '').trim() || null
  const expanded = /<command-name>\/?(?:[\w-]+:)?business-spec<\/command-name>/.test(text)
  if (!expanded) return undefined
  return /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() || null
}

type Asked = { question?: unknown; header?: unknown; options?: unknown }

const labelsOf = (options: unknown): string[] =>
  Array.isArray(options)
    ? options.map(option => (option as { label?: unknown }).label).filter((label): label is string => typeof label === 'string')
    : []

export const recommendedOf = (options: string[]): string | null =>
  options.find(option => RECOMMENDED_PATTERN.test(option)) ?? options[0] ?? null

export const askedOf = (id: string, questions: unknown): Decision[] =>
  (Array.isArray(questions) ? (questions as Asked[]) : [])
    .filter(one => typeof one.question === 'string')
    .map((one, index) => {
      const options = labelsOf(one.options)
      return {
        id: `${id}-${index}`,
        header: typeof one.header === 'string' ? one.header : '',
        question: one.question as string,
        options,
        recommended: recommendedOf(options),
        answer: null,
        note: null,
        isPending: true,
      }
    })

type Answered = { answers?: unknown; annotations?: unknown; response?: unknown }

export const withAnswers = (asked: Decision[], result: unknown): Decision[] => {
  const answered = (result ?? {}) as Answered
  const answers = (answered.answers ?? {}) as Record<string, unknown>
  const annotations = (answered.annotations ?? {}) as Record<string, { notes?: unknown } | undefined>
  const response = typeof answered.response === 'string' && answered.response.trim() !== '' ? answered.response.trim() : null
  return asked.map(decision => {
    const answer = answers[decision.question]
    const notes = annotations[decision.question]?.notes
    return {
      ...decision,
      answer: typeof answer === 'string' && answer !== '' ? answer : response,
      note: typeof notes === 'string' && notes.trim() !== '' ? notes.trim() : null,
      isPending: false,
    }
  })
}

export const isUnanswered = (decision: Decision): boolean => !decision.isPending && decision.answer === null

export const isOffRecommendation = (decision: Decision): boolean =>
  decision.answer !== null && decision.recommended !== null && !decision.answer.split(', ').includes(decision.recommended)

// The desktop sets its blocks apart by shade, not by line: a translucent grey surface reads on a light or a dark
// theme alike; what waits on the person takes a faint wash of its tone: a merge or sync staged and the index
// behind in amber, a blocking open question in red, a decision waiting for its answer in orange.
const SURFACE = '#80808014'
const WARNING_WASH = '#d99a1e24'
const WASH: Record<string, string> = { warning: WARNING_WASH, error: '#d6454524', claude: '#d977571f' }
// A block's padding, in cells; a washed row reaches one cell into it on each side, so its text keeps the column
// of the rows around it while its tone spans the whole width.
const BLOCK = { paddingX: 2, paddingY: 'sm' } as const
const BLEED = { marginX: -1, paddingX: 1 } as const

const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b', specified: '#3b82c4' } as const
const CELL_INK = '#0b0b0b'
const CELL = 18
const CELL_GAP = 3
const SVG_STYLE =
  '<style>text{font:11px system-ui,-apple-system,"Segoe UI",sans-serif}.ink{fill:#52514e}.head{fill:#52514e;font-weight:600}.muted{fill:#52514e;opacity:.7}' +
  '.empty{fill:#52514e;fill-opacity:.08}.rule{stroke:#52514e;stroke-opacity:.35}.pending{fill:none;stroke:#52514e;stroke-dasharray:3 2}.none{fill:#c3c2b7}' +
  '.glyph{font-size:10px;font-weight:600}.hit{fill:#52514e;fill-opacity:0}g.mark:hover .hit{fill-opacity:.14}' +
  '@media (prefers-color-scheme: dark){.ink,.head,.muted{fill:#c3c2b7}.empty{fill:#c3c2b7}.rule,.pending{stroke:#c3c2b7}.none{fill:#52514e}.hit{fill:#c3c2b7}}</style>'

export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const svgHeight = (source: string): number => Number(/<svg[^>]*\sheight="(\d+)"/.exec(source)?.[1] ?? 0)

export const svgWidth = (source: string): number => Number(/<svg[^>]*\swidth="(\d+)"/.exec(source)?.[1] ?? 0)

const px = (value: number): string => `${Math.round(value * 10) / 10}`

const svgOf = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${SVG_STYLE}${body}</svg>`

type Paint = string | 'pending' | 'none'

// One square with its glyph and its tooltip, a hit target wider than it.
const cellSvg = (x: number, y: number, fill: Paint, glyph: string, title: string[]): string => {
  const square =
    fill === 'pending'
      ? `<rect class="pending" x="${px(x + 0.5)}" y="${px(y + 0.5)}" width="${CELL - 1}" height="${CELL - 1}" rx="4"/>`
      : fill === 'none'
        ? `<rect class="none" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="4"/>`
        : `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="4" fill="${fill}"/>`
  const isInked = fill !== 'pending' && fill !== 'none'
  const text =
    glyph === ''
      ? ''
      : `<text class="glyph${isInked ? '' : ' ink'}" x="${px(x + CELL / 2)}" y="${px(y + CELL / 2 + 3.5)}" text-anchor="middle"${isInked ? ` fill="${CELL_INK}"` : ''}>${escapeXml(glyph)}</text>`
  return `<g class="mark"><title>${title.map(escapeXml).join('&#10;')}</title><rect class="hit" x="${x - 1.5}" y="${y - 1.5}" width="${CELL + 3}" height="${CELL + 3}" rx="5"/>${square}${text}</g>`
}

const swatchSvg = (x: number, y: number, fill: Paint): string =>
  fill === 'pending'
    ? `<rect class="pending" x="${x + 0.5}" y="${y - 8.5}" width="8" height="8" rx="2"/>`
    : fill === 'none'
      ? `<rect class="none" x="${x}" y="${y - 9}" width="9" height="9" rx="2"/>`
      : `<rect x="${x}" y="${y - 9}" width="9" height="9" rx="2" fill="${fill}"/>`

const headSvg = (title: string, count: string, left: number, width: number): string =>
  `<text class="head" x="${left}" y="12">${escapeXml(title)}</text>` +
  (count === '' ? '' : `<text class="muted" x="${left + width}" y="12" text-anchor="end">${escapeXml(count)}</text>`)

const STEP = 21
const LABEL_WIDTH = 190
const HEAD_HEIGHT = 62
const LEGEND_HEIGHT = 30
// The legend's last words end near x = 340: a matrix of few columns is drawn that wide all the same.
const LEGEND_WIDTH = 345

export const shortId = (id: string): string => id.replace(/^[A-Z][A-Z0-9]{1,5}-(?=(?:CU|RM|D)-)/, '')

// The rules a context's use cases apply, as columns: each use case's own rules in its order, then the shared ones.
export const matrixColumns = (objects: KObject[], name: string): KObject[] => {
  const { usecases, shared } = contextParts(objects, name)
  const ids = new Set(usecases.map(one => one.cu.id))
  const own = usecases.flatMap(one => one.rules)
  const taken = new Set([...own, ...shared].map(one => one.id))
  const elsewhere = objects.filter(one => one.kind === 'RM' && !taken.has(one.id) && one.usecases.some(cu => ids.has(cu)))
  return [...own, ...shared.filter(rule => rule.usecases.some(cu => ids.has(cu))), ...elsewhere.sort((a, b) => a.id.localeCompare(b.id))]
}

export const matrixSvg = (objects: KObject[], name: string): string => {
  const rows = contextParts(objects, name).usecases.map(one => one.cu)
  const columns = matrixColumns(objects, name)
  if (rows.length === 0 || columns.length === 0) return ''
  const width = Math.max(LEGEND_WIDTH, LABEL_WIDTH + columns.length * STEP + 24)
  const height = HEAD_HEIGHT + rows.length * STEP + LEGEND_HEIGHT
  const heads = columns
    .map((rule, index) => {
      const x = LABEL_WIDTH + index * STEP + CELL / 2
      const place = isSharedRule(rule) ? 'cross-cutting' : rule.context === name ? 'own' : rule.context
      return `<g class="mark"><title>${escapeXml(`${rule.id} — ${rule.title} · ${place}`)}</title><text class="${isSharedRule(rule) ? 'head' : 'ink'}" transform="translate(${x + 4},${HEAD_HEIGHT - 6}) rotate(-55)">${escapeXml(shortId(rule.id))}</text></g>`
    })
    .join('')
  const lines = rows
    .map((cu, row) => {
      const y = HEAD_HEIGHT + row * STEP
      const label = `<g class="mark"><title>${escapeXml(`${cu.id} — ${cu.title}`)}</title><text class="ink" x="0" y="${y + 13}">${escapeXml(fit(`${shortId(cu.id)} ${cu.title}`, 30))}</text></g>`
      const squares = columns
        .map((rule, index) => {
          const x = LABEL_WIDTH + index * STEP
          if (!rule.usecases.includes(cu.id)) return `<rect class="empty" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="4"/>`
          const status = rule.level === null ? 'specified' : `observed ${rule.level}`
          const place = isOwnRule(rule, cu) ? 'own rule' : isSharedRule(rule) ? 'cross-cutting' : `from ${rule.context}`
          return cellSvg(x, y, rule.level === null ? STATUS.specified : STATUS.warning, rule.level?.[0] ?? '', [`${cu.id} applies ${rule.id}`, rule.title, `${place} · ${status}`])
        })
        .join('')
      return label + squares
    })
    .join('')
  const firstShared = columns.findIndex(isSharedRule)
  const divider =
    firstShared > 0
      ? `<line class="rule" x1="${LABEL_WIDTH + firstShared * STEP - 2}" y1="${HEAD_HEIGHT - 4}" x2="${LABEL_WIDTH + firstShared * STEP - 2}" y2="${HEAD_HEIGHT + rows.length * STEP - 3}"/>`
      : ''
  const legendY = HEAD_HEIGHT + rows.length * STEP + 18
  const legend =
    `${swatchSvg(0, legendY, STATUS.specified)}<text class="ink" x="13" y="${legendY}">specified</text>` +
    `${swatchSvg(84, legendY, STATUS.warning)}<text class="ink" x="97" y="${legendY}">observed (h · m · l)</text>` +
    `<text class="muted" x="230" y="${legendY}">bold: cross-cutting</text>`
  return svgOf(width, height, `${headSvg('Use cases × rules', '', 0, width)}${heads}${divider}${lines}${legend}`)
}

export const matrixAlt = (objects: KObject[], name: string): string => {
  const rows = contextParts(objects, name).usecases
  const columns = matrixColumns(objects, name)
  const applied = rows.map(({ cu }) => `${cu.id} applies ${columns.filter(rule => rule.usecases.includes(cu.id)).map(rule => rule.id).join(', ') || 'no rule'}`)
  return `${name}: ${counted(rows.length, 'use case')} × ${counted(columns.length, 'rule')}. ${applied.join('; ')}.`
}

const SVG_WIDTH = 560
const COLUMN_GAP = 24
const LEGEND_CHAR_PX = 6.2
const LEGEND_LINE = 16

type Cell = { fill: Paint; glyph: string; title: string[] }

type Block = { svg: string; height: number }

const cells = (items: Cell[], left: number, y: number, width: number): Block => {
  const perRow = Math.max(1, Math.floor((width + CELL_GAP) / (CELL + CELL_GAP)))
  const svg = items
    .map((item, index) => cellSvg(left + (index % perRow) * (CELL + CELL_GAP), y + Math.floor(index / perRow) * (CELL + CELL_GAP), item.fill, item.glyph, item.title))
    .join('')
  return { svg, height: Math.ceil(items.length / perRow) * (CELL + CELL_GAP) - CELL_GAP }
}

const legend = (items: { fill: Paint; text: string }[], left: number, y: number, width: number): Block => {
  let x = 0
  let line = 0
  const svg = items
    .map(item => {
      const room = 13 + [...item.text].length * LEGEND_CHAR_PX
      if (x > 0 && x + room > width) {
        x = 0
        line += 1
      }
      const at = left + x
      const base = y + line * LEGEND_LINE
      x += room + 16
      return `${swatchSvg(at, base, item.fill)}<text class="ink" x="${at + 13}" y="${base}">${escapeXml(item.text)}</text>`
    })
    .join('')
  return { svg, height: (line + 1) * LEGEND_LINE }
}

type Severity = 'blocking' | 'major' | 'other'

const SEVERITIES: { key: Severity; icon: string; fill: Paint }[] = [
  { key: 'blocking', icon: '✖', fill: STATUS.critical },
  { key: 'major', icon: '▲', fill: STATUS.warning },
  { key: 'other', icon: '●', fill: 'none' },
]

const severityOf = (question: OpenQuestion): Severity => {
  const tone = severityTone(question.severity)
  return tone === 'error' ? 'blocking' : tone === 'warning' ? 'major' : 'other'
}

const bySeverity = (questions: OpenQuestion[]) =>
  SEVERITIES.map(one => ({ ...one, items: questions.filter(question => severityOf(question) === one.key) }))

const decisionParts = (asked: Decision[]) => {
  const pending = asked.filter(one => one.isPending)
  const none = asked.filter(isUnanswered)
  const other = asked.filter(one => !one.isPending && !isUnanswered(one) && isOffRecommendation(one))
  const kept = asked.filter(one => !one.isPending && !isUnanswered(one) && !isOffRecommendation(one))
  return { pending, none, other, kept }
}

const nameOf = (decision: Decision): string => decision.header || decision.question

const block = (title: string, count: string, items: Cell[], keys: { fill: Paint; text: string }[], left: number, width: number): Block => {
  const grid = cells(items, left, 20, width)
  const key = legend(keys, left, 20 + grid.height + 18, width)
  return { svg: headSvg(title, count, left, width) + grid.svg + key.svg, height: 20 + grid.height + 6 + key.height }
}

const answerOf = (decision: Decision): string[] =>
  [
    nameOf(decision),
    decision.header === '' ? '' : decision.question,
    decision.isPending ? 'waiting for the answer' : decision.answer === null ? 'no answer' : `answer: ${decision.answer}`,
    decision.recommended === null ? '' : `recommended: ${decision.recommended}`,
  ].filter(one => one !== '')

export const specGauge = (asked: Decision[], doc: SpecDoc | null): string => {
  if (asked.length === 0 && doc === null) return ''
  const isPair = doc !== null && asked.length > 0
  const width = isPair ? (SVG_WIDTH - COLUMN_GAP) / 2 : SVG_WIDTH
  const blocks: Block[] = []
  if (doc !== null) {
    if (doc.openQuestions.length === 0) {
      blocks.push({
        svg:
          headSvg('Open questions', '', 0, width) +
          `<rect x="0" y="20" width="${CELL}" height="${CELL}" rx="4" fill="${STATUS.good}"/><text class="glyph" x="${CELL / 2}" y="${20 + CELL / 2 + 3.5}" text-anchor="middle" fill="${CELL_INK}">✓</text><text class="ink" x="${CELL + 8}" y="33">no open question</text>`,
        height: 20 + CELL,
      })
    } else {
      const groups = bySeverity(doc.openQuestions)
      blocks.push(
        block(
          'Open questions',
          counted(doc.openQuestions.length, 'open', 'open'),
          groups.flatMap(group =>
            group.items.map(question => ({
              fill: group.fill,
              glyph: group.icon,
              title: [`${question.id} · ${group.key}`, plain(question.question), question.impact === '' ? '' : `impact: ${plain(question.impact)}`].filter(one => one !== ''),
            })),
          ),
          groups.filter(group => group.items.length > 0).map(group => ({ fill: group.fill, text: `${group.icon} ${group.items.length} ${group.key}` })),
          0,
          width,
        ),
      )
    }
  }
  if (asked.length > 0) {
    const { pending, none, other, kept } = decisionParts(asked)
    blocks.push(
      block(
        'Decisions',
        `${kept.length + other.length} of ${asked.length} answered`,
        [
          ...kept.map(one => ({ fill: STATUS.good, glyph: '✓', title: answerOf(one) })),
          ...other.map(one => ({ fill: STATUS.warning, glyph: '≠', title: answerOf(one) })),
          ...none.map(one => ({ fill: 'none', glyph: '–', title: answerOf(one) })),
          ...pending.map(one => ({ fill: 'pending', glyph: '?', title: answerOf(one) })),
        ],
        [
          ...(kept.length > 0 ? [{ fill: STATUS.good, text: `✓ ${kept.length} recommended kept` }] : []),
          ...(other.length > 0 ? [{ fill: STATUS.warning, text: `≠ ${other.length} other choice` }] : []),
          ...(none.length > 0 ? [{ fill: 'none', text: `– ${none.length} no answer` }] : []),
          ...(pending.length > 0 ? [{ fill: 'pending', text: `? ${pending.length} pending` }] : []),
        ],
        isPair ? width + COLUMN_GAP : 0,
        width,
      ),
    )
  }
  const height = Math.ceil(Math.max(...blocks.map(one => one.height)) + 4)
  return svgOf(SVG_WIDTH, height, blocks.map(one => one.svg).join(''))
}

export const specGaugeAlt = (asked: Decision[], doc: SpecDoc | null): string => {
  const parts: string[] = []
  if (doc !== null) {
    const groups = bySeverity(doc.openQuestions).filter(group => group.items.length > 0)
    parts.push(
      doc.openQuestions.length === 0
        ? 'no open question'
        : `${counted(doc.openQuestions.length, 'open question')} (${groups.map(group => `${group.items.length} ${group.key}`).join(', ')})`,
    )
  }
  if (asked.length > 0) {
    const { pending, none, other, kept } = decisionParts(asked)
    const split = [
      kept.length > 0 ? `${kept.length} recommended kept` : '',
      other.length > 0 ? `${other.length} other choice${other.length === 1 ? '' : 's'}` : '',
      none.length > 0 ? `${none.length} without answer` : '',
      pending.length > 0 ? `${pending.length} pending` : '',
    ].filter(one => one !== '')
    parts.push(`${counted(asked.length, 'decision')} (${split.join(', ')})`)
  } else parts.push('no decision')
  if (doc === null) parts.push('spec not written yet')
  return `Spec state: ${parts.join(', ')}.`
}

const blockingCount = (questions: OpenQuestion[]): number => questions.filter(one => severityTone(one.severity) === 'error').length

export const questionsTone = (questions: OpenQuestion[]): 'error' | 'warning' | 'inactive' => {
  const tones = questions.map(one => severityTone(one.severity))
  return tones.includes('error') ? 'error' : tones.includes('warning') ? 'warning' : 'inactive'
}

const join = (...parts: string[]): string => parts.filter(part => part !== '').join('/')

const listOf = async ($: EngineInterface, path: string) => (await $.fs.list(path).catch(() => [])) ?? []

type FileStamp = { rel: string; size: number; mtimeMs: number }

// Every `.md` of the base but INDEX.md and HISTORY.md, dot folders (staging, index) left out, a linked file read
// through its link, a linked folder not entered — as `lib/knowledge.py` `markdown_files` walks them.
async function baseFiles($: EngineInterface, repo: string, root: string, sub = '', depth = 0): Promise<FileStamp[]> {
  if (depth > 32) return []
  const entries = await listOf($, join(repo, root, sub))
  const found: FileStamp[] = []
  for (const entry of entries) {
    const rel = join(sub, entry.name)
    if (entry.kind === 'dir') {
      if (!entry.name.startsWith('.')) found.push(...(await baseFiles($, repo, root, rel, depth + 1)))
      continue
    }
    if (!entry.name.endsWith('.md') || SKIPPED.includes(entry.name)) continue
    if (entry.kind === 'file') found.push({ rel: join(root, rel), size: entry.size, mtimeMs: entry.mtimeMs })
    else if (entry.isLink) {
      const target = await $.fs.stat(join(repo, root, rel)).catch(() => null)
      if (target?.kind === 'file') found.push({ rel: join(root, rel), size: target.size, mtimeMs: target.mtimeMs })
    }
  }
  return found
}

async function filesUnder($: EngineInterface, path: string, sub = '', depth = 0): Promise<{ rel: string; mtimeMs: number }[]> {
  if (depth > 6) return []
  const found: { rel: string; mtimeMs: number }[] = []
  for (const entry of await listOf($, join(path, sub))) {
    const rel = join(sub, entry.name)
    if (entry.kind === 'dir') found.push(...(await filesUnder($, path, rel, depth + 1)))
    else if (entry.kind === 'file') found.push({ rel, mtimeMs: entry.mtimeMs })
  }
  return found
}

const readText = async ($: EngineInterface, path: string): Promise<string | null> => {
  try {
    // A Windows checkout may carry CRLF: every parser below splits on `\n`.
    return (await $.fs.read(path)).replace(/\r\n?/g, '\n')
  } catch {
    return null
  }
}

const mtimeOf = async ($: EngineInterface, path: string): Promise<number> => (await $.fs.stat(path).catch(() => null))?.mtimeMs ?? 0

// What a tick compares: a change of any of it reloads the base.
async function signatureOf($: EngineInterface, repo: string, root: string): Promise<{ signature: string; files: FileStamp[] }> {
  const at = join(repo, root)
  if ((await $.fs.stat(at).catch(() => null))?.kind !== 'dir') return { signature: 'absent', files: [] }
  const files = await baseFiles($, repo, root)
  const staging = [
    ...(await filesUnder($, join(at, '.merge'))).map(one => `m:${one.rel}:${one.mtimeMs}`),
    ...(await filesUnder($, join(at, '.sync'))).map(one => `s:${one.rel}:${one.mtimeMs}`),
  ]
  const marks = [
    `i:${await mtimeOf($, join(at, INDEX_JSONL))}`,
    `x:${await mtimeOf($, join(at, 'INDEX.md'))}`,
    ...files.map(one => `f:${one.rel}:${one.size}:${one.mtimeMs}`),
    ...staging,
  ]
  return { signature: marks.sort().join('|'), files }
}

async function loadMerge($: EngineInterface, at: string, code: string): Promise<Merge> {
  const dir = join(at, '.merge', code)
  const feature = (await readText($, join(dir, '.feature')))?.trim() ?? code
  let objects: MergeObject[] = []
  try {
    const packet = JSON.parse((await readText($, join(dir, '.packet.json'))) ?? '{}') as { objects?: Record<string, unknown>[] }
    objects = (packet.objects ?? [])
      .filter(one => one.status === undefined || one.status === 'todo')
      .map(one => ({ id: textOf(one.id), kind: textOf(one.kind), change: textOf(one.change), context: textOf(one.context), title: textOf(one.title) }))
      .filter(one => one.id !== '')
  } catch {
    objects = []
  }
  const entries = await listOf($, dir)
  const staged = entries.filter(entry => entry.kind === 'dir' && !entry.name.startsWith('.')).map(entry => entry.name)
  const sources = [
    ...(await Promise.all(staged.map(async name => (await filesUnder($, join(dir, name))).map(one => join(dir, name, one.rel))))).flat(),
    ...(await filesUnder($, join(dir, '.drafts'))).map(one => join(dir, '.drafts', one.rel)),
  ]
  const after: Record<string, string> = {}
  for (const path of sources) {
    if (!path.endsWith('.md')) continue
    const text = await readText($, path)
    if (text === null) continue
    for (const object of objects) {
      if (after[object.id] !== undefined || object.change === 'retired') continue
      const found = sliceObject(text, object.id)
      if (found !== null) after[object.id] = found
    }
  }
  return { code, isPartial: / partial$/.test(feature), isStaged: staged.length > 0, objects, after }
}

async function loadSyncs($: EngineInterface, at: string): Promise<Sync[]> {
  const syncs: Sync[] = []
  for (const entry of await listOf($, join(at, '.sync'))) {
    if (entry.kind !== 'dir' || entry.name.startsWith('.')) continue
    const files = (await filesUnder($, join(at, '.sync', entry.name))).map(one => one.rel).sort()
    if (files.length > 0) syncs.push({ context: entry.name, files })
  }
  return syncs
}

export async function loadBase(
  $: EngineInterface,
  repo: string,
  root: string,
  isDemo: boolean,
  walked?: { signature: string; files: FileStamp[] },
): Promise<Base> {
  const at = join(repo, root)
  const { signature, files } = walked ?? (await signatureOf($, repo, root))
  const isPresent = signature !== 'absent'
  const empty = { ...emptyBase(repo, root), isDemo, signature, readAt: await $.clock.now() }
  if (!isPresent) return empty
  const jsonl = await readText($, join(at, INDEX_JSONL))
  const objects = jsonl === null ? [] : parseIndex(jsonl)
  let index: IndexState = jsonl === null ? 'missing' : 'ok'
  let staleFiles: string[] = []
  if (jsonl !== null && !isDemo) {
    let cache: unknown = {}
    try {
      cache = JSON.parse((await readText($, join(at, INDEX_FILES))) ?? '{}')
    } catch {
      cache = {}
    }
    staleFiles = staleOf(files, cache)
    if (staleFiles.length > 0) index = 'stale'
  }
  const indexMd = await readText($, join(at, 'INDEX.md'))
  const parsed = indexMd === null ? { contexts: [], adrCount: null } : parseIndexMd(indexMd)
  const named = new Set(parsed.contexts.map(one => one.name))
  const extra = [...new Set(objects.filter(one => one.kind !== 'ADR' && one.context !== '').map(one => one.context))]
    .filter(name => !named.has(name))
    .map(name => ({ name, prefix: '', usecases: 0, rules: 0, decisions: 0, summary: '' }))
  const contexts = [...parsed.contexts, ...extra]
  const overviews: Record<string, string> = {}
  const history: HistoryRow[] = []
  for (const context of contexts) {
    const overview = await readText($, join(at, context.name, 'OVERVIEW.md'))
    if (overview !== null) overviews[context.name] = overview
    const rows = await readText($, join(at, context.name, 'HISTORY.md'))
    if (rows !== null) history.push(...parseHistory(context.name, rows))
  }
  history.sort((a, b) => b.date.localeCompare(a.date))
  const merges: Merge[] = []
  for (const entry of await listOf($, join(at, '.merge'))) {
    if (entry.kind !== 'dir') continue
    merges.push(await loadMerge($, at, entry.name))
  }
  return {
    ...empty,
    isPresent,
    index,
    staleFiles,
    contexts,
    adrCount: parsed.adrCount ?? (objects.length > 0 ? objects.filter(one => one.kind === 'ADR').length : null),
    objects,
    overviews,
    history,
    merges,
    syncs: await loadSyncs($, at),
  }
}

async function reload($: EngineInterface, walked?: { signature: string; files: FileStamp[] }): Promise<Base> {
  const current = await read($, base)
  const next = await loadBase($, current.repo, current.root, current.isDemo, walked)
  await update($, base, () => next)
  await update($, full, () => ({}))
  // The view on top keeps its whole text: the index holds a use case's head only.
  const { stack } = await read($, nav)
  const top = stack[stack.length - 1]
  if (top?.kind === 'object' || top?.kind === 'change') await fetchFull($, top.id)
  return next
}

// Where `/cctoolkit:kit-init` keeps the base: `knowledge.root` of the repo's kit config, `docs/business` by default.
async function rootOf($: EngineInterface, repo: string): Promise<string> {
  try {
    const config = JSON.parse((await readText($, join(repo, CONFIG))) ?? '{}') as { product?: unknown; knowledge?: { root?: unknown } }
    const root = config.knowledge?.root
    if (typeof root !== 'string' || root.trim() === '') return DEFAULT_ROOT
    return root.replaceAll('{product}', typeof config.product === 'string' && config.product !== '' ? config.product : '*').replace(/^[\\/]+|[\\/]+$/g, '')
  } catch {
    return DEFAULT_ROOT
  }
}

async function switchTo($: EngineInterface, repo: string, root: string, isDemo: boolean): Promise<Base> {
  const next = await loadBase($, repo, root, isDemo)
  await update($, base, () => next)
  await update($, full, () => ({}))
  await update($, nav, () => HOME)
  return next
}

// An object's text whole, read from its file at `path:line` — the index keeps a use case's head only.
async function fetchFull($: EngineInterface, id: string): Promise<void> {
  const current = await read($, base)
  const object = current.objects.find(one => one.id === id)
  if (object === undefined || (await read($, full))[id] !== undefined) return
  const text = await readText($, join(current.repo, object.path))
  const lines = text?.split('\n') ?? []
  const body = text === null ? object.text : (sliceObject(text, id) ?? lines.slice(object.line, object.end).join('\n').trim())
  await update($, full, known => ({ ...known, [id]: body }))
}

async function push($: EngineInterface, view: View): Promise<void> {
  if (view.kind === 'object' || view.kind === 'change') await fetchFull($, view.id)
  await update($, nav, current => {
    const stack = current.stack.length > 0 ? current.stack : HOME.stack
    const top = stack[stack.length - 1]
    if (top !== undefined && JSON.stringify(top) === JSON.stringify(view)) return current
    return seeded({ ...HOME, ...current, stack: [...stack, view], expanded: [] })
  })
}

async function back($: EngineInterface): Promise<void> {
  await update($, nav, current => seeded({ ...HOME, ...current, stack: current.stack.length > 1 ? current.stack.slice(0, -1) : HOME.stack, expanded: [] }))
}

async function home($: EngineInterface): Promise<void> {
  await update($, nav, current => ({ ...HOME, query: current.query }))
}

// The stack without the spec view, so it is never on it twice.
const withoutSpec = (current: Navigation): View[] => {
  const stack = current.stack.filter(one => one.kind !== 'spec')
  return stack.length > 0 ? stack : HOME.stack
}

// The plugin's own close never reaches its own ui.close hook: the flag is set here.
async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE }).catch(() => undefined)
  await update($, isShown, () => false)
}

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS }).catch(() => null)
  if (opened?.isPlaced) await update($, isShown, () => true)
}

async function showSpec($: EngineInterface): Promise<void> {
  await update($, nav, (current): Navigation => ({ ...HOME, ...current, stack: [...withoutSpec({ ...HOME, ...current }), { kind: 'spec' }], expanded: [] }))
  await openPane($)
}

async function arm($: EngineInterface, topic: string | null): Promise<void> {
  await update($, tracked, () => ({ ...IDLE, isArmed: true, topic }))
  await update($, decisions, () => [])
  await showSpec($)
}

async function reloadSpec($: EngineInterface, path: string): Promise<void> {
  const stat = await $.fs.stat(path).catch(() => null)
  const text = stat === null ? null : await readText($, path)
  if (stat === null || text === null) {
    await update($, tracked, state => ({ ...state, path }))
    return
  }
  const at = await $.clock.now()
  await update($, tracked, state => ({ ...state, isArmed: true, path, mtimeMs: stat.mtimeMs, doc: parseSpec(text), readAt: at }))
}

async function tick($: EngineInterface): Promise<void> {
  const shown = await read($, isShown)
  const spec = await read($, tracked)
  if (!shown && !spec.isArmed) return
  const at = await $.clock.now()
  await update($, now, () => at)
  if (spec.path !== null) {
    const stat = await $.fs.stat(spec.path).catch(() => null)
    if (stat !== null && stat.mtimeMs !== spec.mtimeMs) await reloadSpec($, spec.path)
  }
  const current = await read($, base)
  if (!shown || current.repo === '') return
  const walked = await signatureOf($, current.repo, current.root)
  if (walked.signature !== current.signature) await reload($, walked)
}

export const register: Register = on => {
  let repo: string | null = null

  // On a desktop, a button above the prompt opens and closes the pane once the repo holds a base or a spec is
  // followed: its tab has no way back once closed but the commands.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    if (!(await read($, base)).isPresent && !(await read($, tracked)).isArmed) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const shown = await read($, isShown)
    const { stack } = { ...HOME, ...(await read($, nav)) }
    const label = stack[stack.length - 1]?.kind === 'spec' ? `◫ ${SPEC_TITLE}` : `◫ ${TITLE}`
    return (
      <Box>
        <Button key="toggle-knowledge-pane" label={label} variant={shown ? 'primary' : 'secondary'} onPress={() => (shown ? closePane($) : openPane($))} />
      </Box>
    )
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) await update($, isShown, () => false)
    return result
  })

  on('session.start', async ($, e, next) => {
    const panes = await $.ui.panes().catch(() => [])
    await update($, isShown, () => panes.some(pane => pane.id === PANE))
    repo = e.cwd
    await $.command.register({
      name: 'knowledge-pane',
      description: 'Browse the knowledge base: a context, an id or words to search; demo shows the kit example',
    })
    await $.command.register({
      name: 'spec-pane',
      description: 'Open the /business-spec view of the knowledge pane (a SPEC path follows that spec, clear forgets it)',
    })
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    const current = await read($, base)
    if (!current.isDemo || current.repo === '') await switchTo($, e.cwd, await rootOf($, e.cwd), false).catch(() => undefined)
    if ((await read($, tracked)).isArmed) void showSpec($)
    return next(e)
  })

  on('command.run', { command: 'knowledge-pane' }, async ($, e) => {
    const asked = e.args.trim()
    if (asked === 'demo') {
      await switchTo($, `${$.plugin.root}/demo`, DEFAULT_ROOT, true)
      await openPane($)
      return { text: 'Knowledge pane: demo base, the kit example (Catalog).' }
    }
    let current = await read($, base)
    if (current.isDemo || current.repo === '' || asked === '') {
      const where = repo ?? current.repo
      current = await switchTo($, where, await rootOf($, where), false)
    }
    if (asked !== '') {
      const context = current.contexts.find(one => fold(one.name) === fold(asked))
      if (context !== undefined) await push($, { kind: 'context', name: context.name })
      else if (ID_PATTERN.test(asked.toUpperCase())) await push($, { kind: 'object', id: asked.toUpperCase() })
      else {
        await update($, nav, current => ({ ...current, query: asked }))
        await push($, { kind: 'search' })
      }
    }
    await openPane($)
    return { text: current.isPresent ? 'Knowledge pane opened.' : `Knowledge pane opened — no knowledge base under ${current.root}.` }
  })

  on('command.run', { command: 'spec-pane' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, tracked, () => IDLE)
      await update($, decisions, () => [])
      await update($, nav, current => seeded({ ...HOME, ...current, stack: withoutSpec({ ...HOME, ...current }), expanded: [] }))
      return { text: 'Spec pane cleared.' }
    }
    const asked = e.args.trim().replace(/^@/, '')
    if (asked !== '') {
      const path = isAbsolutePath(asked) || repo === null ? asked : `${repo}/${asked}`
      if (!isSpecPath(path)) return { text: `Not a spec: ${asked} (expected todo/<code>/SPEC-<code>.md or todo/<slug>/SPEC.md).` }
      await update($, tracked, () => ({ ...IDLE, isArmed: true }))
      await update($, decisions, () => [])
      await reloadSpec($, path)
      if ((await read($, tracked)).doc === null) return { text: `Spec not found: ${asked}.` }
    }
    await showSpec($)
    return { text: 'Spec pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const topic = promptTopic(e.text)
    if (topic !== undefined) await arm($, topic)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Follow: the object a `cctoolkit ask --id` or `--handler` of the main thread asked for, while the pane is shown.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const target = askTarget(e.command)
    if (target === null || !(await read($, isShown)) || (await read($, base)).isDemo) return next(e)
    const answered = await next(e)
    const current = await reload($)
    if ('ids' in target) {
      for (const id of [...target.ids].reverse()) await push($, { kind: 'object', id })
    } else {
      const found = handlerTarget(current.objects, target.handler)
      if (found !== undefined) await push($, { kind: 'object', id: found.id })
    }
    return answered
  }).catch(($, e, next) => next(e))

  // Follow: the `/business-spec` of the main thread, its questions with their answers, then its SPEC file.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const input = e as unknown as Record<string, unknown>

    if (e.tool === 'Skill') {
      if (isSpecSkill(input.skill)) {
        const args = typeof input.args === 'string' && input.args.trim() !== '' ? input.args.trim() : null
        const state = await read($, tracked)
        if (!state.isArmed || state.path !== null || state.topic !== args) await arm($, args)
      }
      return next(e)
    }

    if (e.tool === 'AskUserQuestion') {
      if (!(await read($, tracked)).isArmed) return next(e)
      const asked = askedOf(e.tool_use_id ?? `q${await $.clock.now()}`, input.questions)
      await update($, decisions, list => [...list, ...asked])
      const answered = await next(e)
      const done = withAnswers(asked, 'deny' in answered && answered.deny !== undefined ? {} : answered.result)
      await update($, decisions, list => list.map(one => done.find(other => other.id === one.id) ?? one))
      return answered
    }

    const path = input.file_path
    const isEdit = EDITING_TOOLS.includes(e.tool)
    if (typeof path !== 'string' || !isSpecPath(path) || (!isEdit && e.tool !== 'Read')) return next(e)
    const state = await read($, tracked)
    if (e.tool === 'Read' && (!state.isArmed || state.path !== null)) return next(e)
    const answered = await next(e)
    if (!state.isArmed) await showSpec($)
    await reloadSpec($, path)
    return answered
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const Svg = e.surface === 'desktop' && 'Svg' in elements ? elements.Svg : undefined
    const Markdown = e.surface === 'desktop' && 'Markdown' in elements ? elements.Markdown : undefined
    // The desktop draws in a proportional face: no space indents, glyph rules or `⎿` there, but a type scale,
    // spacing steps and real buttons. The terminal keeps its text layout.
    const isDesktop = e.surface === 'desktop'
    const kb = await read($, base)
    const spec = await read($, tracked)
    const asked = await read($, decisions)
    const where: Navigation = { ...HOME, ...(await read($, nav)) }
    const texts = await read($, full)
    const at = await read($, now)
    const columns = e.props.bodyColumns
    const view: View = where.stack[where.stack.length - 1] ?? { kind: 'home' }
    const byId = new Map(kb.objects.map(one => [one.id, one]))
    // On the spec, `b` folds the rows unfolded first, then walks back.
    const isFolding = view.kind === 'spec' && where.expanded.length > 0

    const go = (next: View) => () => void push($, next).catch(() => undefined)
    // The search takes the ring on its field, so what is typed next fills it rather than the prompt.
    const toSearch = () =>
      void push($, { kind: 'search' })
        .then(() => $.ui.focus({ requestId: PANE, key: 'query' }))
        .catch(() => undefined)
    const toggle = (group: string) => () =>
      void update($, nav, current => ({
        ...HOME,
        ...current,
        collapsed: current.collapsed.includes(group) ? current.collapsed.filter(one => one !== group) : [...current.collapsed, group],
      }))
    const unfold = (slot: string) => () =>
      void update($, nav, current => ({
        ...HOME,
        ...current,
        expanded: current.expanded.includes(slot) ? current.expanded.filter(one => one !== slot) : [...current.expanded, slot],
      }))
    const foldAll = () => void update($, nav, current => ({ ...HOME, ...current, expanded: [] }))
    const isOpen = (group: string, byDefault = true) => (where.collapsed.includes(group) ? !byDefault : byDefault)

    const close = isDesktop
      ? <Button key="close" label="Close" role="dismiss" onPress={() => closePane($)} />
      : <Button key="close" label="✕" plain dimColor onPress={() => closePane($)} />
    const header = (title: string, trail?: string) => isDesktop ? (
      <Box key="header" flexDirection="row" alignItems="flex-start" gap="sm">
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {trail !== undefined && <Text size="footnote" dimColor wrap="truncate-end">{trail}</Text>}
          <Text size="heading" weight="semibold" wrap="wrap">{title}</Text>
        </Box>
        {close}
      </Box>
    ) : (
      <Box key="header" height={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color="claude">✻ </Text>
            {trail !== undefined && <Text color="inactive">{trail} › </Text>}
            <Text bold>{title}</Text>
          </Text>
        </Box>
        <Text> </Text>
        {close}
      </Box>
    )
    const freshness = (readAt: number | null) => (readAt === null || at === 0 ? '' : ` · read ${ago(at - readAt)} ago`)
    const place =
      view.kind !== 'spec'
        ? `${kb.isDemo ? `demo · ${kb.root}` : kb.root}${freshness(kb.readAt)}`
        : spec.path !== null
          ? `${relativePath(spec.path, repo)}${freshness(spec.readAt)}`
          : spec.isArmed
            ? 'waiting for the SPEC file…'
            : 'No /business-spec in this session yet.'
    // A path cut from its start keeps its indent: the cut happens after the leading cells, never through them.
    const tail = (key: string, indent: number, text: string) => (
      <Box key={key} height={1}>
        <Text>{' '.repeat(indent)}</Text>
        <Text color="inactive" wrap="truncate-start">{text}</Text>
      </Box>
    )
    const location = isDesktop ? (
      <Text key="location" size="footnote" mono dimColor wrap="truncate-start">{place}</Text>
    ) : (
      tail('location', INDENT.length, place)
    )
    const keys = isDesktop ? (
      <Box key="keys" flexDirection="row" flexWrap="wrap" gap="xs" marginTop="xs">
        {where.stack.length > 1 && <Button key="back" label="← Back" hotkey={isFolding ? undefined : 'b'} onPress={() => void back($)} />}
        {where.stack.length > 1 && <Button key="home" label="Home" hotkey="h" onPress={() => void home($)} />}
        {kb.isPresent && view.kind !== 'search' && <Button key="search" label="Search" hotkey="s" onPress={toSearch} />}
        {isFolding && <Button key="fold-all" label={`Fold all (${where.expanded.length} open)`} hotkey="b" onPress={foldAll} />}
      </Box>
    ) : (
      <Box key="keys" height={1}>
        <Text>{INDENT}</Text>
        {[
          isFolding && (
            <Button key="fold-all" hotkey="b" plain dimColor onPress={foldAll}>
              <Text>{`fold all (${where.expanded.length} open)`}</Text>
            </Button>
          ),
          where.stack.length > 1 && (
            <Button key="back" hotkey={isFolding ? undefined : 'b'} plain dimColor onPress={() => void back($)}>
              <Text>back</Text>
            </Button>
          ),
          where.stack.length > 1 && (
            <Button key="home" hotkey="h" plain dimColor onPress={() => void home($)}>
              <Text>home</Text>
            </Button>
          ),
          kb.isPresent && view.kind !== 'search' && (
            <Button key="search" hotkey="s" plain dimColor onPress={toSearch}>
              <Text>search</Text>
            </Button>
          ),
        ]
          .filter(Boolean)
          .flatMap((one, index) => (index === 0 ? [one] : [<Text key={`keys-gap-${index}`}>{'   '}</Text>, one]))}
      </Box>
    )
    // Markdown lines as text: a heading bold without its marks, a fenced block dim without its fences.
    const paragraph = (key: string, text: string, color?: string) => {
      if (Markdown !== undefined) {
        const source = text.replace(/<!--[\s\S]*?-->/g, '').trim()
        return source === '' ? [] : [<Markdown key={key} text={source} dimColor={color === 'inactive'} />]
      }
      let isCode = false
      const lines: { line: string; isCode: boolean }[] = []
      for (const line of text.split('\n')) {
        if (/^\s*(?:```|~~~)/.test(line)) isCode = !isCode
        else lines.push({ line, isCode })
      }
      return lines
        .filter((one, index, all) => one.line.trim() !== '' || (index > 0 && all[index - 1]?.line.trim() !== ''))
        .map((one, index) => {
          const heading = one.isCode ? null : /^#{1,6}\s+(.*)$/.exec(one.line)
          return (
            <Text key={`${key}-${index}`} color={one.isCode ? 'inactive' : color} bold={heading !== null} wrap="wrap">
              {(one.isCode ? one.line.trimEnd() : plain(heading?.[1] ?? one.line)) || ' '}
            </Text>
          )
        })
    }
    const washed = (key: string, tone: string | undefined, child: JSX.Element) => {
      const wash = isDesktop && tone !== undefined ? WASH[tone] : undefined
      return wash === undefined ? child : <Box key={`${key}-wash`} flexDirection="column" backgroundColor={wash} {...BLEED}>{child}</Box>
    }
    const group = (key: string, title: string, count: string, rows: JSX.Element[], tone?: string, byDefault = true) => isDesktop ? (
      <Box key={`group-${key}`} flexDirection="column" marginTop="sm" gap="xs" backgroundColor={SURFACE} {...BLOCK}>
        <Button key={`toggle-${key}`} plain onPress={toggle(key)}>
          <Text size="footnote" dimColor>{isOpen(key, byDefault) ? '▾ ' : '▸ '}</Text>
          <Text size="footnote" weight="semibold" color="inactive">{`${title}  `}</Text>
          <Text size="footnote" color={tone} dimColor={tone === undefined} tabular>{count}</Text>
        </Button>
        {isOpen(key, byDefault) && rows.length > 0 && <Box flexDirection="column" gap="xs">{rows}</Box>}
      </Box>
    ) : (
      <Box key={`group-${key}`} flexDirection="column" marginTop={1}>
        <Box height={1}>
          <Text>{INDENT}</Text>
          <Button key={`toggle-${key}`} plain dimColor onPress={toggle(key)}>
            {isOpen(key, byDefault) ? '▾ ' : '▸ '}
          </Button>
          <Text wrap="truncate-end">
            <Text bold>{title}</Text>
            <Text>{'  '}</Text>
            <Text color={tone ?? 'inactive'}>{count}</Text>
            <Text dimColor>{` ${rule(columns - ROW - title.length - count.length - 3)}`}</Text>
          </Text>
        </Box>
        {isOpen(key, byDefault) && rows}
      </Box>
    )
    const mark = (object: KObject) =>
      object.level === null ? [] : [<Text key="observed" color="warning">{` ◐ ${object.level}`}</Text>]
    // One object as a row: its id and title, pressed to open it; an id outside the base is shown, not pressable.
    const idRow = (key: string, id: string, indent = ROW) => {
      const object = byId.get(id)
      if (isDesktop) {
        const nested = indent > ROW ? 'md' : 0
        if (object === undefined)
          return (
            <Box key={key} paddingLeft={nested}>
              <Text size="footnote" dimColor wrap="truncate-end"><Text mono>{id}</Text> not in the base</Text>
            </Box>
          )
        return (
          <Box key={key} paddingLeft={nested}>
            <Button key={`open-${key}`} plain onPress={go({ kind: 'object', id })}>
              <Text size="footnote" mono dimColor>{`${object.id}  `}</Text>
              <Text>{object.title}</Text>
              {object.level === null ? [] : [<Text key="observed" size="footnote" color="warning">{`  ◐ observed ${object.level}`}</Text>]}
            </Button>
          </Box>
        )
      }
      if (object === undefined)
        return (
          <Box key={key} height={1}>
            <Text color="inactive" wrap="truncate-end">{`${' '.repeat(indent)}${id} — not in the base`}</Text>
          </Box>
        )
      return (
        <Box key={key} height={1}>
          <Text>{' '.repeat(indent)}</Text>
          <Button key={`open-${key}`} plain onPress={go({ kind: 'object', id })}>
            <Text color="inactive">{object.id} </Text>
            <Text wrap="truncate-end">{fit(object.title, columns - indent - object.id.length - (object.level === null ? 1 : 10))}</Text>
            {mark(object)}
          </Button>
        </Box>
      )
    }
    const historyRow = (key: string, row: HistoryRow, id?: string, isContextShown = id === undefined) => {
      const shown = id === undefined ? row.delta : row.delta.filter(token => deltaId(token) === id)
      if (isDesktop)
        return (
          <Box key={key} flexDirection="row" gap="sm">
            <Text size="footnote" tabular dimColor>{row.date}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text size="footnote" wrap="wrap">
                {row.feature}
                {isContextShown && <Text dimColor>{` · ${row.context}`}</Text>}
                <Text mono dimColor>{`  ${shown.join(' ') || '—'}`}</Text>
              </Text>
            </Box>
          </Box>
        )
      return (
        <Text key={key} wrap="truncate-end">
          <Text>{' '.repeat(ROW)}</Text>
          <Text color="inactive">{`${row.date}  `}</Text>
          <Text>{row.feature}</Text>
          {isContextShown && <Text color="inactive">{` · ${row.context}`}</Text>}
          <Text color="inactive">{`  ${shown.join(' ') || '—'}`}</Text>
        </Text>
      )
    }

    const blank = (text: string, tone = 'inactive') => isDesktop ? (
      <Box key="blank" marginTop="md">
        <Text color={tone === 'inactive' ? undefined : tone} dimColor={tone === 'inactive'} wrap="wrap">{text}</Text>
      </Box>
    ) : (
      <Box key="blank" marginTop={1}>
        <Text color={tone} wrap="wrap">
          {INDENT}
          {text}
        </Text>
      </Box>
    )

    // On the terminal an alert's tone goes to its glyph, the box around the alerts says they wait on the user.
    const alertLine = (key: string, press: string, glyph: string, tone: string, name: string, text: string, trail: string, onPress: () => void, gap = '  ') => (
      <Box key={key} height={1}>
        <Button key={press} plain onPress={onPress}>
          <Text wrap="truncate-end">
            <Text color={tone}>{`${glyph} `}</Text>
            {name !== '' && <Text bold>{name}</Text>}
            <Text>{name === '' ? text : ` ${text}`}</Text>
            <Text color="inactive">{`${gap}${trail}`}</Text>
          </Text>
        </Button>
      </Box>
    )

    // --- home ---------------------------------------------------------------------------
    const homeView = () => {
      const followed = spec.isArmed
        ? [
            <Box key="alert-spec" height={1}>
              {!isDesktop && <Text>{INDENT}</Text>}
              <Button key="open-spec" plain onPress={go({ kind: 'spec' })}>
                <Text color="claude" bold>{`✎ ${spec.doc?.title || spec.topic || SPEC_TITLE}`}</Text>
                <Text color="inactive">{spec.doc === null ? '  /business-spec, SPEC not written yet' : '  /business-spec'}</Text>
              </Button>
            </Box>,
          ]
        : []
      if (!kb.isPresent)
        return [
          blank(`No knowledge base under ${kb.root} — /cctoolkit:knowledge-sync builds it. /knowledge-pane demo shows the kit example.`),
          ...(followed.length > 0 ? [<Box key="alerts" flexDirection="column" marginTop={1}>{followed}</Box>] : []),
        ]
      const alerts: JSX.Element[] = isDesktop ? [...followed] : []
      if (kb.index === 'missing')
        alerts.push(
          isDesktop
            ? <Text key="alert-index" color="error" wrap="wrap">{`✗ No index yet (${kb.root}/${INDEX_JSONL}) — run ${INDEX_COMMAND}`}</Text>
            : <Text key="alert-index" wrap="wrap"><Text color="error">✗ </Text>{`No index yet (${kb.root}/${INDEX_JSONL})`}<Text color="inactive">{` — run ${INDEX_COMMAND}`}</Text></Text>,
        )
      if (kb.index === 'stale') {
        const slot = 'stale'
        alerts.push(
          !isDesktop ? alertLine('alert-index', 'open-stale', '▲', 'warning', '', `Index behind ${counted(kb.staleFiles.length, 'file')}`, `run ${INDEX_COMMAND}`, unfold(slot), ' — ') :
          <Box key="alert-index" height={1}>
            <Button key="open-stale" plain onPress={unfold(slot)}>
              <Text color="warning">{`▲ Index behind ${counted(kb.staleFiles.length, 'file')} — run ${INDEX_COMMAND}`}</Text>
            </Button>
          </Box>,
          ...(where.expanded.includes(slot)
            ? kb.staleFiles.map((rel, index) => (
                isDesktop ? <Text key={`stale-${index}`} color="inactive" wrap="truncate-start">{`    ${rel}`}</Text> : tail(`stale-${index}`, 2, rel)
              ))
            : []),
        )
      }
      for (const merge of kb.merges) {
        const changes = ['new', 'modified', 'retired'].map(change => merge.objects.filter(one => one.change === change).length)
        alerts.push(
          !isDesktop ? alertLine(`alert-merge-${merge.code}`, `open-merge-${merge.code}`, '◆', 'warning', `${merge.code}${merge.isPartial ? ' partial' : ''}`, `— merge ${merge.isStaged ? 'staged' : 'prepared'}, not written`, `+${changes[0]} ~${changes[1]} −${changes[2]}`, go({ kind: 'merge', code: merge.code })) :
          <Box key={`alert-merge-${merge.code}`} height={1}>
            <Button key={`open-merge-${merge.code}`} plain onPress={go({ kind: 'merge', code: merge.code })}>
              <Text color="warning" bold>{`◆ ${merge.code}${merge.isPartial ? ' partial' : ''} — merge ${merge.isStaged ? 'staged' : 'prepared'}, not written`}</Text>
              <Text color="inactive">{`  +${changes[0]} ~${changes[1]} −${changes[2]}`}</Text>
            </Button>
          </Box>,
        )
      }
      for (const sync of kb.syncs) {
        const slot = `sync:${sync.context}`
        alerts.push(
          !isDesktop ? alertLine(`alert-sync-${sync.context}`, `open-sync-${sync.context}`, '◆', 'warning', sync.context, '— sync staged, not written', counted(sync.files.length, 'file'), unfold(slot)) :
          <Box key={`alert-sync-${sync.context}`} height={1}>
            <Button key={`open-sync-${sync.context}`} plain onPress={unfold(slot)}>
              <Text color="warning" bold>{`◆ ${sync.context} — sync staged, not written`}</Text>
              <Text color="inactive">{`  ${counted(sync.files.length, 'file')}`}</Text>
            </Button>
          </Box>,
          ...(where.expanded.includes(slot)
            ? [
                ...sync.files.map((rel, index) => (isDesktop ? <Text key={`sync-${sync.context}-${index}`} color="inactive" wrap="truncate-start">{`    ${rel}`}</Text> : tail(`sync-${sync.context}-${index}`, 2, rel))),
                <Text key={`sync-${sync.context}-next`} color="inactive" wrap="wrap">{isDesktop ? '    → /cctoolkit:knowledge-sync to review and write it' : '  → /cctoolkit:knowledge-sync to review and write it'}</Text>,
              ]
            : []),
        )
      }
      const contextRows = isDesktop ? kb.contexts.map(context => (
        <Box key={`row-context-${context.name}`} flexDirection="column">
          <Button key={`open-context-${context.name}`} plain onPress={go({ kind: 'context', name: context.name })}>
            <Text weight="semibold">{context.name}</Text>
            <Text size="footnote" mono dimColor>{context.prefix === '' ? '' : `  ${context.prefix}`}</Text>
            <Text size="footnote" tabular dimColor>{`  ${context.usecases} CU · ${context.rules} RM · ${context.decisions} D`}</Text>
          </Button>
          {context.summary !== '' && <Text size="footnote" dimColor wrap="wrap">{plain(context.summary)}</Text>}
        </Box>
      )) : kb.contexts.flatMap(context => [
        <Box key={`row-context-${context.name}`} height={1}>
          <Text>{' '.repeat(ROW)}</Text>
          <Button key={`open-context-${context.name}`} plain onPress={go({ kind: 'context', name: context.name })}>
            <Text bold>{context.name}</Text>
            <Text color="inactive">{`${context.prefix === '' ? '' : `  ${context.prefix}`} · ${context.usecases} CU · ${context.rules} RM · ${context.decisions} D`}</Text>
          </Button>
        </Box>,
        ...(context.summary === ''
          ? []
          : [
              <Box key={`summary-${context.name}`} marginLeft={ROW + 2} height={1}>
                <Text color="inactive" wrap="truncate-end">
                  {fit(plain(context.summary), columns - ROW - 2)}
                </Text>
              </Box>,
            ]),
      ])
      const adrs = kb.objects.filter(one => one.kind === 'ADR').sort((a, b) => a.id.localeCompare(b.id))
      const observed = LEVELS.map(level => ({ level, items: kb.objects.filter(one => one.level === level) }))
      const observedCount = observed.reduce((sum, one) => sum + one.items.length, 0)
      return [
        ...(alerts.length > 0
          ? [isDesktop
              ? <Box key="alerts" flexDirection="column" gap="xs" marginTop="sm" backgroundColor={WARNING_WASH} {...BLOCK}>{alerts}</Box>
              : <Box key="alerts" flexDirection="column" marginTop={1} marginLeft={INDENT.length} borderStyle="round" borderColor={kb.index === 'missing' ? 'error' : 'warning'} paddingX={1}>{alerts}</Box>]
          : []),
        ...(!isDesktop && followed.length > 0 ? [<Box key="followed" flexDirection="column" marginTop={1}>{followed}</Box>] : []),
        group('contexts', 'Contexts', `${kb.contexts.length}`, contextRows),
        group('adrs', 'ADRs', `${kb.adrCount ?? adrs.length}`, adrs.map(one => idRow(`adr-${one.id}`, one.id)), undefined, adrs.length <= 8),
        group(
          'observed',
          'Observed',
          observedCount === 0 ? 'none' : observed.filter(one => one.items.length > 0).map(one => `${one.items.length} ${one.level}`).join(' · '),
          observed.flatMap(one => one.items.map(object => idRow(`observed-${object.id}`, object.id))),
          observedCount > 0 ? 'warning' : 'success',
          false,
        ),
        isDesktop ? (
          <Box key="recent" flexDirection="column" marginTop="sm" gap="xs" backgroundColor={SURFACE} {...BLOCK}>
            <Text size="footnote" weight="semibold" color="inactive">Recent</Text>
            <Box flexDirection="column" gap="xs">
              {kb.history.length === 0 ? <Text size="footnote" dimColor>none</Text> : kb.history.slice(0, HISTORY_SHOWN).map((row, index) => historyRow(`recent-${index}`, row))}
            </Box>
          </Box>
        ) : (
          group('recent', 'Recent', kb.history.length === 0 ? 'none' : `${Math.min(HISTORY_SHOWN, kb.history.length)}`, kb.history.slice(0, HISTORY_SHOWN).map((row, index) => historyRow(`recent-${index}`, row)))
        ),
      ]
    }

    // --- context ------------------------------------------------------------------------
    const contextView = (name: string) => {
      const parts = contextParts(kb.objects, name)
      const overview = parseOverview(kb.overviews[name] ?? '')
      const gauge = Svg === undefined ? '' : matrixSvg(kb.objects, name)
      const overviewRows = [
        ...(overview.role === '' ? [] : [<Box key="role" marginLeft={isDesktop ? 0 : ROW} flexDirection="column">{paragraph('role', overview.role)}</Box>]),
        ...overview.parts.flatMap(part => {
          const slot = `overview:${part.title}`
          const isUnfolded = where.expanded.includes(slot)
          if (isDesktop)
            return [
              <Button key={`open-${slot}`} plain onPress={unfold(slot)}>
                <Text dimColor>{isUnfolded ? '▾ ' : '▸ '}</Text>
                <Text>{part.title}</Text>
              </Button>,
              ...(isUnfolded ? [<Box key={`body-${slot}`} flexDirection="column" paddingLeft="md" marginBottom="sm">{paragraph(slot, part.body)}</Box>] : []),
            ]
          return [
            <Box key={`row-${slot}`} height={1}>
              <Text>{' '.repeat(ROW)}</Text>
              <Text color="inactive">{isUnfolded ? '▾ ' : '▸ '}</Text>
              <Button key={`open-${slot}`} plain onPress={unfold(slot)}>
                <Text>{part.title}</Text>
              </Button>
            </Box>,
            ...(isUnfolded ? [<Box key={`body-${slot}`} flexDirection="column" marginLeft={ROW + 2} marginBottom={1}>{paragraph(slot, part.body)}</Box>] : []),
          ]
        }),
      ]
      const caseRows = parts.usecases.flatMap(({ cu, rules }) => [idRow(`cu-${cu.id}`, cu.id), ...rules.map(rule => idRow(`own-${rule.id}`, rule.id, ROW + 2))])
      const rows = kb.history.filter(row => row.context === name)
      return [
        ...(Svg !== undefined && gauge !== ''
          ? [
              <Box key="matrix" marginTop={1}>
                <Svg key="matrix-svg" source={gauge} alt={matrixAlt(kb.objects, name)} width={svgWidth(gauge)} height={svgHeight(gauge)} isInteractive />
              </Box>,
            ]
          : []),
        group('overview', 'Overview', kb.overviews[name] === undefined ? 'missing' : `${overview.parts.length} sections`, overviewRows),
        group('usecases', 'Use cases', `${parts.usecases.length}`, caseRows),
        group('shared', 'Cross-cutting rules', `${parts.shared.length}`, parts.shared.map(one => idRow(`shared-${one.id}`, one.id))),
        group('decisions', 'Decisions', `${parts.decisions.length}`, parts.decisions.map(one => idRow(`decision-${one.id}`, one.id))),
        group('context-adrs', 'ADRs', `${parts.adrs.length}`, parts.adrs.map(one => idRow(`adr-${one.id}`, one.id))),
        group(
          'history',
          'History',
          rows.length > HISTORY_SHOWN ? `last ${HISTORY_SHOWN} of ${rows.length}` : `${rows.length}`,
          rows.slice(0, HISTORY_SHOWN).map((row, index) => historyRow(`history-${index}`, row, undefined, false)),
        ),
      ]
    }

    // --- object -------------------------------------------------------------------------
    const objectView = (id: string) => {
      const object = byId.get(id)
      const rows = historyOf(kb.history, id)
      if (object === undefined) {
        const retired = rows.find(row => row.delta.includes(`-${id}`))
        return [
          blank(retired === undefined ? `${id}: not in the base` : `${id}: retired — ${retired.date} ${retired.feature} (${retired.context})`),
          ...(rows.length > 0 ? [group('object-history', 'History', `${rows.length}`, rows.map((row, index) => historyRow(`object-history-${index}`, row, id)))] : []),
        ]
      }
      const ids = (list: string[], key: string) => list.filter(one => one !== id).map(one => idRow(`${key}-${one}`, one))
      const appliesTo = object.kind === 'RM' ? object.usecases : []
      const ownRules = object.kind === 'CU' ? kb.objects.filter(one => isOwnRule(one, object)).sort((a, b) => a.id.localeCompare(b.id)) : []
      const facts = isDesktop ? (
        <Box key="facts" flexDirection="column" gap="xs" marginTop="sm">
          <Box flexDirection="row" flexWrap="wrap" columnGap="sm" alignItems="center">
            <Text size="footnote" weight="medium">{KIND_NAMES[object.kind]}</Text>
            <Text size="footnote" dimColor>{object.context || object.contexts.join(', ')}</Text>
            <Text size="footnote" weight="medium" color={object.level === null ? 'success' : 'warning'}>
              {object.level === null ? '● specified' : `◐ observed ${object.level} — not validated yet`}
            </Text>
          </Box>
          <Text size="footnote" mono dimColor wrap="truncate-start">{`${object.path}:${object.line}`}</Text>
        </Box>
      ) : null
      return [
        facts ?? <Box key="facts" flexDirection="column" marginTop={1}>
          <Text wrap="truncate-end">
            {INDENT}
            <Text color={object.level === null ? 'success' : 'warning'}>{object.level === null ? '✓ ' : '◐ '}</Text>
            {object.level === null ? <Text>specified</Text> : <Text color="warning">{`observed ${object.level}`}</Text>}
            {object.level !== null && <Text color="inactive"> — not validated yet</Text>}
            <Text color="inactive">{`  ${KIND_NAMES[object.kind]} · ${object.context || object.contexts.join(', ')}`}</Text>
          </Text>
          {tail('place', INDENT.length, `${object.path}:${object.line}`)}
        </Box>,
        <Box key="text" flexDirection="column" {...(isDesktop ? { marginTop: 'sm' as const, backgroundColor: SURFACE, ...BLOCK } : { marginTop: 1, marginLeft: 2 })}>
          {paragraph('text', texts[id] ?? object.text)}
        </Box>,
        ...(ownRules.length > 0 ? [group('own-rules', 'Rules', `${ownRules.length}`, ownRules.map(rule => idRow(`rule-${rule.id}`, rule.id)))] : []),
        ...(appliesTo.length > 0 ? [group('applies', 'Applies to', `${appliesTo.length}`, ids(appliesTo, 'applies'))] : []),
        ...(object.handlers.length > 0
          ? [
              group(
                'handlers',
                'Handlers',
                `${object.handlers.length}`,
                object.handlers.map(handler => (
                  <Text key={`handler-${handler}`} wrap="truncate-end">{`${isDesktop ? '  ' : ' '.repeat(ROW)}${handler}`}</Text>
                )),
              ),
            ]
          : []),
        ...(object.cites.length > 0 ? [group('cites', 'Cites', `${object.cites.length}`, ids(object.cites, 'cites'))] : []),
        ...(object.citedBy.length > 0 ? [group('cited-by', 'Cited by', `${object.citedBy.length}`, ids(object.citedBy, 'cited'))] : []),
        group('object-history', 'History', rows.length === 0 ? 'none' : `${rows.length}`, rows.map((row, index) => historyRow(`object-history-${index}`, row, id))),
      ]
    }

    // --- merge --------------------------------------------------------------------------
    const markOf = (change: string) => (change === 'new' ? '+' : change === 'retired' ? '−' : '~')
    const mergeView = (code: string) => {
      const merge = kb.merges.find(one => one.code === code)
      if (merge === undefined) return [blank(`${code}: no merge staged any more`)]
      const contexts = [...new Set(merge.objects.map(one => one.context))].sort()
      return [
        isDesktop ? (
          <Box key="merge-state" flexDirection="column" marginTop={1}>
            <Text color="warning" wrap="wrap">
              {merge.isStaged ? '  Staged: the whole files are ready, nothing is written to the base yet.' : '  Prepared: drafts in progress, not staged yet.'}
            </Text>
            <Text color="inactive" wrap="wrap">{'  → /cctoolkit:knowledge-merge to review and write it'}</Text>
          </Box>
        ) : (
          <Box key="merge-state" flexDirection="column" marginTop={1} marginLeft={INDENT.length} borderStyle="round" borderColor="warning" paddingX={1}>
            <Text wrap="wrap">
              <Text color="warning">◆ </Text>
              {merge.isStaged ? 'Staged: the whole files are ready, nothing is written to the base yet.' : 'Prepared: drafts in progress, not staged yet.'}
            </Text>
            <Text color="inactive" wrap="wrap">{'→ /cctoolkit:knowledge-merge to review and write it'}</Text>
          </Box>
        ),
        ...contexts.map(context =>
          group(
            `merge-${context}`,
            context,
            `${merge.objects.filter(one => one.context === context).length}`,
            merge.objects
              .filter(one => one.context === context)
              .map(one => (
                <Box key={`change-${one.id}`} height={1}>
                  <Text color={one.change === 'new' ? 'success' : one.change === 'retired' ? 'error' : 'warning'}>{`${isDesktop ? '  ' : ' '.repeat(ROW)}${markOf(one.change)} `}</Text>
                  <Button key={`open-change-${one.id}`} plain onPress={go({ kind: 'change', code, id: one.id })}>
                    <Text color="inactive">{one.id} </Text>
                    <Text wrap="truncate-end">{fit(one.title, columns - one.id.length - (isDesktop ? 6 : ROW + 4) - (merge.after[one.id] === undefined && one.change !== 'retired' ? 11 : 0))}</Text>
                    {merge.after[one.id] === undefined && one.change !== 'retired' ? <Text color="inactive"> · no draft</Text> : <Text> </Text>}
                  </Button>
                </Box>
              )),
          ),
        ),
      ]
    }
    const changeView = (code: string, id: string) => {
      const merge = kb.merges.find(one => one.code === code)
      const change = merge?.objects.find(one => one.id === id)
      if (merge === undefined || change === undefined) return [blank(`${id}: not in the merge of ${code}`)]
      const before = byId.has(id) ? (texts[id] ?? byId.get(id)?.text ?? '') : null
      const after = merge.after[id]
      return [
        <Box key="change-kind" marginTop={1}>
          {isDesktop
            ? <Text color={change.change === 'new' ? 'success' : change.change === 'retired' ? 'error' : 'warning'}>{`  ${markOf(change.change)} ${change.change} · ${change.context}`}</Text>
            : (
              <Text>
                {INDENT}
                <Text color={change.change === 'new' ? 'success' : change.change === 'retired' ? 'error' : 'warning'}>{`${markOf(change.change)} `}</Text>
                {change.change}
                <Text color="inactive">{` · ${change.context}`}</Text>
              </Text>
            )}
        </Box>,
        <Box key="before" flexDirection="column" marginTop={1} {...(isDesktop ? {} : { marginLeft: INDENT.length })}>
          <Text bold>Base now</Text>
          <Box flexDirection="column" marginLeft={2}>
            {before === null ? <Text color="inactive">not in the base</Text> : paragraph('before', before, 'inactive')}
          </Box>
        </Box>,
        <Box key="after" flexDirection="column" marginTop={1} {...(isDesktop ? {} : { marginLeft: INDENT.length })}>
          <Text bold>{merge.isStaged ? 'Staged' : 'Draft'}</Text>
          <Box flexDirection="column" marginLeft={2}>
            {change.change === 'retired' ? <Text color="error">retired: cut from the base</Text> : after === undefined ? <Text color="inactive">no draft yet</Text> : paragraph('after', after)}
          </Box>
        </Box>,
        ...(byId.has(id) ? [<Box key="open-object-row" marginTop={1} height={1}>{idRow('change-object', id, isDesktop ? 0 : INDENT.length)}</Box>] : []),
      ]
    }

    // --- search -------------------------------------------------------------------------
    const searchView = () => {
      const found = search(kb.objects, where.query)
      return [
        <Box key="query-row" marginTop={1}>
          {!isDesktop && Input !== undefined && <Text>{INDENT}</Text>}
          {Input === undefined ? (
            <Text color="inactive">{`  query: ${where.query || '—'} (/knowledge-pane <words> sets it)`}</Text>
          ) : (
            <Input
              key="query"
              label="Search"
              placeholder="id, title or handler"
              value={where.seed}
              submitLabel="open"
              autoFocus
              onInput={(value: string) => void update($, nav, current => ({ ...HOME, ...current, query: value }))}
              onSubmit={(value: string) => {
                const first = search(kb.objects, value)[0]
                if (first !== undefined) void push($, { kind: 'object', id: first.id })
              }}
            />
          )}
        </Box>,
        <Box key="results" flexDirection="column" marginTop={1}>
          {where.query.trim() === '' ? (
            <Text color="inactive">  type an id (CAT-RM-004, RM-004), words of a title or a handler name</Text>
          ) : found.length === 0 ? (
            <Text color="inactive">  nothing found</Text>
          ) : (
            [
              ...found.slice(0, RESULTS_SHOWN).map(one => idRow(`found-${one.id}`, one.id, isDesktop ? ROW : INDENT.length)),
              <Text key="found-count" color="inactive">{`  ${found.length > RESULTS_SHOWN ? `${RESULTS_SHOWN} of ` : ''}${counted(found.length, 'object')}`}</Text>,
            ]
          )}
        </Box>,
      ]
    }

    // --- spec ---------------------------------------------------------------------------
    const specView = () => {
      const doc = spec.doc
      if (!spec.isArmed && doc === null) return []
      const slot = (kind: SpecKind, id: string) => `${kind}:${id}`
      const isUnfolded = (kind: SpecKind, id: string) => where.expanded.includes(slot(kind, id))
      // A pane's text cannot be selected on every surface, a row being a Button: an unfolded
      // question carries its own copy, its whole text on the clipboard of the surface pressed.
      const copyOf = (key: string, text: string) => {
        const onPress = async (press: { surface: RenderSurface }) => {
          const copied = await $.ui.copy({ text, surface: press.surface })
          $.ui.toast(copied.isCopied ? 'Copied' : `Not copied: ${copied.reason}`)
        }
        return isDesktop ? (
          <Box key={`${key}-copy`}>
            <Button key={`copy-${key}`} label="Copy" onPress={onPress} />
          </Box>
        ) : (
          <Box key={`${key}-copy`} marginTop={1}>
            <Button key={`copy-${key}`} plain dimColor onPress={onPress}>
              copy
            </Button>
          </Box>
        )
      }
      const detail = (kind: SpecKind, id: string): JSX.Element[] | null => {
        if (kind === 'decision') {
          const decision = asked.find(one => one.id === id)
          if (decision === undefined) return null
          const copied = [
            decision.question,
            ...decision.options.map(option => `- ${option}${option === decision.recommended ? ' (recommended)' : ''}`),
            ...(decision.answer === null ? [] : [`Answer: ${decision.answer}`]),
            ...(decision.note === null ? [] : [`Note: ${decision.note}`]),
          ].join('\n')
          return [
            <Text key="d-question" bold wrap="wrap">
              {decision.question}
            </Text>,
            ...decision.options.map((option, index) => {
              const isChosen = decision.answer?.split(', ').includes(option) ?? false
              return (
                <Text key={`d-option-${index}`} wrap="wrap" color={isChosen ? 'success' : 'inactive'}>
                  {isChosen ? '  ✓ ' : '    '}
                  {option}
                  {option === decision.recommended ? ' ★' : ''}
                </Text>
              )
            }),
            <Box key="d-answer" marginTop={1}>
              <Text wrap="wrap" color={decision.isPending ? 'claude' : isUnanswered(decision) ? 'inactive' : isOffRecommendation(decision) ? 'warning' : undefined}>
                {decision.isPending ? 'Waiting for the answer…' : decision.answer === null ? 'No answer' : `Answer: ${decision.answer}`}
              </Text>
            </Box>,
            ...(decision.note === null ? [] : [<Text key="d-note" color="inactive" wrap="wrap">{`Note: ${decision.note}`}</Text>]),
            copyOf(`decision-${id}`, copied),
          ]
        }
        if (doc === null) return null
        if (kind === 'openQuestion') {
          const question = doc.openQuestions.find(one => one.id === id)
          if (question === undefined) return null
          return [
            <Text key="q-severity" color={severityTone(question.severity)}>
              {question.severity}
            </Text>,
            <Box key="q-impact-title" marginTop={1}>
              <Text bold>Impact</Text>
            </Box>,
            ...paragraph('q-impact', question.impact),
            <Box key="q-options-title" marginTop={1}>
              <Text bold>Options</Text>
            </Box>,
            ...paragraph('q-options', question.options),
            copyOf(
              `openQuestion-${id}`,
              [
                `${question.id} — ${plain(question.question)}`,
                ...(question.severity === '' ? [] : [`Severity: ${plain(question.severity)}`]),
                ...(question.impact === '' ? [] : [`Impact: ${plain(question.impact)}`]),
                ...(question.options === '' ? [] : [`Options: ${plain(question.options)}`]),
              ].join('\n'),
            ),
          ]
        }
        if (kind === 'section') {
          const section = doc.sections.find((one, index) => sectionKey(one, index) === id)
          return section === undefined ? null : paragraph('s', section.body)
        }
        const item = (kind === 'useCase' ? doc.useCases : doc.rules).find(one => one.id === id)
        return item === undefined ? null : paragraph('i', item.body)
      }
      const unfolded = (kind: SpecKind, id: string): JSX.Element[] => {
        const body = isUnfolded(kind, id) ? detail(kind, id) : null
        return body === null
          ? []
          : [
              <Box key={`detail-${kind}-${id}`} flexDirection="column" {...(isDesktop ? { paddingLeft: 'md' as const, marginBottom: 'sm' as const, gap: 'xs' as const } : { marginLeft: ROW + 2, marginBottom: 1 })}>
                {body}
              </Box>,
            ]
      }
      const entry = (kind: SpecKind, id: string, children: JSX.Element[], tone?: string) => isDesktop ? [
        washed(`${kind}-${id}`, tone, <Button key={`open-${kind}-${id}`} plain onPress={unfold(slot(kind, id))}>
          {children}
        </Button>),
        ...unfolded(kind, id),
      ] : [
        <Box key={`row-${kind}-${id}`} height={1}>
          <Text color="inactive">{`${INDENT}${isUnfolded(kind, id) ? '▾ ' : '  '}`}</Text>
          <Button key={`open-${kind}-${id}`} plain onPress={unfold(slot(kind, id))}>
            {children}
          </Button>
        </Box>,
        ...unfolded(kind, id),
      ]

      const pending = asked.filter(one => one.isPending).length
      const decisionRows = asked.flatMap(decision =>
        entry('decision', decision.id, [
          <Text key="mark" color={decision.isPending ? 'claude' : isUnanswered(decision) ? 'inactive' : isOffRecommendation(decision) ? 'warning' : 'success'}>
            {decision.isPending ? '? ' : isUnanswered(decision) ? '– ' : isOffRecommendation(decision) ? '≠ ' : '✓ '}
          </Text>,
          <Text key="text" wrap="truncate-end">
            {fit(`${decision.header !== '' ? `${decision.header} · ` : ''}${decision.isPending ? decision.question : (decision.answer ?? 'no answer')}`, columns - (isDesktop ? 4 : ROW + 2))}
          </Text>,
        ], decision.isPending ? 'claude' : undefined),
      )
      const openQuestions = doc?.openQuestions ?? []
      const blocking = blockingCount(openQuestions)
      const questionRows = openQuestions.flatMap(question => [
        washed(`openQuestion-${question.id}`, severityTone(question.severity) === 'error' ? 'error' : undefined, <Box key={`row-openQuestion-${question.id}`}>
          {(!isDesktop || isUnfolded('openQuestion', question.id)) && <Text color="inactive">{`${isDesktop ? '' : INDENT}${isUnfolded('openQuestion', question.id) ? '▾ ' : '  '}`}</Text>}
          <Button key={`open-openQuestion-${question.id}`} plain onPress={unfold(slot('openQuestion', question.id))}>
            {isDesktop ? (
              <Text color={severityTone(question.severity)}>● {question.id}</Text>
            ) : (
              <Text>
                <Text color={severityTone(question.severity)}>● </Text>
                <Text color="inactive">{question.id}</Text>
              </Text>
            )}
          </Button>
          <Text> </Text>
          <Box flexShrink={1} flexGrow={1}>
            <Text key={`question-${question.id}`} wrap="wrap">
              {plain(question.question)}
            </Text>
          </Box>
        </Box>),
        ...unfolded('openQuestion', question.id),
      ])
      const itemRows = (kind: SpecKind, items: SpecItem[]) =>
        items.flatMap(item =>
          entry(kind, item.id, [
            <Text key="id" color="inactive">
              {item.id}{' '}
            </Text>,
            <Text key="name" wrap="truncate-end">
              {fit(item.name, columns - (isDesktop ? 3 : ROW + 1) - item.id.length)}
            </Text>,
          ]),
        )
      const counts = Svg === undefined || doc === null ? {} : sectionCounts(doc)
      const questionsAt = doc === null ? undefined : questionsSection(doc.sections)
      const countTone = questionsTone(openQuestions)
      const sectionRows = (doc?.sections ?? []).flatMap((section, index) => {
        const count = counts[sectionKey(section, index)] ?? 0
        return entry('section', sectionKey(section, index), [
          <Text key="text" wrap="truncate-end">
            {fit(sectionLabel(section), columns - (isDesktop ? 2 : ROW) - (count > 0 ? String(count).length + 2 : 0))}
          </Text>,
          ...(count > 0 ? [<Text key="count" color={section === questionsAt ? countTone : 'inactive'}>{`  ${count}`}</Text>] : []),
        ])
      })
      const gauge = Svg === undefined ? '' : specGauge(asked, doc)

      return [
        ...(Svg !== undefined && gauge !== ''
          ? [
              <Box key="gauge" marginTop={1}>
                <Svg key="gauge-svg" source={gauge} alt={specGaugeAlt(asked, doc)} width={svgWidth(gauge)} height={svgHeight(gauge)} isInteractive />
              </Box>,
            ]
          : []),
        ...(doc !== null && doc.summary !== ''
          ? [
              <Box key="summary" marginTop={1} {...(isDesktop ? {} : { marginLeft: INDENT.length })}>
                <Text color="inactive" wrap="wrap">
                  {plain(doc.summary)}
                </Text>
              </Box>,
            ]
          : []),
        ...(asked.length > 0
          ? [group('spec-decisions', 'Decisions', `${asked.length}${pending > 0 ? ` · ${pending} pending` : ''}`, decisionRows, pending > 0 ? 'claude' : undefined)]
          : []),
        ...(doc === null
          ? []
          : [
              group(
                'spec-questions',
                'Open questions',
                openQuestions.length === 0 ? 'none' : `${openQuestions.length}${blocking > 0 ? ` · ${blocking} blocking` : ''}`,
                questionRows,
                blocking > 0 ? 'error' : openQuestions.length > 0 ? 'warning' : 'success',
              ),
              ...(doc.useCases.length > 0 ? [group('spec-usecases', 'Use cases', `${doc.useCases.length}`, itemRows('useCase', doc.useCases))] : []),
              ...(doc.rules.length > 0 ? [group('spec-rules', 'Business rules', `${doc.rules.length}`, itemRows('rule', doc.rules))] : []),
              ...(doc.sections.length > 0 ? [group('spec-sections', 'Sections', `${doc.sections.length}`, sectionRows)] : []),
            ]),
      ]
    }

    const titleOf = (): [string, string | undefined] => {
      if (view.kind === 'context') return [view.name, TITLE]
      if (view.kind === 'object') {
        const object = byId.get(view.id)
        return [object === undefined ? view.id : `${object.id} — ${object.title}`, object?.context || TITLE]
      }
      if (view.kind === 'merge') return [`Merge ${view.code}`, TITLE]
      if (view.kind === 'change') return [`${view.id} in ${view.code}`, 'Merge']
      if (view.kind === 'search') return ['Search', TITLE]
      if (view.kind === 'spec') return [spec.doc?.title || spec.topic || SPEC_TITLE, spec.doc?.title ? SPEC_TITLE : undefined]
      return [TITLE, undefined]
    }
    const [title, trail] = titleOf()
    const body =
      view.kind === 'context'
        ? contextView(view.name)
        : view.kind === 'object'
          ? objectView(view.id)
          : view.kind === 'merge'
            ? mergeView(view.code)
            : view.kind === 'change'
              ? changeView(view.code, view.id)
              : view.kind === 'search'
                ? searchView()
                : view.kind === 'spec'
                  ? specView()
                  : homeView()

    return (
      <Box flexDirection="column" marginTop={1} {...(isDesktop ? { paddingX: 'sm' as const, gap: 'xs' as const } : {})}>
        {header(title, trail)}
        {location}
        {(kb.isPresent || where.stack.length > 1) && keys}
        {body}
      </Box>
    )
  })
}
