import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { streamWithCodexRequestDiagnostics, withCodexDiagnosticFetch } from '../src/request-diagnostics.ts'
import { OpenAICodexBackendRequests } from '../src/backend-request.ts'

const options: GenerateOptions = { provider: 'openai-codex', model: 'gpt-6-sol', messages: [] }
const endpoint = 'https://chatgpt.com/backend-api/codex/responses'
describe('non-throwing diagnostic event types', () => {
  it.each([undefined, null, { toString: null }, ['response.completed'], 7])('preserves bytes for untrusted type %j in the actual diagnostic scope', async type => {
    const payload = 'data: ' + JSON.stringify({ type }) + '\n\n'
      + 'data: {"type":"response.completed","response":{"status":"completed"}}\n\n'
      + 'data: {"type":"error","code":"unread_later"}\n\n'
    const cancelled = vi.fn()
    const requests = new OpenAICodexBackendRequests(undefined, undefined, 1)
    let sent = 0
    const underlying = async () => {
      sent += 1
      return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(payload)); c.close() }, cancel: cancelled }),
        { headers: { 'content-type': 'text/event-stream' } })
    }
    const chunks: StreamChunk[] = []
    try {
      for await (const chunk of streamWithCodexRequestDiagnostics(async function* () {
        const wrapped = withCodexDiagnosticFetch({ fetch: underlying }, requests)!
        expect(await (await wrapped.fetch!(endpoint)).text()).toBe(payload)
        expect(await (await wrapped.fetch!(endpoint)).text()).toBe(payload)
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'FIXTURE', message: 'Original failure' } } } as StreamChunk
      }, options)) chunks.push(chunk)
      expect(sent).toBe(2)
      expect(cancelled).not.toHaveBeenCalled()
      const output = JSON.stringify(chunks)
      expect(output).toContain('Original failure')
      expect(output).not.toContain('unread_later')
      expect(output).not.toContain('Cannot convert')
    } finally { requests.dispose() }
  })

  it('stops attribution at an invalid type without relying on an intervening terminal', async () => {
    const payload = 'data: {"type":{"toString":null}}\n\n'
      + 'data: {"type":"error","code":"later_unattributable"}\n\n'
    const requests = new OpenAICodexBackendRequests(undefined, undefined, 1)
    const chunks: StreamChunk[] = []
    try {
      for await (const chunk of streamWithCodexRequestDiagnostics(async function* () {
        const wrapped = withCodexDiagnosticFetch({ fetch: async () => new Response(payload, { headers: { 'content-type': 'text/event-stream' } }) }, requests)!
        expect(await (await wrapped.fetch!(endpoint)).text()).toBe(payload)
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'FIXTURE', message: 'Original failure' } } } as StreamChunk
      }, options)) chunks.push(chunk)
      expect(JSON.stringify(chunks)).toContain('Original failure')
      expect(JSON.stringify(chunks)).not.toContain('later_unattributable')
    } finally { requests.dispose() }
  })

  it('forwards consumer cancellation after an invalid frame and releases admission', async () => {
    const bytes = new TextEncoder().encode('data: {"type":{"toString":null}}\n\n')
    const cancelled = vi.fn()
    let requestsSent = 0
    const requests = new OpenAICodexBackendRequests(undefined, undefined, 1)
    try {
      for await (const _chunk of streamWithCodexRequestDiagnostics(async function* () {
        const wrapped = withCodexDiagnosticFetch({ fetch: async () => {
          requestsSent += 1
          if (requestsSent === 2) return new Response('after cancellation')
          return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes) }, cancel: cancelled }),
            { headers: { 'content-type': 'text/event-stream' } })
        } }, requests)!
        const reader = (await wrapped.fetch!(endpoint)).body!.getReader()
        expect((await reader.read()).value).toEqual(bytes)
        await reader.cancel('fixture cancellation')
        reader.releaseLock()
        expect(cancelled).toHaveBeenCalledOnce()
        expect(cancelled).toHaveBeenCalledWith('fixture cancellation')
        expect(await (await wrapped.fetch!(endpoint)).text()).toBe('after cancellation')
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      }, options)) { /* Consume the diagnostic scope to completion. */ }
      expect(requestsSent).toBe(2)
    } finally { requests.dispose() }
  })
})
