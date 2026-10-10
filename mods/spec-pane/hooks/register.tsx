import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, Kind, Navigation, OpenQuestion, SpecDoc, SpecItem, SpecSection, Tracked } from '../types'

const PANE = 'spec-pane'
const TITLE = 'Spec'
const SKILL = 'business-spec'
const TICK_MS = 3_000
const SPEC_PATTERN = /(?:^|\/)todo\/[^/]+\/SPEC(?:-[^/]+)?\.md$/
const OPEN_QUESTIONS = ['questions ouvertes', 'open questions']
const ITEM_PATTERN = /^###\s+((?:CU|RM)-[\w.]+)\s*[—–-]\s*(.*)$/
const SECTION_PATTERN = /^##\s+(\d+)\.\s*(.*?)\s*(?:<!--.*-->)?\s*$/
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
  let section: { number: string; title: string; lines: string[] } | null = null
  let item: { id: string; name: string; lines: string[] } | null = null
  const closeItem = () => {
    if (item === null) return
    const body = trimBlank(item.lines)
    const severity = item.id.startsWith('RM-') ? (SEVERITY_PATTERN.exec(body)?.[1]?.trim() ?? null) : null
    items.push({ id: item.id, name: item.name, tag: severity, body })
    item = null
  }
  const closeSection = () => {
    closeItem()
    if (section !== null) sections.push({ number: section.number, title: section.title, body: trimBlank(section.lines) })
    section = null
  }
  for (const line of lines) {
    const heading = /^##\s/.test(line) ? SECTION_PATTERN.exec(line) : null
    if (/^##\s/.test(line)) {
      closeSection()
      if (heading !== null) section = { number: heading[1] ?? '', title: (heading[2] ?? '').trim(), lines: [] }
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
  const questions =
    sections.find(one => OPEN_QUESTIONS.some(title => fold(one.title).startsWith(title))) ?? sections.find(one => one.number === '12')
  return {
    title,
    summary,
    sections,
    useCases: items.filter(one => one.id.startsWith('CU-')),
    rules: items.filter(one => one.id.startsWith('RM-')),
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

export const isOffRecommendation = (decision: Decision): boolean =>
  decision.answer !== null && decision.recommended !== null && !decision.answer.split(', ').includes(decision.recommended)

const blockingCount = (questions: OpenQuestion[]): number => questions.filter(one => severityTone(one.severity) === 'error').length

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
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

  on('session.start', async ($, e, next) => {
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

    const close = <Button key="close" label="✕" plain dimColor onPress={() => $.ui.close({ id: PANE })} />
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
            <Text wrap="wrap" color={decision.isPending ? 'claude' : isOffRecommendation(decision) ? 'warning' : undefined}>
              {decision.isPending ? 'Waiting for the answer…' : `Answer: ${decision.answer ?? '—'}`}
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
        const section = doc.sections.find(one => one.number === id)
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
        <Text key="mark" color={decision.isPending ? 'claude' : isOffRecommendation(decision) ? 'warning' : 'success'}>
          {decision.isPending ? '? ' : isOffRecommendation(decision) ? '≠ ' : '✓ '}
        </Text>,
        <Text key="text" wrap="truncate-end">
          {fit(
            `${decision.header !== '' ? `${decision.header} · ` : ''}${decision.isPending ? decision.question : (decision.answer ?? '—')}`,
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
    const sectionRows = (doc?.sections ?? []).flatMap(section =>
      entry('section', section.number, [
        <Text key="text" wrap="truncate-end">
          {fit(`${section.number}. ${section.title}`, columns - 2)}
        </Text>,
      ]),
    )

    const location = state.path === null ? 'waiting for the SPEC file…' : relativePath(state.path, root)
    const freshness = state.readAt === null || at === 0 ? '' : ` · read ${ago(at - state.readAt)} ago`

    return (
      <Box flexDirection="column" marginTop={1}>
        {header(doc?.title || state.topic || TITLE, doc?.title ? TITLE : undefined)}
        <Text color="inactive" wrap="truncate-start">
          {'  ⎿  '}
          {location}
          {freshness}
        </Text>
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
