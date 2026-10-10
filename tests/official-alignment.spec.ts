import { describe, expect, it, vi } from 'vitest'
import type { AssistantMessageEventStream, Model, Provider, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai'
import { openAICodexModelCatalog, withOpenAICodexDefaultEffort } from '../src/adapter.ts'
import { OFFICIAL_CODEX_MODELS, OFFICIAL_CODEX_REMOVED_MODEL_IDS, officialCodexModel } from '../src/official-models.ts'
import { lastServedModel, servedModelFromHeaders, withServedModelObserver } from '../src/served-model.ts'

function model(id: string): Model<'openai-codex-responses'> {
  return { provider: 'openai-codex', id, name: id, api: 'openai-codex-responses', contextWindow: 1, input: ['text'] } as unknown as Model<'openai-codex-responses'>
}

function recordingProvider() {
  const streamSimple = vi.fn((_model: Model<'openai-codex-responses'>, _context: TranscriptContext, _options?: SimpleStreamOptions) => ({} as AssistantMessageEventStream))
  const provider = { id: 'openai-codex', name: 'openai-codex', getModels: () => [], stream: streamSimple, streamSimple } as unknown as Provider
  return { provider, streamSimple }
}

describe('official default effort', () => {
  it('applies the catalog default_reasoning_level when a request names no effort or off', () => {
    const { provider, streamSimple } = recordingProvider()
    const wrapped = withOpenAICodexDefaultEffort(provider)
    wrapped.streamSimple(model('gpt-6-astra'), {} as TranscriptContext, {})
    wrapped.streamSimple(model('gpt-6-sol'), {} as TranscriptContext, { reasoning: 'off' } as unknown as SimpleStreamOptions)
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ reasoning: 'low' })
    expect(streamSimple.mock.calls[1]?.[2]).toMatchObject({ reasoning: 'medium' })
  })

  it('keeps an explicit effort and leaves models outside the official catalog untouched', () => {
    const { provider, streamSimple } = recordingProvider()
    const wrapped = withOpenAICodexDefaultEffort(provider)
    const explicit: SimpleStreamOptions = { reasoning: 'high' }
    wrapped.streamSimple(model('gpt-6-astra'), {} as TranscriptContext, explicit)
    expect(streamSimple.mock.calls[0]?.[2]).toBe(explicit)
    const unknown: SimpleStreamOptions = {}
    wrapped.streamSimple(model('unlisted-model'), {} as TranscriptContext, unknown)
    expect(streamSimple.mock.calls[1]?.[2]).toBe(unknown)
  })

  it('gives the hidden gpt-reserve route the official medium default', () => {
    expect(officialCodexModel('gpt-reserve')).toMatchObject({ defaultReasoningLevel: 'medium', defaultReasoningSummary: 'none' })
  })
})

describe('official model list', () => {
  it('lists every visible official model and no removed one', () => {
    const ids = openAICodexModelCatalog().map(entry => entry.id)
    for (const official of OFFICIAL_CODEX_MODELS.filter(entry => entry.id !== 'gpt-reserve')) expect(ids).toContain(official.id)
    for (const removed of OFFICIAL_CODEX_REMOVED_MODEL_IDS) expect(ids).not.toContain(removed)
  })
})

describe('served model reporting', () => {
  it('reads the openai-model header case-insensitively and rejects empty or oversized values', () => {
    expect(servedModelFromHeaders({ 'OpenAI-Model': ' gpt-6-luna ' })).toBe('gpt-6-luna')
    expect(servedModelFromHeaders({ 'x-openai-model': 'gpt-5.6-sol' })).toBe('gpt-5.6-sol')
    expect(servedModelFromHeaders({ 'openai-model': '' })).toBeUndefined()
    expect(servedModelFromHeaders({ 'openai-model': 'x'.repeat(129) })).toBeUndefined()
    expect(servedModelFromHeaders({ 'content-type': 'text/event-stream' })).toBeUndefined()
  })

  it('records requested versus served model per session and forwards the original onResponse', async () => {
    const previous = vi.fn(async () => undefined)
    const observed = withServedModelObserver({ sessionId: 'session-served', onResponse: previous }, 'gpt-6-sol')
    await observed?.onResponse?.({ status: 200, headers: { 'openai-model': 'gpt-6-luna' } }, model('gpt-6-sol'))
    expect(previous).toHaveBeenCalledTimes(1)
    expect(lastServedModel('session-served')).toEqual({ requested: 'gpt-6-sol', served: 'gpt-6-luna' })
  })

  it('keeps the previous record when a response reports no served model', async () => {
    const observed = withServedModelObserver({ sessionId: 'session-kept' }, 'gpt-5.5')
    await observed?.onResponse?.({ status: 200, headers: { 'openai-model': 'gpt-5.5' } }, model('gpt-5.5'))
    await observed?.onResponse?.({ status: 200, headers: {} }, model('gpt-5.5'))
    expect(lastServedModel('session-kept')).toEqual({ requested: 'gpt-5.5', served: 'gpt-5.5' })
  })
})
