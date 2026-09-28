import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { OpenAICodexBackendRequests } from '../src/backend-request.ts'
import { RequestMetrics } from '../src/request-metrics.ts'
import { buildMetricReport, readMetricJournal } from '../src/request-metrics-report.ts'
import { streamWithCodexRequestDiagnostics, withCodexDiagnosticFetch } from '../src/request-diagnostics.ts'

const endpoint = 'https://chatgpt.com/backend-api/codex/responses'
const options: GenerateOptions = { provider: 'openai-codex', model: 'gpt-6-sol', messages: [] }
describe('pending read cancellation accounting', () => {
  it.each([false, true])('records cancellation once and retains admission until cleanup, diagnostics=%s', async diagnostics => {
    const directory = await mkdtemp(join(tmpdir(), 'metrics-pending-cancel-'))
    const metrics = new RequestMetrics(directory)
    const manager = new OpenAICodexBackendRequests(undefined, undefined, 1, undefined, metrics)
    let release!: () => void
    const cleanup = new Promise<void>(resolve => { release = resolve })
    const cancel = vi.fn(() => cleanup)
    let calls = 0
    const fetch = async () => {
      calls += 1
      return calls === 1
        ? new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { 'content-type': 'text/event-stream' } })
        : new Response('next response')
    }
    try {
      for await (const _chunk of streamWithCodexRequestDiagnostics(async function* () {
        const wrapped = diagnostics ? withCodexDiagnosticFetch({ fetch }, manager)!.fetch! : manager.wrapFetch({ lane: 'model', fetch })
        const first = await wrapped(endpoint)
        const reader = first.body!.getReader()
        const pending = reader.read()
        // Let both wrapper pulls enter the underlying pending read.
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        const cancelling = reader.cancel('fixture cancellation')
        await pending
        await vi.waitFor(() => { expect(cancel).toHaveBeenCalledOnce() })
        const second = wrapped(endpoint)
        try {
          await new Promise<void>(resolve => setTimeout(resolve, 10))
          expect(calls).toBe(1)
        } finally { release(); await cancelling; reader.releaseLock() }
        expect(await (await second).text()).toBe('next response')
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      }, options)) { /* Consume scoped flow. */ }
      manager.dispose()
      const report = buildMetricReport([await readMetricJournal(metrics.filename)])
      expect(report.total.attempts).toBe(2)
      expect(report.total.outcomes).toEqual({ cancelled: 1, unobserved: 1 })
      expect(report.recording.closed).toBe(1)
    } finally { release(); manager.dispose(); await rm(directory, { recursive: true, force: true }) }
  })

  it('retains existing prompt abort semantics while source cleanup is delayed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'metrics-abort-policy-'))
    const metrics = new RequestMetrics(directory)
    const manager = new OpenAICodexBackendRequests(undefined, undefined, 1, undefined, metrics)
    const abort = new AbortController()
    let release!: () => void
    const cleanup = new Promise<void>(resolve => { release = resolve })
    const cancel = vi.fn(() => cleanup)
    let calls = 0
    try {
      const fetch = manager.wrapFetch({ lane: 'model', fetch: async () => {
        calls += 1
        return calls === 1 ? new Response(new ReadableStream<Uint8Array>({ cancel })) : new Response('next')
      } })
      const first = await fetch(endpoint, { signal: abort.signal })
      const next = fetch(endpoint)
      abort.abort(new Error('cancel logical attempt'))
      await vi.waitFor(() => { expect(calls).toBe(2) })
      expect(await (await next).text()).toBe('next')
      expect(cancel).toHaveBeenCalledOnce()
      await expect(first.text()).rejects.toThrow('cancel logical attempt')
      manager.dispose()
      const report = buildMetricReport([await readMetricJournal(metrics.filename)])
      expect(report.total.attempts).toBe(2)
      expect(report.total.outcomes).toEqual({ cancelled: 1, unobserved: 1 })
    } finally { release(); manager.dispose(); await rm(directory, { recursive: true, force: true }) }
  })
})
