import { describe, expect, it, vi } from 'vitest'
import type { AssistantMessageEventStream, TranscriptContext, Model, Provider, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { withOpenAICodexOutputStyle } from '../src/adapter.ts'
import type { CodexSimpleStreamOptions, OpenAICodexOutputStyle } from '../src/adapter.ts'

function model(provider = 'openai-codex'): Model<'openai-codex-responses'> {
  return { provider, id: 'gpt-6-astra', name: 'GPT-6-Astra', api: 'openai-codex-responses', contextWindow: 1, input: ['text'] } as unknown as Model<'openai-codex-responses'>
}

const BASE_PAYLOAD = { model: 'gpt-6-astra', input: [], text: { verbosity: 'low' }, reasoning: { effort: 'low', summary: 'none' } }

function fixture() {
  const captured: { options: SimpleStreamOptions | undefined; payloads: unknown[] } = { options: undefined, payloads: [] }
  const streamSimple = vi.fn((_model: Model<'openai-codex-responses'>, _context: TranscriptContext, options?: SimpleStreamOptions) => {
    captured.options = options
    void Promise.resolve(options?.onPayload?.(structuredClone(BASE_PAYLOAD), model()))
      .then(payload => { captured.payloads.push(payload) })
    return {} as AssistantMessageEventStream
  })
  const provider = {
    id: 'openai-codex',
    name: 'openai-codex',
    auth: { apiKey: { name: 'test', resolve: async () => undefined } },
    getModels: () => [],
    stream: streamSimple,
    streamSimple,
  } as unknown as Provider
  return { captured, provider }
}

function style(verbosity: OpenAICodexOutputStyle['verbosity'], reasoningSummary: OpenAICodexOutputStyle['reasoningSummary']): () => OpenAICodexOutputStyle {
  return () => ({ verbosity, reasoningSummary })
}

/** The fixture pushes captured payloads through an async onPayload chain; flush every pending tick. */
function settle(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
}

describe('OpenAI Codex output-style adapter boundary', () => {
  it('passes explicit verbosity and reasoning summary through stream options without touching the payload', async () => {
    const f = fixture()
    const wrapped = withOpenAICodexOutputStyle(f.provider, style('medium', 'detailed'))
    wrapped.streamSimple(model(), {} as TranscriptContext, { temperature: 0.2 })
    const captured = f.captured.options as CodexSimpleStreamOptions | undefined
    expect(captured).toEqual(expect.objectContaining({
      temperature: 0.2,
      textVerbosity: 'medium',
      reasoningSummary: 'detailed',
    }))
    await settle()
    expect(f.captured.payloads).toContainEqual(BASE_PAYLOAD)
  })

  it('resolves the model-default verbosity to the catalog value and always sends text.verbosity', async () => {
    const f = fixture()
    const wrapped = withOpenAICodexOutputStyle(f.provider, style('default', 'detailed'))
    wrapped.streamSimple(model(), {} as TranscriptContext, {})
    const options = f.captured.options as CodexSimpleStreamOptions | undefined
    expect(options?.textVerbosity).toBe('low')
    expect(await options?.onPayload?.(structuredClone(BASE_PAYLOAD), model())).toEqual(BASE_PAYLOAD)
  })

  it('removes reasoning.summary from the payload when the summary is none, as the official client does', async () => {
    const f = fixture()
    const wrapped = withOpenAICodexOutputStyle(f.provider, style('high', 'none'))
    wrapped.streamSimple(model(), {} as TranscriptContext, {})
    expect(f.captured.options).toEqual(expect.objectContaining({ textVerbosity: 'high', reasoningSummary: 'none' }))
    const options = f.captured.options as CodexSimpleStreamOptions | undefined
    expect(await options?.onPayload?.({ model: 'gpt-6-astra', reasoning: { effort: 'medium', summary: 'none' } }, model()))
      .toEqual({ model: 'gpt-6-astra', reasoning: { effort: 'medium' } })
  })

  it('runs an existing payload replacement before the summary strip', async () => {
    const f = fixture()
    const wrapped = withOpenAICodexOutputStyle(f.provider, style('default', 'concise'))
    const onPayload = vi.fn(async () => ({ existing: true, reasoning: { effort: 'low', summary: 'none' } }))
    wrapped.streamSimple(model(), {} as TranscriptContext, { onPayload })
    const options = f.captured.options as CodexSimpleStreamOptions | undefined
    expect(options?.reasoningSummary).toBe('concise')
    // The summary is concise, so the replacement's own fields pass through unchanged.
    expect(await options?.onPayload?.({ original: true }, model()))
      .toEqual({ existing: true, reasoning: { effort: 'low', summary: 'none' } })
    expect(onPayload).toHaveBeenCalledWith({ original: true }, expect.objectContaining({ provider: 'openai-codex' }))
  })

  it('lets a previous payload hook add fields that survive the summary strip', async () => {
    const f = fixture()
    const wrapped = withOpenAICodexOutputStyle(f.provider, style('default', 'none'))
    const onPayload = vi.fn(async (payload: unknown) => ({ ...(payload as Record<string, unknown>), service_tier: 'priority' }))
    wrapped.streamSimple(model(), {} as TranscriptContext, { onPayload })
    const options = f.captured.options
    expect(await options?.onPayload?.({ model: 'gpt-6-astra', reasoning: { effort: 'low', summary: 'none' } }, model()))
      .toEqual({ model: 'gpt-6-astra', reasoning: { effort: 'low' }, service_tier: 'priority' })
  })

  it('keeps requests unchanged when no style resolver is configured', () => {
    const f = fixture()
    const wrapped = withOpenAICodexOutputStyle(f.provider, () => undefined)
    const options: SimpleStreamOptions = { temperature: 0.2 }
    wrapped.streamSimple(model(), {} as TranscriptContext, options)
    expect(f.captured.options).toEqual(options)
  })
})
