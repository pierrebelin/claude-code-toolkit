import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Base, ContextRow, HistoryRow, IndexState, KObject, Kind, Level, Merge, MergeObject, Navigation, Sync, View } from '../types'

const PANE = 'knowledge-pane'
const TITLE = 'Knowledge'
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

const HOME: Navigation = { stack: [{ kind: 'home' }], query: '', seed: '', expanded: [], collapsed: [] }

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

// Fields of `.index/knowledge.jsonl`, a frozen literal of the kit (`rules/markdown-output.md`).
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

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())

const isSeparator = (line: string): boolean => /^\|?\s*:?-{3,}/.test(line.trim())

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
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const heading = new RegExp(`^(#+)\\s+${escaped}\\s+[—–-]`)
  const at = lines.findIndex(line => heading.test(line))
  if (at < 0) return null
  const level = (heading.exec(lines[at] ?? '')?.[1] ?? '#').length
  const rest = lines.slice(at + 1)
  const stop = rest.findIndex(line => {
    const found = /^(#+)\s/.exec(line)
    return found !== null && (found[1] ?? '').length <= level
  })
  return (stop < 0 ? rest : rest.slice(0, stop)).join('\n').trim()
}

// `[mtime_ns, size]` per base file in `.index/files.json`: a file whose stamp moved, or one not there, is not indexed yet.
export const staleOf = (files: { rel: string; size: number; mtimeMs: number }[], cache: unknown): string[] => {
  const known = ((cache ?? {}) as { files?: Record<string, { stamp?: unknown }> }).files ?? {}
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

export const isSharedRule = (rule: KObject): boolean => rule.kind === 'RM' && /(?:^|\/)rules\.md$/.test(rule.path)

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
    const heading = /^##\s+(.*?)\s*(?:<!--.*-->)?\s*$/.exec(line)
    if (heading !== null) {
      if (current !== null) parts.push({ title: current.title, body: current.lines.join('\n').trim() })
      current = { title: heading[1] ?? '', lines: [] }
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

const SVG_STYLE =
  '<style>text{font:11px system-ui,-apple-system,"Segoe UI",sans-serif}.ink{fill:#52514e}.head{fill:#52514e;font-weight:600}.muted{fill:#52514e;opacity:.7}' +
  '.empty{fill:#52514e;fill-opacity:.08}.glyph{font-size:10px;font-weight:600}.rule{stroke:#52514e;stroke-opacity:.35}' +
  '.hit{fill:#52514e;fill-opacity:0}g.mark:hover .hit{fill-opacity:.14}' +
  '@media (prefers-color-scheme: dark){.ink,.head,.muted{fill:#c3c2b7}.empty{fill:#c3c2b7}.rule{stroke:#c3c2b7}.hit{fill:#c3c2b7}}</style>'
const SPECIFIED = '#3b82c4'
const OBSERVED = '#fab219'
const CELL_INK = '#0b0b0b'
const CELL = 18
const STEP = 21
const LABEL_WIDTH = 190
const HEAD_HEIGHT = 62
const LEGEND_HEIGHT = 30
// The legend's last words end near x = 340: a matrix of few columns is drawn that wide all the same.
const LEGEND_WIDTH = 345

export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const svgHeight = (source: string): number => Number(/<svg[^>]*\sheight="(\d+)"/.exec(source)?.[1] ?? 0)

export const svgWidth = (source: string): number => Number(/<svg[^>]*\swidth="(\d+)"/.exec(source)?.[1] ?? 0)

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
      const cells = columns
        .map((rule, index) => {
          const x = LABEL_WIDTH + index * STEP
          if (!rule.usecases.includes(cu.id)) return `<rect class="empty" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="4"/>`
          const fill = rule.level === null ? SPECIFIED : OBSERVED
          const glyph = rule.level === null ? '' : (rule.level[0] ?? '')
          const status = rule.level === null ? 'specified' : `observed ${rule.level}`
          const place = isOwnRule(rule, cu) ? 'own rule' : isSharedRule(rule) ? 'cross-cutting' : `from ${rule.context}`
          return (
            `<g class="mark"><title>${escapeXml(`${cu.id} applies ${rule.id}`)}&#10;${escapeXml(rule.title)}&#10;${escapeXml(`${place} · ${status}`)}</title>` +
            `<rect class="hit" x="${x - 1.5}" y="${y - 1.5}" width="${CELL + 3}" height="${CELL + 3}" rx="5"/>` +
            `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="4" fill="${fill}"/>` +
            (glyph === '' ? '' : `<text class="glyph" x="${x + CELL / 2}" y="${y + CELL / 2 + 3.5}" text-anchor="middle" fill="${CELL_INK}">${glyph}</text>`) +
            '</g>'
          )
        })
        .join('')
      return label + cells
    })
    .join('')
  const firstShared = columns.findIndex(isSharedRule)
  const divider =
    firstShared > 0
      ? `<line class="rule" x1="${LABEL_WIDTH + firstShared * STEP - 2}" y1="${HEAD_HEIGHT - 4}" x2="${LABEL_WIDTH + firstShared * STEP - 2}" y2="${HEAD_HEIGHT + rows.length * STEP - 3}"/>`
      : ''
  const legendY = HEAD_HEIGHT + rows.length * STEP + 18
  const legend =
    `<rect x="0" y="${legendY - 9}" width="9" height="9" rx="2" fill="${SPECIFIED}"/><text class="ink" x="13" y="${legendY}">specified</text>` +
    `<rect x="84" y="${legendY - 9}" width="9" height="9" rx="2" fill="${OBSERVED}"/><text class="ink" x="97" y="${legendY}">observed (h · m · l)</text>` +
    `<text class="muted" x="230" y="${legendY}">bold: cross-cutting</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${SVG_STYLE}<text class="head" x="0" y="12">Use cases × rules</text>${heads}${divider}${lines}${legend}</svg>`
}

export const matrixAlt = (objects: KObject[], name: string): string => {
  const rows = contextParts(objects, name).usecases
  const columns = matrixColumns(objects, name)
  const applied = rows.map(({ cu }) => `${cu.id} applies ${columns.filter(rule => rule.usecases.includes(cu.id)).map(rule => rule.id).join(', ') || 'no rule'}`)
  return `${name}: ${counted(rows.length, 'use case')} × ${counted(columns.length, 'rule')}. ${applied.join('; ')}.`
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
    return await $.fs.read(path)
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
    return root.replaceAll('{product}', typeof config.product === 'string' && config.product !== '' ? config.product : '*').replace(/^\/+|\/+$/g, '')
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

// The plugin's own close never reaches its own ui.close hook: the flag is set here.
async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE }).catch(() => undefined)
  await update($, isShown, () => false)
}

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: TITLE }).catch(() => null)
  if (opened?.isPlaced) await update($, isShown, () => true)
}

async function tick($: EngineInterface): Promise<void> {
  if (!(await read($, isShown))) return
  const at = await $.clock.now()
  await update($, now, () => at)
  const current = await read($, base)
  if (current.repo === '') return
  const walked = await signatureOf($, current.repo, current.root)
  if (walked.signature !== current.signature) await reload($, walked)
}

export const register: Register = on => {
  let repo: string | null = null

  // On a desktop, a button above the prompt opens and closes the pane once the repo holds a base.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey || !(await read($, base)).isPresent) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const shown = await read($, isShown)
    return (
      <Box>
        <Button key="toggle-knowledge-pane" label="◫ Knowledge" variant={shown ? 'primary' : 'secondary'} onPress={() => (shown ? closePane($) : openPane($))} />
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
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    const current = await read($, base)
    if (!current.isDemo || current.repo === '') await switchTo($, e.cwd, await rootOf($, e.cwd), false).catch(() => undefined)
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const Svg = e.surface === 'desktop' && 'Svg' in elements ? elements.Svg : undefined
    const kb = await read($, base)
    const where: Navigation = { ...HOME, ...(await read($, nav)) }
    const texts = await read($, full)
    const at = await read($, now)
    const columns = e.props.bodyColumns
    const view: View = where.stack[where.stack.length - 1] ?? { kind: 'home' }
    const byId = new Map(kb.objects.map(one => [one.id, one]))

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
    const isOpen = (group: string, byDefault = true) => (where.collapsed.includes(group) ? !byDefault : byDefault)

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
        <Text> </Text>
        {close}
      </Box>
    )
    const freshness = kb.readAt === null || at === 0 ? '' : ` · read ${ago(at - kb.readAt)} ago`
    const location = (
      <Text key="location" color="inactive" wrap="truncate-start">
        {'  ⎿  '}
        {kb.isDemo ? `demo · ${kb.root}` : kb.root}
        {freshness}
      </Text>
    )
    const keys = (
      <Box key="keys" height={1}>
        <Text>{'     '}</Text>
        {where.stack.length > 1 && (
          <Button key="back" hotkey="b" plain dimColor onPress={() => void back($)}>
            <Text>back </Text>
          </Button>
        )}
        {where.stack.length > 1 && (
          <Button key="home" hotkey="h" plain dimColor onPress={() => void home($)}>
            <Text>home </Text>
          </Button>
        )}
        {view.kind !== 'search' && (
          <Button key="search" hotkey="s" plain dimColor onPress={toSearch}>
            <Text>search</Text>
          </Button>
        )}
      </Box>
    )
    // Markdown lines as text: a heading bold without its marks, a fenced block dim without its fences.
    const paragraph = (key: string, text: string, color?: string) => {
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
    const group = (key: string, title: string, count: string, rows: JSX.Element[], tone?: string, byDefault = true) => (
      <Box key={`group-${key}`} flexDirection="column" marginTop={1}>
        <Box height={1}>
          <Button key={`toggle-${key}`} plain dimColor onPress={toggle(key)}>
            {isOpen(key, byDefault) ? '▾' : '▸'}
          </Button>
          <Text bold> {title}</Text>
          <Text color={tone ?? 'inactive'}> {count}</Text>
        </Box>
        {isOpen(key, byDefault) && rows}
      </Box>
    )
    const mark = (object: KObject) =>
      object.level === null ? [] : [<Text key="observed" color="warning">{` ◐ ${object.level}`}</Text>]
    // One object as a row: its id and title, pressed to open it; an id outside the base is shown, not pressable.
    const idRow = (key: string, id: string, indent = 2) => {
      const object = byId.get(id)
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
      return (
        <Text key={key} color="inactive" wrap="truncate-end">
          {`  ${fit(`${row.date} · ${row.feature}${isContextShown ? ` · ${row.context}` : ''} · ${shown.join(' ') || '—'}`, columns - 2)}`}
        </Text>
      )
    }

    const blank = (text: string, tone = 'inactive') => (
      <Text key="blank" color={tone} wrap="wrap">
        {'  ⎿  '}
        {text}
      </Text>
    )

    // --- home ---------------------------------------------------------------------------
    const homeView = () => {
      if (!kb.isPresent)
        return [blank(`No knowledge base under ${kb.root} — /cctoolkit:knowledge-sync builds it. /knowledge-pane demo shows the kit example.`)]
      const alerts: JSX.Element[] = []
      if (kb.index === 'missing')
        alerts.push(
          <Text key="alert-index" color="error" wrap="wrap">{`✗ No index yet (${kb.root}/${INDEX_JSONL}) — run ${INDEX_COMMAND}`}</Text>,
        )
      if (kb.index === 'stale') {
        const slot = 'stale'
        alerts.push(
          <Box key="alert-index" height={1}>
            <Button key="open-stale" plain onPress={unfold(slot)}>
              <Text color="warning">{`▲ Index behind ${counted(kb.staleFiles.length, 'file')} — run ${INDEX_COMMAND}`}</Text>
            </Button>
          </Box>,
          ...(where.expanded.includes(slot)
            ? kb.staleFiles.map((rel, index) => (
                <Text key={`stale-${index}`} color="inactive" wrap="truncate-start">{`    ${rel}`}</Text>
              ))
            : []),
        )
      }
      for (const merge of kb.merges) {
        const changes = ['new', 'modified', 'retired'].map(change => merge.objects.filter(one => one.change === change).length)
        alerts.push(
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
          <Box key={`alert-sync-${sync.context}`} height={1}>
            <Button key={`open-sync-${sync.context}`} plain onPress={unfold(slot)}>
              <Text color="warning" bold>{`◆ ${sync.context} — sync staged, not written`}</Text>
              <Text color="inactive">{`  ${counted(sync.files.length, 'file')}`}</Text>
            </Button>
          </Box>,
          ...(where.expanded.includes(slot)
            ? [
                ...sync.files.map((rel, index) => <Text key={`sync-${sync.context}-${index}`} color="inactive" wrap="truncate-start">{`    ${rel}`}</Text>),
                <Text key={`sync-${sync.context}-next`} color="inactive" wrap="wrap">{'    → /cctoolkit:knowledge-sync to review and write it'}</Text>,
              ]
            : []),
        )
      }
      const contextRows = kb.contexts.flatMap(context => [
        <Box key={`row-context-${context.name}`} height={1}>
          <Text>{'  '}</Text>
          <Button key={`open-context-${context.name}`} plain onPress={go({ kind: 'context', name: context.name })}>
            <Text bold>{context.name}</Text>
            <Text color="inactive">{`${context.prefix === '' ? '' : ` ${context.prefix}`} · ${context.usecases} CU · ${context.rules} RM · ${context.decisions} D`}</Text>
          </Button>
        </Box>,
        ...(context.summary === ''
          ? []
          : [
              <Box key={`summary-${context.name}`} marginLeft={4}>
                <Text color="inactive" wrap="wrap">
                  {plain(context.summary)}
                </Text>
              </Box>,
            ]),
      ])
      const adrs = kb.objects.filter(one => one.kind === 'ADR').sort((a, b) => a.id.localeCompare(b.id))
      const observed = LEVELS.map(level => ({ level, items: kb.objects.filter(one => one.level === level) }))
      const observedCount = observed.reduce((sum, one) => sum + one.items.length, 0)
      return [
        ...(alerts.length > 0 ? [<Box key="alerts" flexDirection="column" marginTop={1}>{alerts}</Box>] : []),
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
        <Box key="recent" flexDirection="column" marginTop={1}>
          <Text bold>Recent</Text>
          {kb.history.length === 0 ? <Text color="inactive">  none</Text> : kb.history.slice(0, HISTORY_SHOWN).map((row, index) => historyRow(`recent-${index}`, row))}
        </Box>,
      ]
    }

    // --- context ------------------------------------------------------------------------
    const contextView = (name: string) => {
      const parts = contextParts(kb.objects, name)
      const overview = parseOverview(kb.overviews[name] ?? '')
      const gauge = Svg === undefined ? '' : matrixSvg(kb.objects, name)
      const overviewRows = [
        ...(overview.role === '' ? [] : [<Box key="role" marginLeft={2} flexDirection="column">{paragraph('role', overview.role)}</Box>]),
        ...overview.parts.flatMap(part => {
          const slot = `overview:${part.title}`
          const isUnfolded = where.expanded.includes(slot)
          return [
            <Box key={`row-${slot}`} height={1}>
              <Text color="inactive">{isUnfolded ? '  ▾ ' : '  ▸ '}</Text>
              <Button key={`open-${slot}`} plain onPress={unfold(slot)}>
                <Text>{part.title}</Text>
              </Button>
            </Box>,
            ...(isUnfolded ? [<Box key={`body-${slot}`} flexDirection="column" marginLeft={4} marginBottom={1}>{paragraph(slot, part.body)}</Box>] : []),
          ]
        }),
      ]
      const caseRows = parts.usecases.flatMap(({ cu, rules }) => [idRow(`cu-${cu.id}`, cu.id), ...rules.map(rule => idRow(`own-${rule.id}`, rule.id, 6))])
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
      return [
        <Box key="facts" flexDirection="column" marginTop={1}>
          <Text color="inactive" wrap="truncate-end">{`  ${KIND_NAMES[object.kind]} · ${object.context || object.contexts.join(', ')}`}</Text>
          <Text color={object.level === null ? 'success' : 'warning'}>{object.level === null ? '  specified' : `  ◐ observed ${object.level} — not validated yet`}</Text>
          <Text color="inactive" wrap="truncate-start">{`  ${object.path}:${object.line}`}</Text>
        </Box>,
        <Box key="text" flexDirection="column" marginTop={1} marginLeft={2}>
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
                  <Text key={`handler-${handler}`} wrap="truncate-end">{`  ${handler}`}</Text>
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
        <Box key="merge-state" flexDirection="column" marginTop={1}>
          <Text color="warning" wrap="wrap">
            {merge.isStaged ? '  Staged: the whole files are ready, nothing is written to the base yet.' : '  Prepared: drafts in progress, not staged yet.'}
          </Text>
          <Text color="inactive" wrap="wrap">{'  → /cctoolkit:knowledge-merge to review and write it'}</Text>
        </Box>,
        ...contexts.map(context =>
          group(
            `merge-${context}`,
            context,
            `${merge.objects.filter(one => one.context === context).length}`,
            merge.objects
              .filter(one => one.context === context)
              .map(one => (
                <Box key={`change-${one.id}`} height={1}>
                  <Text color={one.change === 'new' ? 'success' : one.change === 'retired' ? 'error' : 'warning'}>{`  ${markOf(one.change)} `}</Text>
                  <Button key={`open-change-${one.id}`} plain onPress={go({ kind: 'change', code, id: one.id })}>
                    <Text color="inactive">{one.id} </Text>
                    <Text wrap="truncate-end">{fit(one.title, columns - one.id.length - 6 - (merge.after[one.id] === undefined && one.change !== 'retired' ? 11 : 0))}</Text>
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
          <Text color={change.change === 'new' ? 'success' : change.change === 'retired' ? 'error' : 'warning'}>{`  ${markOf(change.change)} ${change.change} · ${change.context}`}</Text>
        </Box>,
        <Box key="before" flexDirection="column" marginTop={1}>
          <Text bold>Base now</Text>
          <Box flexDirection="column" marginLeft={2}>
            {before === null ? <Text color="inactive">not in the base</Text> : paragraph('before', before, 'inactive')}
          </Box>
        </Box>,
        <Box key="after" flexDirection="column" marginTop={1}>
          <Text bold>{merge.isStaged ? 'Staged' : 'Draft'}</Text>
          <Box flexDirection="column" marginLeft={2}>
            {change.change === 'retired' ? <Text color="error">retired: cut from the base</Text> : after === undefined ? <Text color="inactive">no draft yet</Text> : paragraph('after', after)}
          </Box>
        </Box>,
        ...(byId.has(id) ? [<Box key="open-object-row" marginTop={1} height={1}>{idRow('change-object', id, 0)}</Box>] : []),
      ]
    }

    // --- search -------------------------------------------------------------------------
    const searchView = () => {
      const found = search(kb.objects, where.query)
      return [
        <Box key="query-row" marginTop={1}>
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
              ...found.slice(0, RESULTS_SHOWN).map(one => idRow(`found-${one.id}`, one.id)),
              <Text key="found-count" color="inactive">{`  ${found.length > RESULTS_SHOWN ? `${RESULTS_SHOWN} of ` : ''}${counted(found.length, 'object')}`}</Text>,
            ]
          )}
        </Box>,
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
                : homeView()

    return (
      <Box flexDirection="column" marginTop={1}>
        {header(title, trail)}
        {location}
        {kb.isPresent && keys}
        {body}
      </Box>
    )
  })
}
