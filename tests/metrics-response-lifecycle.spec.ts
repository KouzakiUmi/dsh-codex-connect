import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RequestMetrics } from '../src/request-metrics.ts'
import { buildMetricReport, readMetricJournal } from '../src/request-metrics-report.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { streamWithCodexRequestDiagnostics, withCodexDiagnosticFetch } from '../src/request-diagnostics.ts'
import { OpenAICodexBackendRequests } from '../src/backend-request.ts'

const options: GenerateOptions = { provider: 'openai-codex', model: 'gpt-6-sol', messages: [] }
const endpoint = 'https://chatgpt.com/backend-api/codex/responses'
const cases = [false, true].flatMap(paused => ['abort', 'dispose', 'network'].flatMap(kind => [false, true].map(enabled => ({ paused, kind, enabled }))))
describe('diagnostic response lifecycle without further reads', () => {
  it.each(cases)('$kind reaches reader.closed when paused=$paused and metrics=$enabled', async ({ paused, kind, enabled }) => {
    const directory = await mkdtemp(join(tmpdir(), 'metrics-lifecycle-'))
    const metrics = enabled ? new RequestMetrics(directory) : undefined
    const requests = new OpenAICodexBackendRequests(undefined, undefined, 1, undefined, metrics)
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
    requests.dispose()
    if (metrics) {
      const report = buildMetricReport([await readMetricJournal(metrics.filename)])
      expect(report.total.attempts).toBe(calls)
      expect(report.total.outcomes[kind === 'network' ? 'network-error' : 'cancelled']).toBe(1)
      expect(report.recording.closed).toBe(1)
      expect(report.total.outcomes['pending-or-interrupted']).toBeUndefined()
    }
    } finally { requests.dispose(); await rm(directory, { recursive: true, force: true }) }
  })
})
