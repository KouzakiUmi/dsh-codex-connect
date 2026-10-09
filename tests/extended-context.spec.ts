import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import * as plugin from '../src/index.ts'
import {
  OPENAI_CODEX_EXTENDED_CONTEXT_MAX,
  resolveOpenAICodexExtendedContextWindow,
} from '../src/settings-contract.ts'
import { loadSettingsPlugin } from './support/settings-loader-fixture.ts'

const model = 'gpt-5.6-sol'
const other = 'gpt-5.6-terra'
const provider = plugin.OPENAI_CODEX_PROVIDER
const ns = plugin.OPENAI_CODEX_SETTINGS_NAMESPACE
const catalogWindow = openaiCodexProvider().getModels().find(entry => entry.id === model)!.contextWindow
let ctx: Context | undefined
let home: string | undefined

async function boot(config: plugin.Config = {}): Promise<Context> {
  home = await mkdtemp(join(tmpdir(), 'codex-extended-context-'))
  vi.stubEnv('DSH_HOME', home)
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await loadSettingsPlugin(ctx, home, 'dsh-codex-connect', plugin, config)
  return ctx
}

async function contextWindow(runtime: Context, id: string): Promise<number | undefined> {
  return (await runtime.llm.resolveModelInfo(provider, id)).context?.contextWindow
}

/** Boot one rejected configuration and clean up its partially created runtime. */
async function bootExpectFailure(config: plugin.Config): Promise<void> {
  const failure = await boot(config).then(() => undefined, (error: unknown) => error)
  expect(failure).toBeInstanceOf(Error)
  expect(ctx!.llm.listProviders().map(entry => entry.id)).not.toContain(provider)
  await ctx!.fiber.dispose()
  ctx = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
}

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
  vi.unstubAllEnvs()
})

describe('maximum extended context switch through the real Host settings and LLM registry', () => {
  it('keeps the catalog budget while the switch is off', async () => {
    const runtime = await boot()
    expect(await contextWindow(runtime, model)).toBe(catalogWindow)
    expect(resolveOpenAICodexExtendedContextWindow({})).toBeUndefined()
    expect(plugin.Config({}).enableExtendedContext.get()).toBe(false)
  })

  it('raises every smaller catalog model to the official maximum input while the switch is on', async () => {
    const runtime = await boot({ enableExtendedContext: true })
    expect(await contextWindow(runtime, model)).toBe(OPENAI_CODEX_EXTENDED_CONTEXT_MAX)
    expect(await contextWindow(runtime, other)).toBe(OPENAI_CODEX_EXTENDED_CONTEXT_MAX)
    expect(resolveOpenAICodexExtendedContextWindow({ enableExtendedContext: true }))
      .toBe(OPENAI_CODEX_EXTENDED_CONTEXT_MAX)
    expect(plugin.Config({ enableExtendedContext: true }).enableExtendedContext.get()).toBe(true)
  })

  it('keeps an explicit per-model override authoritative', async () => {
    const runtime = await boot({ enableExtendedContext: true, contextWindowOverrides: { [model]: 300_000 } })
    expect(await contextWindow(runtime, model)).toBe(300_000)
    expect(await contextWindow(runtime, other)).toBe(OPENAI_CODEX_EXTENDED_CONTEXT_MAX)
  })

  it('switches live through settings and restores catalog budgets when disabled', async () => {
    const runtime = await boot({ models: [model] })
    expect(await contextWindow(runtime, model)).toBe(catalogWindow)
    await runtime.settings.update(ns, { enableExtendedContext: true })
    expect(await contextWindow(runtime, model)).toBe(OPENAI_CODEX_EXTENDED_CONTEXT_MAX)
    await runtime.settings.update(ns, { enableExtendedContext: false })
    expect(await contextWindow(runtime, model)).toBe(catalogWindow)
    expect(plugin.decodeOpenAICodexSettings(runtime.settings.describe().find(entry => entry.ns === ns)?.value))
      .toMatchObject({ models: [model], enableExtendedContext: false })
  })

  it('rejects a non-boolean switch before the adapter registers', async () => {
    await bootExpectFailure({ enableExtendedContext: 'yes' as unknown as boolean })
  })
})
