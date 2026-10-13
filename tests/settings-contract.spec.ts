import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPENAI_CODEX_OUTPUT_VERBOSITY,
  DEFAULT_OPENAI_CODEX_PROXY_URL,
  DEFAULT_OPENAI_CODEX_REASONING_SUMMARY,
  DEFAULT_OPENAI_CODEX_SETTINGS,
  decodeOpenAICodexSettings,
  isValidOpenAICodexImageModelHint,
  isValidOpenAICodexOutputVerbosity,
  isValidOpenAICodexReasoningSummary,
  resolveOpenAICodexProxyUrl,
  resolveOpenAICodexSettings,
} from '../src/settings-contract.ts'
import { Config } from '../src/index.ts'
import type { OpenAICodexSettingsInput } from '../src/settings-contract.ts'

function configSettings(config: ReturnType<typeof Config>): OpenAICodexSettingsInput {
  const values = Object.fromEntries(Object.entries(config).flatMap(([key, value]) => {
    if (key === 'oauthTimeoutMs') return []
    return [[key, value !== null && typeof value === 'object' && 'get' in value ? value.get() : value]]
  }))
  return values as OpenAICodexSettingsInput
}

describe('OpenAI Codex proxy settings contract', () => {
  it.each(['gpt-image-2\n', 'gpt-image-2\r', 'gpt-image-2\u2028', 'gpt-image-2\u2029', 'a'.repeat(129), 'model\tname'])('rejects padded or oversized image hints on Host and browser: %j', imageModelHint => {
    expect(isValidOpenAICodexImageModelHint(imageModelHint)).toBe(false)
    expect(() => Config({ imageModelHint })).toThrow()
    expect(() => resolveOpenAICodexSettings({ imageModelHint })).toThrow()
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, imageModelHint })).toBeUndefined()
  })

  it('validates and defaults the optional image model hint', () => {
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.imageModelHint).toBe('')
    expect(isValidOpenAICodexImageModelHint('gpt-image-2')).toBe(true)
    expect(isValidOpenAICodexImageModelHint('')).toBe(true)
    expect(isValidOpenAICodexImageModelHint('https://evil.example')).toBe(false)
    expect(isValidOpenAICodexImageModelHint('bad value')).toBe(false)
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, imageModelHint: 'custom_model' })?.imageModelHint).toBe('custom_model')
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, imageModelHint: 'bad value' })).toBeUndefined()
  })
  it('keeps fresh and legacy settings on direct connection', () => {
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.enableProxy).toBe(false)
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.enableReserveFallback).toBe(false)
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.enableNewSessionFastMode).toBe(false)
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.enableNewSubagentFastMode).toBe(false)
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.enableNativeCompaction).toBe(false)
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.autoReviewDisclosureAcknowledged).toBe(false)
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.enableAutoReview).toBe(false)
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.proxyUrl).toBe(DEFAULT_OPENAI_CODEX_PROXY_URL)
    const legacy = decodeOpenAICodexSettings({
      enableSearch: false,
      enableImageTool: false,
      searchModel: 'gpt-5.6-sol',
      searchMode: 'cached',
      searchContextSize: 'medium',
      searchMaxOutputTokens: 10_000,
    })
    expect(legacy?.enableProxy).toBe(false)
    expect(legacy?.enableReserveFallback).toBe(false)
    expect(legacy?.enableNewSessionFastMode).toBe(false)
    expect(legacy?.enableNewSubagentFastMode).toBe(false)
    expect(legacy?.enableNativeCompaction).toBe(false)
    expect(legacy?.proxyUrl).toBe(DEFAULT_OPENAI_CODEX_PROXY_URL)
    expect(legacy?.autoReviewDisclosureAcknowledged).toBe(false)
    expect(legacy?.enableAutoReview).toBe(false)
    expect(resolveOpenAICodexProxyUrl(legacy ?? {})).toBeUndefined()
  })

  it.each(['yes', 1, {}, []])('rejects a non-boolean Reserve fallback setting: %j', enableReserveFallback => {
    expect(() => Config({ enableReserveFallback } as never)).toThrow()
    expect(decodeOpenAICodexSettings({
      ...DEFAULT_OPENAI_CODEX_SETTINGS,
      enableReserveFallback,
    })).toBeUndefined()
  })

  it('rejects a null Reserve fallback in a decoded browser snapshot', () => {
    expect(decodeOpenAICodexSettings({
      ...DEFAULT_OPENAI_CODEX_SETTINGS,
      enableReserveFallback: null,
    })).toBeUndefined()
  })

  it('keeps Reserve fallback opt-in across Host and browser settings', () => {
    expect(Config({}).enableReserveFallback.get()).toBe(false)
    expect(resolveOpenAICodexSettings({}).enableReserveFallback).toBe(false)
    expect(Config({ enableReserveFallback: true }).enableReserveFallback.get()).toBe(true)
    expect(decodeOpenAICodexSettings({
      ...DEFAULT_OPENAI_CODEX_SETTINGS,
      enableReserveFallback: true,
    })?.enableReserveFallback).toBe(true)
  })

  it('keeps top-level and subagent Fast Mode defaults separate and rejects malformed values', () => {
    const defaults = resolveOpenAICodexSettings({})
    expect(defaults.enableNewSessionFastMode).toBe(false)
    expect(defaults.enableNewSubagentFastMode).toBe(false)
    expect(configSettings(Config({ enableNewSessionFastMode: true }))).toMatchObject({
      enableNewSessionFastMode: true,
      enableNewSubagentFastMode: false,
    })
    expect(decodeOpenAICodexSettings({
      ...DEFAULT_OPENAI_CODEX_SETTINGS,
      enableNewSubagentFastMode: true,
    })).toMatchObject({ enableNewSessionFastMode: false, enableNewSubagentFastMode: true })
    for (const field of ['enableNewSessionFastMode', 'enableNewSubagentFastMode'] as const) {
      expect(() => Config({ [field]: 'on' } as never)).toThrow()
      expect(() => resolveOpenAICodexSettings({ [field]: 'on' } as never)).toThrow()
      expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, [field]: 'on' })).toBeUndefined()
    }
  })

  it('rejects non-boolean Auto-review settings while preserving the default-off legacy value', () => {
    expect(decodeOpenAICodexSettings({
      ...DEFAULT_OPENAI_CODEX_SETTINGS,
      enableAutoReview: 'yes',
    })).toBeUndefined()
    expect(resolveOpenAICodexSettings({}).enableAutoReview).toBe(false)
    expect(decodeOpenAICodexSettings({
      ...DEFAULT_OPENAI_CODEX_SETTINGS,
      autoReviewDisclosureAcknowledged: 'yes',
    })).toBeUndefined()
    expect(configSettings(Config({
      autoReviewDisclosureAcknowledged: true,
      enableAutoReview: true,
    }))).toMatchObject({
      autoReviewDisclosureAcknowledged: true,
      enableAutoReview: true,
    })
  })

  it('keeps the composer quota pill opt-in for fresh and legacy profiles', () => {
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.enableComposerQuotaPill).toBe(false)
    expect(Config({}).enableComposerQuotaPill.get()).toBe(false)
    expect(resolveOpenAICodexSettings({}).enableComposerQuotaPill).toBe(false)
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, enableComposerQuotaPill: undefined })?.enableComposerQuotaPill).toBe(false)
    expect(Config({ enableComposerQuotaPill: true }).enableComposerQuotaPill.get()).toBe(true)
    expect(resolveOpenAICodexSettings({ enableComposerQuotaPill: true }).enableComposerQuotaPill).toBe(true)
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, enableComposerQuotaPill: true })?.enableComposerQuotaPill).toBe(true)
  })

  it.each(['yes', 1, null, {}, []])('rejects a malformed composer quota pill setting: %j', enableComposerQuotaPill => {
    expect(() => resolveOpenAICodexSettings({ enableComposerQuotaPill } as never)).toThrow()
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, enableComposerQuotaPill })).toBeUndefined()
  })

  it('rejects unsafe active proxy values while preserving explicit activation semantics', () => {
    expect(decodeOpenAICodexSettings({
      enableProxy: true,
      proxyUrl: 'http://user:password@127.0.0.1:7890',
      enableSearch: false,
      enableImageTool: false,
      searchModel: 'gpt-5.6-sol',
      searchMode: 'cached',
      searchContextSize: 'medium',
      searchMaxOutputTokens: 10_000,
    })).toBeUndefined()
    expect(resolveOpenAICodexProxyUrl({ enableProxy: true, proxyUrl: 'http://127.0.0.1:7890' }))
      .toBe('http://127.0.0.1:7890')
  })

  it.each([undefined, null, {}, { 'gpt-6.1-sol': 350000 }, { retired: null }, { unknown: 9999999 }, []])('ignores retired context budgets without rejecting other settings: %j', legacy => {
    const input = { contextWindowOverrides: legacy, enableSearch: true } as OpenAICodexSettingsInput
    // Schemastery preserves null for optional fields without a default; neither
    // null nor any historical budget is allowed to affect resolved settings.
    expect(configSettings(Config(input)).contextWindowOverrides).toBe(legacy === null ? null : undefined)
    expect(resolveOpenAICodexSettings(input)).toMatchObject({ enableSearch: true, contextWindowOverrides: undefined })
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, ...input })).toMatchObject({ enableSearch: true, contextWindowOverrides: undefined })
  })

  it('defaults per-model maximum preferences off and detaches the saved id list', () => {
    expect(configSettings(Config({})).maximumContextModels).toEqual([])
    expect(resolveOpenAICodexSettings({}).maximumContextModels).toEqual([])
    const ids = ['gpt-6.1-sol', 'gpt-6.1-sol']
    const input = { maximumContextModels: ids }
    const host = configSettings(Config(input))
    expect(host.maximumContextModels).toEqual(['gpt-6.1-sol'])
    expect(host.maximumContextModels).not.toBe(ids)
    expect(resolveOpenAICodexSettings(input).maximumContextModels).toEqual(['gpt-6.1-sol'])
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, ...input })?.maximumContextModels).toEqual(['gpt-6.1-sol'])
  })

  it('maps the Host null reset sentinel to maximum preferences off at every boundary', () => {
    const input = { maximumContextModels: null }
    expect(configSettings(Config(input)).maximumContextModels).toEqual([])
    expect(resolveOpenAICodexSettings(input).maximumContextModels).toEqual([])
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, ...input })?.maximumContextModels).toEqual([])
    expect(resolveOpenAICodexSettings(Object.assign({}, DEFAULT_OPENAI_CODEX_SETTINGS, { maximumContextModels: ['gpt-6.1-sol'] }, input)).maximumContextModels).toEqual([])
  })

  it.each(['gpt-6.1-sol', [''], [' padded '], [1], ['m'.repeat(129)], Array(257).fill('model')])('rejects an invalid per-model maximum preference consistently: %j', maximumContextModels => {
    const input = { maximumContextModels } as never
    expect(() => Config(input)).toThrow()
    expect(() => resolveOpenAICodexSettings(input)).toThrow()
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, maximumContextModels })).toBeUndefined()
  })

  it('defaults verbosity and reasoning summary to the official catalog behaviour', () => {
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.outputVerbosity).toBe('default')
    expect(DEFAULT_OPENAI_CODEX_SETTINGS.reasoningSummary).toBe('none')
    expect(DEFAULT_OPENAI_CODEX_OUTPUT_VERBOSITY).toBe('default')
    expect(DEFAULT_OPENAI_CODEX_REASONING_SUMMARY).toBe('none')
    const legacy = decodeOpenAICodexSettings({
      enableSearch: false,
      enableImageTool: false,
      searchModel: 'gpt-5.6-sol',
      searchMode: 'cached',
      searchContextSize: 'medium',
      searchMaxOutputTokens: 10_000,
    })
    expect(legacy?.outputVerbosity).toBe('default')
    expect(legacy?.reasoningSummary).toBe('none')
    expect(Config({}).outputVerbosity.get()).toBe('default')
    expect(Config({}).reasoningSummary.get()).toBe('none')
  })

  it('accepts the official output-style choices on Host and browser', () => {
    for (const verbosity of ['default', 'low', 'medium', 'high'] as const) {
      expect(isValidOpenAICodexOutputVerbosity(verbosity)).toBe(true)
      expect(Config({ outputVerbosity: verbosity }).outputVerbosity.get()).toBe(verbosity)
      expect(resolveOpenAICodexSettings({ outputVerbosity: verbosity }).outputVerbosity).toBe(verbosity)
      expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, outputVerbosity: verbosity })?.outputVerbosity)
        .toBe(verbosity)
    }
    for (const summary of ['auto', 'concise', 'detailed', 'none'] as const) {
      expect(isValidOpenAICodexReasoningSummary(summary)).toBe(true)
      expect(Config({ reasoningSummary: summary }).reasoningSummary.get()).toBe(summary)
      expect(resolveOpenAICodexSettings({ reasoningSummary: summary }).reasoningSummary).toBe(summary)
      expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, reasoningSummary: summary })?.reasoningSummary)
        .toBe(summary)
    }
  })

  it.each(['ultra', 'verbose', 'terse', 2])('rejects malformed output-style values on Host and browser: %j', value => {
    expect(() => Config({ outputVerbosity: value } as never)).toThrow()
    expect(() => resolveOpenAICodexSettings({ outputVerbosity: value } as never)).toThrow()
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, outputVerbosity: value })).toBeUndefined()
    expect(() => Config({ reasoningSummary: value } as never)).toThrow()
    expect(() => resolveOpenAICodexSettings({ reasoningSummary: value } as never)).toThrow()
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, reasoningSummary: value })).toBeUndefined()
  })

  it('treats a null output-style value as invalid for resolution and browser decoding', () => {
    // The Host volatile union tolerates a null entry, so null is asserted at the decode/resolution layers only.
    expect(() => resolveOpenAICodexSettings({ outputVerbosity: null } as never)).toThrow()
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, outputVerbosity: null })).toBeUndefined()
    expect(() => resolveOpenAICodexSettings({ reasoningSummary: null } as never)).toThrow()
    expect(decodeOpenAICodexSettings({ ...DEFAULT_OPENAI_CODEX_SETTINGS, reasoningSummary: null })).toBeUndefined()
  })
})
