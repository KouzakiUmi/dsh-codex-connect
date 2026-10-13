import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AssistantMessageEventStream, Provider } from '@earendil-works/pi-ai'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import { ExtendedContextRegistry } from '../src/extended-context.ts'
import { OpenAICodexCredentialStore, OPENAI_CODEX_PROVIDER } from '../src/store.ts'

const observed = vi.hoisted(() => [] as {
  apiKey: string | undefined
  contextWindow: number
  maxTokens: number | undefined
  transport: string | undefined
}[])
const streamGate = vi.hoisted(() => ({ pending: false, release: undefined as (() => void) | undefined }))

vi.mock('@earendil-works/pi-ai/providers/openai-codex', async importOriginal => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai/providers/openai-codex')>()
  return {
    ...actual,
    openaiCodexProvider: () => {
      const provider: Provider = {
        ...actual.openaiCodexProvider(),
        streamSimple(model, _context, options) {
          observed.push({ apiKey: options?.apiKey, contextWindow: model.contextWindow, maxTokens: options?.maxTokens, transport: options?.transport })
          if (streamGate.pending) {
            const waiting = new Promise<void>(resolve => { streamGate.release = resolve })
            return {
              async *[Symbol.asyncIterator]() {
                await waiting
                throw new Error('offline stream capture')
              },
              result: async () => { throw new Error('offline stream capture') },
            } as unknown as AssistantMessageEventStream
          }
          throw new Error('offline stream capture')
        },
      }
      return provider
    },
  }
})

afterEach(() => {
  observed.length = 0
  streamGate.pending = false
  streamGate.release = undefined
  vi.unstubAllGlobals()
})

describe('context-window request snapshots', () => {
  it('streams a prepared call with its captured window while new calls use the updated window and unchanged output budget', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('Network is forbidden in this test') })
    const credentials = {
      read: async () => ({ type: 'oauth', accountId: 'offline-account', access: 'offline-test-access', refresh: 'offline-test-refresh', expires: Date.now() + 3_600_000 }),
    } as unknown as OpenAICodexCredentialStore
    credentials.captureActiveAccount = async () => credentials
    const registry = new ExtendedContextRegistry()
    let maximumContextModels: string[] = []
    const signal = new AbortController().signal
    registry.set('a', true)
    registry.bind(signal, 'a')
    const adapter = createOpenAICodexAdapter(credentials, () => undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, registry, () => maximumContextModels)
    const prepared = await adapter.prepareCall('openai-codex', 'gpt-5.6-sol', signal)
    maximumContextModels = ['gpt-5.6-sol']
    const maximum = await adapter.prepareCall('openai-codex', 'gpt-5.6-sol', signal)
    maximumContextModels = []
    registry.set('a', false)
    registry.bind(signal, 'a')
    const current = await adapter.prepareCall('openai-codex', 'gpt-5.6-sol', signal)
    const options = { provider: 'openai-codex', model: 'gpt-5.6-sol', messages: [], maxTokens: 1024 }
    for (const call of [prepared, maximum, current]) {
      const events: unknown[] = []
      for await (const event of call.stream(options)) events.push(event)
      expect(events).toContainEqual({
        type: 'finish', reason: { kind: 'error', failure: { code: 'PI_AI_ERROR', message: 'offline stream capture' } },
      })
    }
    expect(observed).toEqual([
      { apiKey: 'offline-test-access', contextWindow: 500_000, maxTokens: 1024, transport: 'sse' },
      { apiKey: 'offline-test-access', contextWindow: 872_000, maxTokens: 1024, transport: 'sse' },
      { apiKey: 'offline-test-access', contextWindow: 272_000, maxTokens: 1024, transport: 'sse' },
    ])
  })

  it.each(['off', 'expanded', 'maximum'] as const)('keeps %s requests on their captured account while new requests use the selected account', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-openai-codex-request-account-'))
    try {
      const credentials = new OpenAICodexCredentialStore(join(root, 'auth.json'))
      const saved = (access: string, accountId: string) => ({
        type: 'oauth' as const,
        access,
        refresh: `refresh-${accountId}`,
        expires: Date.now() + 3_600_000,
        accountId,
      })
      await credentials.modify(OPENAI_CODEX_PROVIDER, () => Promise.resolve(saved('access-one', 'account-1')))
      const registry = new ExtendedContextRegistry()
      registry.set('a', mode !== 'off')
      const adapter = createOpenAICodexAdapter(credentials, () => undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, registry, () => mode === 'maximum' ? ['gpt-5.6-sol'] : [])
      const options = { provider: OPENAI_CODEX_PROVIDER, model: 'gpt-5.6-sol', sessionId: SessionId('a'), messages: [] }
      streamGate.pending = true
      const running = (async () => {
        for await (const _event of adapter.stream(options)) { /* no events in the offline stream */ }
      })()
      await vi.waitFor(() => { expect(observed).toHaveLength(1) })

      await credentials.modify(OPENAI_CODEX_PROVIDER, () => Promise.resolve(saved('access-two', 'account-2')))
      streamGate.pending = false
      const next = (async () => {
        for await (const _event of adapter.stream(options)) { /* no events in the offline stream */ }
      })()
      await next

      expect(observed.map(request => request.apiKey)).toEqual(['access-one', 'access-two'])
      const expectedWindow = mode === 'off' ? 272_000 : mode === 'expanded' ? 500_000 : 872_000
      expect(observed.map(request => request.contextWindow)).toEqual([expectedWindow, expectedWindow])
      streamGate.release?.()
      await running
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
