import { expect, it, vi } from 'vitest'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { createOpenAICodexAdapter, openAICodexModelCatalog, withOpenAICodexModels, withOpenAICodexContextWindowOverrides } from '../src/adapter.ts'
import { openAICodexContextLimit } from '../src/model-contract.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'

const id = 'gpt-6.1-sol'
it('advertises the calibrated Sol61 default through the production catalog', () => {
  const native = openaiCodexProvider().getModels()
  const snapshot = structuredClone(native)
  expect(openAICodexModelCatalog().find(model => model.id === id)).toMatchObject({ contextWindow: 500_000, maxContextWindow: 872_000 })
  expect(native).toEqual(snapshot)
})
it('uses the same calibrated default for a missing Sol61 entry', () => {
  const provider = openaiCodexProvider()
  const fallback = withOpenAICodexModels({ ...provider, getModels: () => provider.getModels().filter(model => model.id !== id) })
  expect(fallback.getModels().find(model => model.id === id)).toMatchObject({ contextWindow: 500_000, maxTokens: 128_000 })
})
it('resolves the calibrated model through the real Host adapter without an account request', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network forbidden') })
  try {
    const adapter = createOpenAICodexAdapter({} as OpenAICodexCredentialStore, () => undefined)
    await expect(adapter.resolveModel('openai-codex', id)).resolves.toMatchObject({ context: { contextWindow: 500_000 } })
    expect(network).not.toHaveBeenCalled()
  } finally { network.mockRestore() }
})
it.each([272_000, 320_000, 500_000, 600_000])('preserves explicitly supplied provider metadata at %i', contextWindow => {
  const provider = openaiCodexProvider(), native = { ...provider.getModels()[0]!, id, contextWindow, maxTokens: 96_000 }
  const wrapped = withOpenAICodexModels({ ...provider, getModels: () => [native] })
  expect(wrapped.getModels().find(model => model.id === id)).toMatchObject({ contextWindow, maxTokens: 96_000 })
  const override = withOpenAICodexContextWindowOverrides(wrapped, { [id]: 450_000 })
  expect(override.getModels().find(model => model.id === id)).toMatchObject({ contextWindow: 450_000, maxTokens: 96_000 })
  expect(native.contextWindow).toBe(contextWindow)
  expect(openAICodexContextLimit(id, contextWindow).maxContextWindow).toBe(872_000)
})
it('calibrates a known stale bundled entry without changing its other metadata', () => {
  const provider = openaiCodexProvider(), native = { ...provider.getModels()[0]!, id, contextWindow: 272_000, maxTokens: 96_000 }
  const wrapped = withOpenAICodexModels({ ...provider, getModels: () => [native] }, 'bundled-static')
  expect(wrapped.getModels().find(model => model.id === id)).toMatchObject({ contextWindow: 500_000, maxTokens: 96_000 })
  expect(native.contextWindow).toBe(272_000)
})
it.each([320_000, 500_000, 600_000])('keeps a different bundled default at %i instead of applying a blanket replacement', contextWindow => {
  const provider = openaiCodexProvider(), native = { ...provider.getModels()[0]!, id, contextWindow, maxTokens: 96_000 }
  const wrapped = withOpenAICodexModels({ ...provider, getModels: () => [native] }, 'bundled-static')
  expect(wrapped.getModels().find(model => model.id === id)).toMatchObject({ contextWindow, maxTokens: 96_000 })
})
it('changes only Sol61 when calibrating a complete bundled catalog', () => {
  const provider = openaiCodexProvider(), models = [...provider.getModels(), { ...provider.getModels()[0]!, id, contextWindow: 272_000 }]
  const supplied = { ...provider, getModels: () => models }
  const baseline = withOpenAICodexModels(supplied).getModels()
  const calibrated = withOpenAICodexModels(supplied, 'bundled-static').getModels()
  expect(calibrated.filter(model => model.id !== id)).toEqual(baseline.filter(model => model.id !== id))
  expect(calibrated.find(model => model.id === id)).toEqual({ ...baseline.find(model => model.id === id)!, contextWindow: 500_000 })
})
