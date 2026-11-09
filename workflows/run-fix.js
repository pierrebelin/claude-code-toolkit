export const meta = {
  name: 'run-fix',
  description: 'Bug fix, autonomous: the fix plan /fix-bug wrote run as one batch (RED, GREEN, global green, diff audit, commit), then the knowledge base updated from the fix spec',
  whenToUse: 'Run a fix /cctoolkit:fix-bug diagnosed and the user validated. Argument: path of the fix plan `todo/<code>/<CODE>-PLAN.md` (one batch, F1).',
  phases: [
    { title: 'Fix', detail: 'run-lot on F1: RED by tdd-cycle on the sheet contract, GREEN, global green, pre-audit, audit on the diff alone (closing light), batch commit' },
    { title: 'Doc', detail: 'the fix spec delta (rule corrected, decision overturned) drafted by knowledge-merger and written to the base, nobody asked: the cause was validated before the run; nothing to merge when the fix restores a rule already documented' },
    { title: 'Report', detail: 'one result: batch status, audit verdict, minors, decisions to validate, knowledge base written, files left for the user commit' },
  ],
}

// On Windows a path may come with `\`: Git Bash eats an unquoted one. Paths are carried with `/`.
const slashed = p => String(p || '').replace(/\\/g, '/')

const plan = slashed(typeof args === 'string' ? args : (args && args.plan) || '').trim().replace(/^@/, '')
if (!/-PLAN\.md$/.test(plan)) throw new Error('expected argument: the fix plan `todo/<code>/<CODE>-PLAN.md`')
const code = plan.replace(/^.*\//, '').replace(/-PLAN\.md$/, '')
const sheet = plan.replace(/\.md$/, '-F1.md')

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

const PREPARED = obj({ exit: int, nothing: str, refused: arr(str) })
const MERGED = obj({ staged: bool, stagedLine: str, files: arr(str), warnings: arr(str), blocked: str })
const APPLIED = obj({ exit: int, lines: arr(str) })
const SHELL = { model: 'haiku', effort: 'low' }
const FRAME = 'Workflow run-fix, supervisor step. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes. Return the result through the structured output.'

const toReview = []

// --- Fix: the batch, its audit and its commit belong to run-lot ---------------------------------
phase('Fix')
log(`→ ${code} F1 launched`)
const lot = await workflow('cctoolkit:run-lot', { sheet }).catch(e => ({ status: BLOCKED, reason: `run-lot failed: ${e.message}`, report: null }))
for (const x of lot.toReview || []) toReview.push(x)
if (lot.status !== DONE) {
  log(`${code}: ${lot.status} — ${lot.reason}`)
  return { status: lot.status, reason: lot.reason, report: lot.report || null, audit: lot.audit || null, toReview }
}

// --- Doc: the fix spec is the intent the user validated; its delta goes to the base unasked ---------
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
      'Workflow run-fix, knowledge-base merge of a bug fix. Autonomous mode: nobody answers. Never AskUserQuestion, never a Git command that writes, never `cctoolkit knowledge-write`: the workflow writes the staged merge itself after your report. Return the report fields through the structured output.',
      '',
      `plan: ${plan} · partial: no`,
      'The spec is a fix spec: its delta is the rule the fix corrects, stated whole. Rewrite the base object to it, nothing beyond.',
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
  report: lot.report || null,
  audit: lot.audit || null,
  minors: lot.minors || [],
  hypotheses: lot.hypotheses || [],
  toReview,
  ...(knowledge.state === 'nothing' ? {} : { merge: knowledge }),
  next: knowledge.state === 'written'
    ? 'Fix committed by run-lot; the knowledge base update is in the tree: review `git diff` and commit it.'
    : 'Fix committed by run-lot.',
}
