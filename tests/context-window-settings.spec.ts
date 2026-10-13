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

async function boot(config: plugin.Config = {}): Promise<Context> {
  home = await mkdtemp(join(tmpdir(), 'codex-context-window-'))
  vi.stubEnv('DSH_HOME', home)
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await loadSettingsPlugin(ctx, home, 'dsh-codex-connect', plugin, config)
  return ctx
}

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
  vi.unstubAllEnvs()
})

describe('retired context budgets through the Host settings registry', () => {
  it.each([null, { [model]: 350_000 }, { retired: null }, { 'unknown-model': 9_999_999 }])('accepts old budgets but never applies them: %j', contextWindowOverrides => boot({ contextWindowOverrides, models: [model] }).then(async runtime => {
    expect((await runtime.llm.resolveModelInfo(provider, model)).context?.contextWindow).toBe(272_000)
    expect((await runtime.llm.listModels(provider)).map(entry => entry.id)).toEqual([model])
    expect(plugin.decodeOpenAICodexSettings(runtime.settings.describe().find(entry => entry.ns === ns)?.value)?.contextWindowOverrides).toBeUndefined()
  }))

  it('ignores later legacy updates and preserves model visibility and ordinary settings', async () => {
    const runtime = await boot({ models: [model] })
    await runtime.settings.update(ns, { contextWindowOverrides: { [model]: 872_000 }, outputVerbosity: 'high' })
    expect((await runtime.llm.resolveModelInfo(provider, model)).context?.contextWindow).toBe(272_000)
    expect((await runtime.llm.listModels(provider)).map(entry => entry.id)).toEqual([model])
    expect(plugin.decodeOpenAICodexSettings(runtime.settings.describe().find(entry => entry.ns === ns)?.value)?.outputVerbosity).toBe('high')
  })
})
