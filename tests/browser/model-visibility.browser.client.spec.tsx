import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { modelCatalogFixture } from '../model-catalog-fixture.ts'
import { OpenAICodexConfiguration } from '../../src/client/OpenAICodexConfiguration.tsx'
import { en, zh } from '../../src/client/locales.ts'
import { OPENAI_CODEX_MODEL_CATALOG_PATH } from '../../src/model-contract.ts'
import {
  OPENAI_CODEX_PROXY_DETECT_PATH,
  OPENAI_CODEX_PROXY_TEST_PATH,
} from '../../src/proxy-paths.ts'
import { DEFAULT_OPENAI_CODEX_SETTINGS, resolveOpenAICodexSettings } from '../../src/settings-contract.ts'
import type { OpenAICodexSettingsConfig } from '../../src/settings-contract.ts'

function t(key: keyof typeof en, params: Record<string, unknown> = {}): string {
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
    en[key],
  )
}

function settingsScopeFixture(initial: Partial<OpenAICodexSettingsConfig> = {}, writable = true): {
  scope: ConfigForm<OpenAICodexSettingsConfig>
  mutate: ReturnType<typeof vi.fn>
} {
  let snapshot: ConfigFormSnapshot<OpenAICodexSettingsConfig> = {
    status: 'ready',
    value: { ...DEFAULT_OPENAI_CODEX_SETTINGS, ...initial },
    base: { ...DEFAULT_OPENAI_CODEX_SETTINGS, ...initial },
    user: undefined,
    revision: 0,
    writable,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const mutate = vi.fn<ConfigForm<OpenAICodexSettingsConfig>['mutate']>(async (ops, revision) => {
    if (revision !== snapshot.revision) throw new Error('stale revision')
    const current = snapshot.value
    if (current === undefined) throw new Error('settings unavailable')
    const next = { ...current }
    for (const op of ops) Object.assign(next, { [op.path[0]!]: op.op === 'set' ? op.value : undefined })
    snapshot = { ...snapshot, value: resolveOpenAICodexSettings(next), revision: (snapshot.revision ?? 0) + 1 }
    for (const listener of listeners) listener()
    return true
  })
  return {
    mutate,
    scope: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: vi.fn(async () => { throw new Error('Use an atomic mutation') }),
      mutate,
      unset: vi.fn(async () => true),
    },
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  await page.viewport(960, 800)
  host = document.createElement('div')
  host.style.width = '720px'
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  root.unmount()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Codex model visibility in Chromium', () => {
  it.each([['en', 390, en], ['zh', 390, zh], ['en', 960, en], ['zh', 960, zh]] as const)('keeps the native-context opt-in at peer level in %s at %i pixels without a second confirmation', async (_language, width, copy) => {
    await page.viewport(width, 844)
    host.style.width = '100%'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(modelCatalogFixture([{ id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' }]))))
    const { scope, mutate } = settingsScopeFixture()
    root.render(createElement(OpenAICodexConfiguration, { scope, t: key => copy[key], activeModule: 'capabilities' }))
    const native = page.getByRole('checkbox', { name: copy.enableNativeCompaction, exact: true })
    await expect.element(native).not.toBeChecked()
    await expect.element(page.getByText(copy.nativeCompactionConsent, { exact: true })).toBeVisible()
    await native.click()
    await expect.element(page.getByText(copy.nativeCompactionPending, { exact: true })).toBeVisible()
    expect(scope.getSnapshot().value?.enableNativeCompaction).toBe(false)
    expect(mutate).not.toHaveBeenCalled()
    expect(document.querySelector('dialog[open]')).toBeNull()
    await page.getByRole('button', { name: copy.save, exact: true }).click()
    await expect.element(page.getByText(copy.nativeCompactionSavedOn, { exact: true })).toBeVisible()
    expect(mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['enableNativeCompaction'], value: true }], 0)
    expect(scope.getSnapshot().value).toEqual({ ...DEFAULT_OPENAI_CODEX_SETTINGS, enableNativeCompaction: true })
    await page.getByText(copy.nativeCompactionDetails, { exact: true }).click()
    await expect.element(page.getByText(copy.nativeCompactionDisableHelp, { exact: true })).toBeVisible()
    const group = page.getByRole('group', { name: copy.enableNativeCompaction, exact: true }).element()
    const groupStyle = getComputedStyle(group)
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      expect(groupStyle[`border${side}Width`]).toBe('0px')
      expect(groupStyle[`padding${side}`]).toBe('0px')
    }
    expect(groupStyle.borderRadius).toBe('0px')
    const nativeLabel = native.element().closest('label')!
    const nativeTitle = page.getByText(copy.enableNativeCompaction, { exact: true }).element()
    for (const name of [copy.enableReserveFallback, copy.enableImageTool]) {
      const peer = page.getByRole('checkbox', { name }).element()
      const peerLabel = peer.closest('label')!
      const peerTitle = peerLabel.querySelector('span > span')!
      expect(Math.abs(native.element().getBoundingClientRect().left - peer.getBoundingClientRect().left)).toBeLessThan(1)
      expect(Math.abs(nativeTitle.getBoundingClientRect().left - peerTitle.getBoundingClientRect().left)).toBeLessThan(1)
      expect(getComputedStyle(nativeLabel).gap).toBe(getComputedStyle(peerLabel).gap)
      expect(getComputedStyle(nativeTitle).fontSize).toBe(getComputedStyle(peerTitle).fontSize)
      expect(getComputedStyle(nativeTitle).fontWeight).toBe(getComputedStyle(peerTitle).fontWeight)
    }
    const nativeDetails = page.getByText(copy.nativeCompactionDetails, { exact: true }).element()
    const peerDetails = page.getByText(copy.autoReviewDetails, { exact: true }).element()
    expect(Math.abs(nativeDetails.getBoundingClientRect().left - peerDetails.getBoundingClientRect().left)).toBeLessThan(1)
    expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth)
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth)
    await native.click()
    await page.getByRole('button', { name: copy.discard, exact: true }).click()
    await expect.element(native).toBeChecked()
    await native.click()
    await page.getByRole('button', { name: copy.save, exact: true }).click()
    await expect.element(page.getByText(copy.nativeCompactionSavedOff, { exact: true })).toBeVisible()
    expect(scope.getSnapshot().value).toEqual(DEFAULT_OPENAI_CODEX_SETTINGS)
  })

  it('keeps staged changes and actions while switching settings modules', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(modelCatalogFixture([{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]))))
    const { scope, mutate } = settingsScopeFixture()
    root.render(createElement(OpenAICodexConfiguration, { scope, t }))
    const model = page.getByRole('checkbox', { name: /GPT-5\.6 Sol/u })
    await model.click()
    await expect.element(page.getByRole('button', { name: en.save, exact: true })).toBeEnabled()
    await page.getByRole('tab', { name: en.networkModule, exact: true }).click()
    await expect.element(page.getByText(en.networkHeading, { exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: en.save, exact: true })).toBeEnabled()
    await page.getByRole('tab', { name: en.modelsModule, exact: true }).click()
    await expect.element(model).not.toBeChecked()
    await page.getByRole('button', { name: en.discard, exact: true }).click()
    await expect.element(model).toBeChecked()
    expect(mutate).not.toHaveBeenCalled()
  })

  it.each(['implicit', 'explicit'] as const)('clears dirty after restoring a full multi-model %s selection', async mode => {
    const ids = ['gpt-6.1-sol', 'gpt-6-astra']
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(modelCatalogFixture([
      { id: ids[0]!, name: 'GPT-6.1 Sol' }, { id: ids[1]!, name: 'GPT-6 Astra' },
    ]))))
    const { scope, mutate } = settingsScopeFixture({ models: mode === 'implicit' ? undefined : ids })
    root.render(createElement(OpenAICodexConfiguration, { scope, t }))
    const sol = page.getByRole('checkbox', { name: /GPT-6\.1 Sol/u })
    await expect.element(sol).toBeChecked()
    await sol.click()
    await expect.element(page.getByText(en.settingsUnsaved, { exact: true })).toBeVisible()
    await sol.click()
    await expect.element(page.getByRole('button', { name: en.save, exact: true })).toBeDisabled()
    expect(mutate).not.toHaveBeenCalled()
    expect(scope.getSnapshot().value?.models).toEqual(mode === 'implicit' ? undefined : ids)
  })

  it('stages maximum context independently per model with safe defaults and risk guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(modelCatalogFixture([
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
      { id: 'gpt-5.5', name: 'GPT-5.5' },
    ]).map(model => model.id === 'gpt-5.5' ? { ...model, maxContextWindow: 272_000 } : model))))
    const { scope, mutate } = settingsScopeFixture()
    root.render(createElement(OpenAICodexConfiguration, { scope, t }))
    const sol = page.getByRole('slider', { name: `${en.modelContextTier} (gpt-6.1-sol)`, exact: true })
    const astra = page.getByRole('slider', { name: `${en.modelContextTier} (gpt-6-astra)`, exact: true })
    await expect.element(sol).toHaveAttribute('aria-valuetext', '500K')
    await expect.element(astra).toHaveAttribute('aria-valuetext', '272K')
    await expect.element(page.getByText(en.extendedContextWarning, { exact: true })).toBeVisible()
    expect(host.querySelector('[aria-label="' + en.modelContextTier + ' (gpt-5.5)"]')?.getAttribute('aria-valuemax')).toBe('0')
    await sol.click({ position: { x: 120, y: 20 } })
    await expect.element(astra).toHaveAttribute('aria-valuetext', '272K')
    expect(mutate).not.toHaveBeenCalled()
    await page.getByRole('button', { name: en.discard, exact: true }).click()
    await expect.element(sol).toHaveAttribute('aria-valuetext', '500K')
    await sol.click({ position: { x: 120, y: 20 } })
    await page.getByRole('button', { name: en.save, exact: true }).click()
    await vi.waitFor(() => {
      expect(scope.getSnapshot().value?.modelContextTiers).toEqual({ 'gpt-6.1-sol': 'maximum' })
      expect(scope.getSnapshot().value?.models).toBeUndefined()
    })
    expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['modelContextTiers'], value: { 'gpt-6.1-sol': 'maximum' } }], expect.any(Number))
  })

  it('removes arbitrary context controls and places save actions above all fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(modelCatalogFixture([{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]))))
    const { scope, mutate } = settingsScopeFixture({ contextWindowOverrides: { 'gpt-5.6-sol': 350000 } })
    root.render(createElement(OpenAICodexConfiguration, { scope, t }))
    const model = page.getByRole('checkbox', { name: /GPT-5\.6 Sol/u })
    await expect.element(model).toBeVisible()
    expect(host.querySelector('input[type="range"]')).toBeNull()
    expect(host.querySelector('[role="tabpanel"]:not([hidden]) input[type="number"]')).toBeNull()
    const actions = host.querySelector('[data-codex-settings-actions]') as HTMLElement
    expect(getComputedStyle(actions).position).toBe('static')
    expect(actions.getBoundingClientRect().bottom).toBeLessThanOrEqual(model.element().getBoundingClientRect().top)
    await model.click()
    await expect.element(page.getByText(en.settingsUnsaved, { exact: true })).toBeVisible()
    await model.click()
    await expect.element(page.getByRole('button', { name: en.save, exact: true })).toBeDisabled()
    await model.click()
    await page.getByRole('button', { name: en.save, exact: true }).click()
    expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['models'], value: [] }], expect.any(Number))
  })

  it('discloses Auto-review details and asks once before the first profile enablement', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(modelCatalogFixture([{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]))))
    const { scope, mutate } = settingsScopeFixture()
    root.render(createElement(OpenAICodexConfiguration, { scope, t }))
    await page.getByRole('tab', { name: en.capabilitiesModule, exact: true }).click()
    const checkbox = page.getByRole('checkbox', { name: /Codex Auto-review/u })
    await expect.element(page.getByText(en.autoReviewOfficialBadge, { exact: true })).toBeVisible()
    const details = page.getByText(en.autoReviewDetails, { exact: true }).element().closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    await page.getByText(en.autoReviewDetails, { exact: true }).click()
    expect(details.open).toBe(true)
    await expect.element(page.getByRole('link', { name: en.autoReviewOfficialDocs, exact: true })).toHaveAttribute('href', 'https://learn.chatgpt.com/docs/sandboxing/auto-review')

    await checkbox.click()
    await expect.element(page.getByRole('dialog', { name: en.autoReviewConfirmTitle, exact: true })).toBeVisible()
    await expect.element(checkbox).not.toBeChecked()
    await page.getByRole('button', { name: en.autoReviewCancel, exact: true }).click()
    await expect.element(page.getByRole('dialog', { name: en.autoReviewConfirmTitle, exact: true })).not.toBeInTheDocument()

    await checkbox.click()
    await page.getByRole('button', { name: en.autoReviewConfirm, exact: true }).click()
    await expect.element(checkbox).toBeChecked()
    await page.getByRole('button', { name: en.save, exact: true }).click()
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(expect.arrayContaining([{ op: 'set', path: ['autoReviewDisclosureAcknowledged'], value: true }]), expect.any(Number))
      expect(mutate).toHaveBeenCalledWith(expect.arrayContaining([{ op: 'set', path: ['enableAutoReview'], value: true }]), expect.any(Number))
    })

    await checkbox.click()
    await page.getByRole('button', { name: en.save, exact: true }).click()
    await checkbox.click()
    await expect.element(checkbox).toBeChecked()
    await expect.element(page.getByRole('dialog', { name: en.autoReviewConfirmTitle, exact: true })).not.toBeInTheDocument()
  })

  it('saves, stages, discards, and disables Reserve fallback in Chromium', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(modelCatalogFixture([{ id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' }]))))
    const { scope, mutate } = settingsScopeFixture()
    root.render(createElement(OpenAICodexConfiguration, { scope, t }))
    await page.getByRole('tab', { name: en.capabilitiesModule, exact: true }).click()
    const reserve = page.getByRole('checkbox', { name: /Automatic Luna Reserve/u })

    await expect.element(reserve).not.toBeChecked()
    await reserve.click()
    await page.getByRole('button', { name: en.save, exact: true }).click()
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enableReserveFallback'], value: true },
      ], 0)
      expect(scope.getSnapshot().value?.enableReserveFallback).toBe(true)
    })

    await reserve.click()
    await expect.element(reserve).not.toBeChecked()
    await page.getByRole('button', { name: en.discard, exact: true }).click()
    await expect.element(reserve).toBeChecked()
    expect(mutate).toHaveBeenCalledTimes(1)

    await reserve.click()
    await page.getByRole('button', { name: en.save, exact: true }).click()
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enableReserveFallback'], value: false },
      ], 1)
      expect(scope.getSnapshot().value?.enableReserveFallback).toBe(false)
    })
  })

  it('shows the full catalog, saves a subset, and stays inside a narrow viewport', async () => {
    const models = [
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
      { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      expect(String(input)).toBe(OPENAI_CODEX_MODEL_CATALOG_PATH)
      return new Response(JSON.stringify(modelCatalogFixture(models)), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const { scope, mutate } = settingsScopeFixture()
    vi.stubGlobal('fetch', fetchMock)
    root.render(createElement(OpenAICodexConfiguration, { scope, t }))

    const sol = page.getByRole('checkbox', { name: /GPT-6\.1-Sol/u })
    await vi.waitFor(() => { expect(sol.element()).toBeInstanceOf(HTMLInputElement) })
    await sol.click()
    await page.getByRole('button', { name: en.save }).click()
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(expect.arrayContaining([{ op: 'set', path: ['models'], value: ['gpt-5.6-luna', 'gpt-5.6-terra'] }]), expect.any(Number))
    })

    await page.viewport(360, 800)
    host.style.width = '100%'
    await vi.waitFor(() => {
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth)
    })
  })

  it('keeps proxy state explicit and touch targets usable in a narrow viewport', async () => {
    const candidate = 'http://127.0.0.1:7897'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const value = String(input)
      if (value === OPENAI_CODEX_MODEL_CATALOG_PATH) return Response.json(modelCatalogFixture([{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]))
      if (value === OPENAI_CODEX_PROXY_DETECT_PATH) {
        return Response.json({
          candidates: [{ proxyUrl: candidate, reachable: true, classification: 'reachable', status: 401 }],
          results: [{ proxyUrl: candidate, reachable: true, classification: 'reachable', status: 401 }],
        })
      }
      expect(value.startsWith(`${OPENAI_CODEX_PROXY_TEST_PATH}?`)).toBe(true)
      const proxyUrl = new URL(value, window.location.href).searchParams.get('proxyUrl') ?? ''
      return Response.json({ proxyUrl, reachable: true, classification: 'reachable', status: 401 })
    }))
    const { scope, mutate } = settingsScopeFixture()
    root.render(createElement(OpenAICodexConfiguration, { scope, t }))
    await page.getByRole('tab', { name: en.networkModule, exact: true }).click()
    await page.viewport(360, 800)
    host.style.width = '100%'

    const automaticPanel = document.querySelector<HTMLElement>('#openai-codex-proxy-auto')
    const manualPanel = document.querySelector<HTMLElement>('#openai-codex-proxy-manual')
    if (automaticPanel === null || manualPanel === null) throw new Error('proxy mode panels were not rendered')
    expect(automaticPanel.hidden).toBe(false)
    expect(getComputedStyle(automaticPanel).display).not.toBe('none')
    expect(manualPanel.hidden).toBe(true)
    expect(getComputedStyle(manualPanel).display).toBe('none')
    await page.getByRole('button', { name: en.scanLocalProxy, exact: true }).click()
    await page.getByRole('button', { name: en.useThisProxy, exact: true }).click()
    await expect.element(page.getByText(en.selectedProxy, { exact: true }).first()).toBeVisible()
    await expect.element(page.getByText(en.pendingProxy.replace('{proxyUrl}', candidate), { exact: true })).toBeVisible()
    expect(mutate).not.toHaveBeenCalled()

    await page.getByRole('tab', { name: en.manualEntry, exact: true }).click()
    expect(automaticPanel.hidden).toBe(true)
    expect(getComputedStyle(automaticPanel).display).toBe('none')
    expect(manualPanel.hidden).toBe(false)
    expect(getComputedStyle(manualPanel).display).not.toBe('none')
    const address = page.getByRole('textbox', { name: en.proxyAddress, exact: true })
    await expect.element(address).toHaveAttribute('aria-invalid', 'false')
    await address.fill('http://user:secret@127.0.0.1:7898')
    await expect.element(address).toHaveAttribute('aria-invalid', 'true')
    await expect.element(page.getByRole('button', { name: en.testProxy, exact: true })).toBeDisabled()
    await address.fill('http://127.0.0.1:7898')
    await page.getByRole('button', { name: en.testProxy, exact: true }).click()
    const useProxy = page.getByRole('button', { name: en.useThisProxy, exact: true })
    await expect.element(useProxy).toBeEnabled()
    await useProxy.click()
    await expect.element(page.getByText(en.selectedProxy, { exact: true }).last()).toBeVisible()

    for (const control of [
      page.getByRole('tab', { name: en.automaticDetection, exact: true }),
      page.getByRole('tab', { name: en.manualEntry, exact: true }),
      page.getByRole('button', { name: en.testProxy, exact: true }),
      page.getByRole('button', { name: en.save, exact: true }),
      page.getByRole('button', { name: en.discard, exact: true }),
    ]) expect(control.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth)
  })
})
