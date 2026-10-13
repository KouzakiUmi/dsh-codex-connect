import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { it } from 'vitest'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import { OpenAICodexBackendRequests } from '../src/backend-request.ts'
import { OpenAICodexCredentialStore, OPENAI_CODEX_PROVIDER } from '../src/store.ts'
import type { CapturedOpenAICodexAccount } from '../src/store.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}

function access(): string {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' } })).toString('base64url')}.fixture`
}

/** Only captureActiveAccount is used by the adapter; no filesystem methods run. */
class SyntheticCredentialStore extends OpenAICodexCredentialStore {
  readonly memory = new InMemoryCredentialStore()
  readonly queued = deferred<void>()
  readonly committed = deferred<void>()
  captures = 0
  writes = 0
  private modifications = 0

  constructor() { super('synthetic-unused-auth.json') }

  async seed(expired = true): Promise<void> {
    await this.memory.modify(OPENAI_CODEX_PROVIDER, async () => ({
      type: 'oauth', accountId: 'fixture-account', access: access(),
      refresh: 'fixture-refresh', expires: expired ? 1 : Date.now() + 3_600_000,
    }))
  }

  override async captureActiveAccount(): Promise<CapturedOpenAICodexAccount> {
    this.captures += 1
    const snapshot: CapturedOpenAICodexAccount = {
      accounts: async () => [],
      captureActiveAccount: async () => snapshot,
      read: this.memory.read.bind(this.memory),
      list: this.memory.list.bind(this.memory),
      delete: this.memory.delete.bind(this.memory),
      modify: async (providerId, fn, options) => {
        const before = this.writes
        const mutation = this.memory.modify(providerId, async current => {
          const next = await fn(current)
          if (next !== undefined) this.writes += 1
          return next
        }, options)
        this.modifications += 1
        if (this.modifications === 2) this.queued.resolve()
        const result = await mutation
        if (this.writes > before) this.committed.resolve()
        return result
      },
    }
    return snapshot
  }
}

type Route = 'stream' | 'prepared'
type Adapter = ReturnType<typeof createOpenAICodexAdapter>

async function streamFor(adapter: Adapter, route: Route, signal?: AbortSignal) {
  const options: GenerateOptions = {
    provider: OPENAI_CODEX_PROVIDER, model: 'gpt-5.6-sol', messages: [],
    ...(signal === undefined ? {} : { signal }),
  }
  if (route === 'stream') return adapter.stream(options)
  const prepared = await adapter.prepareCall(options.provider, options.model, signal)
  return prepared.stream(options)
}

async function collect(stream: AsyncIterable<StreamChunk>) {
  const events: StreamChunk[] = []
  try {
    for await (const event of stream) events.push(event)
    return { events, error: undefined }
  } catch (error: unknown) { return { events, error } }
}

function assertAborted(result: Awaited<ReturnType<typeof collect>>): void {
  assert.deepEqual(result.events, [])
  assert(result.error instanceof Error)
  assert('code' in result.error)
  assert.equal(result.error.code, 'ABORTED')
  assert.equal(result.error.name, 'AbortError')
  assert(!inspect(result.error, { depth: null }).includes('fixture-private-cancellation'))
  assert(!('cause' in result.error))
}

function refreshFixture() {
  const started = deferred<void>()
  const finish = deferred<void>()
  let refreshes = 0
  let dispatches = 0
  let refreshSignal: AbortSignal | null | undefined
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input).includes('/oauth/token')) {
      refreshes += 1
      refreshSignal = init?.signal
      started.resolve()
      await finish.promise
      return Response.json({ access_token: access(), refresh_token: 'fixture-rotated', expires_in: 3600 })
    }
    dispatches += 1
    return new Response('offline fixture', { status: 400 })
  }
  return { started, finish, fetch, counts: () => ({ refreshes, dispatches }), signal: () => refreshSignal }
}

for (const route of ['stream', 'prepared'] as const) {
  for (const expired of [true, false]) {
    it(`${route}: pre-cancelled ${expired ? 'expired' : 'valid'} auth never captures, refreshes or writes`, async () => {
      const credentials = new SyntheticCredentialStore()
      await credentials.seed(expired)
      const fixture = refreshFixture()
      const originalFetch = globalThis.fetch
      globalThis.fetch = fixture.fetch
      try {
        const adapter = createOpenAICodexAdapter(credentials, () => undefined)
        const controller = new AbortController()
        controller.abort(new Error('fixture-private-cancellation'))
        assertAborted(await collect(await streamFor(adapter, route, controller.signal)))
        assert.equal(credentials.captures, 0)
        assert.equal(credentials.writes, 0)
        assert.deepEqual(fixture.counts(), { refreshes: 0, dispatches: 0 })
      } finally { fixture.finish.resolve(); globalThis.fetch = originalFetch }
    })
  }

  it(`${route}: cancellation settles auth promptly but preserves an already-started token rotation`, async () => {
    const credentials = new SyntheticCredentialStore()
    await credentials.seed()
    const fixture = refreshFixture()
    const originalFetch = globalThis.fetch
    globalThis.fetch = fixture.fetch
    try {
      const adapter = createOpenAICodexAdapter(credentials, () => undefined)
      const controller = new AbortController()
      const result = collect(await streamFor(adapter, route, controller.signal))
      await fixture.started.promise
      controller.abort(new Error('fixture-private-cancellation'))
      // The caller must settle before the deliberately stalled refresh can complete.
      assertAborted(await result)
      assert.equal(credentials.writes, 0)
      assert.deepEqual(fixture.counts(), { refreshes: 1, dispatches: 0 })
      // pi-ai bounds a started rotation with its own timeout, not the caller's signal.
      assert.equal(fixture.signal()?.aborted, false)
      fixture.finish.resolve()
      await credentials.committed.promise
      assert.equal(credentials.writes, 1)
      assert.deepEqual(fixture.counts(), { refreshes: 1, dispatches: 0 })
    } finally { fixture.finish.resolve(); globalThis.fetch = originalFetch }
  })

  for (const cancelled of ['refreshing', 'queued'] as const) {
    it(`${route}: cancelling the ${cancelled} request does not cancel its concurrent peer`, async () => {
      const credentials = new SyntheticCredentialStore()
      await credentials.seed()
      const fixture = refreshFixture()
      const originalFetch = globalThis.fetch
      globalThis.fetch = fixture.fetch
      try {
        const adapter = createOpenAICodexAdapter(credentials, () => undefined)
        const first = new AbortController()
        const second = new AbortController()
        const firstResult = collect(await streamFor(adapter, route, first.signal))
        await fixture.started.promise
        const secondResult = collect(await streamFor(adapter, route, second.signal))
        // Observe admission to the real in-memory store's serialized lock queue.
        await credentials.queued.promise
        assert.equal(credentials.captures, 2)
        const controller = cancelled === 'refreshing' ? first : second
        controller.abort(new Error('fixture-private-cancellation'))
        assertAborted(await (cancelled === 'refreshing' ? firstResult : secondResult))
        assert.equal((cancelled === 'refreshing' ? second : first).signal.aborted, false)
        assert.deepEqual(fixture.counts(), { refreshes: 1, dispatches: 0 })
        fixture.finish.resolve()
        const peer = await (cancelled === 'refreshing' ? secondResult : firstResult)
        assert.equal(peer.error, undefined)
        assert.equal(credentials.writes, 1)
        assert.deepEqual(fixture.counts(), { refreshes: 1, dispatches: 1 })
      } finally { fixture.finish.resolve(); globalThis.fetch = originalFetch }
    })
  }

  it(`${route}: plugin disposal aborts auth and prevents subsequent authentication`, async () => {
    const credentials = new SyntheticCredentialStore()
    await credentials.seed()
    const fixture = refreshFixture()
    const originalFetch = globalThis.fetch
    globalThis.fetch = fixture.fetch
    const requests = new OpenAICodexBackendRequests()
    try {
      const adapter = createOpenAICodexAdapter(credentials, () => undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, requests)
      // There is intentionally no caller signal: disposal alone must reach auth.
      const result = collect(await streamFor(adapter, route))
      await fixture.started.promise
      requests.dispose()
      assertAborted(await result)
      assert.equal(requests.signal.aborted, true)
      assertAborted(await collect(await streamFor(adapter, route)))
      assert.equal(credentials.captures, 1)
      assert.deepEqual(fixture.counts(), { refreshes: 1, dispatches: 0 })
      fixture.finish.resolve()
      await credentials.committed.promise
      assert.equal(credentials.writes, 1)
      assert.deepEqual(fixture.counts(), { refreshes: 1, dispatches: 0 })
    } finally { requests.dispose(); fixture.finish.resolve(); globalThis.fetch = originalFetch }
  })
}
