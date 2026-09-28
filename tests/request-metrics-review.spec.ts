import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OpenAICodexBackendRequests } from '../src/backend-request.ts'
import { streamWithCodexRequestDiagnostics, withCodexDiagnosticFetch } from '../src/request-diagnostics.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { RequestMetrics } from '../src/request-metrics.ts'
import { buildMetricReport, readMetricJournal } from '../src/request-metrics-report.ts'

const endpoint = 'https://chatgpt.com/backend-api/codex/responses'
const terminal = 'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":1}}}\n\n'

describe('independent metrics review regressions', () => {
  it.each([false, true])('keeps anomalous metadata byte-for-byte transparent with metrics enabled=%s', async enabled => {
    const dir = await mkdtemp(join(tmpdir(), 'metrics-review-'))
    const writer = enabled ? new RequestMetrics(dir) : undefined
    const requests = new OpenAICodexBackendRequests(undefined, undefined, 1, undefined, writer)
    const cancel = vi.fn()
    const payload = 'data: {"type":{"toString":null}}\n\n' + terminal
    let index = 0
    const wrapped = requests.wrapFetch({ lane: 'model', fetch: async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { if (index++ === 0) controller.enqueue(new TextEncoder().encode(payload)); else controller.close() },
      cancel,
    }), { headers: { 'content-type': 'text/event-stream' } }) })
    try {
      for await (const chunk of streamWithCodexRequestDiagnostics(async function* () {
        const diagnosticFetch = withCodexDiagnosticFetch({ fetch: wrapped })!
        expect(await (await diagnosticFetch.fetch!(endpoint)).text()).toBe(payload)
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      }, { provider: 'openai-codex', model: 'gpt-6-sol', messages: [] } as GenerateOptions)) expect(chunk.type).toBe('finish')
      expect(cancel).not.toHaveBeenCalled()
      // The completed response must release the sole admission slot.
      const second = requests.wrapFetch({ lane: 'model', fetch: async () => new Response(terminal, { headers: { 'content-type': 'text/event-stream' } }) })
      expect(await (await second(endpoint)).text()).toBe(terminal)
      requests.dispose()
      if (writer) {
        const report = buildMetricReport([await readMetricJournal(writer.filename)])
        expect(report.total.outcomes).toEqual({ completed: 2 })
        expect(report.total.usage['input']?.observedTokens).toBe(6)
      }
    } finally { requests.dispose(); await rm(dir, { recursive: true, force: true }) }
  })

  it.each([
    ['closed'], ['stopped'], ['started', 'stopped', 'closed'], ['started', 'closed', 'stopped'],
  ])('rejects impossible collection sequence %j', async (...states: string[]) => {
    const dir = await mkdtemp(join(tmpdir(), 'metrics-collection-review-'))
    try {
      const path = join(dir, 'journal.jsonl')
      const id = '00000000-0000-0000-0000-000000000001'
      await writeFile(path, states.map((state, at) => JSON.stringify({ schemaVersion: 1, event: 'collection', id, at, state })).join('\n') + '\n')
      const journal = await readMetricJournal(path)
      expect(() => buildMetricReport([journal])).toThrow(/collection/i)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it.each(['closed', 'stopped'])('keeps legitimate collection termination %s', async state => {
    const dir = await mkdtemp(join(tmpdir(), 'metrics-collection-control-'))
    try {
      const path = join(dir, 'journal.jsonl')
      const id = '00000000-0000-0000-0000-000000000001'
      await writeFile(path, ['started', state].map((s, at) => JSON.stringify({ schemaVersion: 1, event: 'collection', id, at, state: s })).join('\n') + '\n')
      const report = buildMetricReport([await readMetricJournal(path)])
      expect(report.recording.closed).toBe(state === 'closed' ? 1 : 0)
      expect(report.recording.stoppedEarly).toBe(state === 'stopped' ? 1 : 0)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})

const collectionId = '00000000-0000-0000-0000-000000000010'
const requestId = '00000000-0000-0000-0000-000000000011'
const collection = (state: string) => ({ schemaVersion: 1, event: 'collection', id: collectionId, at: 1, state })
const start = { schemaVersion: 1, event: 'start', id: requestId, at: 2, lane: 'model', callId: requestId, session: null, model: 'gpt-6-sol', effort: 'low', purpose: 'conversation', version: 'test' }
const finish = { schemaVersion: 1, event: 'finish', id: requestId, at: 3, elapsedMs: 1, status: 200, outcome: 'completed', usage: { input: 3, output: 1, cachedInput: null, cacheWrite: null, reasoningOutput: null }, observation: 'observed' }
async function reportFor(events: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'metrics-record-review-'))
  try {
    const path = join(dir, 'journal.jsonl')
    await writeFile(path, events.map(e => JSON.stringify(e)).join('\n') + '\n')
    return buildMetricReport([await readMetricJournal(path)])
  } finally { await rm(dir, { recursive: true, force: true }) }
}
describe('strict journal types and per-file recording phase', () => {
  it.each([
    ['state', collection('closed')], ['lane', start], ['purpose', start], ['outcome', finish], ['observation', finish],
  ])('rejects array-valued %s instead of coercing it', async (key, row) => {
    const invalid = { ...row, [key as string]: [(row as Record<string, unknown>)[key as string]] }
    await expect(reportFor([collection('started'), invalid])).rejects.toThrow(/record/)
  })
  it.each([
    { name: 'unframed requests', events: [start, finish] },
    { name: 'request before collection', events: [start, collection('started'), finish, collection('closed')] },
    { name: 'request after close', events: [collection('started'), collection('closed'), start, finish] },
    { name: 'request after recording stop', events: [collection('started'), collection('stopped'), start, finish] },
  ])('rejects $name', async ({ events }) => {
    await expect(reportFor(events)).rejects.toThrow(/collection|journal/)
  })
  it('retains a valid closed journal with an unfinished attempt as incomplete evidence', async () => {
    const report = await reportFor([collection('started'), start, collection('closed')])
    expect(report.total.outcomes).toEqual({ 'pending-or-interrupted': 1 })
    expect(report.recording.closed).toBe(1)
  })
})
