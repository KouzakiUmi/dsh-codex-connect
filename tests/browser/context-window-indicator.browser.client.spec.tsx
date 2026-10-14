import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OpenAICodexContextIndicator } from '../../src/client/OpenAICodexContextIndicator.tsx'
import { DEFAULT_OPENAI_CODEX_SETTINGS, type OpenAICodexSettingsConfig } from '../../src/settings-contract.ts'
import { en, zh } from '../../src/client/locales.ts'
let root: Root | undefined, host: HTMLDivElement | undefined
afterEach(() => { root?.unmount(); host?.remove(); vi.unstubAllGlobals() })
it.each([['en', en], ['zh', zh]] as const)('keeps hover and compact click editor inside a phone viewport in %s', async (_locale, copy) => {
  await page.viewport(390, 844)
  host = document.createElement('div'); document.body.append(host)
  host.style.cssText = 'position:fixed;right:16px;bottom:40px;'
  root = createRoot(host)
  const state: ModelDirectoryState = { status: 'ready', pending: null, current: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, groups: [], failures: [], routable: true, error: null }
  const directory: SnapshotStore<ModelDirectoryState> = { getSnapshot: () => state, subscribe: () => () => undefined, set: () => undefined, update: () => undefined }
  const listeners = new Set<() => void>()
  let snapshot: ConfigFormSnapshot<OpenAICodexSettingsConfig> = { status: 'ready', value: { ...DEFAULT_OPENAI_CODEX_SETTINGS, modelContextTiers: {} }, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }
  const mutate = vi.fn<ConfigForm<OpenAICodexSettingsConfig>['mutate']>(async (ops, revision) => {
    expect(revision).toBe(1)
    const op = ops[0]
    if (op?.op !== 'set' || op.value !== 'maximum') throw new Error('Unexpected synthetic setting')
    snapshot = { ...snapshot, value: { ...snapshot.value!, modelContextTiers: { 'gpt-6.1-sol': 'maximum' } }, revision: 2 }
    listeners.forEach(listener => { listener() }); return true
  })
  root.render(createElement(OpenAICodexContextIndicator, { directory, configScope: { subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, getSnapshot: () => snapshot, mutate },
    t: (key, params = {}) => Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), copy[key]) }))
  const button = page.getByRole('button')
  await expect.element(button).toHaveAttribute('data-openai-codex-context-window', '500000')
  expect(host.querySelector('button')!.textContent).toBe('')
  host.querySelector<HTMLElement>('button')!.focus()
  await expect.element(page.getByRole('tooltip')).toBeVisible()
  expect(host.querySelector('[role="tooltip"]')!.textContent).toBe(_locale === 'en' ? 'Context: Extended · 500K' : '上下文：扩展 · 500K')
  await button.click()
  await expect.element(page.getByRole('dialog')).toBeVisible()
  expect(host.querySelector('[role="tooltip"]')).toBeNull()
  const bounds = host.querySelector('[role="dialog"]')!.getBoundingClientRect()
  expect(bounds.width).toBeLessThanOrEqual(140); expect(bounds.height).toBeLessThanOrEqual(46)
  expect(bounds.left).toBeGreaterThanOrEqual(15); expect(bounds.right).toBeLessThanOrEqual(375)
  await page.getByRole('slider').click({ position: { x: 110, y: 20 } })
  await expect.element(button).toHaveAttribute('data-openai-codex-context-window', '872000')
  expect(mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['modelContextTiers', 'gpt-6.1-sol'], value: 'maximum' }], 1)
})
