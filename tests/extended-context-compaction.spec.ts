import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import type { OpenAICodexContextTiers } from '../src/model-contract.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'

const PROVIDER = 'openai-codex', MODEL = 'gpt-6.1-sol'
const fixtures: Array<{ ctx: Context; root: string }> = []
afterEach(async () => {
  for (const { ctx, root } of fixtures.splice(0)) { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function response(text: string, native = false): Response {
  const item = native ? { type: 'compaction', id: 'cmp_fixture', encrypted_content: 'synthetic-checkpoint' }
    : { type: 'message', id: 'msg_fixture', role: 'assistant', phase: 'final_answer', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
  return new Response([
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', model: MODEL, output: [item], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
/** Real Host routing, meter, maintenance transaction and JSONL; provider and account are synthetic. */
async function fixture(native = false) {
  const ctx = new Context(), root = await mkdtemp(join(tmpdir(), 'model-tier-compaction-'))
  fixtures.push({ ctx, root })
  let tiers: OpenAICodexContextTiers = { [MODEL]: 'maximum' }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const credentials = { read: async () => ({ type: 'oauth', accountId: 'synthetic-context',
    access: `${encode({ alg: 'none' })}.${encode({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-context' } })}.synthetic`,
    refresh: 'synthetic-only', expires: Date.now() + 3_600_000 }) } as unknown as OpenAICodexCredentialStore
  credentials.captureActiveAccount = async () => credentials
  const adapter = createOpenAICodexAdapter(credentials, () => undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, () => native,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, () => tiers)
  for (const service of [LlmRuntime, SessionStore, SessionProjections, SystemPrompt, ToolRuntime, AgentRegistry]) await ctx.plugin(service)
  await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(TokenMeter)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(BasicCompactionEngine, { auto: false, maxTokens: 2048, retainTokens: 0 })
  ctx.llm.registerAdapter([PROVIDER], adapter)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('existing-400k'), agentOptions: { provider: PROVIDER, model: MODEL } })
  let count = 0
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(init?.method).toBe('POST')
    const raw = new Headers(init?.headers).get('content-encoding') === 'zstd'
      ? zstdDecompressSync(init?.body as unknown as Uint8Array).toString('utf8') : String(init?.body)
    const body: { input: Array<{ type?: string }> } = JSON.parse(raw)
    return response(++count === 1 ? 'x'.repeat(1_600_000) : 'Concise retained history.', body.input.some(item => item.type === 'compaction_trigger'))
  })
  vi.stubGlobal('fetch', fetchMock)
  for (const text of ['Create historical decisions.', 'Record a short final decision.']) {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
    await agent.whenIdle(); await ctx.sessions.flush(agent.session)
  }
  const before = ctx.tokenMeter.measure(agent.session).totalTokens
  expect(before).toBeGreaterThanOrEqual(400_000)
  expect(before).toBeLessThan(500_000)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  tiers = { [MODEL]: 'standard' }
  expect((await ctx.llm.resolveModelInfo(PROVIDER, MODEL)).context?.contextWindow).toBe(272_000)
  return { ctx, agent, adapter, fetchMock, before, setTier: (tier: 'standard' | 'extended' | 'maximum') => { tiers = { [MODEL]: tier } } }
}
describe('existing oversized conversation manual compaction', () => {
  it('uses the saved window for Host pressure checks with an otherwise unbound signal', async () => {
    const f = await fixture()
    f.setTier('extended')
    const measurement = f.ctx.tokenMeter.measure(f.agent.session)
    // Synthetic boundary pressure, with the actual Host resolver and unchanged stored history.
    vi.spyOn(f.ctx.tokenMeter, 'measure').mockReturnValue({ ...measurement, totalTokens: 375_000 })
    expect(await f.ctx.compaction.compactIfNeeded(f.agent, 'pressure', new AbortController().signal)).toBeNull()
    expect(f.fetchMock).toHaveBeenCalledTimes(2)
    expect(f.agent.session.surface.replaceGeneration).toBe(0)
  })
  it.each([false, true])('uses the saved 500K tier immediately with native=%s and completes one manual transaction', async native => {
    const f = await fixture(native)
    f.setTier('extended') // No agent/request or pre-step occurs between the setting and /compact.
    expect((await f.ctx.llm.resolveModelInfo(PROVIDER, MODEL)).context?.contextWindow).toBe(500_000)
    const prepare = vi.spyOn(f.adapter, 'prepareCall')
    const result = await f.ctx.compaction.compactNow(f.agent, new AbortController().signal)
    expect(result).not.toBeNull()
    expect(prepare).toHaveBeenCalledOnce()
    expect((await prepare.mock.results[0]!.value).model.context?.contextWindow).toBe(500_000)
    expect(f.fetchMock).toHaveBeenCalledTimes(3)
    expect(f.ctx.tokenMeter.measure(f.agent.session).totalTokens).toBeLessThan(f.before)
    expect(f.agent.session.surface.replaceGeneration).toBe(1)
    await f.ctx.sessions.flush(f.agent.session)
  })
  it('cancels a hung manual summary and preserves the original history without replay', async () => {
    const f = await fixture()
    f.setTier('extended')
    let started!: () => void
    const dispatched = new Promise<void>(resolve => { started = resolve })
    f.fetchMock.mockImplementation((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      started()
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const controller = new AbortController()
    const original = [...f.agent.session.surface.nodes]
    const operation = f.ctx.compaction.compactNow(f.agent, controller.signal)
    const rejected = expect(operation).rejects.toThrow()
    await dispatched; controller.abort(new Error('Synthetic manual cancellation'))
    await rejected
    expect(f.agent.session.surface.nodes).toEqual(original)
    expect(f.fetchMock).toHaveBeenCalledTimes(3)
    expect(f.agent.session.surface.replaceGeneration).toBe(0)
  })
  it('terminates a rejected manual summary without replacing or deleting old history', async () => {
    const f = await fixture()
    f.setTier('extended')
    const original = [...f.agent.session.surface.nodes]
    f.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 'invalid_request_error', message: 'Synthetic summary rejection' } }), { status: 400 }))
    await expect(f.ctx.compaction.compactNow(f.agent, new AbortController().signal)).rejects.toThrow()
    expect(f.agent.session.surface.nodes).toEqual(original)
    expect(f.fetchMock).toHaveBeenCalledTimes(3)
    expect(f.agent.session.surface.replaceGeneration).toBe(0)
  })
})
