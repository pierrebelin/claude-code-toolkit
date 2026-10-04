import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Batch, Correction, Phase, Sheet, Step } from '../types'

const PANE = 'tdd-batch'
const TITLE = 'Lot TDD'
const TICK_MS = 10_000
const TODO = 'todo'
const DONE = '✅'
const BLOCKED_LITERALS = ['## BLOQUÉ', '## BLOCKED']
const SHEET_PATTERN = /-PLAN-(F\d+)\.md$/
const AGENT_KINDS: Record<string, 'RED' | 'GREEN'> = {
  'tdd-test-author': 'RED',
  'tdd-implementer': 'GREEN',
}

const EMPTY: Batch = { path: null, sheet: null, error: null, wave: 0, running: [], blocked: [] }

const batch = atom({ plugin: 'tdd-batch', key: 'batch' } as const, EMPTY)

const complete = (stored: Batch): Batch => ({ ...EMPTY, ...stored })

const storeKey = (cwd: string): string => `sheet:${cwd}`

export const isPhaseDone = (tdd: Phase | null): boolean =>
  tdd !== null && tdd.red === DONE && tdd.green === DONE && tdd.cost === DONE

export const isStepDone = (step: Step): boolean =>
  (step.isDone || isPhaseDone(step.tdd)) && step.corrections.every(one => isPhaseDone(one.tdd))

export const parseSheet = (text: string, path: string): Sheet => {
  const lines = text.split(/\r?\n/)
  const title = lines.find(line => line.startsWith('# '))?.slice(2).trim() ?? ''
  const lot = SHEET_PATTERN.exec(path)?.[1] ?? /PLAN-(F\d+)/.exec(title)?.[1] ?? '?'
  const name = title
    .replace(/\s+—\s+✅ DONE.*$/, '')
    .split(' — ')
    .slice(1)
    .join(' — ')
  const steps: Step[] = []
  let section = ''
  let hypotheses = 0

  for (const line of lines) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim()
      continue
    }
    if (/^(H[yi]poth[eè]ses|Assumptions)/i.test(section) && /^\s*(?:[-*]\s+)?\**H\d+\b/.test(line)) hypotheses += 1
    if (!/^(D[eé]roulement TDD|TDD sequence)/i.test(section)) continue

    const step = /^### (?:[EÉ]tape|Step) (\S+) — (.+)$/.exec(line)
    if (step) {
      const heading = step[2] ?? ''
      steps.push({
        number: step[1] ?? '',
        title: heading.replace(/\s+—\s+✅ DONE.*$/, ''),
        isDone: heading.includes('✅ DONE'),
        tdd: null,
        corrections: [],
      })
      continue
    }
    const current = steps[steps.length - 1]
    if (current === undefined) continue

    const correction = /^(?:#{3,4} )?Correction (C\d+) — (.+)$/.exec(line)
    if (correction) {
      current.corrections.push({ id: correction[1] ?? '', finding: correction[2] ?? '', tdd: null })
      continue
    }
    const tdd = /^TDD ?: RED (\S+) · GREEN (\S+) · CO[US]T (\S+)/.exec(line)
    if (tdd) {
      const phase: Phase = { red: tdd[1] ?? '', green: tdd[2] ?? '', cost: tdd[3] ?? '' }
      const owner: Step | Correction = current.corrections[current.corrections.length - 1] ?? current
      if (owner.tdd === null) owner.tdd = phase
    }
  }

  return { lot, name, isDone: title.includes('✅ DONE'), steps, hypotheses }
}

export const sheetFromArgs = (args: string): { path: string | null; lot: string | null } => {
  const lot = /\blot\s+(F\d+)\b/i.exec(args)?.[1]?.toUpperCase() ?? null
  const sheet = /(\S+-PLAN-F\d+\.md)\b/.exec(args)?.[1]
  if (sheet !== undefined) return { path: sheet, lot }
  const plan = /(\S+-PLAN\.md)\b/.exec(args)?.[1]
  if (plan !== undefined && lot !== null) return { path: plan.replace(/-PLAN\.md$/, `-PLAN-${lot}.md`), lot }
  return { path: null, lot }
}

async function findSheet($: EngineInterface, lot: string | null): Promise<string | null> {
  if (!(await $.fs.exists(TODO))) return null
  let best: { path: string; mtimeMs: number } | null = null
  for (const folder of await $.fs.list(TODO)) {
    if (folder.kind !== 'directory') continue
    for (const entry of await $.fs.list(`${TODO}/${folder.name}`)) {
      const found = SHEET_PATTERN.exec(entry.name)
      if (found === null || (lot !== null && found[1] !== lot)) continue
      if (best === null || entry.mtimeMs > best.mtimeMs) {
        best = { path: `${TODO}/${folder.name}/${entry.name}`, mtimeMs: entry.mtimeMs }
      }
    }
  }
  return best?.path ?? null
}

async function refresh($: EngineInterface): Promise<void> {
  const current = complete(await read($, batch))
  if (current.path === null) return
  let sheet: Sheet | null = null
  let error: string | null = null
  try {
    sheet = parseSheet(await $.fs.read(current.path), current.path)
  } catch {
    error = `fiche illisible : ${current.path}`
  }
  if (JSON.stringify(sheet) === JSON.stringify(current.sheet) && error === current.error) return
  await update($, batch, stored => ({ ...complete(stored), sheet, error }))
}

async function follow($: EngineInterface, path: string): Promise<void> {
  const cwd = await $.session.cwd()
  const relative = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
  await update($, batch, stored => {
    const current = complete(stored)
    return current.path === relative ? current : { ...EMPTY, path: relative }
  })
  await $.store.set(storeKey(cwd), relative)
  await refresh($)
}

async function trackAgent($: EngineInterface, id: string, kind: 'RED' | 'GREEN', description: string): Promise<void> {
  await update($, batch, stored => {
    const current = complete(stored)
    const opensWave = kind === 'RED' && !current.running.some(one => one.kind === 'RED')
    return {
      ...current,
      wave: opensWave ? current.wave + 1 : current.wave,
      running: [...current.running, { id, kind, description }],
    }
  })
}

async function settleAgent($: EngineInterface, id: string, isBlocked: boolean): Promise<void> {
  await update($, batch, stored => {
    const current = complete(stored)
    const run = current.running.find(one => one.id === id)
    return {
      ...current,
      running: current.running.filter(one => one.id !== id),
      blocked:
        isBlocked && run !== undefined
          ? [...current.blocked, { kind: run.kind, description: run.description }]
          : current.blocked,
    }
  })
}

async function restore($: EngineInterface, cwd: string): Promise<void> {
  const current = complete(await read($, batch))
  if (current.path !== null) return
  const stored = await $.store.get(storeKey(cwd))
  if (typeof stored === 'string') await update($, batch, () => ({ ...EMPTY, path: stored }))
}

const mark = (value: string): string => (value === '' ? '?' : value)

export const phaseLabel = (tdd: Phase | null): string =>
  tdd === null ? '—' : `RED ${mark(tdd.red)} · GREEN ${mark(tdd.green)} · COUT ${mark(tdd.cost)}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tdd-batch',
      description: "Ouvre le pane d'avancement du lot /implement-tdd (argument : chemin de la fiche, sinon la plus récente)",
    })
    await restore($, e.cwd)
    $.clock.every(TICK_MS, () => void refresh($))
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'tdd-batch' }, async ($, e) => {
    const asked = e.args.trim()
    const known = complete(await read($, batch)).path
    const path = asked !== '' ? asked : (known ?? (await findSheet($, null)))
    if (path !== null) await follow($, path)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: path === null ? 'Pane ouvert, aucune fiche de lot trouvée sous todo/.' : `Pane ouvert sur ${path}.` }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const input = (e.input ?? {}) as Record<string, unknown>

    if (e.tool === 'Skill' && input.skill === 'implement-tdd') {
      const asked = sheetFromArgs(typeof input.args === 'string' ? input.args : '')
      const path = asked.path ?? (await findSheet($, asked.lot))
      if (path !== null) await follow($, path)
      void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
      return next(e)
    }

    if (e.tool === 'Agent') {
      const kind = AGENT_KINDS[typeof input.subagent_type === 'string' ? input.subagent_type : '']
      if (kind === undefined) return next(e)
      const id = e.tool_use_id ?? `${kind}-${await $.clock.now()}`
      const description = typeof input.description === 'string' ? input.description : kind
      await trackAgent($, id, kind, description)
      const result = await next(e)
      const text = typeof result.deny === 'string' ? result.deny : (result.text ?? '')
      await settleAgent($, id, BLOCKED_LITERALS.some(literal => text.includes(literal)))
      return result
    }

    const result = await next(e)
    if (e.tool === 'Write' || e.tool === 'Edit') {
      const path = typeof input.file_path === 'string' ? input.file_path : ''
      if (SHEET_PATTERN.test(path) && path.includes(`${TODO}/`)) await follow($, path)
      else if (path.includes(`${TODO}/`)) await refresh($)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const state = complete(await read($, batch))
    const sheet = state.sheet

    if (state.path === null || sheet === null) {
      return (
        <Box flexDirection="column" width={e.props.bodyColumns}>
          <Text dimColor>{state.error ?? 'Aucune fiche de lot suivie.'}</Text>
          <Text dimColor>/tdd-batch todo/&lt;code&gt;/&lt;CODE&gt;-PLAN-FX.md</Text>
        </Box>
      )
    }

    const current = sheet.steps.find(step => !isStepDone(step))
    const done = sheet.steps.filter(isStepDone).length
    const red = state.running.filter(one => one.kind === 'RED').length
    const green = state.running.filter(one => one.kind === 'GREEN').length

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Text wrap="truncate-end">
          <Text bold>Lot {sheet.lot}</Text>
          {sheet.name !== '' && <Text> — {sheet.name}</Text>}
        </Text>
        <Text wrap="truncate-end">
          <Text color={sheet.isDone ? 'green' : undefined} dimColor={!sheet.isDone}>
            {sheet.isDone ? 'terminé' : `${done}/${sheet.steps.length} étapes`}
          </Text>
          {state.wave > 0 && <Text dimColor> · vague {state.wave}</Text>}
          {red > 0 && <Text color="red"> · RED en cours : {red}</Text>}
          {green > 0 && <Text color="green"> · GREEN en cours : {green}</Text>}
          {sheet.hypotheses > 0 && <Text dimColor> · {sheet.hypotheses} hypothèse(s)</Text>}
        </Text>
        {state.error !== null && <Text color="red">{state.error}</Text>}
        {sheet.steps.map(step => {
          const isDone = isStepDone(step)
          const isCurrent = step === current
          return (
            <Box key={`step-${step.number}`} flexDirection="column">
              <Text wrap="truncate-end" color={isDone ? 'green' : isCurrent ? 'yellow' : undefined} bold={isCurrent}>
                {isCurrent ? '▸ ' : '  '}
                {step.number}. {step.tdd === null ? (isDone ? DONE : '·') : phaseLabel(step.tdd)} {step.title}
              </Text>
              {step.corrections.map(one => (
                <Text
                  key={`correction-${step.number}-${one.id}`}
                  wrap="truncate-end"
                  color={isPhaseDone(one.tdd) ? 'green' : 'yellow'}
                >
                  {'    '}
                  {one.id} {phaseLabel(one.tdd)} {one.finding}
                </Text>
              ))}
            </Box>
          )
        })}
        {state.blocked.map((one, index) => (
          <Text key={`blocked-${index}`} color="red" wrap="truncate-end">
            BLOQUÉ ({one.kind}) {one.description}
          </Text>
        ))}
        <Text dimColor wrap="truncate-end">
          {state.path}
        </Text>
      </Box>
    )
  })
}
