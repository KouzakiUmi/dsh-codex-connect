import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import type { OpenAICodexContextTiers } from '../src/model-contract.ts'
import { openAICodexModelContextWindow } from '../src/model-contract.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'

afterEach(() => { vi.unstubAllGlobals() })
function adapter(tiers: () => OpenAICodexContextTiers) {
  vi.stubGlobal('fetch', () => { throw new Error('Network forbidden') })
  const credentials = { read: async () => { throw new Error('Metadata must not read credentials') } } as unknown as OpenAICodexCredentialStore
  return createOpenAICodexAdapter(credentials, () => undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, tiers)
}
describe('persistent model context tiers', () => {
  it.each([['standard', 272_000], ['extended', 500_000], ['maximum', 872_000]] as const)('uses %s on unbound metadata and fresh manual signals', async (tier, window) => {
    const runtime = adapter(() => ({ 'gpt-6.1-sol': tier }))
    expect((await runtime.resolveModel('openai-codex', 'gpt-6.1-sol')).context?.contextWindow).toBe(window)
    expect((await runtime.prepareCall('openai-codex', 'gpt-6.1-sol', new AbortController().signal)).model.context?.contextWindow).toBe(window)
    expect((await runtime.listModels('openai-codex')).some(model => model.id === 'gpt-6.1-sol')).toBe(true)
  })
  it('updates existing sessions immediately, isolates models and retains prepared snapshots', async () => {
    let tiers: OpenAICodexContextTiers = {}
    const runtime = adapter(() => tiers)
    const old = await runtime.prepareCall('openai-codex', 'gpt-6.1-sol')
    tiers = { 'gpt-6.1-sol': 'extended' }
    const expanded = await runtime.prepareCall('openai-codex', 'gpt-6.1-sol')
    expect(expanded.model.context?.contextWindow).toBe(500_000)
    expect((await runtime.resolveModel('openai-codex', 'gpt-6-astra')).context?.contextWindow).toBe(272_000)
    expect({ ...old.model, context: expanded.model.context }).toEqual(expanded.model)
    tiers = { 'gpt-6.1-sol': 'maximum' }
    expect((await runtime.resolveModel('openai-codex', 'gpt-6.1-sol')).context?.contextWindow).toBe(872_000)
    tiers = { 'gpt-6.1-sol': null }
    expect((await runtime.resolveModel('openai-codex', 'gpt-6.1-sol')).context?.contextWindow).toBe(272_000)
    expect(old.model.context?.contextWindow).toBe(500_000)
    expect(expanded.model.context?.contextWindow).toBe(500_000)
  })
  it('clamps finite tiers to supported windows without inventing unknown-model capacity', () => {
    expect(openAICodexModelContextWindow('gpt-5.5', 272_000, 'maximum')).toBe(272_000)
    expect(openAICodexModelContextWindow('unlisted-model', 100_000, 'extended')).toBe(100_000)
    expect(openAICodexModelContextWindow('unlisted-model', 100_000, 'maximum')).toBe(100_000)
  })
})
