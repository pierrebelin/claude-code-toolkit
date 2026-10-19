import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Stamps = Record<string, number>
export type Directory = Record<string, { name: string; kind: 'file' | 'dir'; mtimeMs?: number }[]>
export type World = { now?: number; stamps?: Stamps; dirs?: Directory; reads?: string[]; writes?: string[]; toasts?: string[]; closed?: string[]; opened?: Set<string> }

// The engine around the pane: a clock, the session, the files (a relative key stands for any path ending with it),
// the directories, the panes opened and closed, the toasts. Each test file adds the tools its runs call.
export const world = (on: On, files: Record<string, string> = {}, options: World = {}) => {
  const { stamps = {}, dirs = {}, reads = [], writes = [], toasts = [], closed = [], opened = new Set<string>() } = options
  const clock = options.now === undefined ? mock.clock(on) : mock.clock(on, { now: options.now })
  const keyOf = (path: string, keys: string[]) => keys.find(key => key === path || (!key.startsWith('/') && path.endsWith(`/${key}`)))
  const touch = (path: string, text: string) => {
    files[path] = text
    stamps[path] = (stamps[path] ?? 1) + 1
  }
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], cost: { usd: 1 } } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    opened.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    opened.delete(e.id)
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...opened].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('fs.read', ($, e) => {
    const key = keyOf(e.path, Object.keys(files))
    reads.push(key ?? e.path)
    return key === undefined ? { deny: `ENOENT ${e.path}` } : { value: files[key] ?? '' }
  })
  on('fs.stat', ($, e) => {
    const key = keyOf(e.path, Object.keys(files))
    return key === undefined ? { deny: `ENOENT ${e.path}` } : { value: { kind: 'file', size: 1, mtimeMs: stamps[key] ?? 1, isLink: false } }
  })
  on('fs.list', ($, e) => {
    const entries = dirs[keyOf(e.path ?? '', Object.keys(dirs)) ?? e.path ?? '']
    return entries === undefined
      ? { deny: `ENOENT ${e.path}` }
      : { value: entries.map(entry => ({ name: entry.name, kind: entry.kind, size: 1, mtimeMs: entry.mtimeMs ?? 0, isLink: false })) }
  })
  on('fs.write', ($, e) => {
    touch(e.path, e.text)
    writes.push(e.path)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return { clock, touch }
}

export const paneAt = (bodyColumns = 60, bodyRows = 40) =>
  ({ component: 'Pane', requestId: 'run-lot-pane', props: { title: 'Workflow', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} } }) as const

export const PANE = paneAt()

export const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

export const paneCommand = ($: Engine, args: string) => $.command.run({ command: 'run-lot-pane', args } as Parameters<typeof $.command.run>[0])
