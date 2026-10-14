import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/index.ts'
import { loadSettingsPlugin } from './support/settings-loader-fixture.ts'

const model = 'gpt-6.1-sol'
const provider = plugin.OPENAI_CODEX_PROVIDER
const ns = plugin.OPENAI_CODEX_SETTINGS_NS
let ctx: Context | undefined
let home: string | undefined
let entry: Awaited<ReturnType<typeof loadSettingsPlugin>>['entry'] | undefined

async function boot(config: plugin.Config = {}): Promise<Context> {
  home = await mkdtemp(join(tmpdir(), 'codex-context-window-'))
  vi.stubEnv('DSH_HOME', home)
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  entry = (await loadSettingsPlugin(ctx, home, 'dsh-codex-connect', plugin, config)).entry
  return ctx
}

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
  vi.unstubAllEnvs()
})

describe('persistent tiers through the Host settings registry', () => {
  it('updates unbound and fresh-signal windows immediately after a Host settings save', async () => {
    const runtime = await boot({ models: [model], maximumContextModels: [model], modelContextTiers: { 'gpt-6-astra': 'standard' } })
    // The retired maximum preference never overrides Sol's new 500K plugin default.
    expect((await runtime.llm.resolveModelInfo(provider, model)).context?.contextWindow).toBe(500_000)
    for (const [tier, window] of [['extended', 500_000], ['maximum', 872_000], ['standard', 272_000]] as const) {
      await runtime.settings.mutate(ns, [{ op: 'set', path: ['modelContextTiers', model], value: tier }])
      expect((await runtime.llm.resolveModelInfo(provider, model)).context?.contextWindow).toBe(window)
      expect((await runtime.llm.resolveModelInfo(provider, model, new AbortController().signal)).context?.contextWindow).toBe(window)
      expect((await runtime.llm.resolveModelInfo(provider, 'gpt-6-astra')).context?.contextWindow).toBe(272_000)
      expect(plugin.decodeOpenAICodexSettings(runtime.settings.describe().find(entry => entry.ns === ns)?.value)?.modelContextTiers).toEqual({ [model]: tier, 'gpt-6-astra': 'standard' })
    }
    expect((await runtime.llm.listModels(provider)).map(entry => entry.id)).toEqual([model])
  })
  it('recreates the runtime from the Host-owned saved configuration without losing the tier', async () => {
    const runtime = await boot()
    await runtime.settings.mutate(ns, [{ op: 'set', path: ['modelContextTiers'], value: { [model]: 'maximum' } }])
    const saved = JSON.parse(JSON.stringify(entry!.options.config)) as plugin.Config
    expect(saved.modelContextTiers).toEqual({ [model]: 'maximum' })
    await runtime.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    entry = (await loadSettingsPlugin(ctx, home!, 'dsh-codex-connect', plugin, saved)).entry
    expect((await ctx.llm.resolveModelInfo(provider, model)).context?.contextWindow).toBe(872_000)
    expect((await ctx.llm.resolveModelInfo(provider, 'gpt-6-astra')).context?.contextWindow).toBe(272_000)
  })
  it('rejects malformed tier writes and preserves the last accepted window', async () => {
    const runtime = await boot({ modelContextTiers: { [model]: 'extended' } })
    await expect(runtime.settings.mutate(ns, [{ op: 'set', path: ['modelContextTiers'], value: { [model]: 600_000 } }])).rejects.toThrow()
    expect((await runtime.llm.resolveModelInfo(provider, model)).context?.contextWindow).toBe(500_000)
    await runtime.settings.mutate(ns, [{ op: 'set', path: ['modelContextTiers'], value: { [model]: null } }])
    expect((await runtime.llm.resolveModelInfo(provider, model)).context?.contextWindow).toBe(272_000)
  })
  it.each([null, { [model]: 350_000 }, { retired: null }, { 'unknown-model': 9_999_999 }])('accepts old budgets but never applies them: %j', contextWindowOverrides => boot({ contextWindowOverrides, models: [model] }).then(async runtime => {
    expect((await runtime.llm.resolveModelInfo(provider, model)).context?.contextWindow).toBe(500_000)
    expect((await runtime.llm.listModels(provider)).map(entry => entry.id)).toEqual([model])
    expect(plugin.decodeOpenAICodexSettings(runtime.settings.describe().find(entry => entry.ns === ns)?.value)?.contextWindowOverrides).toBeUndefined()
  }))

  it('ignores later legacy updates and preserves model visibility and ordinary settings', async () => {
    const runtime = await boot({ models: [model] })
    await runtime.settings.update(ns, { contextWindowOverrides: { [model]: 872_000 }, outputVerbosity: 'high' })
    expect((await runtime.llm.resolveModelInfo(provider, model)).context?.contextWindow).toBe(500_000)
    expect((await runtime.llm.listModels(provider)).map(entry => entry.id)).toEqual([model])
    expect(plugin.decodeOpenAICodexSettings(runtime.settings.describe().find(entry => entry.ns === ns)?.value)?.outputVerbosity).toBe('high')
  })
})
