import { zstdDecompressSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import { ConversationSpeedRegistry } from '../src/conversation-speed.ts'
import { openAICodexAccountKey } from '../src/store.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'

afterEach(() => { vi.unstubAllGlobals() })
it.each(['gpt-6-astra', 'gpt-6.1-sol'])('passes %s Ultrafast through the real pi-ai SSE transport without changing reasoning or confirming entitlement', async model => {
  const registry = new ConversationSpeedRegistry()
  const accountId = 'synthetic-speed-wire'
  const scope = { workspace: registry.workspaceFor('wire'), accountKey: openAICodexAccountKey(accountId), provider: 'openai-codex', model }
  const state = registry.readSpeed('wire', scope)
  registry.selectSpeed('wire', scope, state.generation, state.revision, 'ultrafast')
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const credentials = { read: async () => ({ type: 'oauth', accountId, refresh: 'synthetic-only', expires: Date.now() + 3600000,
    access: `${encode({ alg: 'none' })}.${encode({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })}.synthetic` }) } as unknown as OpenAICodexCredentialStore
  credentials.captureActiveAccount = async () => credentials
  const wires: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit) => {
    expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses')
    const raw = new Headers(init.headers).get('content-encoding') === 'zstd'
      ? zstdDecompressSync(init.body as Uint8Array).toString('utf8') : String(init.body)
    wires.push(JSON.parse(raw))
    const item = { type: 'message', id: 'msg_speed_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture', annotations: [] }] }
    return new Response([
      { type: 'response.created', response: { id: 'resp_speed_fixture', status: 'in_progress', model } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'resp_speed_fixture', status: 'completed', model, service_tier: 'ultrafast', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  }))
  const adapter = createOpenAICodexAdapter(credentials, () => undefined, registry)
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'openai-codex', model, sessionId: SessionId('wire'), messages: [], reasoningEffort: ReasoningEffortId('max'), maxTokens: 1024 })) chunks.push(chunk)
  expect(wires).toHaveLength(1)
  expect(wires[0]).toMatchObject({ model, service_tier: 'ultrafast', stream: true, reasoning: { effort: 'max' } })
  expect(chunks).toContainEqual(expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } }))
  // Even a fixture's explicit completed tier does not become an account entitlement cache.
  expect(registry.readSpeed('wire', scope).eligibility).toBe('unknown')
})
