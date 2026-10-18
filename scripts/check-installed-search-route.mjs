import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Exercise optional Codex Search through this exact Host's WebRuntime, without real accounts/network. */
export async function checkInstalledSearchRoute(importHost, CodexConnect) {
  const [{ Context }, { default: Llm }, { default: Web }, { default: Loader }] = await Promise.all([
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-web', '@deepseek-ai/cordis-plugin-loader',
  ].map(importHost))
  const root = await mkdtemp(join(tmpdir(), 'codex-installed-search-'))
  const oldHome = process.env.DSH_HOME
  const oldFetch = globalThis.fetch
  const oldSearchEnv = process.env.DSH_WEB_SEARCH_PROVIDER
  delete process.env.DSH_WEB_SEARCH_PROVIDER
  const ctx = new Context()
  process.env.DSH_HOME = root
  let dispatches = 0, fallbackCalls = 0, newerCalls = 0
  try {
    const claim = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'search-fixture' } })).toString('base64url')
    await new CodexConnect.OpenAICodexCredentialStore().modify('openai-codex', async () => ({
      type: 'oauth', accountId: 'search-fixture', access: `e30.${claim}.fixture`, refresh: 'fixture', expires: Date.now() + 3600000,
    }))
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://chatgpt.com/backend-api/codex/alpha/search')
      assert.equal(JSON.parse(init.body).input[0].content[0].text, 'Synthetic route query')
      dispatches++
      return Response.json({ output: 'Synthetic Codex search', results: [
        { type: 'text_result', url: 'https://example.invalid/one' },
        { type: 'text_result', url: 'https://example.invalid/two' },
      ] })
    }
    await ctx.plugin(Llm)
    await ctx.plugin(Loader)
    ctx.baseUrl = pathToFileURL(root).href + '/'
    ctx.loader.internal = { version: 'v2', async import(specifier) {
      assert.equal(specifier, 'fixture-web')
      return Web
    } }
    await ctx.loader.root.create({ id: 'fixture-web', name: 'fixture-web',
      config: { searchProvider: 'fixture-fallback', fetchProvider: 'fixture-fetch' } })
    await ctx.loader.await()
    const entry = ctx.loader.resolve('fixture-web')
    await entry.fiber.await()
    const web = ctx.web
    const originalConfig = Reflect.get(web, 'config')
    const volatile = typeof originalConfig?.searchProvider?.get === 'function'
    web.registerSearchProvider({ id: 'fixture-fallback', available: () => true, async search() {
      fallbackCalls++; return { content: 'Fallback', sources: [], truncated: false }
    } })
    web.registerSearchProvider({ id: 'fixture-newer', available: () => true, async search() {
      newerCalls++; return { content: 'Newer Host choice', sources: [], truncated: false }
    } })
    web.registerFetchProvider({ id: 'fixture-fetch', available: () => true, async fetch({ url }) {
      return { url, statusCode: 200, body: { kind: 'text', content: 'Unchanged fetch' }, truncated: false }
    } })
    const search = () => web.search({ query: 'Synthetic route query', maxResults: 1 })
    assert.equal((await search()).content, 'Fallback')
    for (let cycle = 0; cycle < 2; cycle++) {
      const plugin = await ctx.plugin(CodexConnect, { enableSearch: true })
      const result = await search()
      assert.equal(result.content, 'Synthetic Codex search')
      assert.equal(result.sources.length, 1)
      assert.equal(result.truncated, true)
      assert.equal((await web.fetch({ url: 'https://example.invalid/fetch' })).body.content, 'Unchanged fetch')
      await plugin.dispose()
      assert.equal((await search()).content, 'Fallback')
    }
    if (volatile) {
      const hostFiber = entry.fiber
      const change = async (value) => {
        await entry.update({ config: { fetchProvider: 'fixture-fetch',
          ...(value === undefined ? {} : { searchProvider: value }) } })
        assert.ok(entry.fiber === hostFiber, 'A volatile Host choice must retain the same fiber')
      }
      for (const initial of ['fixture-fallback', undefined]) {
        for (const readBetween of [true, false]) {
          await change(initial)
          const plugin = await ctx.plugin(CodexConnect, { enableSearch: true })
          assert.equal((await search()).content, 'Synthetic Codex search')
          const before = dispatches
          await change('fixture-newer')
          if (readBetween) assert.equal((await search()).content, 'Newer Host choice')
          await change(initial)
          const assertHostChoice = async () => {
            if (initial === undefined) await assert.rejects(search(), { code: 'WEB_PROVIDER_AMBIGUOUS' })
            else assert.equal((await search()).content, 'Fallback')
          }
          await assertHostChoice()
          assert.equal(dispatches, before, 'Host round trips must never dispatch to Codex')
          assert.equal((await web.fetch({ url: 'https://example.invalid/fetch' })).body.content, 'Unchanged fetch')
          await plugin.dispose()
          assert.ok(Reflect.get(web, 'config') === originalConfig)
          await assertHostChoice()
        }
      }
    }
    assert.equal(dispatches, volatile ? 6 : 2)
    assert.equal(fallbackCalls, volatile ? 7 : 3)
    assert.equal(newerCalls, volatile ? 2 : 0)
    return { syntheticOnly: true, dispatches, reloadCycles: 2, sourceLimitVerified: true,
      fetchRouteUnchanged: true, restorationVerified: true, volatileHostChoiceVerified: volatile, hostRoundTripCases: volatile ? 4 : 0,
      betweenSearchUpdatesVerified: volatile, unsetSelectionVerified: volatile }
  } finally {
    try { await ctx.fiber.dispose() } finally {
      globalThis.fetch = oldFetch
      if (oldSearchEnv === undefined) delete process.env.DSH_WEB_SEARCH_PROVIDER
      else process.env.DSH_WEB_SEARCH_PROVIDER = oldSearchEnv
      if (oldHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = oldHome
      await rm(root, { recursive: true, force: true })
    }
  }
}
