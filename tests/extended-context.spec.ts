import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import { ExtendedContextRegistry } from '../src/extended-context.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'

afterEach(() => { vi.unstubAllGlobals() })

function adapter(registry: ExtendedContextRegistry, maximum: () => readonly string[] = () => []) {
  vi.stubGlobal('fetch', () => { throw new Error('Network is forbidden in this test') })
  const credentials = {
    read: async () => ({ type: 'oauth', accountId: 'offline-account', access: 'offline-test-access', refresh: 'offline-test-refresh', expires: Date.now() + 3_600_000 }),
  } as unknown as OpenAICodexCredentialStore
  credentials.captureActiveAccount = async () => credentials
  return createOpenAICodexAdapter(credentials, () => undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, registry, maximum)
}

describe('session-local extended context', () => {
  it('defaults off, isolates sessions and captures the choice at request admission', () => {
    const registry = new ExtendedContextRegistry()
    const a = new AbortController().signal
    const b = new AbortController().signal
    registry.set('a', true)
    registry.bind(a, 'a')
    registry.bind(b, 'b')
    registry.set('a', false)
    expect(registry.forRequest(a)).toBe(true)
    expect(registry.forRequest(b)).toBe(false)
    expect(registry.forRequest(undefined)).toBe(false)
    registry.bind(a, 'a')
    expect(registry.forRequest(a)).toBe(false)
    expect(registry.size).toBe(0)
  })

  it('binds 272K or 500K to each prepared call without changing global metadata', async () => {
    const registry = new ExtendedContextRegistry()
    const runtime = adapter(registry)
    const a = new AbortController().signal
    const b = new AbortController().signal
    registry.set('a', true)
    registry.bind(a, 'a')
    registry.bind(b, 'b')
    const extended = await runtime.prepareCall('openai-codex', 'gpt-6.1-sol', a)
    const standard = await runtime.prepareCall('openai-codex', 'gpt-6.1-sol', b)
    expect(extended.model.context?.contextWindow).toBe(500_000)
    expect(standard.model.context?.contextWindow).toBe(272_000)
    expect({ ...extended.model, context: standard.model.context }).toEqual(standard.model)
    expect((await runtime.resolveModel('openai-codex', 'gpt-6.1-sol', a)).context?.contextWindow).toBe(500_000)
    expect((await runtime.resolveModel('openai-codex', 'gpt-6.1-sol', b)).context?.contextWindow).toBe(272_000)
    expect((await runtime.resolveModel('openai-codex', 'gpt-6.1-sol')).context?.contextWindow).toBe(272_000)
    registry.set('a', false)
    registry.bind(a, 'a')
    expect((await runtime.prepareCall('openai-codex', 'gpt-6.1-sol', a)).model.context?.contextWindow).toBe(272_000)
    expect(extended.model.context?.contextWindow).toBe(500_000)
  })

  it('changes only the ON budget for a model and keeps prepared calls on their captured preference', async () => {
    const registry = new ExtendedContextRegistry()
    let maximum: string[] = []
    const runtime = adapter(registry, () => maximum)
    const signal = new AbortController().signal
    registry.set('a', true)
    registry.bind(signal, 'a', 'gpt-6.1-sol')
    const medium = await runtime.prepareCall('openai-codex', 'gpt-6.1-sol', signal)
    maximum = ['gpt-6.1-sol']
    const full = await runtime.prepareCall('openai-codex', 'gpt-6.1-sol', signal)
    expect(medium.model.context?.contextWindow).toBe(500_000)
    expect(full.model.context?.contextWindow).toBe(872_000)
    expect((await runtime.resolveModel('openai-codex', 'gpt-6.1-sol', signal)).context?.contextWindow).toBe(872_000)
    registry.set('a', false)
    registry.bind(signal, 'a', 'gpt-6.1-sol')
    expect((await runtime.prepareCall('openai-codex', 'gpt-6.1-sol', signal)).model.context?.contextWindow).toBe(272_000)
    registry.set('a', true)
    registry.bind(signal, 'a', 'gpt-6-astra')
    expect((await runtime.prepareCall('openai-codex', 'gpt-6-astra', signal)).model.context?.contextWindow).toBe(500_000)
    expect(registry.forRequest(signal, 'gpt-6.1-sol')).toBe(false)
    expect((await runtime.resolveModel('openai-codex', 'gpt-6.1-sol', signal)).context?.contextWindow).toBe(272_000)
    maximum = []
    expect(full.model.context?.contextWindow).toBe(872_000)
  })

  it('does not invent an extension for a model whose official maximum is its default', async () => {
    const registry = new ExtendedContextRegistry()
    const signal = new AbortController().signal
    registry.set('a', true)
    registry.bind(signal, 'a')
    const runtime = adapter(registry)
    expect((await runtime.prepareCall('openai-codex', 'gpt-5.5', signal)).model.context?.contextWindow).toBe(272_000)
  })
})
