import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModels } from '@earendil-works/pi-ai'

afterEach(() => {
  vi.doUnmock('../src/host-pi-ai-resolution.ts')
  vi.resetModules()
})

describe('host pi-ai forward loading', () => {
  it.each(['1.2.1', '1.3.0', '2.0.0', '2.1.0-beta.1'])('allows host %s with the existing public API', async version => {
    vi.resetModules()
    vi.doMock('../src/host-pi-ai-resolution.ts', async () => {
      const actual = await vi.importActual<typeof import('../src/host-pi-ai-resolution.ts')>('../src/host-pi-ai-resolution.ts')
      return { ...actual, resolveHostPiAiPackage: (entry: string) => ({ ...actual.resolveHostPiAiPackage(entry), version }) }
    })
    const bridge = await import('../src/host-pi-ai.ts')
    expect(bridge.createModels).toBe(createModels)
    expect(typeof bridge.openaiCodexProvider).toBe('function')
    expect(typeof bridge.normalizeContext).toBe('function')
  })
})
