export const meta = {
  name: 'run-sync',
  description: 'Knowledge base aligned with the code, autonomous: per context changed since its sync mark, the extraction in parts under knowledge.syncBudget, the code taken as truth, validated by level and written; a report of the rules changed',
  whenToUse: 'Launched by /cctoolkit:knowledge-sync once the new contexts have their prefix. Argument: `[Context[,Context]] [--since <commit>] [--full]`; without a context, every context the scan lists.',
  phases: [
    { title: 'Scan', detail: '`knowledge-write init`, then `knowledge-scan --plan`: per context its mode, its parts (one agent each), its mechanical renames and retirements, drafts an interrupted sync left' },
    { title: 'Close', detail: '`knowledge-write mark` on the contexts nothing touched: their sync row, delta —' },
    { title: 'Report', detail: 'per context: the rules added, changed and removed with their title, the conflicts the code won, the handlers retired, what stays observed or uncovered' },
  ],
}

// One phase per context, titled `sync: <Context>`, opens between Scan and Close: its mechanical step,
// one `knowledge-extractor` per part (`<Context> · part n/N`, `<Context> · extract` when the context
// runs whole), then `<Context> · apply` (`<Context> · repair` and a second apply when the first is refused).

const raw = typeof args === 'string' ? args : (args && args.args) || ''
const words = String(raw).trim().split(/\s+/).filter(Boolean)
let since = '', full = false
const named = []
for (let i = 0; i < words.length; i++) {
  if (words[i] === '--since') since = words[++i] || ''
  else if (words[i] === '--full') full = true
  else named.push(...words[i].split(',').filter(Boolean))
}
if (since && full) throw new Error('--since and --full exclude each other')

const str = { type: 'string' }
const int = { type: 'integer' }
const arr = items => ({ type: 'array', items })
const obj = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
})

const SCANNED = obj({ exit: int, staging: str, plan: str, error: str })
const RAN = obj({ exit: int, lines: arr(str) })
const EXTRACTED = obj({
  blocked: str,
  status: str,
  adr: arr(str),
  removed: arr(obj({ id: str, why: str, evidence: str })),
  retire: arr(str),
  overview: str,
  conflicts: arr(obj({ object: str, sheet: str, code: str, evidence: str })),
  notCovered: arr(str),
})
const SHELL = { model: 'haiku', effort: 'low' }
const FRAME = 'Workflow run-sync, supervisor step. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes. Return the result through the structured output.'
const AGENT_FRAME = 'Workflow run-sync, extraction. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes, never `cctoolkit knowledge-write` beyond `status`: the workflow validates and writes after your report. Return the report fields through the structured output: `blocked` empty unless you end on `## BLOCKED` (then its cause), the other fields the lines of `## EXTRACTED` (`adr`, `retire`, `notCovered` empty for none, `overview` the `Overview:` value).'

const shell = (label, phase, command, extra = '') => agent(
  [FRAME, '', `One call: \`${command}\`.`, extra || '`exit` = the code on the last line `exit=N`; `lines` = every other output line, verbatim.'].join('\n'),
  { schema: RAN, phase, label, ...SHELL },
).catch(() => null)

// --- Scan --------------------------------------------------------------------------------------------
phase('Scan')
const scanArgs = [named.length ? `--context ${named.join(',')}` : '', since ? `--since ${since}` : '', full ? '--full' : ''].filter(Boolean).join(' ')
const scanned = await agent(
  [
    FRAME,
    '',
    `One call: \`cctoolkit knowledge-write init; cctoolkit knowledge-scan --plan ${scanArgs} 2>&1; echo "exit=$?"\`.`,
    '`staging` = the first output line (the staging path printed by `init`); `plan` = the JSON the scan printed, every line of it verbatim, nothing added; `exit` = the code on the last line `exit=N`; `error` = the other lines when the exit is not 0, else empty.',
  ].join('\n'),
  { schema: SCANNED, phase: 'Scan', label: 'scan', ...SHELL },
).catch(() => null)
if (!scanned || scanned.exit !== 0) {
  const reason = scanned ? `knowledge-scan exit ${scanned.exit}: ${scanned.error}` : 'scan agent without result'
  log(reason)
  return { status: 'BLOCKED', reason, contexts: [], next: scanned && scanned.exit === 3 ? 'cctoolkit doctor' : '/cctoolkit:knowledge-sync' }
}
let plan
try { plan = JSON.parse(scanned.plan) } catch (e) {
  return { status: 'BLOCKED', reason: `scan plan unreadable: ${e.message}`, contexts: [], next: '/cctoolkit:knowledge-sync' }
}
const staging = String(scanned.staging || `${plan.root}/.sync`).trim().replace(/\\/g, '/').replace(/\/?$/, '/')
const sinceOpt = since ? ` --since ${since}` : ''
log(`${plan.contexts.length} context(s) scanned at ${plan.head || 'no commit'}`)

// --- Per context, one after the other: the ADR ids are shared ------------------------------------------
const results = []
const toMark = []
for (const c of plan.contexts) {
  const r = { name: c.name, mode: c.mode, parts: 0, state: 'written', row: '', objects: [], conflicts: [], removed: [], retired: [], notCovered: [], status: [], warnings: [], reason: '' }
  results.push(r)
  if (!c.prefix) {
    Object.assign(r, { state: 'skipped', reason: `no prefix in knowledge.contexts (proposed ${c.proposedPrefix}) — /cctoolkit:knowledge-sync frames it` })
    log(`${c.name}: skipped, no prefix`)
    continue
  }
  const agentParts = c.mode === 'incremental' ? c.parts : c.parts.slice(0, 1)
  if (!agentParts.length && !c.mechanical.length && !c.staged) {
    r.state = 'marked'
    toMark.push(c.name)
    continue
  }
  const ph = `sync: ${c.name}`
  phase(ph)
  if (c.mechanical.length) {
    const m = await shell(`${c.name} · mechanical`, ph, `${c.mechanical.map(x => `${x} 2>&1`).join('; ')}; echo "exit=$?"`)
    r.retired.push(...c.mechanical.filter(x => / retire /.test(x)).map(x => x.split(' ').pop()))
    if (!m || m.exit !== 0) r.warnings.push(`mechanical: ${m ? m.lines.join(' ; ') : 'agent without result'}`)
  }
  r.parts = agentParts.length
  let blocked = ''
  for (const p of agentParts) {
    const option = p.part ? `--part ${p.part}${sinceOpt}` : full ? '--full' : since ? `--since ${since}` : 'none'
    const label = p.part ? `${c.name} · part ${p.part}/${agentParts.length}` : `${c.name} · extract`
    const x = await agent(
      [AGENT_FRAME, '', `context: ${c.name} · prefix: ${c.prefix} · mode: ${c.mode} · staging: ${staging}`, `scan option: ${option}`].join('\n'),
      { agentType: 'cctoolkit:knowledge-extractor', schema: EXTRACTED, phase: ph, label },
    ).catch(e => ({ blocked: `knowledge-extractor failed: ${e.message}` }))
    if (!x || x.blocked) {
      blocked = `${label}: ${x ? x.blocked : 'agent without result'}`
      break
    }
    if (x.status) r.status.push(x.status)
    r.conflicts.push(...x.conflicts)
    r.removed.push(...x.removed)
    r.notCovered.push(...x.notCovered)
    for (const h of x.retire) if (!r.retired.includes(h)) {
      const t = await shell(`${c.name} · retire ${h}`, ph, `cctoolkit knowledge-write retire ${c.name} ${h} 2>&1; echo "exit=$?"`)
      if (t && t.exit === 0) r.retired.push(h)
      else r.warnings.push(`retire ${h}: ${t ? t.lines.join(' ; ') : 'agent without result'}`)
    }
  }
  if (blocked) {
    Object.assign(r, { state: 'blocked', reason: `${blocked} — drafts kept in ${staging}${c.name}, taken up by the next sync` })
    log(`${c.name}: blocked — ${blocked}`)
    continue
  }
  // The code is the truth: high accepted, medium kept observed, low dropped, then written.
  const applyCmd = `cctoolkit knowledge-write validate --context ${c.name} --accept high --drop low 2>&1; cctoolkit knowledge-write apply --context ${c.name} 2>&1; echo "exit=$?"`
  let ap = await shell(`${c.name} · apply`, ph, applyCmd)
  if (ap && ap.exit !== 0) {
    const fix = ap.lines.filter(l => /^(refused|dangling): /.test(l))
    await agent(
      [
        AGENT_FRAME,
        '',
        `context: ${c.name} · prefix: ${c.prefix} · mode: repair · staging: ${staging}`,
        'No scan, no extraction: the drafts are staged. Fix only what these lines name, in the staged files, then `cctoolkit knowledge-write status --context ' + c.name + '`:',
        ...fix.map(l => `- ${l}`),
        'A `dangling:` citation: remove it from the draft that holds it. A rule that `belongs in <Context>/rules.md`: move it there, staged whole, cited on the line opening the `## Rules` of each use case applying it. Report with empty lists.',
      ].join('\n'),
      { agentType: 'cctoolkit:knowledge-extractor', schema: EXTRACTED, phase: ph, label: `${c.name} · repair` },
    ).catch(() => null)
    ap = await shell(`${c.name} · apply again`, ph, `cctoolkit knowledge-write apply --context ${c.name} 2>&1; echo "exit=$?"`)
  }
  if (!ap || ap.exit !== 0) {
    Object.assign(r, { state: 'refused', reason: `${ap ? ap.lines.filter(l => /^(refused|dangling): /.test(l)).join(' ; ') || `exit ${ap.exit}` : 'apply agent without result'} — drafts kept in ${staging}${c.name}` })
    log(`${c.name}: apply refused`)
    continue
  }
  r.row = ap.lines.find(l => l.startsWith(`${c.name}: `)) || ''
  r.objects = ap.lines.filter(l => /^\s+[+~-]\S+ — /.test(l)).map(l => l.trim())
  r.warnings.push(...ap.lines.filter(l => l.startsWith('WARN ')))
  log(`${c.name}: written — ${r.objects.length} object(s)`)
}

// --- Close ---------------------------------------------------------------------------------------------
phase('Close')
if (toMark.length) {
  const m = await shell('mark', 'Close', `cctoolkit knowledge-write mark --context ${toMark.join(',')} 2>&1; echo "exit=$?"`)
  if (!m || m.exit !== 0) for (const r of results) if (r.state === 'marked') Object.assign(r, { state: 'refused', reason: `mark: ${m ? m.lines.join(' ; ') : 'agent without result'}` })
}

// --- Report --------------------------------------------------------------------------------------------
phase('Report')
const failed = results.filter(r => ['blocked', 'refused'].includes(r.state))
const written = results.filter(r => r.state === 'written')
return {
  status: failed.length ? 'PARTIAL' : 'DONE',
  reason: failed.length ? failed.map(r => `${r.name}: ${r.state}`).join(', ') : '—',
  head: plan.head,
  unassigned: plan.unassigned,
  contexts: results,
  next: written.length || toMark.length
    ? `Review \`git diff -- ${plan.root}\` and commit it with the code it describes.`
    : 'Nothing written.',
}
