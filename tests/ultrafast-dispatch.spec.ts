import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import type { AssistantMessageEventStream, Provider } from '@earendil-works/pi-ai'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import { ConversationSpeedRegistry } from '../src/conversation-speed.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'

const observed = vi.hoisted(() => [] as Array<{ account: string | undefined; payload: unknown }>)
vi.mock('@earendil-works/pi-ai/providers/openai-codex', async importOriginal => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai/providers/openai-codex')>()
  return { ...actual, openaiCodexProvider: (): Provider => ({ ...actual.openaiCodexProvider(),
    streamSimple(model, _context, options) {
      const base = { model: model.id, input: [], reasoning: { effort: options?.reasoning }, max_output_tokens: options?.maxTokens }
      const finished = Promise.resolve(options?.onPayload?.(base, model)).then(payload => {
        observed.push({ account: options?.apiKey, payload: payload ?? base })
      })
      return {
        async *[Symbol.asyncIterator]() { await finished; throw new Error('offline capture complete') },
        result: async () => { await finished; throw new Error('offline capture complete') },
      } as unknown as AssistantMessageEventStream
    },
  }) }
})
afterEach(() => { observed.length = 0; vi.unstubAllGlobals() })
function accountKey(account: string) { return 'acct_' + createHash('sha256').update(account).digest('base64url') }
function setup() {
  const network = vi.fn(() => { throw new Error('network forbidden') }); vi.stubGlobal('fetch', network)
  const current = { account: 'offline-a', wait: undefined as Promise<void> | undefined, captures: 0 }
  const credentials = { captureActiveAccount: async () => {
    const account = current.account
    current.captures++
    await current.wait
    const snapshot = { read: async () => ({ type: 'oauth' as const, accountId: account,
      access: 'access-' + account, refresh: 'refresh-' + account, expires: Date.now() + 3_600_000 }) }
    return snapshot
  } } as unknown as OpenAICodexCredentialStore
  const registry = new ConversationSpeedRegistry()
  const scope = (model = 'gpt-6.1-sol') => ({ workspace: registry.workspace, accountKey: accountKey(current.account), provider: 'openai-codex', model })
  const choose = (mode: 'standard' | 'fast' | 'ultrafast', model = 'gpt-6.1-sol') => {
    const selection = registry.readSpeed('session', scope(model))
    registry.selectSpeed('session', scope(model), selection.generation, selection.revision, mode)
  }
  const adapter = createOpenAICodexAdapter(credentials, () => undefined, registry)
  const run = async (model = 'gpt-6.1-sol', purpose?: 'compaction' | 'session-title') => {
    for await (const _chunk of adapter.stream({ provider: 'openai-codex', model, sessionId: SessionId('session'), messages: [], reasoningEffort: ReasoningEffortId('max'), maxTokens: 1024,
      ...(purpose === undefined ? {} : { purpose }) })) { /* offline capture */ }
  }
  return { current, registry, scope, choose, run, network }
}
it.each(['gpt-6-astra', 'gpt-6.1-sol'])('dispatches an explicitly selected %s Ultrafast request with the normal captured account', async model => {
  const f = setup(); f.choose('ultrafast', model); await f.run(model)
  expect(observed).toEqual([{ account: 'access-offline-a', payload: { model, input: [], reasoning: { effort: 'max' }, max_output_tokens: 1024, service_tier: 'ultrafast' } }])
  expect(f.network).not.toHaveBeenCalled()
})
it.each(['compaction', 'session-title'] as const)('does not seed the conversation paid choice into an auxiliary %s request', async purpose => {
  const f = setup(); f.choose('ultrafast'); await f.run('gpt-6.1-sol', purpose); await f.run()
  expect(observed[0]!.payload).not.toHaveProperty('service_tier')
  expect(observed[1]!.payload).toHaveProperty('service_tier', 'ultrafast')
})
it('keeps Standard omitted and the legacy Fast priority route unchanged', async () => {
  const f = setup(); await f.run(); f.registry.set('session', true); await f.run()
  expect(observed[0]!.payload).not.toHaveProperty('service_tier')
  expect(observed[1]!.payload).toMatchObject({ service_tier: 'priority', reasoning: { effort: 'max' }, max_output_tokens: 1024 })
  expect(f.network).not.toHaveBeenCalled()
})
it('refuses stale model/account scopes before the provider is invoked and does not replay Standard', async () => {
  const f = setup(); f.choose('ultrafast'); await f.run('gpt-5.6-sol'); await f.run('gpt-5.6-sol')
  expect(observed).toEqual([]); expect(f.network).not.toHaveBeenCalled()
})
it('keeps an already captured request on its original account/tier while a later choice belongs to another account', async () => {
  const f = setup(); f.choose('ultrafast')
  let release!: () => void
  f.current.wait = new Promise<void>(resolve => { release = resolve })
  const pending = f.run()
  await vi.waitFor(() => { expect(f.current.captures).toBe(1) })
  f.current.account = 'offline-b'; f.choose('ultrafast')
  f.current.wait = undefined; release(); await pending; await f.run()
  expect(observed.map(row => ({ account: row.account, tier: (row.payload as Record<string, unknown>)['service_tier'] }))).toEqual([
    { account: 'access-offline-a', tier: 'ultrafast' }, { account: 'access-offline-b', tier: 'ultrafast' },
  ])
  expect(f.network).not.toHaveBeenCalled()
})
