import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { zstdDecompressSync } from 'node:zlib'

/** Verify installed startup configuration, provider observation and offline reporting with synthetic HTTP only. */
export async function checkInstalledMetrics(importHost, CodexConnect, profilePackagePath) {
  const [{ Context }, { default: Llm }, { SessionId }] = await Promise.all([
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session',
  ].map(importHost))
  const directory = await mkdtemp(join(tmpdir(), 'codex-installed-metrics-'))
  const previousHome = process.env.DSH_HOME
  const previousFetch = globalThis.fetch
  const ctx = new Context()
  process.env.DSH_HOME = directory
  let dispatches = 0
  try {
    const access = 'e30.' + Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'metrics-fixture' },
    })).toString('base64url') + '.fixture'
    await new CodexConnect.OpenAICodexCredentialStore().modify('openai-codex', async () => ({
      type: 'oauth', accountId: 'metrics-fixture', access, refresh: 'fixture-refresh', expires: Date.now() + 3_600_000,
    }))
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://chatgpt.com/backend-api/codex/responses')
      const body = new Headers(init.headers).get('content-encoding') === 'zstd'
        ? zstdDecompressSync(init.body).toString('utf8') : String(init.body)
      const wire = JSON.parse(body)
      assert.equal(wire.model, 'gpt-6-astra')
      assert.equal(wire.prompt_cache_key, 'installed-metrics-fixture')
      dispatches++
      const usage = dispatches === 1 ? { input_tokens: 2048, input_tokens_details: { cached_tokens: 1024 }, output_tokens: 2 } : undefined
      const event = { type: 'response.completed', response: { id: 'fixture-response', status: 'completed', output: [], ...(usage ? { usage } : {}) } }
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }
    await ctx.plugin(Llm)
    const metrics = join(directory, 'metrics')
    const plugin = await ctx.plugin(CodexConnect, { requestMetricsDirectory: metrics })
    for (let index = 0; index < 2; index++) {
      const chunks = []
      for await (const chunk of ctx.llm.stream({ provider: 'openai-codex', model: 'gpt-6-astra',
        sessionId: SessionId('installed-metrics-fixture'), messages: [] })) chunks.push(chunk)
      assert.ok(chunks.some(chunk => chunk.type === 'finish'))
    }
    await plugin.dispose()
    assert.equal(dispatches, 2)
    const files = await readdir(metrics)
    assert.equal(files.length, 1)
    const file = join(metrics, files[0])
    assert.doesNotMatch(await readFile(file, 'utf8'), /fixture-refresh|metrics-fixture|fixture-response/)
    const entry = createRequire(profilePackagePath).resolve('dsh-codex-connect')
    const report = JSON.parse(execFileSync(process.execPath, [join(dirname(entry), 'bin.js'), 'metrics', '--file', file, '--json'], {
      encoding: 'utf8', timeout: 10000,
    }))
    assert.equal(report.total.attempts, 2)
    assert.equal(report.total.observedAdapterCalls, 2)
    assert.equal(report.total.cacheHitRate.ratio, 0.5)
    assert.equal(report.total.usage.input.unknownAttempts, 1)
    assert.equal(report.recording.closed, 1)
    assert.equal(report.apiCostEstimate, null)
    return { syntheticOnly: true, dispatches, startupConfiguration: true, installedCli: true, unknownUsagePreserved: true }
  } finally {
    try { await ctx.fiber.dispose() } finally {
      globalThis.fetch = previousFetch
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(directory, { recursive: true, force: true })
    }
  }
}
