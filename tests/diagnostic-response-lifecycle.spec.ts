import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { streamWithCodexRequestDiagnostics, withCodexDiagnosticFetch } from '../src/request-diagnostics.ts'
import { OpenAICodexBackendRequests } from '../src/backend-request.ts'

const options: GenerateOptions = { provider: 'openai-codex', model: 'gpt-6-sol', messages: [] }
const endpoint = 'https://chatgpt.com/backend-api/codex/responses'
const cases = [false, true].flatMap(paused => ['abort', 'dispose', 'network'].map(kind => ({ paused, kind })))
describe('diagnostic response lifecycle without further reads', () => {
  it.each(cases)('$kind reaches reader.closed when paused=$paused', async ({ paused, kind }) => {
    const requests = new OpenAICodexBackendRequests(undefined, undefined, 1)
    const abort = new AbortController()
    const cancelled = vi.fn()
    const reason = new Error('synthetic upstream failure')
    let source!: ReadableStreamDefaultController<Uint8Array>
    let calls = 0
    try {
      for await (const _chunk of streamWithCodexRequestDiagnostics(async function* () {
        const wrapped = withCodexDiagnosticFetch({ fetch: async () => {
          calls += 1
          if (calls > 1) return new Response('next request')
          return new Response(new ReadableStream<Uint8Array>({ start(c) {
            source = c
            c.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"fixture"}\n\n'))
          }, cancel: cancelled }), { headers: { 'content-type': 'text/event-stream' } })
        } }, requests)!
        const response = await wrapped.fetch!(endpoint, { signal: abort.signal })
        const reader = response.body!.getReader()
        let observed: unknown
        const closed = reader.closed.catch(error => { observed = error })
        try {
          if (paused) expect((await reader.read()).done).toBe(false)
          if (kind === 'abort') abort.abort(reason)
          else if (kind === 'dispose') requests.dispose()
          else source.error(reason)
          await vi.waitFor(() => { expect(observed).toBeDefined() }, { timeout: 1000 })
          if (kind === 'dispose') expect(observed).toMatchObject({ name: 'AbortError' })
          else expect(observed).toBe(reason)
          await closed
          if (kind === 'network') expect(cancelled).not.toHaveBeenCalled()
          else expect(cancelled).toHaveBeenCalledOnce()
          if (kind !== 'dispose') expect(await (await wrapped.fetch!(endpoint)).text()).toBe('next request')
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      }, options)) { /* Run inside the actual diagnostic AsyncLocalStorage scope. */ }
    } finally { requests.dispose() }
  })
})
