import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { PlanLot, WorkflowAgent, WorkflowRun } from '../types'
import {
  answersOf, asidesOf, attemptLinesOf, auditRoundsOf, blankAgent, breakerOf, completeRun, contestLine, demoPlanRuns, entryIdOf, feedPathsOf, feedViewOf, feedWorkOf,
  graphNodesOf, graphTreeLines, isAttemptOf, keptSections, notesOf, openQuestionsOf, paneLinesOf, parsePlanLots, pendingQuestionsOf, planGraph, planGraphAlt,
  questionBanner, retryOf, roundLine, sentencesOf, svgHeight, svgWidth, toValidateOf, validateEntriesOf, withPaneLine, workLinesOf,
} from '../hooks/register'
import { BAND, paneAt, paneCommand, world, indented } from './world'

const lines = (...records: object[]) => workLinesOf(records.map(one => JSON.stringify(one)).join('\n'))
const NOW = 1_760_000_000_000
const S = NOW / 1000

const agentOf = (id: string, label: string, phase: string, startedAt: number, state: WorkflowAgent['state'] = 'done'): WorkflowAgent => ({
  ...blankAgent(id, startedAt, label, 'Sonnet', 'x', '', startedAt), phase, state, endedAt: state === 'running' ? null : startedAt + 1,
})

describe('run files', () => {
  test('pending question: count, countdown from its waitSeconds, gone on an answer at or after it or once over', () => {
    const asked = (id: string, at: number, extra: object = {}) => ({ kind: 'question', batch: 'F3', id, at, payload: { batch: 'F3', questions: [{ id: 'q1' }, { id: 'q2' }], ...extra } })
    const work = lines(asked('F3-1', S - 148, { waitSeconds: 600 }), { kind: 'answer', batch: 'F3', id: 'F3-0', at: S }, asked('F3-0', S - 10, { waitSeconds: 300 }))
    expect(openQuestionsOf(work)).toEqual([{ batch: 'F3', id: 'F3-1', count: 2, endsAt: (S - 148 + 600) * 1000 }])
    expect(questionBanner(openQuestionsOf(work), NOW)).toBe('? F3 — 2 questions — recommendation applied in 7:32')
    expect(questionBanner(openQuestionsOf(work), NOW + 452_000)).toBeNull()
    const early = lines(asked('F3-1', S), { kind: 'answer', id: 'F3-1', at: S - 5 })
    expect(pendingQuestionsOf(early, 'F3')).toEqual(['F3-1'])
    expect(questionBanner(openQuestionsOf(lines(asked('F4-1', S, { waitSeconds: 90, questions: [{ id: 'q1' }] }))), NOW)).toBe('? F3 — 1 question — recommendation applied in 1:30')
  })

  test('audit rounds: the last line of a round wins, open → after, contests with their answer, divergence', () => {
    const work = lines(
      { kind: 'audit-round', batch: 'F2', round: 1, open: 5, files: ['a', 'b', 'c', 'd'], contested: [], at: 1 },
      { kind: 'audit-round', batch: 'F2', round: 2, open: 2, files: ['a', 'b', 'c', 'd'], contested: [{ gap: 'Guard `duplicated`', harm: 'none' }], responses: [], at: 2 },
      { kind: 'audit-round', batch: 'F2', round: 1, open: 5, files: ['a', 'b', 'c', 'd'], contested: [], after: 2, at: 3 },
      { kind: 'audit-round', batch: 'F2', round: 2, open: 2, files: ['a', 'b', 'c', 'd'], contested: [{ gap: 'Guard `duplicated`', harm: 'none' }], responses: [{ gap: 'guard duplicated', answer: 'Accept', text: 'kept' }], after: 2, diverged: true, at: 4 },
      { kind: 'audit-round', batch: 'F3', round: 1, open: 9, files: [], contested: [], at: 5 },
    )
    const rounds = auditRoundsOf(work, 'F2')
    expect(rounds.map(roundLine)).toEqual(['R1 findings 5 → 2 · files 4', 'R2 findings 2 → 2 · files 4 · diverging, rounds stopped'])
    expect(contestLine(rounds[1]!.contested[0]!)).toBe('contested: Guard `duplicated` — harm: none → Accept: kept')
    expect(contestLine({ gap: 'g', harm: 'h', answer: null, text: null })).toBe('contested: g — harm: h → no response')
    expect(roundLine(auditRoundsOf(lines({ kind: 'audit-round', batch: 'F2', round: 1, open: 3, files: ['a'], contested: [] }), 'F2')[0]!)).toBe('R1 findings 3 · files 1')
  })

  test('retry reasons: an attempt line meets its agent by batch and step, cut behaviours and model suffix included', () => {
    expect(isAttemptOf('RED Refuse an archived catalog when publishing…', agentOf('r', 'RED X2 w1 Refuse an archived catalog when publ…', 'RED', 1))).toBe(true)
    expect(isAttemptOf('GREEN Refuse an archived catalog', agentOf('g', 'GREEN X2 Refuse an archived catalog opus', 'GREEN', 1))).toBe(true)
    expect(isAttemptOf('GREEN Refuse an archived catalog', agentOf('r', 'RED X2 w1 Refuse an archived catalog', 'RED', 1))).toBe(false)
    expect(isAttemptOf('Design', agentOf('d', 'design', 'Design', 1))).toBe(true)
    expect(isAttemptOf('Design', agentOf('x', 'declaratives', 'Design', 1))).toBe(false)
    expect(isAttemptOf('Declaratives', agentOf('x', 'declaratives', 'Design', 1))).toBe(true)
    expect(isAttemptOf('Global green', agentOf('s', 'suites', 'Global green', 1))).toBe(true)
    expect(isAttemptOf('Closing', agentOf('c', 'pre-audit', 'Closing', 1))).toBe(true)
    const work = lines(
      { kind: 'attempt', batch: 'F2', step: 'GREEN lock', n: 2, reason: 'RED on stub: NotImplementedException in A.ShouldX' },
      { kind: 'attempt', batch: 'F2', step: 'GREEN lock', n: 3, reason: 'GREEN agent without result' },
      { kind: 'attempt', batch: 'F3', step: 'GREEN lock', n: 2, reason: 'other batch' },
    )
    const attempts = attemptLinesOf(work, 'F2')
    const agents = [agentOf('g1', 'GREEN X3 lock', 'GREEN', 1, 'error'), agentOf('i', 'GREEN X3 lock', 'GREEN', 2, 'interrupted'), agentOf('g2', 'GREEN X3 lock', 'GREEN', 3), agentOf('g3', 'GREEN X3 lock opus', 'GREEN', 4)]
    expect(agents.map(agent => retryOf(agents, agent, attempts))).toEqual([
      null, null,
      { attempt: 2, reasons: ['RED on stub: NotImplementedException in A.ShouldX'] },
      { attempt: 3, reasons: ['RED on stub: NotImplementedException in A.ShouldX', 'GREEN agent without result'] },
    ])
    expect(retryOf(agents, agents[2]!, [])).toBeNull()
  })

  test('breaker stop and batches set aside, from the breaker and journal lines', () => {
    const work = lines(
      { kind: 'journal', run: '2026-10-10-0912', text: 'F3 ✗ — set aside — audit Blocking not lifted — patch run/2026-10-10-0912-aside-F3.patch' },
      { kind: 'breaker', run: '2026-10-10-0912', asides: ['F3', 'F5'], decision: 'continue', cause: '' },
      { kind: 'breaker', run: '2026-10-10-0912', asides: ['F3', 'F5'], decision: 'stop', cause: 'the spec leaves the lock owner open' },
    )
    expect(breakerOf(work)).toEqual({ asides: ['F3', 'F5'], cause: 'the spec leaves the lock owner open' })
    expect(breakerOf(lines({ kind: 'breaker', asides: ['F3'], decision: 'continue' }))).toBeNull()
    expect(asidesOf(work)).toEqual({ F3: { reason: 'audit Blocking not lifted', patch: 'run/2026-10-10-0912-aside-F3.patch' }, F5: { reason: '', patch: null } })
  })

  test('pane file: notes pending or taken, the last answer of an entry and its application', () => {
    const pane = (...records: object[]) => paneLinesOf(records.map(one => JSON.stringify(one)).join('\n') + '\nnot json\n')
    const notes = notesOf(pane({ kind: 'note', id: 'n-1', batch: 'F2', text: 'a', at: 1 }, { kind: 'note', id: 'n-2', batch: 'F3', text: 'b', at: 2 }), lines({ kind: 'ack', batch: 'F2', ref: 'n-1', what: 'note-taken', at: 3 }))
    expect(notes.map(one => [one.id, one.isTaken])).toEqual([['n-1', true], ['n-2', false]])
    const answers = answersOf(
      pane(
        { kind: 'validation', id: 'v-1', entry: { batch: 'F2', step: 'Design', text: 't' }, decision: 'reject', text: 'no', at: 10 },
        { kind: 'validation', id: 'v-1', entry: { batch: 'F2', step: 'Design', text: 't' }, decision: 'amend', text: 'this way', at: 20 },
        { kind: 'validation', id: 'v-2', entry: { batch: 'F2', step: 'Audit', text: 'u' }, decision: 'keep', text: '', at: 10 },
        { kind: 'validation', id: 'v-3', decision: 'later', at: 10 },
      ),
      lines({ kind: 'ack', ref: 'v-1', what: 'applied', relaunch: '/run-lot x', at: 15 }, { kind: 'ack', ref: 'v-2', what: 'applied', relaunch: '/run-plan p', hn: 'H4', at: 10 }),
    )
    expect(answers).toEqual({
      'v-1': { decision: 'amend', text: 'this way', at: 20, applied: null },
      'v-2': { decision: 'keep', text: '', at: 10, applied: { relaunch: '/run-plan p' } },
    })
    expect(withPaneLine('', { kind: 'note', id: 'n-1', at: 1 })).toBe('{"kind":"note","id":"n-1","at":1}\n')
    expect(withPaneLine('{"a":1}\n\n', { b: 2 })).toBe('{"a":1}\n{"b":2}\n')
  })

  test('to validate: batch report bullets, run report bullets prefixed by their batch, stable ids', () => {
    const report = '## STATUS — DONE\n\n## To validate\n\n- Design — lock on the catalog (no rule names the owner)\n- Assumptions — H1: `ArchivedAt` from `TimeProvider` (tech lead)\n\n## Audit gaps\n\n- not an entry\n'
    const entries = toValidateOf(report, 'F2', batch => `todo/cat/CAT-PLAN-${batch}.md`)
    expect(entries.map(one => [one.batch, one.step, one.text, one.why, one.sheet])).toEqual([
      ['F2', 'Design', 'lock on the catalog', 'no rule names the owner', 'todo/cat/CAT-PLAN-F2.md'],
      ['F2', 'Assumptions', 'H1: `ArchivedAt` from `TimeProvider`', 'tech lead', 'todo/cat/CAT-PLAN-F2.md'],
    ])
    expect(entries[0]?.id).toBe(entryIdOf('F2', 'Design', 'lock on the catalog'))
    expect(entries[0]?.id).toMatch(/^v-[0-9a-f]{8}$/)
    expect(toValidateOf('## To validate\n\nNone.\n', 'F2')).toEqual([])
    const run = '## To validate\n\n### Stop\n\n- common cause across F3, F5: lock owner\n\n### Batches set aside\n\n- F3 — Set aside — audit Blocking — patch run/x.patch\n- F5: design blocked\n\n### Audit gaps carried\n\nNone.\n'
    expect(toValidateOf(run, null).map(one => [one.batch, one.step, one.text, one.section])).toEqual([
      ['', 'Stop', 'common cause across F3, F5: lock owner', 'Stop'],
      ['F3', 'Set aside', 'audit Blocking — patch run/x.patch', 'Batches set aside'],
      ['F5', 'Batches set aside', 'design blocked', 'Batches set aside'],
    ])
    expect(keptSections('# R\n\n## Plan stopped — common cause\n\ncause\n\n## To validate\n\n- F3 — x\n\n## Other\n\ny\n')).toBe('## To validate\n\n- F3 — x\n\n\n## Plan stopped — common cause\n\ncause\n')
    expect(keptSections('# R\n\n## To validate\n\n- a — b\n\n## Audit gaps\n\n- c\n')).toBe('## To validate\n\n- a — b\n')
  })

  test('to validate: an entry cut into its sentences, a code span never cut', () => {
    expect(sentencesOf('Relancer le GREEN de C2. Le blocage vient de C4 (`Fixture.cs:77`). Ensuite, relancer `dotnet test --filter "A. B"`.')).toEqual([
      'Relancer le GREEN de C2.',
      'Le blocage vient de C4 (`Fixture.cs:77`).',
      'Ensuite, relancer `dotnet test --filter "A. B"`.',
    ])
    expect(sentencesOf('one sentence, no cut: e.g. this')).toEqual(['one sentence, no cut: e.g. this'])
  })

  test('to validate: the French alias `## À valider` read like the English heading, kept, `Aucune.` empty', () => {
    const report = '## STATUT — TERMINÉ\n\n## À valider\n\n- Design — verrou sur le catalogue (aucune règle ne nomme le propriétaire)\n\n## Écarts d’audit\n\n- pas une entrée\n'
    expect(toValidateOf(report, 'F2').map(one => [one.batch, one.step, one.text, one.why])).toEqual([
      ['F2', 'Design', 'verrou sur le catalogue', 'aucune règle ne nomme le propriétaire'],
    ])
    expect(toValidateOf('## A\u0300 valider\n\n- Design — d\n', 'F2').map(one => one.text)).toEqual(['d'])
    expect(toValidateOf('## À valider\n\nAucune.\n', 'F2')).toEqual([])
    expect(keptSections('# R\n\n## À valider\n\n- F3 — x\n\n## Autre\n\ny\n')).toBe('## À valider\n\n- F3 — x\n')
    const feed = { runId: 'r', root: 'todo/cat/run', work: '', pane: '', reports: { 'todo/cat/run/batches/F2.md': '## À valider\n\n- Design — d\n' } }
    expect(validateEntriesOf(feed, () => null, ['F2']).map(one => [one.batch, one.step, one.text])).toEqual([['F2', 'Design', 'd']])
  })

  test('entries: the reports first, then a divergence, a batch set aside and the breaker stop the reports do not say yet, then the notes taken', () => {
    const feed = {
      runId: 'r', root: 'todo/cat/run', reports: { 'todo/cat/run/batches/F2.md': '## To validate\n\n- Design — d\n' },
      work: [
        { kind: 'audit-round', batch: 'F2', round: 2, open: 2, files: ['a'], contested: [], after: 2, diverged: true },
        { kind: 'journal', run: 's', text: 'F3 ✗ — set aside — design blocked — patch run/s-aside-F3.patch' },
        { kind: 'breaker', run: 's', asides: ['F3', 'F5'], decision: 'stop', cause: 'lock owner open' },
        { kind: 'ack', ref: 'n-1', what: 'note-taken', at: 2 },
      ].map(one => JSON.stringify(one)).join('\n'),
      pane: JSON.stringify({ kind: 'note', id: 'n-1', batch: 'F2', text: 'keep it small', at: 1 }),
    }
    const entries = validateEntriesOf(feed, batch => `todo/cat/CAT-PLAN-${batch}.md`, ['F2', 'F3'])
    expect(entries.map(one => [one.batch, one.step, one.text])).toEqual([
      ['F2', 'Design', 'd'],
      ['F2', 'Audit', 'round 2 diverging: findings 2 → 2, files 1 — rounds stopped'],
      ['F3', 'Set aside', 'design blocked — patch run/s-aside-F3.patch'],
      ['F5', 'Plan stopped', 'common cause across F3, F5: lock owner open'],
      ['F2', 'Note', 'keep it small'],
    ])
    const said = { ...feed, reports: { ...feed.reports, 'todo/cat/run/batches/F3.md': '## To validate\n\n- Audit — audit rounds stopped, diverging: x\n- Set aside — design blocked\n', 'todo/cat/run/s.md': '## To validate\n\n### Stop\n\n- common cause across F3, F5: lock owner open\n' } }
    expect(validateEntriesOf({ ...said, reports: { ...said.reports, 'todo/cat/run/batches/F2.md': '## To validate\n\n- Audit — audit rounds stopped, diverging: y\n' } }, () => null, ['F2', 'F3']).map(one => one.step)).toEqual(['Audit', 'Audit', 'Set aside', 'Stop', 'Note'])
    expect(validateEntriesOf(null, () => null, [])).toEqual([])
  })

  test('feed: the work lines the views read, the reports of the batches and of the run', () => {
    expect(feedWorkOf(['{"kind":"cycle","slug":"a"}', '{"kind":"question","id":"q"}', 'oops', '{"kind":"ack","ref":"n-1"}'].join('\n'))).toBe('{"kind":"question","id":"q"}\n{"kind":"ack","ref":"n-1"}')
    const lot = (id: string): PlanLot => ({ lot: id, sheet: null, deps: [], isDone: false, outcome: null, audit: null, view: null })
    const plan = completeRun({ runId: 'r', name: 'run-plan', startedAt: 0, child: { name: 'run-lot', phases: [], details: {}, labels: {} }, plan: 'todo/cat/CAT-PLAN.md', lots: [lot('F1')] } as unknown as WorkflowRun)
    expect(feedPathsOf(plan, 'todo/cat/run', lines({ kind: 'journal', run: '2026-10-10-0912', text: 'x' }))).toEqual([
      'todo/cat/run/batches/F1.md', 'todo/cat/run/2026-10-10-0912.md',
    ])
    const lotRunOnly = completeRun({ runId: 'r', name: 'run-lot', startedAt: 0, argument: 'todo/cat/CAT-PLAN-F2.md' } as WorkflowRun)
    expect(feedPathsOf(lotRunOnly, 'todo/cat/run', [])[0]).toBe('todo/cat/run/batches/F2.md')
  })

  test('plan table: batch titles read from their headings', () => {
    const plan = '### Batch execution\n\n| Batch | Depends on |\n|---|---|\n| F1 | — |\n| F2 | F1 |\n| F3 | F1 |\n\n### Batch F1 — Archive a product — ✅ DONE (2026-10-09)\n\n### Batch F2 — Restore a product — ⬜\n\n### Lot F3 — Purge ⬜\n'
    expect(parsePlanLots(plan).map(one => [one.lot, one.title, one.isDone])).toEqual([['F1', 'Archive a product', true], ['F2', 'Restore a product', false], ['F3', 'Purge', false]])
  })
})

describe('plan graph', () => {
  const AT = 1_000_000_000
  test('states, dependencies and hover of the demo plan: a batch set aside holds back its dependents', () => {
    const run = demoPlanRuns(AT)[0]!
    const view = feedViewOf({ runId: run.runId, root: 'r', reports: {}, pane: '', work: JSON.stringify({ kind: 'journal', run: 's', text: 'F5 ✗ — set aside — design blocked — patch run/p.patch' }) })
    const nodes = graphNodesOf(run, view, AT)
    expect(nodes.map(node => [node.lot, node.state, node.layer, node.deps])).toEqual([
      ['F1', 'done', 0, []], ['F2', 'running', 1, ['F1']], ['F3', 'waiting', 1, ['F1']], ['F4', 'waiting', 2, ['F2', 'F3']], ['F5', 'aside', 1, ['F1']], ['F6', 'blocked', 2, ['F5']],
    ])
    const hover = (lot: string) => nodes.find(node => node.lot === lot)?.hover ?? []
    expect(hover('F4')[1]).toBe('waiting on F2 (running), F3 (waiting)')
    expect(hover('F6')[1]).toBe('blocked: F5 set aside — design blocked')
    expect(hover('F1')).toEqual(['F1 · Create a product', expect.stringMatching(/^DONE/), expect.stringMatching(/^\d+m\d{2} · \d+(\.\d)?[kM]? tok$/)])
    const svg = planGraph(nodes)
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/)
    expect(svgWidth(svg)).toBeGreaterThan(0)
    expect(svgHeight(svg)).toBeGreaterThan(0)
    expect(svg).toMatch(/<g class="edge-of-F5-F6"><title>F5 → F6 · held back: F5 set aside<\/title><path class="edge cut"[^>]*stroke-dasharray="4 3"/)
    expect(svg).toMatch(/<g class="edge-of-F1-F2"><title>F1 → F2<\/title><path class="edge" d=/)
    expect(svg).toContain('<title>F6 · Export schedule&#10;blocked: F5 set aside — design blocked</title>')
    expect(planGraphAlt(nodes)).toBe('Batch graph: F1 done; F2 running after F1; F3 waiting after F1; F4 waiting after F2, F3; F5 set aside after F1; F6 blocked after F5.')
    expect(graphTreeLines(nodes).map(one => `${one.prefix}${one.text.split(' · ')[0]}`)).toEqual([
      '✓ F1 Create a product', '├─ ● F2 Archive a product', '│  └─ ○ F4 Product history', '├─ ○ F3 Restore a product', '└─ ✗ F5 Export the products', '   └─ ⊘ F6 Export schedule',
    ])
    expect(graphTreeLines(nodes)[2]?.text).toMatch(/ · also after F3$/)
    expect(planGraph([])).toBe('')
  })
})

// The engine's world at NOW, plus the Workflow launch.
const planWorld = (on: On, files: Record<string, string>, writes: string[] = []) => {
  const made = world(on, files, { now: NOW, writes })
  on('tool.call', ($, e) =>
    e.tool === 'Workflow'
      ? { result: { status: 'async_launched', taskId: 't1', runId: 'wf_1', workflowName: (e as { name?: string }).name ?? 'run-lot', transcriptDir: '/h/.claude/projects/p/s1/subagents/workflows/wf_1', scriptPath: '/h/script.js' }, text: 'launched' }
      : { result: { type: 'text' }, text: 'ok' },
  )
  return made
}

const PANE = paneAt(72, 60)

type Found = { find: (query: { type: string; text: RegExp }) => Promise<{ props: Record<string, unknown> } | undefined> }

// A line the terminal wraps hangs in a box: its indent is the box's padding, its text starts where the line does.
const hung = async (ui: Found, text: RegExp) => (await ui.find({ type: 'Box', text }))?.props.paddingLeft
test('demo: the pending question above the prompt and on every view, ticking; retry reasons; notes', async ($, on) => {
  const { clock } = planWorld(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await paneCommand($, 'demo')
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'run-lot-pane', surface, ...BAND })
    expect((await band.find({ key: 'question-banner' }))?.text).toBe('? F4 — 2 questions — recommendation applied in 7:32')
    expect(await band.find({ key: 'toggle-run-lot-pane' })).toEqual(surface === 'desktop' ? expect.anything() : undefined)
    await band.unmount()
    const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: indented(surface, /^ {2}\? F4 — 2 questions — recommendation applied in 7:32$/) })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↻ attempt 1 rejected: tests modified at GREEN: tests\/Acme/ })).toBeDefined()
    if (surface === 'desktop') {
      expect(await ui.find({ type: 'Text', text: /✓ F4 · an archived catalog is read-only · consumed/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /✎ F4 · keep the lock check in the aggregate, not the handler · pending/ })).toBeDefined()
    } else {
      // A note's tone goes to its glyph: the batch and its state dim, its text in the text colour.
      expect(await ui.find({ type: 'Text', text: /^ {2}✓ F4 {2}an archived catalog is read-only · consumed$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^ {2}✎ F4 {2}keep the lock check in the aggregate, not the handler · pending$/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^✎ $/ }))?.props.color).toBe('warning')
      expect((await ui.find({ type: 'Text', text: /^keep the lock check in the aggregate, not the handler$/ }))?.props.color).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /^ {2}Notes · 2 ─+$/ }))?.text).toHaveLength(72)
    }
    await ui.unmount()
  }
  await clock.advance(2_000)
  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /recommendation applied in 7:30$/ })).toBeDefined()
  expect(await ui.find({ key: 'open-graph' })).toBeUndefined()
  await ui.press({ key: 'open-demo-g2b' })
  expect(await ui.find({ type: 'Text', text: /^Retries · ↻ 2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}\? F4 — 2 questions/ })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'note' })
  await ui.input({ key: 'note-input', text: 'the lock is on the catalog' })
  expect(await ui.find({ type: 'Text', text: /✎ F4 {2}the lock is on the catalog · pending/ })).toBeDefined()
  expect(await ui.find({ key: 'note-input' })).toBeUndefined()
  await clock.advance(452_000)
  expect(await ui.find({ key: 'question-banner' })).toBeUndefined()
  await ui.unmount()
})

test('demo end: audit rounds under the Audit phase, to validate in each state, answers written to the pane file', async ($, on) => {
  planWorld(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await paneCommand($, 'demo end')
  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  // A round at the agents' level, its contests one level in, each answer on its own line beneath.
  expect(await ui.find({ type: 'Text', text: /^ {4}R1 findings 3 → 2 · files 4$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}R2 findings 2 → 2 · files 5 · diverging, rounds stopped$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^ · diverging, rounds stopped$/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /^R2 findings 2 → 2 · files 5$/ }))?.props.color).toBe('inactive')
  expect(await ui.find({ type: 'Text', text: /^ {6}↳ contested: duplicated guard in the aggregate — harm: none, the guard runs once per command$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {8}→ Accept: trade-off kept, the guard stays in the aggregate$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {6}↳ contested: organization lock not checked before deletion — harm: / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {8}→ Escalate: / })).toBeDefined()
  expect(await ui.find({ key: 'question-banner' })).toBeUndefined()
  expect((await ui.find({ key: 'open-validate' }))?.text).toBe('to validate 4')
  await ui.press({ key: 'phase-Audit' })
  expect(await ui.find({ type: 'Text', text: /^Rounds · 2$/ })).toBeDefined()
  await ui.press({ key: 'back' })

  await ui.press({ key: 'open-validate' })
  expect(await ui.find({ type: 'Text', text: /cctoolkit run-validate apply \/repo\/todo\/catalog-lifecycle\/run\/\.work\.jsonl$/ })).toBeDefined()
  expect(await hung(ui, /^✓ kept · applied$/)).toBe(4)
  expect(await hung(ui, /^✓ amended: write the test, the guard stays · applied$/)).toBe(4)
  expect(await hung(ui, /^ {2}relaunch: \/run-lot todo\/catalog-lifecycle\/CAT-LIFECYCLE-PLAN-F4\.md$/)).toBe(2)
  expect(await hung(ui, /^● rejected: lock on first sale, the spec is wrong here · answered, not applied yet$/)).toBe(4)
  expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('warning')
  expect((await ui.findAll({ type: 'Box', text: /^○ pending answer$/ })).map(one => one.props.paddingLeft)).toEqual([4, 4, 4, 4])
  expect(await hung(ui, /^an archived catalog is read-only$/)).toBe(4)

  const entry = toValidateOf('## To validate\n\n- Assumptions — H2: archived items keep their audit trail (tech lead)\n', 'F4')[0]!
  await ui.press({ key: `keep-${entry.id}` })
  expect((await ui.findAll({ type: 'Box', text: /^○ pending answer$/ })).length).toBe(3)
  expect(await ui.find({ key: `keep-${entry.id}` })).toBeDefined()
  const design = { id: (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').find(key => key.startsWith('amend-'))!.slice('amend-'.length) }
  await ui.press({ key: `amend-${design.id}` })
  await ui.input({ key: `answer-${design.id}`, text: '  the lock is per product  ' })
  expect(await hung(ui, /^● amended: the lock is per product · answered, not applied yet$/)).toBe(4)
  expect(await ui.find({ key: `answer-${design.id}` })).toBeUndefined()
  await ui.press({ key: 'back' })
  expect((await ui.find({ key: 'open-validate' }))?.text).toBe('to validate 3')
  await ui.unmount()

  const desktop = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'desktop', ...PANE })
  await desktop.press({ key: 'open-validate' })
  expect((await desktop.find({ key: `reject-${design.id}` }))?.props.label).toBe('✗ reject')
  // A card per entry under its caption; the buttons alone tell an answer is pending.
  expect(await desktop.find({ type: 'Text', text: /^F4 · Assumptions$/ })).toBeDefined()
  expect(await desktop.findAll({ type: 'Text', text: /pending answer/ })).toEqual([])
  // A short reason shows open under its `Why`, a press folds it.
  expect((await desktop.find({ key: `entry-why-text-${entry.id}` }))?.props.text).toBe('tech lead')
  await desktop.press({ key: `why-${entry.id}` })
  expect(await desktop.find({ key: `entry-why-text-${entry.id}` })).toBeUndefined()
  await desktop.unmount()
})

test('tests view: every planned test by cycle with its state, regrouped by rule; the plan at its end', async ($, on) => {
  planWorld(on, {})
  const copies: string[] = []
  on('ui.copy', ($, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await paneCommand($, 'demo')
  let ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...paneAt(100) })
  expect((await ui.find({ key: 'open-tests' }))?.text).toBe('tests 3/7')
  await ui.press({ key: 'open-tests' })
  expect(await ui.find({ type: 'Text', text: /› tests$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}8 tests · 3 green · 2 red · 2 to write · 1 unreachable$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^F4 · Product lifecycle · 3\/7 green/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}✓ X1 Create the product$/ })).toBeDefined()
  const written = await ui.find({ type: 'Text', text: /^ {4}✓ Product created in an active catalog$/ })
  expect((written?.children[1] as { props?: { color?: string } } | undefined)?.props?.color).toBe('success')
  expect(await ui.find({ type: 'Text', text: /^ {4}⚠ Refuse when catalog archived$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}● Locked product not published$/ })).toBeDefined()
  // Not written yet: the method read as words, dimmed.
  const planned = await ui.find({ type: 'Text', text: /^ {4}○ Should delete product item when product item removed event is saved$/ })
  expect((planned?.children[2] as { props?: { dimColor?: boolean } } | undefined)?.props?.dimColor).toBe(true)
  // One line per test at rest: the method, the rules and the observation wait under the pointer, each under its label.
  const row = await ui.find({ key: 'tests-F4-X1-0-hover' })
  expect(row?.children).toHaveLength(2)
  expect((row?.children[1] as { props?: object }).props).toMatchObject({ display: 'none' })
  for (const [label, text] of [
    ['test', 'CreateProductTests.ShouldSaveProductCreatedEvent_WhenCatalogIsActive'],
    ['rules', 'CAT-RM-001 · CAT-CU-01'],
    ['level', 'UT · CreateProductTests'],
    ['observes', 'the stored product no longer holds the item'],
    ['note', 'unreachable, not written'],
  ]) {
    expect(await ui.find({ type: 'Text', text: label })).toBeDefined()
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  expect((await ui.find({ key: 'tests-F4-X1-0-hover-copy-test' }))?.props.plain).toBeUndefined()
  // A cut behaviour shows whole there too.
  const whole = /^Catalog of another organisation hidden$/
  expect(await ui.findAll({ type: 'Text', text: whole })).toHaveLength(1)
  await ui.unmount()
  const narrow = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...paneAt(40) })
  expect(await narrow.findAll({ type: 'Text', text: whole })).toHaveLength(2)
  await narrow.unmount()
  ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...paneAt(100) })
  await ui.press({ key: 'tests-F4-X1-0-hover-copy-test' })
  await ui.press({ key: 'tests-F4-X1-0-hover-copy-case' })
  await ui.press({ key: 'tests-F4-X1-hover-copy-behaviour' })
  expect(copies).toEqual(['CreateProductTests.ShouldSaveProductCreatedEvent_WhenCatalogIsActive', 'Product created in an active catalog', 'Create the product'])

  await ui.press({ key: 'tests-group' })
  expect(await ui.find({ type: 'Text', text: /^CAT-RM-003 · 0\/2 green/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'X3' })).toBeDefined()
  expect((await ui.find({ key: 'tests-group' }))?.text).toBe('by batch')
  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'open-tests' })).toBeDefined()

  await paneCommand($, 'demo plan merge')
  await ui.press({ key: 'open-tests' })
  expect(await ui.find({ type: 'Text', text: /^ {2}9 tests · 9 green · 0 red · 0 to write$/ })).toBeDefined()
  // Still grouped by rule: on the plan, each test names its batch beside its cycle.
  expect(await ui.find({ type: 'Text', text: 'F2 C2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^CAT-RM-003 · 6\/6 green/ })).toBeDefined()
  await ui.press({ key: 'tests-group' })
  expect(await ui.find({ type: 'Text', text: /^F1 · Archive a product · 6\/6 green/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^F2 · Restore a product · 3\/3 green/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}✓ Other organisation hidden$/ })).toBeDefined()
})

test('demo plan: graph as a tree on the terminal and an SVG on the desktop, entries of every batch; plan end', async ($, on) => {
  planWorld(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await paneCommand($, 'demo plan')
  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^ {2}✓ F1 {2}reuse the archived flag of the catalog · consumed$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}✎ F2 {2}the archived filter stays off by default · pending$/ })).toBeDefined()

  await ui.press({ key: 'note' })
  expect((await ui.find({ key: 'note-input' }))?.props.label).toBe('note for F2: ')
  await ui.input({ key: 'note-input', text: 'F3: restore keeps the archive date' })
  expect(await ui.find({ type: 'Text', text: /✎ F3 {2}restore keeps the archive date · pending/ })).toBeDefined()

  await ui.press({ key: 'open-graph' })
  expect(await ui.find({ type: 'Text', text: /^⊘ F6 Export schedule · blocked: F5 set aside — design blocked: no defensible export format/ })).toBeDefined()
  // A node's tone goes to its glyph; a batch waiting to start reads dim.
  const node = await ui.find({ type: 'Text', text: /^✗ F5 Export the products/ })
  expect((node?.children[0] as { props?: { color?: string } } | undefined)?.props?.color).toBe('error')
  expect((node?.children[1] as { props?: { color?: string } } | undefined)?.props?.color).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^F3 Restore a product · waiting to start$/ }))?.props).toMatchObject({ color: 'inactive', dimColor: true })
  expect(await ui.find({ type: 'Text', text: /^○ F4 Product history · waiting on F2 \(running\), F3 \(waiting\)/ })).toBeDefined()
  await ui.press({ key: 'back' })

  await ui.press({ key: 'open-validate' })
  expect(await hung(ui, /^✓ kept · applied$/)).toBe(4)
  expect(await hung(ui, /^export format undecided: CSV or the catalog JSON feed \(no rule names one/)).toBe(4)
  expect(await hung(ui, /^design blocked: no defensible export format, CSV or the catalog JSON feed — patch run\/2026-10-10-0912-aside-F5\.patch$/)).toBe(4)
  expect(await hung(ui, /^reuse the archived flag of the catalog$/)).toBe(4)
  await ui.press({ key: 'open-lot-F2' })
  expect(await ui.find({ key: 'open-graph' })).toBeUndefined()
  await ui.unmount()

  const desktop = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'desktop', ...PANE })
  await desktop.press({ key: 'plan' })
  await desktop.press({ key: 'open-graph' })
  const svg = await desktop.find({ type: 'Svg' })
  expect(svg?.props.isInteractive).toBe(true)
  expect(String(svg?.props.source)).toContain('class="edge cut"')
  expect(svg?.props.width).toBe(svgWidth(String(svg?.props.source)))
  expect(svg?.props.height).toBe(svgHeight(String(svg?.props.source)))
  expect(svg?.props.alt).toMatch(/^Batch graph: F1 done; F2 running after F1;/)
  await desktop.unmount()

  await paneCommand($, 'demo plan end')
  const end = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  await end.press({ key: 'open-validate' })
  expect(await hung(end, /^restoring keeps the archive date in the history \(the audit trail is never rewritten\)$/)).toBe(4)
  expect(await hung(end, /^archiving twice answers 409, not 204 \(the spec says refused, not ignored\)$/)).toBe(4)
  await end.unmount()
})

const RUN_PLAN = `# CAT-PLAN

### Batch execution

| Batch | Intent | Depends on |
|---|---|---|
| F1 | a | — |
| F2 | b | F1 |
| F3 | c | F1 |

### Batch F1 — Archive — ⬜

### Batch F2 — Restore — ⬜

### Batch F3 — Purge — ⬜
`

test('a real run-plan: run files read from disk, the breaker stop, answers and notes written whole into run/.pane.jsonl, acks read back', async ($, on) => {
  const work = '/repo/todo/cat/run/.work.jsonl'
  const paneFile = '/repo/todo/cat/run/.pane.jsonl'
  const files: Record<string, string> = {
    '/h/script.js': "export const meta = { name: 'run-plan', phases: [{ title: 'Batch' }] }\nconst r = await workflow('run-lot', b.sheet)\n",
    '/repo/todo/cat/CAT-PLAN.md': RUN_PLAN,
    [work]: [
      { kind: 'cycle', batch: 'F1', slug: 's', state: {} },
      { kind: 'question', batch: 'F2', id: 'F2-1', at: S + 10, payload: { batch: 'F2', questions: [{ id: 'q1' }], waitSeconds: 300 } },
      { kind: 'journal', run: '2026-10-10-0912', text: 'F1 ✗ — set aside — audit Blocking not lifted — patch run/2026-10-10-0912-aside-F1.patch' },
      { kind: 'breaker', run: '2026-10-10-0912', asides: ['F1', 'F3'], decision: 'stop', cause: 'the spec leaves the lock owner open' },
    ].map(one => JSON.stringify(one)).join('\n'),
    '/repo/todo/cat/run/batches/F1.md': '## STATUS — BLOCKED\n\n## To validate\n\n- Design — lock on the catalog (no rule names the owner)\n',
  }
  const writes: string[] = []
  const { clock, touch } = planWorld(on, files, writes)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', tool_use_id: 'w1', name: 'run-plan', args: '/repo/todo/cat/CAT-PLAN.md' } as Parameters<typeof $.tool.call>[0])
  await clock.advance(10_000)

  const band = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...BAND })
  expect((await band.find({ key: 'question-banner' }))?.text).toBe('? F2 — 1 question — recommendation applied in 5:00')
  await band.unmount()
  const ui = await $.ui.mount({ plugin: 'run-lot-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /⛔ Plan stopped — common cause/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^set aside: F1, F3$/ })).toBeDefined()
  await ui.press({ key: 'open-graph' })
  expect(await ui.find({ type: 'Text', text: /^✗ F1 Archive · set aside — audit Blocking not lifted/ })).toBeDefined()
  await ui.press({ key: 'back' })

  await ui.press({ key: 'open-validate' })
  const entries = toValidateOf(files['/repo/todo/cat/run/batches/F1.md']!, 'F1')
  expect(await hung(ui, /^common cause across F1, F3: the spec leaves the lock owner open$/)).toBe(4)
  await ui.press({ key: `reject-${entries[0]!.id}` })
  await ui.input({ key: `answer-${entries[0]!.id}`, text: 'the lock is on the product' })
  const answer = JSON.parse(files[paneFile]!.trim().split('\n').pop()!)
  expect(answer).toMatchObject({
    kind: 'validation', id: entries[0]!.id, decision: 'reject', text: 'the lock is on the product',
    entry: { batch: 'F1', step: 'Design', text: 'lock on the catalog', sheet: '/repo/todo/cat/CAT-PLAN-F1.md' },
  })
  expect(files[paneFile]!.trim().split('\n')).toHaveLength(1)
  touch(work, `${files[work]}\n${JSON.stringify({ kind: 'ack', batch: 'F1', ref: entries[0]!.id, what: 'applied', relaunch: '/run-plan /repo/todo/cat/CAT-PLAN.md', hn: 'H2', cycles: [], at: answer.at + 1 })}`)
  await clock.advance(2_000)
  expect(await hung(ui, /^✓ rejected: the lock is on the product · applied$/)).toBe(4)
  expect(await hung(ui, /^ {2}relaunch: \/run-plan \/repo\/todo\/cat\/CAT-PLAN\.md$/)).toBe(2)
  await ui.press({ key: 'back' })

  await ui.press({ key: 'note' })
  await ui.input({ key: 'note-input', text: 'mind the lock' })
  const note = JSON.parse(files[paneFile]!.trim().split('\n').pop()!)
  expect(note).toMatchObject({ kind: 'note', batch: 'F2', text: 'mind the lock' })
  expect(note.id).toBe(`n-${note.at}`)
  touch(work, `${files[work]}\n${JSON.stringify({ kind: 'ack', batch: 'F2', ref: note.id, what: 'note-taken', at: note.at + 1 })}`)
  await clock.advance(2_000)
  expect(await ui.find({ type: 'Text', text: /✓ F2 {2}mind the lock · consumed/ })).toBeDefined()
  expect(writes.every(path => path === paneFile)).toBe(true)
  await ui.unmount()
})
