import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentKind, Awaited, Batch, Correction, Gate, Phase, Sheet, Step, Verdict } from '../types'

const TICK_MS = 10_000
const TODO = 'todo'
const DONE = '✅'
const BLOCKED_LITERALS = ['## BLOQUÉ', '## BLOCKED']
const SHEET_PATTERN = /-PLAN-(F\d+)\.md$/
const AGENT_KINDS: Record<string, 'RED' | 'GREEN'> = {
  'tdd-test-author': 'RED',
  'tdd-implementer': 'GREEN',
}
const TDD_SKILL = 'implement-tdd'
const AUDIT_SKILL = 'verify-ddd-tdd'
// `cctoolkit pre-audit` since the plugin, `scripts/pre-audit.sh` before it.
const GATE_SCRIPT = 'pre-audit'
// Skills, agents and commands of the cctoolkit plugin arrive namespaced.
const bare = (name: unknown): string => (typeof name === 'string' ? name.replace(/^cctoolkit:/, '') : '')
const TYPICAL_MS: Record<AgentKind, number> = { RED: 224_000, GREEN: 187_000, AUDIT: 309_000 }
const SLOW_FACTOR = 2

const EMPTY: Batch = {
  path: null,
  root: null,
  sheet: null,
  error: null,
  wave: 0,
  running: [],
  blocked: [],
  startedAt: null,
  gate: null,
  audit: { passes: 0, verdict: null },
}

const batch = atom({ plugin: 'tdd-batch', key: 'batch' } as const, EMPTY)
const now = atom({ plugin: 'tdd-batch', key: 'now' } as const, 0)
const isExpanded = atom({ plugin: 'tdd-batch', key: 'isExpanded' } as const, false)
const awaited = atom({ plugin: 'tdd-batch', key: 'awaited' } as const, null as Awaited | null)

const complete = (stored: Batch): Batch => ({ ...EMPTY, ...stored })

const fileOf = (state: Batch): string | null =>
  state.path === null || state.root === null || state.path.startsWith('/') ? state.path : `${state.root}/${state.path}`

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

    if (line.startsWith('✅ DONE')) {
      current.isDone = true
      continue
    }

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

  const isDone = title.includes('✅ DONE') || (steps.length > 0 && steps.every(isStepDone))
  return { lot, name, isDone, steps, hypotheses }
}

export const parseGate = (text: string): Gate | null => {
  const outcome = /PRE-AUDIT — (?:lot|batch) \S+ : (VERT|ROUGE|GREEN|RED)\b/.exec(text)?.[1]
  if (outcome === undefined) return null
  const failures = text.split(/\r?\n/).filter(line => /^\s*✗ /.test(line)).length
  return { isGreen: outcome === 'VERT' || outcome === 'GREEN', failures }
}

export const parseVerdict = (text: string): Verdict | null => {
  const outcome = /## Verdict — (VALIDE|VALID|ECARTS|DEVIATIONS)\b/.exec(text)?.[1]
  if (outcome === undefined) return null
  const rows = (severity: RegExp): number =>
    text.split(/\r?\n/).filter(line => severity.test(line)).length
  return {
    isValid: outcome === 'VALIDE' || outcome === 'VALID',
    blocking: rows(/^\|\s*(Bloquant|Blocking)\s*\|/),
    major: rows(/^\|\s*(Majeur|Major)\s*\|/),
  }
}

export const duration = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, '0')}`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

export const isSlow = (kind: AgentKind, ms: number): boolean => ms > TYPICAL_MS[kind] * SLOW_FACTOR

export const verdictLabel = (verdict: Verdict): string => {
  if (verdict.isValid) return 'VALID'
  const counts = [
    verdict.blocking > 0 ? `${verdict.blocking} blocking` : '',
    verdict.major > 0 ? `${verdict.major} major` : '',
  ].filter(one => one !== '')
  return counts.length === 0 ? 'DEVIATIONS' : `DEVIATIONS — ${counts.join(', ')}`
}

export const sheetFromArgs = (args: string): { path: string | null; lot: string | null } => {
  const lot = /\blot\s+(F\d+)\b/i.exec(args)?.[1]?.toUpperCase() ?? null
  const sheet = /(\S+-PLAN-F\d+\.md)\b/.exec(args)?.[1]
  if (sheet !== undefined) return { path: sheet, lot }
  const plan = /(\S+-PLAN\.md)\b/.exec(args)?.[1]
  if (plan !== undefined && lot !== null) return { path: plan.replace(/-PLAN\.md$/, `-PLAN-${lot}.md`), lot }
  return { path: null, lot }
}

let seen: { path: string; mtimeMs: number } | null = null

async function hasChanged($: EngineInterface, path: string): Promise<boolean> {
  try {
    const { mtimeMs } = await $.fs.stat(path)
    if (seen !== null && seen.path === path && seen.mtimeMs === mtimeMs) return false
    seen = { path, mtimeMs }
  } catch {
    seen = null
  }
  return true
}

async function refresh($: EngineInterface, isForced = true): Promise<void> {
  const current = complete(await read($, batch))
  const file = fileOf(current)
  if (current.path === null || file === null) return
  if (!(await $.fs.exists(file))) {
    await update($, batch, () => EMPTY)
    return
  }
  if (!isForced && !(await hasChanged($, file))) return
  let sheet: Sheet | null = null
  let error: string | null = null
  try {
    sheet = parseSheet(await $.fs.read(file), current.path)
  } catch {
    error = `unreadable sheet: ${current.path}`
  }
  if (JSON.stringify(sheet) === JSON.stringify(current.sheet) && error === current.error) return
  await update($, batch, stored => ({ ...complete(stored), sheet, error }))
}

async function follow($: EngineInterface, path: string): Promise<void> {
  const root = await $.session.cwd()
  const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  const at = await $.clock.now()
  await update($, awaited, () => null)
  await update($, batch, stored => {
    const current = complete(stored)
    return current.path === relative && current.root === root ? current : { ...EMPTY, path: relative, root, startedAt: at }
  })
  await refresh($)
}

async function followArgs($: EngineInterface, args: string): Promise<void> {
  const asked = sheetFromArgs(args)
  if (asked.path !== null) return follow($, asked.path)
  await update($, awaited, () => ({ lot: asked.lot }))
}

async function onSheetTouched($: EngineInterface, path: string): Promise<void> {
  const found = SHEET_PATTERN.exec(path)
  const pending = await read($, awaited)
  if (found !== null && pending !== null && path.includes(`${TODO}/`) && (pending.lot === null || pending.lot === found[1])) {
    return follow($, path)
  }
  if (path === fileOf(complete(await read($, batch)))) await refresh($)
}

async function trackAgent($: EngineInterface, id: string, kind: AgentKind, description: string): Promise<void> {
  const at = await $.clock.now()
  await update($, batch, stored => {
    const current = complete(stored)
    const opensWave = kind === 'RED' && !current.running.some(one => one.kind === 'RED')
    return {
      ...current,
      wave: opensWave ? current.wave + 1 : current.wave,
      running: [...current.running, { id, kind, description, startedAt: at }],
      audit: kind === 'AUDIT' ? { ...current.audit, passes: current.audit.passes + 1 } : current.audit,
    }
  })
}

async function recordGate($: EngineInterface, gate: Gate): Promise<void> {
  await update($, batch, stored => ({ ...complete(stored), gate }))
}

async function recordVerdict($: EngineInterface, verdict: Verdict): Promise<void> {
  await update($, batch, stored => {
    const current = complete(stored)
    return { ...current, audit: { ...current.audit, verdict } }
  })
}

const tick = async ($: EngineInterface): Promise<void> => {
  const at = await $.clock.now()
  await update($, now, () => at)
  await refresh($, false)
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

const mark = (value: string): string => (value === '' ? '?' : value)

export const phaseLabel = (tdd: Phase | null): string =>
  tdd === null ? '—' : `RED ${mark(tdd.red)} · GREEN ${mark(tdd.green)} · COUT ${mark(tdd.cost)}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tdd-batch',
      description: '/implement-tdd batch progress band, shown once /implement-tdd runs in this session (off hides it)',
    })
    await $.ui.close({ id: 'tdd-batch' }).catch(() => undefined)
    $.clock.every(TICK_MS, () => void tick($))
    await tick($)

    return next(e)
  })

  on('command.run', { command: 'tdd-batch' }, async ($, e) => {
    if (e.args.trim() === 'off') {
      await update($, batch, () => EMPTY)
      await update($, awaited, () => null)
      return { text: 'Band hidden.' }
    }
    const path = complete(await read($, batch)).path
    return { text: path === null ? 'No batch followed: run /implement-tdd first.' : `Band following ${path}.` }
  })

  on('command.run', async ($, e, next) => {
    if (bare(e.command) !== TDD_SKILL) return next(e)
    await followArgs($, e.args)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const input = e as unknown as Record<string, unknown>

    if (e.tool === 'Skill' && bare(input.skill) === TDD_SKILL) {
      await followArgs($, typeof input.args === 'string' ? input.args : '')
      return next(e)
    }

    if (e.tool === 'Skill' && bare(input.skill) === AUDIT_SKILL) {
      const id = e.tool_use_id ?? `AUDIT-${await $.clock.now()}`
      const reprise = typeof input.args === 'string' && /\breprise\b/i.test(input.args)
      await trackAgent($, id, 'AUDIT', reprise ? 'audit (reprise)' : 'audit')
      const result = await next(e)
      const text = typeof result.deny === 'string' ? result.deny : (result.text ?? '')
      await settleAgent($, id, false)
      const verdict = parseVerdict(text)
      if (verdict !== null) await recordVerdict($, verdict)
      return result
    }

    if (e.tool === 'Agent') {
      const kind = AGENT_KINDS[bare(input.subagent_type)]
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
    if (e.tool === 'Bash' && typeof input.command === 'string' && input.command.includes(GATE_SCRIPT)) {
      const gate = parseGate(typeof result.deny === 'string' ? '' : (result.text ?? ''))
      if (gate !== null) await recordGate($, gate)
    }
    if ((e.tool === 'Read' || e.tool === 'Write' || e.tool === 'Edit') && typeof input.file_path === 'string') {
      await onSheetTouched($, input.file_path)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = complete(await read($, batch))
    const sheet = state.sheet
    if (e.props.hasSurvey || state.path === null) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    if (sheet === null) {
      return (
        <Box flexDirection="column" width={e.props.bodyColumns} marginTop={1}>
          <Text color="red" wrap="truncate-end">{state.error ?? `reading sheet: ${state.path}`}</Text>
        </Box>
      )
    }

    const current = sheet.steps.find(step => !isStepDone(step))
    const done = sheet.steps.filter(isStepDone).length
    const at = await read($, now)
    const expanded = await read($, isExpanded)
    const { gate, audit } = state
    const showsAudit = gate !== null || audit.passes > 0
    const shown = expanded ? sheet.steps : sheet.steps.filter(step => step === current)

    return (
      <Box flexDirection="column" width={e.props.bodyColumns} marginTop={1}>
        <Box height={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text bold>Batch {sheet.lot}</Text>
              <Text color={sheet.isDone ? 'green' : undefined} dimColor={!sheet.isDone}>
                {' '}
                {sheet.isDone ? 'done' : `${done}/${sheet.steps.length} steps`}
              </Text>
              {state.startedAt !== null && at >= state.startedAt && (
                <Text dimColor> · {duration(at - state.startedAt)}</Text>
              )}
              {state.wave > 0 && <Text dimColor> · wave {state.wave}</Text>}
              {sheet.hypotheses > 0 && <Text dimColor> · {sheet.hypotheses} assumption(s)</Text>}
              {sheet.name !== '' && <Text dimColor> — {sheet.name}</Text>}
            </Text>
          </Box>
          <Button
            key="steps-toggle"
            label={expanded ? '[Collapse]' : `[All steps (${sheet.steps.length})]`}
            plain
            dimColor
            onPress={() => update($, isExpanded, value => !value)}
          />
        </Box>
        {state.running.map(run => {
          const elapsed = Math.max(0, at - run.startedAt)
          const slow = isSlow(run.kind, elapsed)
          return (
            <Text key={`run-${run.id}`} wrap="truncate-end" color={slow ? 'yellow' : undefined}>
              <Text color={run.kind === 'RED' ? 'red' : run.kind === 'GREEN' ? 'green' : 'cyan'}>{run.kind}</Text>
              <Text> {run.description} — {duration(elapsed)}</Text>
              {slow && <Text> (usual {duration(TYPICAL_MS[run.kind])})</Text>}
            </Text>
          )
        })}
        {showsAudit && (
          <Text wrap="truncate-end">
            <Text dimColor>Audit: </Text>
            {gate !== null && (
              <Text color={gate.isGreen ? 'green' : 'red'}>
                pre-audit {gate.isGreen ? 'GREEN' : `RED (${gate.failures} failed check(s))`}
              </Text>
            )}
            {audit.passes > 0 && gate !== null && <Text dimColor> · </Text>}
            {audit.passes > 0 && <Text dimColor>pass {audit.passes}</Text>}
            {audit.verdict !== null && (
              <Text color={audit.verdict.isValid ? 'green' : 'red'}> · {verdictLabel(audit.verdict)}</Text>
            )}
          </Text>
        )}
        {state.error !== null && <Text color="red">{state.error}</Text>}
        {shown.map(step => {
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
            BLOCKED ({one.kind}) {one.description}
          </Text>
        ))}
        {expanded && (
          <Text dimColor wrap="truncate-end">
            {state.path}
          </Text>
        )}
      </Box>
    )
  })
}
