import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import { ExtendedContextRegistry, registerExtendedContextRequests } from '../src/extended-context.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'

const PROVIDER = 'openai-codex'
const MODEL = 'gpt-6.1-sol'
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Unmodified Host services; no persistence, credentials, provider calls or fabricated pressure resolver. */
async function fixture(maximum: () => readonly string[] = () => []) {
  vi.stubGlobal('fetch', () => { throw new Error('Network is forbidden in this test') })
  const credentials = {
    read: async () => { throw new Error('Pressure metadata must not read credentials') },
  } as unknown as OpenAICodexCredentialStore
  const registry = new ExtendedContextRegistry()
  const adapter = createOpenAICodexAdapter(credentials, () => undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, registry, maximum)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  // Register Host pressure first, so the plugin must actually prepend its binding.
  await ctx.plugin(BasicCompactionEngine, { auto: true })
  ctx.llm.registerAdapter([PROVIDER], adapter)
  registerExtendedContextRequests(ctx, registry)
  const createAgent = (id: string, model = MODEL) => ctx.agentLoop.create(SessionId(id), { provider: PROVIDER, model })
  const route = (agent: Agent, config: LlmCallConfig = { provider: PROVIDER, model: MODEL, maxTokens: 2048 }) => {
    agent.session.append('request/header', {
      header: { config }, reason: agent.session.requestHeader() === undefined ? 'initial' : 'change',
    })
  }
  const preStep = (agent: Agent, signal: AbortSignal, step = 1) => ctx.waterfall('agent/pre-step', {
    agent, signal, turn: 1, step, messages: [],
  }, async () => ({ kind: 'enter' as const, messages: [] }))
  const request = (agent: Agent, signal: AbortSignal, config: LlmCallConfig) => ctx.waterfall('agent/request', {
    agent, signal, turn: 1, step: 1,
  }, async () => config)
  return { ctx, registry, adapter, createAgent, route, preStep, request }
}

describe('extended context in the Host automatic pressure chain', () => {
  it.each([
    { enabled: true, maximum: false, window: 500_000 },
    { enabled: true, maximum: true, window: 872_000 },
    { enabled: false, maximum: true, window: 272_000 },
  ])('prices first pre-step at $window before any agent/request binding', async ({ enabled, maximum, window }) => {
    const f = await fixture(() => maximum ? [MODEL] : [])
    const agent = await f.createAgent('first-step')
    f.route(agent)
    f.registry.set(agent.session.id, enabled)
    const signal = new AbortController().signal
    expect(f.registry.forRequest(signal, MODEL)).toBe(false)
    const pressure = vi.spyOn(f.ctx.llm, 'resolveModelInfo')
    const prepare = vi.spyOn(f.adapter, 'prepareCall')
    // This invokes the real automatic hook -> compactIfNeeded -> resolveModelInfo -> resolveModel.
    await f.preStep(agent, signal)
    expect(pressure).toHaveBeenCalledExactlyOnceWith(PROVIDER, MODEL, signal)
    const info = await pressure.mock.results[0]!.value
    expect(info.context?.contextWindow).toBe(window)
    expect(prepare).not.toHaveBeenCalled()
    const baseline = await f.ctx.llm.resolveModelInfo(PROVIDER, MODEL)
    expect(baseline.context?.contextWindow).toBe(272_000)
    expect({ ...info, context: baseline.context }).toEqual(baseline)
    expect(info.defaultMaxTokens).toBe(baseline.defaultMaxTokens)
    expect(agent.session.requestHeader()?.config.maxTokens).toBe(2048)
    expect(f.ctx.tokenMeter.measure(agent.session).totalTokens).toBeLessThan(272_000)
  })

  it('refreshes every pre-step on the same turn signal and keeps old prepared calls captured', async () => {
    let maximum: string[] = []
    const f = await fixture(() => maximum)
    const agent = await f.createAgent('same-turn')
    f.route(agent)
    f.registry.set(agent.session.id, true)
    const signal = new AbortController().signal
    await f.preStep(agent, signal)
    const captured = await f.adapter.prepareCall(PROVIDER, MODEL, signal)
    const pressure = vi.spyOn(f.ctx.llm, 'resolveModelInfo')
    f.registry.set(agent.session.id, false)
    await f.preStep(agent, signal, 2)
    expect((await pressure.mock.results[0]!.value).context?.contextWindow).toBe(272_000)
    expect((await f.adapter.prepareCall(PROVIDER, MODEL, signal)).model.context?.contextWindow).toBe(272_000)
    f.registry.set(agent.session.id, true)
    maximum = [MODEL]
    await f.preStep(agent, signal, 3)
    expect((await pressure.mock.results[1]!.value).context?.contextWindow).toBe(872_000)
    expect(captured.model.context?.contextWindow).toBe(500_000)
  })

  it('isolates concurrent session signals even when pressure queries overlap', async () => {
    const f = await fixture()
    const a = await f.createAgent('enabled')
    const b = await f.createAgent('disabled')
    f.route(a)
    f.route(b)
    f.registry.set(a.session.id, true)
    const sa = new AbortController().signal
    const sb = new AbortController().signal
    const pressure = vi.spyOn(f.ctx.llm, 'resolveModelInfo')
    await Promise.all([f.preStep(a, sa), f.preStep(b, sb)])
    expect(pressure).toHaveBeenCalledTimes(2)
    const windows = await Promise.all(pressure.mock.results.map(async result => (await result.value).context?.contextWindow))
    expect(windows.sort()).toEqual([272_000, 500_000])
    expect((await f.adapter.resolveModel(PROVIDER, MODEL, sa)).context?.contextWindow).toBe(500_000)
    expect((await f.adapter.resolveModel(PROVIDER, MODEL, sb)).context?.contextWindow).toBe(272_000)
    expect((await f.adapter.resolveModel(PROVIDER, MODEL)).context?.contextWindow).toBe(272_000)
  })

  it('uses the durable routed model, not agent options or a different summary model', async () => {
    const f = await fixture(() => [MODEL])
    const agent = await f.createAgent('routed', 'gpt-6-astra')
    f.route(agent)
    f.registry.set(agent.session.id, true)
    const signal = new AbortController().signal
    const pressure = vi.spyOn(f.ctx.llm, 'resolveModelInfo')
    await f.preStep(agent, signal)
    expect(pressure).toHaveBeenCalledExactlyOnceWith(PROVIDER, MODEL, signal)
    expect((await pressure.mock.results[0]!.value).context?.contextWindow).toBe(872_000)
    expect((await f.adapter.prepareCall(PROVIDER, 'gpt-6-astra', signal)).model.context?.contextWindow).toBe(272_000)
    expect((await f.adapter.resolveModel(PROVIDER, 'gpt-6-astra', signal)).context?.contextWindow).toBe(272_000)
    // A later request captures its final routed config, without retroactively extending the old route.
    await f.request(agent, signal, { provider: PROVIDER, model: 'gpt-6-astra' })
    expect((await f.adapter.prepareCall(PROVIDER, 'gpt-6-astra', signal)).model.context?.contextWindow).toBe(500_000)
    expect((await f.adapter.resolveModel(PROVIDER, MODEL, signal)).context?.contextWindow).toBe(272_000)
    f.route(agent, { provider: PROVIDER, model: 'gpt-6-astra' })
    await f.preStep(agent, signal, 2)
    expect(pressure).toHaveBeenLastCalledWith(PROVIDER, 'gpt-6-astra', signal)
    expect((await pressure.mock.results.at(-1)!.value).context?.contextWindow).toBe(500_000)
  })

  it('clears stale turn bindings for a missing header or a non-Codex route', async () => {
    const f = await fixture()
    const fresh = await f.createAgent('no-header')
    f.registry.set(fresh.session.id, true)
    const signal = new AbortController().signal
    f.registry.bind(signal, fresh.session.id, MODEL)
    const pressure = vi.spyOn(f.ctx.llm, 'resolveModelInfo')
    await f.preStep(fresh, signal)
    // A truly new conversation has no routed header; Host skips pressure rather than guessing options.
    expect(pressure).not.toHaveBeenCalled()
    expect(f.registry.forRequest(signal, MODEL)).toBe(false)
    f.route(fresh)
    await f.preStep(fresh, signal, 2)
    expect(f.registry.forRequest(signal, MODEL)).toBe(true)
    await f.request(fresh, signal, { provider: 'other-provider', model: MODEL })
    expect(f.registry.forRequest(signal, MODEL)).toBe(false)
    f.registry.bind(signal, fresh.session.id, MODEL)
    f.route(fresh, { provider: 'other-provider', model: MODEL })
    // Host catches the absent other-provider adapter and continues; our binding must still be cleared.
    await f.preStep(fresh, signal, 3)
    expect(f.registry.forRequest(signal, MODEL)).toBe(false)
    expect((await f.adapter.resolveModel(PROVIDER, MODEL, signal)).context?.contextWindow).toBe(272_000)
    contexts.splice(contexts.indexOf(f.ctx), 1)
    await f.ctx.fiber.dispose()
    expect(f.registry.size).toBe(0)
    expect(f.registry.forRequest(signal, MODEL)).toBe(false)
  })
})
