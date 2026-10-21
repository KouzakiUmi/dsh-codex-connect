import { afterEach, expect, it, vi } from 'vitest'
import { OpenAICodexPreflightActivity } from '../src/preflight-activity.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

const origin = 'http://127.0.0.1:7890'
const headers = { 'content-type': 'text/event-stream', 'x-bili-preflight': 'compressing' }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function observe(response: Response, inspect: (wrapped: Response) => Promise<void>) {
  const activity = new OpenAICodexPreflightActivity({ protocol: 'bili-v1', trustedProxyOrigin: origin, maxDurationMs: 450_000 })
  vi.stubGlobal('fetch', vi.fn(async () => response))
  const delegate = async function* (options: GenerateOptions): AsyncIterable<StreamChunk> {
    activity.activate(options.signal!)
    const request = activity.wrap({ signal: options.signal! }, origin)
    await inspect(await request.fetch!('https://chatgpt.com/backend-api/codex/responses'))
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
  }
  for await (const _chunk of activity.stream(delegate, { provider: 'openai-codex', model: 'synthetic', messages: [] })) { /* drain */ }
}

it('preserves fragmented UTF-8 and response metadata without reading ahead', async () => {
  let pulls = 0
  const bytes = new TextEncoder().encode(': bili-preflight\r\n\r\ndata: {"text":"你好🙂"}\n\n')
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls === bytes.length) { controller.close(); return }
      controller.enqueue(bytes.slice(pulls, ++pulls))
    },
  }, { highWaterMark: 0 }), { status: 201, statusText: 'Fixture', headers })
  Object.defineProperty(response, 'url', { value: 'https://chatgpt.com/backend-api/codex/responses' })
  Object.defineProperty(response, 'redirected', { value: false })
  await observe(response, async wrapped => {
    expect(pulls).toBe(0)
    expect(wrapped.status).toBe(201)
    expect(wrapped.statusText).toBe('Fixture')
    expect(wrapped.url).toBe(response.url)
    expect(wrapped.redirected).toBe(response.redirected)
    expect(wrapped.type).toBe(response.type)
    const actual: Record<string, string> = {}
    wrapped.headers.forEach((value, name) => { actual[name] = value })
    expect(actual).toEqual(headers)
    const reader = wrapped.body!.getReader()
    const first = await reader.read()
    expect(pulls).toBe(1)
    const result = [...first.value!]
    while (true) {
      const next = await reader.read()
      if (next.done) break
      result.push(...next.value)
    }
    reader.releaseLock()
    expect(new Uint8Array(result)).toEqual(bytes)
    expect(response.body!.locked).toBe(false)
  })
})

it('awaits source cancellation and releases its reader after cleanup', async () => {
  const cleanup = Promise.withResolvers<void>()
  const cancelled = vi.fn(() => cleanup.promise)
  const response = new Response(new ReadableStream({ cancel: cancelled }, { highWaterMark: 0 }), { headers })
  await observe(response, async wrapped => {
    let settled = false
    const reason = new Error('synthetic consumer stopped')
    const pending = wrapped.body!.cancel(reason).then(() => { settled = true })
    await Promise.resolve()
    expect(cancelled).toHaveBeenCalledWith(reason)
    expect(settled).toBe(false)
    expect(response.body!.locked).toBe(true)
    cleanup.resolve()
    await pending
    expect(response.body!.locked).toBe(false)
  })
})

it('retains the original total budget after a second fetch instead of resetting it', async () => {
  vi.useFakeTimers()
  const activity = new OpenAICodexPreflightActivity({ protocol: 'bili-v1', trustedProxyOrigin: origin, maxDurationMs: 450_000 })
  const sources: ReadableStreamDefaultController<Uint8Array>[] = []
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { sources.push(controller) },
  }, { highWaterMark: 0 }), { headers })))
  const second = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  const delegate = async function* (options: GenerateOptions): AsyncIterable<StreamChunk> {
    activity.activate(options.signal!)
    const wrapped = activity.wrap({ signal: options.signal! }, origin)
    const one = await wrapped.fetch!('https://chatgpt.com/backend-api/codex/responses')
    readers.push(one.body!.getReader())
    ready.resolve()
    await second.promise
    const two = await wrapped.fetch!('https://chatgpt.com/backend-api/codex/responses')
    readers.push(two.body!.getReader())
    await new Promise<void>(() => {})
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
  }
  const iterator = activity.stream(delegate, { provider: 'openai-codex', model: 'synthetic', messages: [] })[Symbol.asyncIterator]()
  const pending = iterator.next().catch(error => error)
  await ready.promise
  for (let index = 0; index < 20; index++) {
    await vi.advanceTimersByTimeAsync(15_000)
    const read = readers[0]!.read()
    sources[0]!.enqueue(new TextEncoder().encode(': bili-preflight\n\n'))
    await read
  }
  second.resolve()
  await vi.advanceTimersByTimeAsync(0)
  expect(sources).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(149_999)
  await vi.advanceTimersByTimeAsync(1)
  expect(await pending).toMatchObject({ code: 'TIMEOUT', message: 'Codex preflight timeout after 450000ms' })
  for (const reader of readers) { await reader.cancel(); reader.releaseLock() }
  expect(vi.getTimerCount()).toBe(0)
})
