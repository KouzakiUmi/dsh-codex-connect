import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canaryTrackerAction, buildCanaryTrackingIssue } from './canary-tracking.mjs'

const metadata = { runUrl: 'https://github.com/example/repo/actions/runs/123', pluginCommit: 'a'.repeat(40) }
const report = { channel: 'next', candidateVersion: '9.0.0', supportedVersion: '1.0.0', status: 'fail', classification: 'compatibility', summary: 'missing peer' }
const tracking = buildCanaryTrackingIssue(report, report, metadata)
const existing = { state: 'open', title: tracking.title, body: tracking.body }
assert.equal(canaryTrackerAction(undefined, tracking), 'create')
assert.equal(canaryTrackerAction(existing, tracking), 'unchanged')
assert.equal(canaryTrackerAction({ ...existing, state: 'closed', state_reason: 'completed' }, tracking), 'reopen')
assert.equal(canaryTrackerAction({ ...existing, state: 'closed', state_reason: 'not_planned' }, tracking), 'suppressed')
for (const changed of [
  buildCanaryTrackingIssue(report, { ...report, summary: 'different missing peer' }, metadata),
  buildCanaryTrackingIssue(report, report, { ...metadata, runUrl: `${metadata.runUrl}4` }),
  buildCanaryTrackingIssue(report, { ...report, checkedAt: '2026-09-29T00:00:00Z' }, metadata),
]) assert.equal(canaryTrackerAction(existing, changed), 'update')

// Execute the actual privileged workflow script against a fake GitHub API.
// No checkout, candidate code, credentials, artifacts or network are involved.
const workflow = readFileSync(new URL('../.github/workflows/canary-run-health.yml', import.meta.url), 'utf8')
assert.ok(workflow.includes('workflows: [Upstream DSH canary, Compatibility canary]'))
assert.ok(!/actions\/checkout|download-artifact|secrets\./u.test(workflow))
const source = workflow.split('          script: |\n')[1].split('\n').map(line => line.replace(/^            /u, '')).join('\n')
const execute = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'core', source)
const run = { id: 123, workflow_id: 7, head_branch: 'main', head_repository: { full_name: 'example/repo' }, event: 'schedule', name: 'Upstream DSH canary', conclusion: 'failure', html_url: metadata.runUrl, head_sha: metadata.pluginCommit, updated_at: '2026-09-29T00:00:00Z' }
async function observe(overrides = {}, issues = [], latest = 123, jobs = []) {
  const writes = []
  await execute({
    paginate: async method => method === listJobs ? jobs : issues,
    rest: {
      actions: { listJobsForWorkflowRun: listJobs, listWorkflowRuns: async () => ({ data: { workflow_runs: [{ id: latest }] } }) },
      issues: {
        listForRepo() {},
        create: async data => writes.push({ operation: 'create', ...data }),
        update: async data => writes.push({ operation: 'update', ...data }),
      },
    },
  }, { repo: { owner: 'example', repo: 'repo' }, payload: { workflow_run: { ...run, ...overrides } } }, { notice() {} })
  return writes
}
function listJobs() {}
assert.equal((await observe())[0].operation, 'create')
for (const overrides of [
  { conclusion: 'success' }, { head_branch: 'untrusted' },
  { head_repository: { full_name: 'other/repo' } }, { event: 'pull_request' },
]) assert.equal((await observe(overrides)).length, 0)
assert.equal((await observe({}, [], 124)).length, 0)
const failedChannel = { name: 'canary (next)', conclusion: 'failure', steps: [{ name: 'Fail after two unsuccessful checks', conclusion: 'failure' }] }
assert.equal((await observe({}, [{ body: tracking.body }], 123, [failedChannel])).length, 0)
assert.equal((await observe({}, [{ body: tracking.body }], 123, [failedChannel, { ...failedChannel, name: 'canary (alpha)' }]))[0].operation, 'create')
assert.equal((await observe({}, [{ body: tracking.body }], 123, [{ ...failedChannel, steps: [{ name: 'Record candidate tracking state', conclusion: 'failure' }] }]))[0].operation, 'create')
const health = { number: 10, state: 'open', body: '<!-- dsh-canary-run-health:7 -->' }
assert.equal((await observe({ conclusion: 'success' }, [health]))[0].state, 'open')
assert.match((await observe({ conclusion: 'success' }, [health]))[0].body, /recovery evidence only/u)
assert.equal((await observe({}, [{ ...health, state: 'closed', state_reason: 'not_planned' }])).length, 0)
assert.equal((await observe({}, [{ ...health, state: 'closed', state_reason: 'completed' }]))[0].state, 'open')
assert.equal((await observe({ conclusion: 'success' }, [{ ...health, state: 'closed' }])).length, 0)
for (const conclusion of ['timed_out', 'cancelled', 'startup_failure']) assert.equal((await observe({ conclusion }))[0].operation, 'create')
console.log('canary maintenance: tracker freshness, decisions and workflow health scenarios passed')
