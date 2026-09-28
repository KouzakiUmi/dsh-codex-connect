/** Built, boot-free CLI acceptance using synthetic evidence and an isolated home. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'codex-metrics-built-'))
try {
  const file = join(root, 'synthetic.jsonl')
  const id = '00000000-0000-0000-0000-000000000001'
  const collectionId = '00000000-0000-0000-0000-000000000002'
  const events = [
    { schemaVersion: 1, event: 'collection', id: collectionId, at: 0, state: 'started' },
    { schemaVersion: 1, event: 'start', id, at: 1, lane: 'model', callId: id,
      session: null, model: 'gpt-6-astra', effort: 'medium', purpose: 'conversation', version: 'synthetic' },
    { schemaVersion: 1, event: 'finish', id, at: 2, elapsedMs: 1, status: 200, outcome: 'completed',
      usage: { input: 1000, cachedInput: 900, cacheWrite: null, output: 100, reasoningOutput: 60 }, observation: 'observed' },
    { schemaVersion: 1, event: 'collection', id: collectionId, at: 3, state: 'closed' },
  ]
  await writeFile(file, events.map(event => JSON.stringify(event)).join('\n') + '\n', { mode: 0o600 })
  const run = args => spawnSync(process.execPath, ['lib/bin.js', 'metrics', ...args], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, env: { ...process.env, DSH_HOME: root },
  })
  const json = run(['--file', file, '--json'])
  assert.equal(json.status, 0, json.stderr)
  const report = JSON.parse(json.stdout)
  assert.equal(report.total.attempts, 1)
  assert.equal(report.total.cacheHitRate.ratio, 0.9)
  assert.equal(report.total.usage.output.observedTokens, 100)
  assert.equal(report.total.usage.cacheWrite.unknownAttempts, 1)
  assert.equal(report.apiCostEstimate, null)
  assert.equal(report.subscriptionQuotaCost, null)
  const human = run(['--file', file])
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /not a subscription bill/u)
  assert.match(human.stdout, /unknown is not zero/u)
  assert.equal(run(['--file', file, '--file', file]).status, 1)
  assert.equal(run(['--probe']).status, 1)
  console.log('Built request metrics CLI: JSON/human output, unknown usage, no quota conversion, and invalid input checks passed (synthetic evidence only)')
} finally { await rm(root, { recursive: true, force: true }) }
