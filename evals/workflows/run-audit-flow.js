// Whole run-audit body driven by schema-shaped fake agents: Stryker off runs no Stryker agent and
// reads `skipped`; full starts Stryker only after every measure, waits until done, crosses the
// reports; a Stryker past its bound is stopped and reads `missing`; a failed audit-collect drops
// the cross and its source; a doctor FAIL stops before any worktree; the cleanup runs every time.
// Usage: node run-audit-flow.js <run-audit.js> off|full|timeout|nocollect|blocked
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta')
const variant = process.argv[3] || 'off'
const labels = []
const prompts = {}
const T = '/tmp/cctoolkit-run/r/audit-abcdef012345'
const agent = async (prompt, o) => {
  labels.push(o.label)
  prompts[o.label] = prompt
  const l = o.label
  if (l === 'preflight') return variant === 'blocked'
    ? { ok: false, failure: 'FAIL kit.config.json invalid', worktree: '', commit: '', branch: '', stack: 'dotnet', project: '', tmp: '', cache: '', sinceTarget: '', startedAt: 0, copied: [] }
    : { ok: true, failure: '', worktree: '/tmp/cctoolkit-audit-r-abcdef012345', commit: 'abcdef0123456789', branch: 'main', stack: 'dotnet', project: 'P', tmp: T, cache: '/tmp/cctoolkit-run/r/stryker-abcdef012345', sinceTarget: 'fedcba', startedAt: 1000, copied: [] }
  if (l === 'tests') return { status: 'measured', reason: '', file: `${T}/tests.json` }
  if (l === 'sonarqube + coverage') return { sonarStatus: 'not_configured', sonarReason: 'no token, no server', coverageStatus: 'measured', coverageReason: '', coverageFile: '/w/TestResults/MergedCoverage/SonarQube.xml', reused: false, file: `${T}/sonar.json` }
  if (l === 'audit-collect') return variant === 'nocollect' ? { ok: false, failure: 'boom', statuses: [] } : { ok: true, failure: '', statuses: [] }
  if (l === 'inventory') return { status: 'measured', reason: '', file: `${T}/inventory.json` }
  if (l === 'activity') return { ok: true, failure: '', file: `${T}/activity.json`, themes: 'catalog work' }
  if (l === 'stryker start') return { status: 'started', reason: '' }
  if (l.startsWith('stryker wait')) {
    const n = Number(l.split('#')[1])
    if (variant === 'timeout' || n < 3) return { state: 'running', line: 'RUNNING 540s' }
    return { state: 'done', line: 'DONE exit=0' }
  }
  if (l === 'stryker stop') return { ok: true, detail: '' }
  if (l === 'stryker results') return { status: 'measured', reason: '', file: `${T}/stryker.json` }
  if (l === 'assemble') return { ok: true, detail: 'written' }
  if (l === 'report') return { path: '/c/docs/metrics/quality-report-2026-10-15.md', atAGlance: 'x', summary: [], attention: ['a'], verdict: 'v' }
  if (l.startsWith('check')) return { exit: l === 'check #1' ? 1 : 0, lines: ['  🔴 x'] }
  if (l.startsWith('repair')) return { fixed: ['x'], files: [] }
  if (l === 'coherence') return { fixed: [], remaining: [], byHand: [] }
  if (l === 'cleanup') return { ok: true, endedAt: 1000 + 60 * 42, detail: '' }
  console.log('UNHANDLED', l); return null
}
const fn = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'log', 'phase', 'parallel', 'workflow', src)
const parallel = async ts => Promise.all(ts.map(t => t().catch(() => null)))
fn(`--stryker ${variant === 'off' || variant === 'nocollect' ? 'off' : 'full'} --date 2026-10-15 --checkout /c`, agent, () => {}, () => {}, parallel, async () => null)
  .then(r => {
    const at = l => labels.indexOf(l)
    const measures = ['sonarqube + coverage', 'audit-collect', 'inventory', 'activity']
    if (at('stryker start') >= 0 && measures.some(m => at(m) > at('stryker start'))) console.log('WARN Stryker started before a measure')
    if (r.status !== 'BLOCKED' && at('cleanup') !== labels.length - 1) console.log('WARN cleanup not last')
    const a = prompts.assemble || ''
    if (variant === 'off' && !a.includes("--stryker-status skipped --stryker-reason 'Stryker off for this run'")) console.log('WARN off: risk-cross not told Stryker was skipped')
    if (variant === 'full' && !a.includes('--stryker-dir /tmp/cctoolkit-run/r/stryker-abcdef012345')) console.log('WARN full: risk-cross without the reports')
    if (variant === 'nocollect' && (a.includes('risk-cross') || a.includes('hotspot_risk='))) console.log('WARN nocollect: cross kept without collect')
    if (a && !a.includes('"status": "not_configured"')) console.log('WARN sonarqube evidence not carried into meta')
    if (a && !a.includes('--last')) console.log('WARN meta not merged last')
    console.log('STATUS', r.status, '| stryker', r.evidence ? r.evidence.stryker.status : 'none', r.evidence ? r.evidence.stryker.reason : '', '| minutes', r.minutes)
    console.log('AGENTS', labels.join(' | '))
  })
  .catch(e => { console.log('ERR', e.stack); process.exitCode = 1 })
