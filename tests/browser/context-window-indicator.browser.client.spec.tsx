import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OpenAICodexContextIndicator } from '../../src/client/OpenAICodexContextIndicator.tsx'
import { DEFAULT_OPENAI_CODEX_SETTINGS, type OpenAICodexSettingsConfig } from '../../src/settings-contract.ts'
import { en, zh } from '../../src/client/locales.ts'
let root: Root | undefined, host: HTMLDivElement | undefined
afterEach(() => { root?.unmount(); host?.remove(); vi.unstubAllGlobals() })
it.each([['en', en], ['zh', zh]] as const)('keeps the read-only indicator tooltip inside a phone viewport in %s', async (_locale, copy) => {
  await page.viewport(390, 844)
  host = document.createElement('div'); document.body.append(host)
  host.style.cssText = 'position:fixed;right:16px;bottom:40px;'
  root = createRoot(host)
  const state: ModelDirectoryState = { status: 'ready', pending: null, current: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, groups: [], failures: [], routable: true, error: null }
  const directory: SnapshotStore<ModelDirectoryState> = { getSnapshot: () => state, subscribe: () => () => undefined, set: () => undefined, update: () => undefined }
  const snapshot: ConfigFormSnapshot<OpenAICodexSettingsConfig> = { status: 'ready', value: { ...DEFAULT_OPENAI_CODEX_SETTINGS, modelContextTiers: { 'gpt-6.1-sol': 'maximum' } },
    base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  root.render(createElement(OpenAICodexContextIndicator, { directory, configScope: { subscribe: () => () => undefined, getSnapshot: () => snapshot },
    t: (key, params = {}) => Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), copy[key]) }))
  await expect.element(page.getByRole('status')).toHaveTextContent('872K')
  expect(host.querySelector('button')).toBeNull()
  host.querySelector<HTMLElement>('[role="status"]')!.focus()
  await expect.element(page.getByRole('tooltip')).toBeVisible()
  expect(host.textContent).toContain(copy.extendedContextWarning)
  const bounds = host.querySelector('[role="tooltip"]')!.getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(15)
  expect(bounds.right).toBeLessThanOrEqual(375)
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(fetch).not.toHaveBeenCalled()
})
