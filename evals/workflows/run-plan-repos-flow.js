// run-plan over a plan whose `Repo` column names other repositories, driven by schema-shaped fake agents. F1 in
// /s, F2 in /e and F3 in the checkout /r, both depending on F1.
// repos: /s and /e checked at the preflight (kit.config.json, branch rule, doctor, build — the checkout's F3 needs
// none); F1 carried into /s (put on the checkout's branch), run there (run-lot `root` /s, the sheet's copy), gated and
// committed there, its plan folder brought back; then F2 in /e beside F3 in the checkout; the final check runs in /r,
// then /s and /e; the security pass reads the commits of /s and /e with `git -C`; the report names each repo's branch.
// preflight: /s has no kit.config.json — the run stops at the preflight, before any batch, the fix named.
// branch: /e's local changes block the switch to the checkout's branch — F2 set aside without run-lot nor restore,
// F3 committed.
// aside: F2 blocked in /e — set aside in /e (the sheet's copy fingerprinted), its plan folder brought back, F3
// committed.
// package: F2 consumes F1 as a package (`F1(package)`) — /s checked for `commands.pack`, /e for `commands.usePackage`
// and the feed; F1 packed in /s after its gate and before its commit; run-lot F2 pinned to that prerelease.
// packfail: F1's pack fails — F1 set aside in /s, nothing committed, F2 and F3 held.
// repack: F1 committed by an earlier run — packed again from /s's HEAD, on the run's branch, before F2 runs.
// The last line is `CLEAN` when no check warned.
// Usage: node run-plan-repos-flow.js <run-plan.js> repos|preflight|branch|aside|package|packfail|repack
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'repos'
const packaging = ['package', 'packfail', 'repack'].includes(variant)
const labels = []
const done = new Set(variant === 'repack' ? ['F1'] : [])
const set = new Set()
const deps = { F1: [], F2: ['F1'], F3: ['F1'] }
const repoOf = { F1: '/s', F2: '/e', F3: '/r' }
const sheet = b => `/r/todo/x/X-PLAN-${b}.md`
const copy = b => `${repoOf[b]}/todo/x/X-PLAN-${b}.md`
const VERSION = '1.4.1-kit.202611271000.1'
let warned = 0
const warn = m => { warned++; console.log('WARN', m) }
const carried = new Set()
const packed = new Set()
const runnable = () => ['F1', 'F2', 'F3'].filter(b => !done.has(b) && !set.has(b) && deps[b].every(d => done.has(d)))
const atOf = l => (/^.*? (F\d)/.exec(l) || [])[1]
const agent = async (prompt, o) => {
  labels.push(o.label)
  const l = o.label
  if (l === 'preflight') {
    if (!prompt.includes('cctoolkit batch-repo prune')) warn('preflight does not bring back a stopped run\'s carries')
    if (!prompt.includes('cctoolkit plan-next-batch <plan> --repos')) warn('preflight does not list the plan\'s repositories')
    if (!prompt.includes('cctoolkit config package-feed')) warn('preflight does not read the local feed')
    const repos = [
      { repo: '/s', checkout: false, batches: done.has('F1') ? [] : ['F1'], pack: packaging ? ['F1'] : [], use: [] },
      { repo: '/e', checkout: false, batches: ['F2'], pack: [], use: packaging ? ['F2'] : [] },
      { repo: '/r', checkout: true, batches: ['F3'], pack: [], use: [] },
    ]
    return { ok: true, failure: '', plan: '/r/todo/x/X-PLAN.md', root: '/r', kit: '/k', runRoot: '/r/todo/x/run', stamp: '2026-11-27-1000', parallel: 1, repos, feed: packaging ? '/feed' : '' }
  }
  if (l.startsWith('preflight ')) {
    const name = l.split(' ')[1]
    if (name === 'r') warn('the checkout preflighted again without a package role')
    const at = `cd '/${name}' && export CLAUDE_PROJECT_DIR='/${name}' &&`
    if (!prompt.includes(`test -f '/${name}/.claude/kit.config.json'`)) warn(`${l}: kit.config.json not checked`)
    if (!prompt.includes(`cctoolkit batch-repo branch --repo /${name} --check`)) warn(`${l}: branch rule not checked`)
    if (!prompt.includes(`${at} cctoolkit doctor --quiet`)) warn(`${l}: doctor not run in its repo`)
    if (!prompt.includes('never through `eval`')) warn(`${l}: build not run literally`)
    const pkg = name === 's' ? '--pack' : '--use'
    if (packaging !== prompt.includes(`${at} cctoolkit batch-package check ${pkg} --feed '/feed'`)) warn(`${l}: package check ${packaging ? 'missing' : 'without a package role'}`)
    if (variant === 'preflight' && name === 's') return { ok: false, failure: '/s: no .claude/kit.config.json — run /cctoolkit:kit-init in that repository', branch: '' }
    return { ok: true, failure: '', branch: 'feat/x' }
  }
  if (l === 'next batch') {
    const skip = (/--skip (\S+)/.exec(prompt) || [])[1]
    for (const s of (skip || '').split(',').filter(Boolean)) set.add(s)
    const g = runnable()
    const held = ['F2', 'F3'].filter(b => !done.has(b) && !g.includes(b)).map(b => ({ batch: b, by: deps[b] }))
    if (!g.length) return { kind: 'END', line: '', batches: [], held, outsideBatch: '', outsidePaths: [] }
    const batches = g.map(b => ({ batch: b, repo: repoOf[b], sheet: sheet(b), ...(packaging && b === 'F1' ? { pack: true } : {}), ...(packaging && b === 'F2' ? { packageFrom: [{ batch: 'F1', repo: '/s' }] } : {}) }))
    const mine = batches.find(x => x.repo === '/r')
    return { kind: 'BATCHES', line: '', batches, held, outsideBatch: mine ? mine.batch : '', outsidePaths: [] }
  }
  if (l === 'pair') warn('a pair looked for beside batches of other repos')
  if (l.startsWith('carry ')) {
    const b = l.split(' ')[1]
    if (!prompt.includes(`cctoolkit batch-repo carry ${b} --repo ${repoOf[b]} --plan /r/todo/x/X-PLAN.md`)) warn(`carry ${b} without its repo or plan`)
    if (prompt.includes('cctoolkit doctor')) warn(`carry ${b}: doctor run again, the preflight checked it`)
    if (!prompt.includes(`plan-next-batch /r/todo/x/X-PLAN.md --outside ${b}`)) warn(`carry ${b} without the out-of-batch check`)
    if (variant === 'branch' && b === 'F2') return { ok: false, plan: '', outside: [], carried: false, detail: '/e cannot switch to feat/x: Your local changes would be overwritten by checkout — its local changes block it, the batch is set aside' }
    carried.add(b)
    return { ok: true, plan: `${repoOf[b]}/todo/x/X-PLAN.md`, outside: b === 'F2' ? ['README.md'] : [], carried: true, detail: '', branch: 'feat/x', switched: b === 'F1' ? 'created' : 'checked out' }
  }
  if (l.startsWith('back ')) {
    const b = l.split(' ')[1]
    if (!prompt.includes(`cctoolkit batch-repo back ${b} --repo ${repoOf[b]}`)) warn(`back ${b} without its repo`)
    if (!carried.delete(b)) warn(`back ${b} without a carry`)
    return { ok: true, back: ['X-PLAN-F1.md'], merged: ['X-PLAN.md'], conflict: [], kept: [], detail: '' }
  }
  if (l === 'journal') return { ok: true }
  if (l.startsWith('branch ')) {
    const b = l.split(' ')[1]
    if (variant !== 'repack' || !prompt.includes(`cctoolkit batch-repo branch --repo ${repoOf[b]}`) || prompt.includes('--check')) warn(`${l}: unexpected, or not the switch of its repo`)
    return { ok: true, detail: 'feat/x' }
  }
  if (l.startsWith('pack ')) {
    const b = l.split(' ')[1]
    if (!packaging || b !== 'F1') warn(`${l}: a batch that feeds no package packed`)
    if (!prompt.includes(`cd '${repoOf[b]}' && export CLAUDE_PROJECT_DIR='${repoOf[b]}' &&`)) warn(`${l} not in its repo`)
    if (!prompt.includes(`cctoolkit batch-package version ${b} --stamp 2026-11-27-1000`) || !prompt.includes(`cctoolkit config command pack --version <version> --feed '/feed'`)) warn(`${l} without the run's prerelease or the feed`)
    if (variant !== 'repack' && !labels.includes(`gate ${b}`)) warn(`${l} before its gate`)
    if (variant === 'repack' && !labels.includes(`branch ${b}`)) warn(`${l}: repacked before its repo is on the run's branch`)
    if (variant === 'packfail') return { ok: false, version: VERSION, detail: 'pack=1 error NU5026: the file to package was not found' }
    packed.add(b)
    return { ok: true, version: VERSION, detail: '' }
  }
  if (l.startsWith('gate')) {
    const b = atOf(l)
    const tree = repoOf[b]
    const inTree = prompt.includes(`Batch worktree: \`${tree}\``)
    if ((tree !== '/r') !== inTree) warn(`${l} in the wrong tree`)
    if (tree !== '/r' && !prompt.includes(`${tree}/todo/x/X-PLAN.md`)) warn(`${l} reads the checkout's plan, not its copy`)
    return { statusLine: '## STATUS — DONE', verdictLine: 'Verdict: VALID', planDone: true, build: 0 }
  }
  if (l.startsWith('commit')) {
    const b = l.split(' ')[1]
    const tree = repoOf[b]
    if (tree !== '/r' && !(prompt.includes(`cd '${tree}' && export CLAUDE_PROJECT_DIR='${tree}' &&`) && prompt.includes(`--sheet ${copy(b)}`))) warn(`commit ${b} outside its repo or without the sheet's copy`)
    if (tree === '/r' && (prompt.includes('Batch worktree') || !prompt.includes(`--sheet ${sheet(b)}`))) warn(`commit ${b} not in the checkout`)
    if (tree !== '/r' && !carried.has(b)) warn(`commit ${b} after its plan folder was brought back`)
    if (packaging && b === 'F1' && !packed.has(b)) warn('F1 committed before it was packed')
    done.add(b)
    return { ok: true, commit: `committed ${b === 'F1' ? 'aaa1111' : b === 'F2' ? 'bbb2222' : 'ccc3333'}: 3 file(s)` }
  }
  if (l.startsWith('aside')) {
    const b = l.split(' ')[1]
    if (b === 'F2' && !(prompt.includes("cd '/e'") && prompt.includes(`--sheet ${copy('F2')}`) && prompt.includes('/r/todo/x/run/2026-11-27-1000-aside-F2.patch'))) warn('aside of F2 outside /e or without the sheet\'s copy')
    if (b === 'F1' && !(variant === 'packfail' && prompt.includes("cd '/s'") && prompt.includes('pack: pack=1'))) warn('aside of F1 outside /s or without the pack failure')
    set.add(b)
    return { ok: true, detail: `restored, ref: refs/cctoolkit/aside/x/${b}` }
  }
  if (l === 'breaker 1') return null
  if (l.startsWith('final check')) {
    const name = l.slice('final check'.length).trim()
    if (name && !prompt.includes(`cd '/${name}' && export CLAUDE_PROJECT_DIR='/${name}' &&`)) warn(`${l} not in its repo`)
    if (!name && prompt.includes('Batch worktree')) warn('final check of the checkout in another tree')
    return { suites: [{ name: 'UnitTests', exit: name === 'e' ? 1 : 0, report: { failed: 1, total: 9, listed: 1, fromRunner: true, setup: [], assertion: [{ message: 'boom', tests: ['T.a'] }] } }] }
  }
  if (l === 'security') {
    if (variant === 'repos' && !(prompt.includes('ccc3333') && prompt.includes('aaa1111 (`git -C /s`)') && prompt.includes('bbb2222 (`git -C /e`)'))) warn('security does not read the other repos\' commits there')
    return { findings: [] }
  }
  if (l === 'merge prepare') return { exit: 0, nothing: 'nothing to merge: the spec carries no delta anchor', refused: [] }
  if (l === 'report') {
    if (variant === 'repos' && !(prompt.includes('"repo": "/s"') && prompt.includes('"name": "e/UnitTests"'))) warn('report without the repos of its batches or suites')
    if (variant === 'repos' && !prompt.includes("cd '/e' && cctoolkit bg log final-2026-11-27-1000-UnitTests")) warn('red suite of /e without its log command there')
    if (variant === 'repos' && !(prompt.includes('"branch": "feat/x"') && prompt.includes('(<repo>, branch <branch>)'))) warn('report without the branch of each repo')
    if (variant === 'package' && !prompt.includes(`pointed at F1's prerelease ${VERSION}`)) warn('report without the package pin to switch back')
    return { path: '/r/todo/x/run/2026-11-27-1000.md', lastLine: 'x' }
  }
  if (l === 'cleanup') return { ok: true }
  console.log('UNHANDLED', l)
  return null
}
const workflow = async (name, a) => {
  const b = /-(F\d+)\.md$/.exec(a.sheet)[1]
  const tree = repoOf[b]
  labels.push(`run-lot ${b}${a.root ? ` ${a.root}` : ''}`)
  if (tree !== '/r' && !(a.root === tree && a.sheet === copy(b) && a.run === '/r/todo/x/run' && !a.lock)) warn(`run-lot ${b} without its repo, the sheet's copy or the run folder`)
  if (tree === '/r' && (a.root || a.lock || a.run)) warn(`run-lot ${b} of the checkout carries tree arguments`)
  if (tree !== '/r' && !carried.has(b)) warn(`run-lot ${b} before its carry`)
  const pinned = a.packages && a.packages.from === 'F1' && a.packages.version === VERSION && a.packages.feed === '/feed'
  if ((packaging && b === 'F2') !== !!pinned || (!pinned && a.packages)) warn(`run-lot ${b}: package pin ${pinned ? 'unexpected' : 'missing or wrong'}`)
  const toReview = pinned ? [{ step: 'Package', text: `pointed at F1's prerelease ${VERSION} on the local feed /feed: \`Directory.Packages.props\`, \`nuget.config\` — switch back to the published version once its CI passes`, why: '' }] : []
  return variant === 'aside' && b === 'F2'
    ? { status: 'BLOCKED', reason: 'GREEN stopped', report: `/r/todo/x/run/batches/${b}.md`, toReview: [], hypotheses: [], minors: [] }
    : { status: 'DONE', reason: '—', report: `/r/todo/x/run/batches/${b}.md`, toReview, hypotheses: [], minors: [] }
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', src)
fn('todo/x/X-PLAN.md', agent, m => console.log('log:', m), () => {}, async ts => Promise.all(ts.map(t => t())), workflow)
  .then(r => {
    if (carried.size) warn(`plan folder left in ${[...carried].join(', ')}`)
    console.log('STATUS', r.status, '|', r.reason, '|', r.batches.map(x => `${x.batch} ${x.status}`).join(', '))
    console.log('AGENTS', labels.join(' | '))
    if (!warned) console.log('CLEAN')
  })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
