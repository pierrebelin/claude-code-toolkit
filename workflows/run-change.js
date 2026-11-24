export const meta = {
  name: 'run-change',
  description: 'Small business change, autonomous, in one go: sized first, then its delta, one-batch plan and sheet drafted, RED, GREEN, global green, diff audit, commit, and the knowledge base updated',
  whenToUse: 'A small business change that fits one batch (a rule changed or added, a use case adjusted, a field on an existing request), without the spec → plan → run-plan chain. Argument: the change in one or two sentences, optionally `--code <code>`; or the `todo/<code>/<CODE>-PLAN.md` of an earlier run to resume it. The draft says when it is too big → /cctoolkit:business-spec.',
  phases: [
    { title: 'Draft', detail: 'one agent: the rules and use cases touched found in the knowledge base, the size judged (one context, one batch, at most five cycles, no new aggregate, use case or migration), open points settled on the existing analogue, the change spec, plan and F1 sheet written from the fix template, sheet-cycles and plan-next-batch checks green; too big or contradictory → the run stops before any code' },
    { title: 'Change', detail: 'run-lot on F1: RED by tdd-cycle on the sheet contract, GREEN, global green, pre-audit, audit on the diff alone (closing light), batch commit' },
    { title: 'Doc', detail: 'the change spec delta (rules added or rewritten, a use case adjusted, a decision overturned) drafted by knowledge-merger and written to the base' },
    { title: 'Report', detail: 'one result: each object of the delta before and after, batch status, audit verdict, minors, assumptions and decisions to validate, knowledge base written' },
  ],
}

// On Windows a path may come with `\`: Git Bash eats an unquoted one. Paths are carried with `/`.
const slashed = p => String(p || '').replace(/\\/g, '/')

const raw = typeof args === 'string' ? args : (args && (args.plan || args.change)) || ''
const given = (typeof args === 'object' && args && args.code) || ((raw.match(/(?:^|\s)--code\s+(\S+)/) || [])[1]) || ''
const request = raw.replace(/(?:^|\s)--code\s+\S+/, '').trim()
if (!request) throw new Error('expected argument: the change in one or two sentences [--code <code>], or the `todo/<code>/<CODE>-PLAN.md` of an earlier run')
const resume = /-PLAN\.md$/.test(slashed(request).replace(/^@/, ''))

const DONE = 'DONE'
const BLOCKED = 'BLOCKED'

const str = { type: 'string' }
const int = { type: 'integer' }
const bool = { type: 'boolean' }
const arr = items => ({ type: 'array', items })
const obj = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
})

const DELTA = obj({ id: str, change: { type: 'string', enum: ['new', 'modified', 'retired'] }, title: str, before: str, after: str })
const DRAFTED = obj({
  status: { type: 'string', enum: ['READY', 'TOO_BIG', 'AMBIGUOUS', 'BLOCKED'] },
  reason: str, plan: str, delta: arr(DELTA), assumptions: arr(str), questions: arr(str),
})
const PREPARED = obj({ exit: int, nothing: str, refused: arr(str) })
const MERGED = obj({ staged: bool, stagedLine: str, files: arr(str), warnings: arr(str), blocked: str })
const APPLIED = obj({ exit: int, lines: arr(str) })
const SHELL = { model: 'haiku', effort: 'low' }
const FRAME = 'Workflow run-change, supervisor step. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes. Return the result through the structured output.'

const toReview = []
const NONE = { plan: '', delta: [], assumptions: [], questions: [] }

// --- Draft: sized first, then the spec, plan and sheet a fix-bug would write, from the request alone ---
phase('Draft')
let plan
let drafted = null
if (resume) {
  plan = slashed(request).replace(/^@/, '')
  log(`resuming ${plan}: no draft`)
} else {
  drafted = await agent(
    [
      'Workflow run-change, draft step. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes, no production or test code: three markdown files only. Return the result through the structured output.',
      '`<kit>` below = the cctoolkit plugin directory, printed by `cctoolkit root`; kit scripts run as `cctoolkit <script>`.',
      '',
      `Change requested: ${request}`,
      given ? `Code: \`${given}\`.` : 'Code: `chg-<short-kebab-slug>` of the change, 24 characters at most, a `todo/<code>/` that does not exist yet.',
      'Folder `todo/<code>/`, `<CODE>` = the code uppercased.',
      '',
      '1. **Base** — the use case(s) and rules the change touches, cheapest first: `cctoolkit ask "<the change in the base\'s words>"`, then `cctoolkit ask --id <id>` for the candidates, `cctoolkit ask --handler <Name>` for a handler. Never `Read` a `rules.md` or `decisions.md` whole. A behaviour the code enforces and no rule states is a rule to add, not a reason to stop.',
      '2. **Code** — bounded: the handler(s), the `path:line` where the behaviour is decided today, the analogue the request points to or the code already has (the same choice made elsewhere: at creation, in a sibling command), the request, command, port and adapter it goes through, the existing test classes and fixtures, the production files to change.',
      '3. **Size** — the question is how big, not how many rules. The run takes the change when all hold: one bounded context; one batch, no step that must land and be checked before another starts; at most five cycles and twelve production files; no new aggregate or entity, no new use case or endpoint, no persistence schema change or migration. Inside that, all in: rules added or rewritten, an existing use case adjusted (a variant, a step, an error), a field added to an existing request or command, a port or adapter extended, a decision overturned. Otherwise `TOO_BIG`, nothing written, `reason` = the measure crossed, in one or two lines, and the open business decisions in `questions`.',
      '4. **Open points** — a choice the request leaves open (which use case, both inputs given at once, what follows from the new path): settle it on the analogue of step 2 (the request says "as at creation" → what creation does, its validation and errors included), else on the code\'s current pattern; each one stated in `assumptions`, one line. `AMBIGUOUS` only when the request contradicts itself or the code, or two readings remain with no analogue to choose between them: nothing written, `questions` = up to three closed questions with their options.',
      '5. **Ids** — once, just before writing: a new object takes its id from `cctoolkit next-id <Context> RM|D --count <n>`; an object of the base keeps its own. `next-id` refusing the context → `BLOCKED` with its output.',
      '6. **Write** — from `<kit>/skills/fix-bug/references/fix-template.md`, three files under `todo/<code>/`, one `Write` each, in one message: `SPEC-<code>.md`, `<CODE>-PLAN.md`, `<CODE>-PLAN-F1.md`. Structure and anchors verbatim, prose in `language.docs`. A change, not a fix: titles read `Change: <title>`; §1 states the request and the behaviour today at its `path:line` in place of a cause, then the assumptions. Delta, one `###` heading per object, one anchor each: `<!-- kit:new -->` for an id just taken, `<!-- kit:modified -->` for the base\'s — a rule or a decision stated again whole, as it must read once changed (the base text is replaced by it); a use case only by what changes, under a `## Use cases <!-- kit:use-cases -->` section placed before the rules. `**Origin**` `change <CODE>`. The batch reason `business change`; the `kit:na-rules` line lists only the DDD/APP rules the change leaves untouched, `N/A — change inside an existing design`: a rule it does touch (a port extended, a request contract changed) stays out of that line. Cycles per `<kit>/skills/implement-tdd/references/design.md`: one per observable behaviour that changes or appears, its test red today, at the level where it is observed (a field on the request → its contract or mapping test); `rmcu` cites the rule ids; `methods` named `Should<Result>_When<Condition>`; `closing` `light`; `wave` 1 when files are disjoint.',
      '7. **Check** — one message: `cctoolkit sheet-cycles todo/<code>/<CODE>-PLAN-F1.md --index` and `cctoolkit plan-next-batch todo/<code>/<CODE>-PLAN.md --check`. A failure → fix the file it names, rerun; still red after two rounds → `BLOCKED` with the failing output in `reason`.',
      '',
      '`READY`: `plan` = `todo/<code>/<CODE>-PLAN.md`, `delta` = one entry per object of the spec\'s delta (`before` = its statement in the base today, empty for a new one; `after` = as written in the spec), `reason` `—`. Otherwise `plan` empty, `delta` what was found.',
    ].join('\n'),
    { schema: DRAFTED, phase: 'Draft', label: 'draft' },
  ).catch(e => ({ status: BLOCKED, reason: `draft agent failed: ${e.message}`, ...NONE }))
  if (!drafted) drafted = { status: BLOCKED, reason: 'draft agent without result', ...NONE }
  plan = slashed(drafted.plan).trim().replace(/^@/, '')
  if (drafted.status === 'READY' && !/^todo\/[^/]+\/[^/]+-PLAN\.md$/.test(plan)) drafted = { ...drafted, status: BLOCKED, reason: `draft returned no plan path: \`${drafted.plan}\`` }
  if (drafted.status !== 'READY') {
    log(`draft: ${drafted.status} — ${drafted.reason}`)
    return {
      status: drafted.status,
      reason: drafted.reason,
      delta: drafted.delta,
      questions: drafted.questions,
      toReview,
      next: drafted.status === 'AMBIGUOUS'
        ? 'Answer the questions in the request and relaunch /cctoolkit:run-change.'
        : drafted.status === 'TOO_BIG'
          ? 'Too big for one batch: /cctoolkit:business-spec, then /cctoolkit:plan-implementation.'
          : 'Nothing written to the code; the drafted files, if any, stay under todo/.',
    }
  }
  for (const a of drafted.assumptions) toReview.push({ step: 'Draft', text: `assumption: ${a}` })
  log(`→ ${drafted.delta.map(d => `${d.id} (${d.change})`).join(', ') || 'no delta'}`)
}
const code = plan.replace(/^.*\//, '').replace(/-PLAN\.md$/, '')
const sheet = plan.replace(/\.md$/, '-F1.md')
const delta = drafted ? drafted.delta : null

// --- Change: the batch, its audit and its commit belong to run-lot -----------------------------------
phase('Change')
log(`→ ${code} F1 launched`)
const lot = await workflow('cctoolkit:run-lot', { sheet }).catch(e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null }))
for (const x of lot.toReview || []) toReview.push(x)
if (lot.status !== DONE) {
  log(`${code}: ${lot.status} — ${lot.reason}`)
  return { status: lot.status, reason: lot.reason, plan, delta, report: lot.report || null, audit: lot.audit || null, toReview, next: `The plan stays under todo/; /cctoolkit:run-change ${plan} resumes from the saved cycles.` }
}

// --- Doc: same step as run-fix's — a change to it goes to both ---------------------------------------
phase('Doc')
const skill = `/cctoolkit:knowledge-merge ${plan}`
let knowledge
const prep = await agent(
  [
    FRAME,
    '',
    `One call: \`cctoolkit knowledge-merge prepare ${plan} 2>&1; echo "exit=$?"\`.`,
    '`exit` = the code on the last line; `nothing` = the line starting `nothing to merge: `, empty when none; `refused` = every line starting `refused: ` or `collision: `, verbatim.',
  ].join('\n'),
  { schema: PREPARED, phase: 'Doc', label: 'merge prepare', ...SHELL },
).catch(() => null)
if (!prep) knowledge = { state: 'failed', lines: ['prepare agent without result'], next: skill }
else if (prep.exit === 0 && prep.nothing) knowledge = { state: 'nothing', lines: [prep.nothing] }
else if (prep.exit !== 0) knowledge = { state: 'refused', lines: prep.refused.length ? prep.refused : [`exit=${prep.exit}`], next: skill }
else {
  const m = await agent(
    [
      'Workflow run-change, knowledge-base merge of a business change. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes, never `cctoolkit knowledge-write`: the workflow writes the staged merge itself after your report. Return the report fields through the structured output.',
      '',
      `plan: ${plan} · partial: no`,
      'The spec is a change spec: its delta is what the change adds or rewrites. Bring each object to the base as stated, nothing beyond.',
      '`staged` true with `## MERGE STAGED`: `stagedLine` = the `staged:` line, `files` = the `+n −n <file>` lines, `warnings` = the `WARN` lines left, `blocked` empty. `## BLOCKED`: `staged` false, `blocked` = the cause, `files` = its output lines.',
    ].join('\n'),
    { agentType: 'cctoolkit:knowledge-merger', schema: MERGED, phase: 'Doc', label: 'merge draft' },
  ).catch(e => ({ staged: false, stagedLine: '', files: [], warnings: [], blocked: `knowledge-merger failed: ${e.message}` }))
  if (!m || !m.staged) knowledge = { state: 'blocked', lines: [m ? m.blocked : 'agent without result', ...(m ? m.files : [])], next: skill }
  else {
    const ap = await agent(
      [FRAME, '', `One call: \`cctoolkit knowledge-write apply --merge ${code} 2>&1; echo "exit=$?"\`.`, '`exit` = the code on the last line; `lines` = every other output line, verbatim.'].join('\n'),
      { schema: APPLIED, phase: 'Doc', label: 'merge apply', ...SHELL },
    ).catch(() => null)
    knowledge = ap && ap.exit === 0
      ? { state: 'written', lines: [m.stagedLine, ...m.files, ...ap.lines], warnings: m.warnings }
      : { state: 'refused', lines: ap ? ap.lines : ['apply agent without result'], warnings: m.warnings, next: skill }
  }
}
log(`knowledge base: ${knowledge.state}${knowledge.next ? ` — ${knowledge.next}` : ''}`)
if (!['written', 'nothing'].includes(knowledge.state)) toReview.push({ step: 'Doc', text: `knowledge base not written: ${knowledge.lines.join(' ; ')} — ${knowledge.next}` })

// --- Report ----------------------------------------------------------------------------------------
phase('Report')
return {
  status: DONE,
  reason: '—',
  plan,
  delta,
  report: lot.report || null,
  audit: lot.audit || null,
  minors: lot.minors || [],
  hypotheses: lot.hypotheses || [],
  toReview,
  ...(knowledge.state === 'nothing' ? {} : { merge: knowledge }),
  next: knowledge.state === 'written'
    ? 'Change committed by run-lot; the knowledge base update is in the tree: review `git diff` and commit it.'
    : 'Change committed by run-lot.',
}
