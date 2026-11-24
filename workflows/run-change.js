export const meta = {
  name: 'run-change',
  description: 'Small rule change, autonomous, in one go: the delta of one existing rule, its one-batch plan and sheet drafted, then RED, GREEN, global green, diff audit, commit, and the knowledge base updated',
  whenToUse: 'A small change to one business rule already in the knowledge base, without the spec → plan → run-plan chain. Argument: the change in one or two sentences, optionally `--code <code>`; or the `todo/<code>/<CODE>-PLAN.md` of an earlier run to resume it. A new rule, several rules, a new use case → /cctoolkit:business-spec.',
  phases: [
    { title: 'Draft', detail: 'one agent: the rule found in the knowledge base, the scope checked (one existing rule, at most three cycles), the change spec, plan and F1 sheet written from the fix template, sheet-cycles and plan-next-batch checks green; out of scope or ambiguous → the run stops before any code' },
    { title: 'Change', detail: 'run-lot on F1: RED by tdd-cycle on the sheet contract, GREEN, global green, pre-audit, audit on the diff alone (closing light), batch commit' },
    { title: 'Doc', detail: 'the change spec delta (the rule rewritten, a decision overturned) drafted by knowledge-merger and written to the base' },
    { title: 'Report', detail: 'one result: the rule before and after, batch status, audit verdict, minors, assumptions and decisions to validate, knowledge base written' },
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

const DRAFTED = obj({
  status: { type: 'string', enum: ['READY', 'OUT_OF_SCOPE', 'AMBIGUOUS', 'BLOCKED'] },
  reason: str, plan: str, rule: str, before: str, after: str, assumptions: arr(str), questions: arr(str),
})
const PREPARED = obj({ exit: int, nothing: str, refused: arr(str) })
const MERGED = obj({ staged: bool, stagedLine: str, files: arr(str), warnings: arr(str), blocked: str })
const APPLIED = obj({ exit: int, lines: arr(str) })
const SHELL = { model: 'haiku', effort: 'low' }
const FRAME = 'Workflow run-change, supervisor step. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes. Return the result through the structured output.'

const toReview = []

// --- Draft: the spec, plan and sheet a fix-bug would write, from the request alone --------------------
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
      '1. **Rule** — find the rule the change touches in the knowledge base, cheapest first: `cctoolkit ask "<the change in the base\'s words>" --kind rule`, then `cctoolkit ask --id <id>` for the one or two candidates, `cctoolkit ask --handler <Name>` for the handler applying it. Never `Read` a `rules.md` or `decisions.md` whole.',
      '2. **Scope** — the run is for one existing rule changed. Return `OUT_OF_SCOPE`, nothing written, `reason` naming what makes it bigger and `/cctoolkit:business-spec` as the way, when: no rule of the base says the behaviour today (a new rule, use case or capability); the change rewrites two rules or more, or spans two use cases; it needs a new endpoint, aggregate, entity, persisted field or migration; or more than three cycles or eight production files. A decision the change overturns, linked to that rule, stays in scope.',
      '3. **Ambiguity** — two readings of the request that the tests would tell apart (which callers keep the old behaviour, existing data, an edge case it leaves open): the reading closest to the request and to the code\'s current pattern is taken and stated in `assumptions`, one line each. Only when no reading is closer than the other: `AMBIGUOUS`, nothing written, `questions` = up to three closed questions with their options.',
      '4. **Code** — bounded: the handler, the `path:line` where the rule is decided today, the existing test class and fixture of that handler (or `(to create)`), the production files to change.',
      '5. **Write** — from `<kit>/skills/fix-bug/references/fix-template.md`, its verdict **Rule to correct**, three files under `todo/<code>/`, one `Write` each, in one message: `SPEC-<code>.md`, `<CODE>-PLAN.md`, `<CODE>-PLAN-F1.md`. Structure and anchors verbatim, prose in `language.docs`. A change, not a fix: titles read `Change: <title>`; §1 states the request and the behaviour today at its `path:line` in place of a cause, then the assumptions; the rule\'s `**Origin**` is `change <CODE>`; the batch reason `rule change`; the `kit:na-rules` line says `rule change inside an existing design, no design decision taken`. The rule\'s statement is written whole as it must read once changed: the base text is replaced by it. Cycles per `<kit>/skills/implement-tdd/references/design.md`: one per observable behaviour that changes, its test red today; `rmcu` cites the rule id; `methods` named `Should<Result>_When<Condition>`; `closing` `light`.',
      '6. **Check** — one message: `cctoolkit sheet-cycles todo/<code>/<CODE>-PLAN-F1.md --index` and `cctoolkit plan-next-batch todo/<code>/<CODE>-PLAN.md --check`. A failure → fix the file it names, rerun; still red after two rounds → `BLOCKED` with the failing output in `reason`.',
      '',
      '`READY`: `plan` = `todo/<code>/<CODE>-PLAN.md`, `rule` = `<id> — <title>`, `before` = its statement in the base today, `after` = as written in the spec, `reason` `—`. Otherwise `plan`, `rule`, `before`, `after` empty when unknown.',
    ].join('\n'),
    { schema: DRAFTED, phase: 'Draft', label: 'draft' },
  ).catch(e => ({ status: BLOCKED, reason: `draft agent failed: ${e.message}`, plan: '', rule: '', before: '', after: '', assumptions: [], questions: [] }))
  if (!drafted) drafted = { status: BLOCKED, reason: 'draft agent without result', plan: '', rule: '', before: '', after: '', assumptions: [], questions: [] }
  plan = slashed(drafted.plan).trim().replace(/^@/, '')
  if (drafted.status === 'READY' && !/^todo\/[^/]+\/[^/]+-PLAN\.md$/.test(plan)) drafted = { ...drafted, status: BLOCKED, reason: `draft returned no plan path: \`${drafted.plan}\`` }
  if (drafted.status !== 'READY') {
    log(`draft: ${drafted.status} — ${drafted.reason}`)
    return {
      status: drafted.status,
      reason: drafted.reason,
      rule: drafted.rule ? { id: drafted.rule, before: drafted.before, after: drafted.after } : null,
      questions: drafted.questions,
      toReview,
      next: drafted.status === 'AMBIGUOUS'
        ? 'Answer the questions in the request and relaunch /cctoolkit:run-change.'
        : drafted.status === 'OUT_OF_SCOPE'
          ? 'Too big for a rule change: /cctoolkit:business-spec, then /cctoolkit:plan-implementation.'
          : 'Nothing written to the code; the drafted files, if any, stay under todo/.',
    }
  }
  for (const a of drafted.assumptions) toReview.push({ step: 'Draft', text: `assumption: ${a}` })
  log(`→ ${drafted.rule}`)
}
const code = plan.replace(/^.*\//, '').replace(/-PLAN\.md$/, '')
const sheet = plan.replace(/\.md$/, '-F1.md')

// --- Change: the batch, its audit and its commit belong to run-lot -----------------------------------
phase('Change')
log(`→ ${code} F1 launched`)
const lot = await workflow('cctoolkit:run-lot', { sheet }).catch(e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null }))
for (const x of lot.toReview || []) toReview.push(x)
const rule = drafted ? { id: drafted.rule, before: drafted.before, after: drafted.after } : null
if (lot.status !== DONE) {
  log(`${code}: ${lot.status} — ${lot.reason}`)
  return { status: lot.status, reason: lot.reason, plan, rule, report: lot.report || null, audit: lot.audit || null, toReview, next: `The plan stays under todo/; /cctoolkit:run-change ${plan} resumes from the saved cycles.` }
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
      'Workflow run-change, knowledge-base merge of a rule change. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes, never `cctoolkit knowledge-write`: the workflow writes the staged merge itself after your report. Return the report fields through the structured output.',
      '',
      `plan: ${plan} · partial: no`,
      'The spec is a change spec: its delta is the rule the change rewrites, stated whole. Rewrite the base object to it, nothing beyond.',
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
  rule,
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
