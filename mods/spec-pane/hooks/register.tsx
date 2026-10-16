import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, Kind, Navigation, OpenQuestion, SpecDoc, SpecItem, SpecSection, Tracked } from '../types'

const PANE = 'spec-pane'
const TITLE = 'Spec'
const SKILL = 'business-spec'
const TICK_MS = 3_000
const SPEC_PATTERN = /(?:^|\/)todo\/[^/]+\/SPEC(?:-[^/]+)?\.md$/
// The open questions: the section whose heading carries the anchor, else, in a spec written before
// the anchors, the title the `/plan-implementation` gate reads (`skills/plan-implementation/SKILL.md`).
const OPEN_QUESTIONS_ANCHOR = 'open-questions'
const OPEN_QUESTIONS_TITLE = /^12\. (?:Open questions|Questions ouvertes)/
// `CU-01`, or a knowledge-base id `CAT-CU-01` as `lib/knowledge.py` (`HEADING`) reads it: the em dash only.
// The delta anchor ending the heading (`<!-- kit:new -->`) is not part of the name.
const ITEM_PATTERN = /^###\s+([A-Z][A-Z0-9]{1,5}-(?:CU|RM)-\d+|(?:CU|RM)-[\w.]+)\s+—\s+(.*?)\s*(?:<!--.*-->)?\s*$/
const isRule = (id: string): boolean => /(?:^|-)RM-/.test(id)
const isUseCase = (id: string): boolean => /(?:^|-)CU-/.test(id)
const SECTION_PATTERN = /^##\s+(?:(\d+)\.\s*)?(.*?)\s*(?:<!--\s*kit:([\w-]+)\s*-->|<!--.*-->)?\s*$/
const SEVERITY_PATTERN = /\*\*(?:s[ée]v[ée]rit[ée]|severity)\*\*\s*:?\s*([^·\n]+)/i
const RECOMMENDED_PATTERN = /\((?:recommand[ée]e?|recommended)\)/i
const EDITING_TOOLS = ['Edit', 'Write', 'MultiEdit']
const BLOCKING = ['bloquant', 'blocking']
const MAJOR = ['majeur', 'major', 'warning']
const GROUPS = ['decisions', 'openQuestions', 'useCases', 'rules', 'sections'] as const

const IDLE: Tracked = { isArmed: false, topic: null, path: null, mtimeMs: 0, doc: null, readAt: null }
const HOME: Navigation = { expanded: [], collapsed: [] }

const tracked = atom({ plugin: 'spec-pane', key: 'tracked' } as const, IDLE)
const decisions = atom({ plugin: 'spec-pane', key: 'decisions' } as const, [] as Decision[])
const nav = atom({ plugin: 'spec-pane', key: 'nav' } as const, HOME)
const now = atom({ plugin: 'spec-pane', key: 'now' } as const, 0)
const isShown = atom({ plugin: 'spec-pane', key: 'isShown' } as const, false)

export const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export const isSpecPath = (path: string): boolean => SPEC_PATTERN.test(path)

export const relativePath = (path: string, root: string | null): string =>
  root !== null && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

export const severityTone = (severity: string | null): 'error' | 'warning' | 'inactive' => {
  const folded = fold(severity ?? '')
  if (BLOCKING.some(word => folded.startsWith(word))) return 'error'
  if (MAJOR.some(word => folded.startsWith(word))) return 'warning'
  return 'inactive'
}

export const plain = (text: string): string => text.replace(/\*\*/g, '').replace(/`/g, '')

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

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())

const isSeparator = (line: string): boolean => /^\|?\s*:?-{3,}/.test(line.trim())

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

// A section without a number (`## Notes`) is keyed by its position, shown by its title alone.
export const sectionKey = (section: SpecSection, index: number): string => section.number || `#${index + 1}`
export const sectionLabel = (section: SpecSection): string => (section.number ? `${section.number}. ${section.title}` : section.title)

export const sectionCounts = (doc: SpecDoc): Record<string, number> => {
  const questions = questionsSection(doc.sections)
  return Object.fromEntries(
    doc.sections.map((section, index) => [
      sectionKey(section, index),
      section === questions ? doc.openQuestions.length : section.body.split('\n').filter(line => ITEM_PATTERN.test(line)).length,
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
    const heading = /^##\s/.test(line) ? SECTION_PATTERN.exec(line) : null
    if (/^##\s/.test(line)) {
      closeSection()
      if (heading !== null) section = { number: heading[1] ?? '', title: (heading[2] ?? '').trim(), anchor: heading[3], lines: [] }
      continue
    }
    if (section === null) continue
    section.lines.push(line)
    const found = ITEM_PATTERN.exec(line)
    if (found !== null) {
      closeItem()
      item = { id: found[1] ?? '', name: (found[2] ?? '').trim(), lines: [] }
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

const SVG_WIDTH = 560
const CELL = 18
const CELL_GAP = 3
const COLUMN_GAP = 24
const LEGEND_CHAR_PX = 6.2
const CELL_INK = '#0b0b0b'
const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' } as const
const SVG_STYLE =
  '<style>text{font:11px system-ui,-apple-system,"Segoe UI",sans-serif}.ink{fill:#52514e}.head{fill:#52514e;font-weight:600}.muted{fill:#52514e;opacity:.7}' +
  '.pending{fill:none;stroke:#52514e;stroke-dasharray:3 2}.none{fill:#c3c2b7}.glyph{font-size:10px;font-weight:600}' +
  '.hit{fill:#52514e;fill-opacity:0}g.mark:hover .hit{fill-opacity:.14}' +
  '@media (prefers-color-scheme: dark){.ink,.head,.muted{fill:#c3c2b7}.pending{stroke:#c3c2b7}.none{fill:#52514e}.hit{fill:#c3c2b7}}</style>'

export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const svgHeight = (source: string): number => Number(/<svg[^>]*\sheight="(\d+)"/.exec(source)?.[1] ?? 0)

export const svgWidth = (source: string): number => Number(/<svg[^>]*\swidth="(\d+)"/.exec(source)?.[1] ?? 0)

const px = (value: number): string => `${Math.round(value * 10) / 10}`

const counted = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

type Paint = string | 'pending' | 'none'

type Cell = { fill: Paint; glyph: string; title: string[] }

type Block = { svg: string; height: number }

const cells = (items: Cell[], left: number, y: number, width: number): Block => {
  const perRow = Math.max(1, Math.floor((width + CELL_GAP) / (CELL + CELL_GAP)))
  const svg = items
    .map((item, index) => {
      const x = left + (index % perRow) * (CELL + CELL_GAP)
      const top = y + Math.floor(index / perRow) * (CELL + CELL_GAP)
      const square =
        item.fill === 'pending'
          ? `<rect class="pending" x="${px(x + 0.5)}" y="${px(top + 0.5)}" width="${CELL - 1}" height="${CELL - 1}" rx="4"/>`
          : item.fill === 'none'
            ? `<rect class="none" x="${x}" y="${top}" width="${CELL}" height="${CELL}" rx="4"/>`
            : `<rect x="${x}" y="${top}" width="${CELL}" height="${CELL}" rx="4" fill="${item.fill}"/>`
      const isInked = item.fill !== 'pending' && item.fill !== 'none'
      const glyph = `<text class="glyph${isInked ? '' : ' ink'}" x="${px(x + CELL / 2)}" y="${px(top + CELL / 2 + 3.5)}" text-anchor="middle"${isInked ? ` fill="${CELL_INK}"` : ''}>${escapeXml(item.glyph)}</text>`
      return `<g class="mark"><title>${item.title.map(escapeXml).join('&#10;')}</title><rect class="hit" x="${x - 1.5}" y="${top - 1.5}" width="${CELL + 3}" height="${CELL + 3}" rx="5"/>${square}${glyph}</g>`
    })
    .join('')
  return { svg, height: Math.ceil(items.length / perRow) * (CELL + CELL_GAP) - CELL_GAP }
}

const LEGEND_LINE = 16

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
      const swatch =
        item.fill === 'pending'
          ? `<rect class="pending" x="${at + 0.5}" y="${base - 8.5}" width="8" height="8" rx="2"/>`
          : item.fill === 'none'
            ? `<rect class="none" x="${at}" y="${base - 9}" width="9" height="9" rx="2"/>`
            : `<rect x="${at}" y="${base - 9}" width="9" height="9" rx="2" fill="${item.fill}"/>`
      x += room + 16
      return `${swatch}<text class="ink" x="${at + 13}" y="${base}">${escapeXml(item.text)}</text>`
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

const heading = (title: string, count: string, left: number, width: number): string =>
  `<text class="head" x="${left}" y="12">${escapeXml(title)}</text>` +
  (count === '' ? '' : `<text class="muted" x="${left + width}" y="12" text-anchor="end">${escapeXml(count)}</text>`)

const block = (title: string, count: string, items: Cell[], keys: { fill: Paint; text: string }[], left: number, width: number): Block => {
  const grid = cells(items, left, 20, width)
  const key = legend(keys, left, 20 + grid.height + 18, width)
  return { svg: heading(title, count, left, width) + grid.svg + key.svg, height: 20 + grid.height + 6 + key.height }
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
          heading('Open questions', '', 0, width) +
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${height}" viewBox="0 0 ${SVG_WIDTH} ${height}">${SVG_STYLE}${blocks.map(one => one.svg).join('')}</svg>`
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

// The plugin's own close never reaches its own ui.close hook: the flag is set here.
async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE }).catch(() => undefined)
  await update($, isShown, () => false)
}

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: TITLE }).catch(() => null)
  if (opened?.isPlaced) await update($, isShown, () => true)
}

async function arm($: EngineInterface, topic: string | null): Promise<void> {
  await update($, tracked, () => ({ ...IDLE, isArmed: true, topic }))
  await update($, decisions, () => [])
  await update($, nav, () => HOME)
  await openPane($)
}

async function reload($: EngineInterface, path: string): Promise<void> {
  try {
    const stat = await $.fs.stat(path)
    const text = await $.fs.read(path)
    const at = await $.clock.now()
    await update($, tracked, state => ({ ...state, isArmed: true, path, mtimeMs: stat.mtimeMs, doc: parseSpec(text), readAt: at }))
  } catch {
    await update($, tracked, state => ({ ...state, path }))
  }
}

async function tick($: EngineInterface): Promise<void> {
  const state = await read($, tracked)
  if (!state.isArmed) return
  const at = await $.clock.now()
  await update($, now, () => at)
  if (state.path === null) return
  const stat = await $.fs.stat(state.path).catch(() => null)
  if (stat !== null && stat.mtimeMs !== state.mtimeMs) await reload($, state.path)
}

export const register: Register = on => {
  let root: string | null = null

  // On a desktop, a button above the prompt opens and closes the pane: its tab has no way back
  // once closed but the command. The surface stacks each plugin's band: this one draws its own alone.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey || !((await read($, tracked)).isArmed)) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const shown = await read($, isShown)
    return (
      <Box>
        <Button
          key="toggle-spec-pane"
          label="◫ Spec"
          variant={shown ? 'primary' : 'secondary'}
          onPress={() => (shown ? closePane($) : openPane($))}
        />
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
    root = e.cwd
    await $.command.register({
      name: 'spec-pane',
      description: 'Open the /business-spec pane (a SPEC path follows that spec, clear forgets it)',
    })
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    if ((await read($, tracked)).isArmed) void openPane($)
    return next(e)
  })

  on('command.run', { command: 'spec-pane' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, tracked, () => IDLE)
      await update($, decisions, () => [])
      await update($, nav, () => HOME)
      return { text: 'Spec pane cleared.' }
    }
    const asked = e.args.trim().replace(/^@/, '')
    if (asked !== '') {
      const path = asked.startsWith('/') || root === null ? asked : `${root}/${asked}`
      if (!isSpecPath(path)) return { text: `Not a spec: ${asked} (expected todo/<code>/SPEC-<code>.md or todo/<slug>/SPEC.md).` }
      await update($, tracked, () => ({ ...IDLE, isArmed: true }))
      await update($, decisions, () => [])
      await update($, nav, () => HOME)
      await reload($, path)
      if ((await read($, tracked)).doc === null) return { text: `Spec not found: ${asked}.` }
    }
    await openPane($)
    return { text: 'Spec pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const topic = promptTopic(e.text)
    if (topic !== undefined) await arm($, topic)
    return next(e)
  }).catch(($, e, next) => next(e))

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
    if (!state.isArmed) await openPane($)
    await reload($, path)
    return answered
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    const state = await read($, tracked)
    const asked = await read($, decisions)
    const where: Navigation = { ...HOME, ...(await read($, nav)) }
    const at = await read($, now)
    const doc = state.doc
    const columns = e.props.bodyColumns
    const slot = (kind: Kind, id: string) => `${kind}:${id}`
    const isExpanded = (kind: Kind, id: string) => where.expanded.includes(slot(kind, id))
    const expand = (kind: Kind, id: string) => () =>
      void update($, nav, current => {
        const expanded = current.expanded ?? []
        const one = slot(kind, id)
        return { ...HOME, ...current, expanded: expanded.includes(one) ? expanded.filter(other => other !== one) : [...expanded, one] }
      })
    const foldAll = () => void update($, nav, current => ({ ...HOME, ...current, expanded: [] }))
    const toggle = (group: string) => () =>
      void update($, nav, current => ({
        ...current,
        collapsed: current.collapsed.includes(group) ? current.collapsed.filter(one => one !== group) : [...current.collapsed, group],
      }))
    const isOpen = (group: string) => !where.collapsed.includes(group)

    const close = <Button key="close" label="✕" plain dimColor onPress={() => closePane($)} />
    const header = (title: string, trail?: string) => (
      <Box key="header" height={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color="claude">✻ </Text>
            {trail !== undefined && <Text color="inactive">{trail} › </Text>}
            <Text bold>{title}</Text>
          </Text>
        </Box>
        {close}
      </Box>
    )
    const paragraph = (key: string, text: string, color?: string) =>
      text
        .split('\n')
        .filter((line, index, all) => line.trim() !== '' || (index > 0 && all[index - 1]?.trim() !== ''))
        .map((line, index) => (
          <Text key={`${key}-${index}`} color={color} wrap="wrap">
            {plain(line) || ' '}
          </Text>
        ))

    const detail = (kind: Kind, id: string): JSX.Element[] | null => {
      if (kind === 'decision') {
        const decision = asked.find(one => one.id === id)
        if (decision === undefined) return null
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
        ]
      }
      if (kind === 'section') {
        const section = doc.sections.find((one, index) => sectionKey(one, index) === id)
        return section === undefined ? null : paragraph('s', section.body)
      }
      const item = (kind === 'useCase' ? doc.useCases : doc.rules).find(one => one.id === id)
      return item === undefined ? null : paragraph('i', item.body)
    }

    if (!state.isArmed && doc === null) {
      return (
        <Box flexDirection="column" marginTop={1}>
          {header(TITLE)}
          <Text color="inactive" wrap="truncate-end">
            {'  ⎿  '}No /business-spec in this session yet.
          </Text>
        </Box>
      )
    }

    const group = (key: (typeof GROUPS)[number], title: string, count: string, rows: JSX.Element[], tone?: string) => (
      <Box key={`group-${key}`} flexDirection="column" marginTop={1}>
        <Box height={1}>
          <Button key={`toggle-${key}`} plain dimColor onPress={toggle(key)}>
            {isOpen(key) ? '▾' : '▸'}
          </Button>
          <Text bold> {title}</Text>
          <Text color={tone ?? 'inactive'}> {count}</Text>
        </Box>
        {isOpen(key) && rows}
      </Box>
    )
    const unfolded = (kind: Kind, id: string): JSX.Element[] => {
      if (!isExpanded(kind, id)) return []
      const body = detail(kind, id)
      return body === null
        ? []
        : [
            <Box key={`detail-${kind}-${id}`} flexDirection="column" marginLeft={4} marginBottom={1}>
              {body}
            </Box>,
          ]
    }
    const entry = (kind: Kind, id: string, children: JSX.Element[]) => [
      <Box key={`row-${kind}-${id}`} height={1}>
        <Text color="inactive">{isExpanded(kind, id) ? '▾ ' : '  '}</Text>
        <Button key={`open-${kind}-${id}`} plain onPress={expand(kind, id)}>
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
          {fit(
            `${decision.header !== '' ? `${decision.header} · ` : ''}${decision.isPending ? decision.question : (decision.answer ?? 'no answer')}`,
            columns - 4,
          )}
        </Text>,
      ]),
    )

    const openQuestions = doc?.openQuestions ?? []
    const blocking = blockingCount(openQuestions)
    const questionRows = openQuestions.flatMap(question => [
      <Box key={`row-openQuestion-${question.id}`}>
        <Text color="inactive">{isExpanded('openQuestion', question.id) ? '▾ ' : '  '}</Text>
        <Button key={`open-openQuestion-${question.id}`} plain onPress={expand('openQuestion', question.id)}>
          <Text color={severityTone(question.severity)}>● {question.id}</Text>
        </Button>
        <Text> </Text>
        <Box flexShrink={1} flexGrow={1}>
          <Text key={`question-${question.id}`} wrap="wrap">
            {plain(question.question)}
          </Text>
        </Box>
      </Box>,
      ...unfolded('openQuestion', question.id),
    ])
    const itemRows = (kind: Kind, items: SpecItem[]) =>
      items.flatMap(item =>
        entry(kind, item.id, [
          <Text key="id" color="inactive">
            {item.id}{' '}
          </Text>,
          <Text key="name" wrap="truncate-end">
            {fit(item.name, columns - 3 - item.id.length)}
          </Text>,
        ]),
      )
    const counts = Svg === undefined || doc === null ? {} : sectionCounts(doc)
    const questionsAt = doc === null ? undefined : questionsSection(doc.sections)
    const countTone = questionsTone(doc?.openQuestions ?? [])
    const sectionRows = (doc?.sections ?? []).flatMap((section, index) => {
      const count = counts[sectionKey(section, index)] ?? 0
      const isQuestions = section === questionsAt
      return entry('section', sectionKey(section, index), [
        <Text key="text" wrap="truncate-end">
          {fit(sectionLabel(section), columns - 2 - (count > 0 ? String(count).length + 2 : 0))}
        </Text>,
        ...(count > 0 ? [<Text key="count" color={isQuestions ? countTone : 'inactive'}>{`  ${count}`}</Text>] : []),
      ])
    })

    const location = state.path === null ? 'waiting for the SPEC file…' : relativePath(state.path, root)
    const gauge = Svg === undefined ? '' : specGauge(asked, doc)
    const freshness = state.readAt === null || at === 0 ? '' : ` · read ${ago(at - state.readAt)} ago`

    return (
      <Box flexDirection="column" marginTop={1}>
        {header(doc?.title || state.topic || TITLE, doc?.title ? TITLE : undefined)}
        <Text color="inactive" wrap="truncate-start">
          {'  ⎿  '}
          {location}
          {freshness}
        </Text>
        {Svg !== undefined && gauge !== '' && (
          <Box key="gauge" marginTop={1}>
            <Svg key="gauge-svg" source={gauge} alt={specGaugeAlt(asked, doc)} width={svgWidth(gauge)} height={svgHeight(gauge)} isInteractive />
          </Box>
        )}
        {where.expanded.length > 0 && (
          <Box key="fold" height={1}>
            <Text>{'     '}</Text>
            <Button key="fold-all" hotkey="b" plain dimColor onPress={foldAll}>
              <Text>{`fold all (${where.expanded.length} open)`}</Text>
            </Button>
          </Box>
        )}
        {doc !== null && doc.summary !== '' && (
          <Box key="summary" marginTop={1}>
            <Text color="inactive" wrap="wrap">
              {plain(doc.summary)}
            </Text>
          </Box>
        )}
        {asked.length > 0 &&
          group('decisions', 'Decisions', `${asked.length}${pending > 0 ? ` · ${pending} pending` : ''}`, decisionRows, pending > 0 ? 'claude' : undefined)}
        {doc !== null &&
          group(
            'openQuestions',
            'Open questions',
            openQuestions.length === 0 ? 'none' : `${openQuestions.length}${blocking > 0 ? ` · ${blocking} blocking` : ''}`,
            questionRows,
            blocking > 0 ? 'error' : openQuestions.length > 0 ? 'warning' : 'success',
          )}
        {doc !== null && doc.useCases.length > 0 && group('useCases', 'Use cases', `${doc.useCases.length}`, itemRows('useCase', doc.useCases))}
        {doc !== null && doc.rules.length > 0 && group('rules', 'Business rules', `${doc.rules.length}`, itemRows('rule', doc.rules))}
        {doc !== null && doc.sections.length > 0 && group('sections', 'Sections', `${doc.sections.length}`, sectionRows)}
      </Box>
    )
  })
}
