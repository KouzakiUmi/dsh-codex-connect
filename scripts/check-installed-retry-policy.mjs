import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Check the packed plugin's public Host policy and prepared-call contract without provider traffic. */
export async function checkInstalledRetryPolicy(importHost, CodexConnect) {
  const [{ Context }, { default: Llm, resolveRetryPolicy }] = await Promise.all([
    importHost('@deepseek-ai/cordis'), importHost('@deepseek-ai/dsh-llm'),
  ])
  const directory = await mkdtemp(join(tmpdir(), 'codex-installed-retry-'))
  const previousHome = process.env.DSH_HOME
  const previousFetch = globalThis.fetch
  let realProviderRequests = 0
  let cases = 0
  process.env.DSH_HOME = directory
  globalThis.fetch = () => { realProviderRequests++; throw new Error('Unexpected provider request in retry policy fixture') }
  try {
    for (const retryPolicy of [
      undefined,
      { mode: 'normal', maxRetries: 10, retryableCodes: ['TRANSPORT', 'TIMEOUT'],
        backoff: { initialDelayMs: 1_000, maxDelayMs: 20_000, jitterRatio: 0.1 } },
      { mode: 'normal', maxRetries: 0 },
      { mode: 'always', backoff: { initialDelayMs: 1_000, maxDelayMs: 20_000, jitterRatio: 0 } },
    ]) {
      const ctx = new Context()
      try {
        await ctx.plugin(Llm)
        const plugin = await ctx.plugin(CodexConnect, retryPolicy === undefined ? {} : { retryPolicy })
        const expected = resolveRetryPolicy(retryPolicy, 'installed fixture')
        assert.deepEqual(ctx.llm.providerRetryPolicy('openai-codex'), expected)
        const prepared = await ctx.llm.prepareCall({ provider: 'openai-codex', model: 'gpt-6.1-sol' })
        assert.deepEqual(prepared.retryPolicy, expected)
        await plugin.dispose()
        assert.ok(!ctx.llm.listProviders().some(provider => provider.id === 'openai-codex'))
        await ctx.plugin(CodexConnect, {})
        assert.deepEqual(ctx.llm.providerRetryPolicy('openai-codex'), resolveRetryPolicy(undefined, 'installed fixture'))
        assert.deepEqual(prepared.retryPolicy, expected)
        cases++
      } finally { await ctx.fiber.dispose() }
    }
    for (const retryPolicy of [
      { mode: 'normal', unknown: true },
      { mode: 'normal', backoff: { unknown: true } },
    ]) {
      assert.throws(() => CodexConnect.Config({ retryPolicy }), /retryPolicy.*unknown key/u)
      cases++
    }
    assert.equal(realProviderRequests, 0)
    return { syntheticOnly: true, cases, preparedPolicyVerified: true, omittedDefaultsPreserved: true,
      disposalVerified: true, realProviderRequests }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    globalThis.fetch = previousFetch
    await rm(directory, { recursive: true, force: true })
  }
}
