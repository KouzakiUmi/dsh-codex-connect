import { zstdDecompressSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import { OPENAI_CODEX_SPEED_MODE_PATH as PATH } from '../src/speed-mode-contract.ts'
import { speedLifecycleFixture } from './support/speed-lifecycle-fixture.ts'

afterEach(() => { vi.unstubAllGlobals() })
it.each(['model', 'account'])('clears the old paid choice at a real %s lifecycle boundary while keeping a captured old request guarded', async change => {
  const f = await speedLifecycleFixture()
  const wires: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit) => {
    expect(String(input)).toBe('https://chatgpt.com/backend-api/codex/responses')
    const body = new Headers(init.headers).get('content-encoding') === 'zstd'
      ? zstdDecompressSync(init.body as Uint8Array).toString('utf8') : String(init.body)
    const payload = JSON.parse(body) as Record<string, unknown>
    wires.push(payload)
    const item = { type: 'message', id: 'msg_lifecycle_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture', annotations: [] }] }
    return new Response([
      { type: 'response.created', response: { id: 'resp_lifecycle_fixture', status: 'in_progress', model: payload['model'] } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'resp_lifecycle_fixture', status: 'completed', model: payload['model'], output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  }))
  const adapter = createOpenAICodexAdapter(f.store, () => undefined, f.registry)
  const invoke = async (model: string) => {
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({ provider: 'openai-codex', model, sessionId: SessionId('session'), messages: [], reasoningEffort: ReasoningEffortId('max'), maxTokens: 1024 })) chunks.push(chunk)
    return chunks
  }
  const read = await f.request(`${PATH}?sessionId=session&model=gpt-6.1-sol`, { method: 'GET' })
  const state = await read.json() as { generation: string; revision: number }
  const chosen = await f.request(PATH, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session', model: 'gpt-6.1-sol', generation: state.generation, revision: state.revision, mode: 'ultrafast' }) })
  expect(chosen.status).toBe(200)
  expect(await invoke('gpt-6.1-sol')).toContainEqual(expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } }))
  expect(wires[0]).toMatchObject({ model: 'gpt-6.1-sol', service_tier: 'ultrafast' })
  const captured = f.registry.captureSpeed('session')
  const nextModel = change === 'model' ? 'gpt-6-sol' : 'gpt-6.1-sol'
  if (change === 'model') f.modelChanged(nextModel)
  else f.accountChanged()
  const next = await invoke(nextModel)
  expect(next).toContainEqual(expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } }))
  expect(wires).toHaveLength(2)
  expect(wires[1]).toMatchObject({ model: nextModel, reasoning: { effort: 'max' } })
  expect(wires[1]).not.toHaveProperty('service_tier')
  expect(() => f.registry.confirmCapturedSpeed('session', captured, f.scope('gpt-6.1-sol'))).toThrow('ULTRAFAST_SELECTION_EXPIRED')
})
