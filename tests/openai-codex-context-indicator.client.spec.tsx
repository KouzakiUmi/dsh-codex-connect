// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OpenAICodexContextIndicator } from '../src/client/OpenAICodexContextIndicator.tsx'
import { DEFAULT_OPENAI_CODEX_SETTINGS, type OpenAICodexSettingsConfig } from '../src/settings-contract.ts'
import { en, zh } from '../src/client/locales.ts'
import type { OpenAICodexSettingsKey } from '../src/client/locales.ts'
function directory(model = 'gpt-6.1-sol', provider = 'openai-codex'): SnapshotStore<ModelDirectoryState> {
  const state: ModelDirectoryState = { status: 'ready', pending: null, current: { model, provider }, groups: [], failures: [], routable: true, error: null }
  return { getSnapshot: () => state, subscribe: () => () => undefined, set: () => undefined, update: () => undefined }
}
function scope(tier: 'standard' | 'extended' | 'maximum') {
  const listeners = new Set<() => void>()
  let snapshot: ConfigFormSnapshot<OpenAICodexSettingsConfig> = { status: 'ready', value: { ...DEFAULT_OPENAI_CODEX_SETTINGS, modelContextTiers: { 'gpt-6.1-sol': tier } },
    base: undefined, user: undefined, revision: 0, writable: true, mode: 'host' }
  const mutate = vi.fn()
  return { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }, mutate,
    save: (next: typeof tier) => { snapshot = { ...snapshot, value: { ...snapshot.value!, modelContextTiers: { 'gpt-6.1-sol': next } }, revision: 1 }; listeners.forEach(listener => { listener() }) } }
}
const translator = (copy: typeof en) => (key: OpenAICodexSettingsKey, params: Record<string, unknown> = {}) =>
  Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), copy[key])
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('read-only saved context indicator', () => {
  it.each([['standard', '272K'], ['extended', '500K'], ['maximum', '872K']] as const)('shows %s capacity with keyboard tooltip and never sends a mutation', (tier, label) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const configScope = scope(tier)
    render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(en)} />)
    const indicator = screen.getByRole('status')
    expect(indicator.textContent).toBe(label)
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.click(indicator); fireEvent.keyDown(indicator, { key: 'Enter' }); fireEvent.focus(indicator)
    expect(screen.getByRole('tooltip').textContent).toContain('not used tokens')
    expect(screen.getByRole('tooltip').textContent).toContain('/compact')
    expect(fetch).not.toHaveBeenCalled(); expect(configScope.mutate).not.toHaveBeenCalled()
  })
  it('uses different colors and updates from saved settings without a conversation turn', async () => {
    const configScope = scope('standard')
    render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(zh)} />)
    const indicator = screen.getByRole('status'), gray = indicator.style.color
    await act(async () => { configScope.save('extended') })
    const blue = indicator.style.color
    expect(indicator.textContent).toBe('500K'); expect(blue).not.toBe(gray)
    await act(async () => { configScope.save('maximum') })
    expect(indicator.textContent).toBe('872K'); expect(indicator.style.color).not.toBe(blue)
    fireEvent.focus(indicator)
    expect(screen.getByRole('tooltip').textContent).toContain('已有和新会话')
    expect(screen.getByRole('tooltip').textContent).toContain(zh.extendedContextWarning)
  })
  it('does not present missing settings as confirmed 272K or invent another model window', () => {
    const view = render(<OpenAICodexContextIndicator directory={directory()} t={translator(en)} />)
    expect(screen.getByRole('status').textContent).toBe('…')
    view.rerender(<OpenAICodexContextIndicator directory={directory('unknown-model')} configScope={scope('maximum')} t={translator(en)} />)
    expect(screen.queryByRole('status')).toBeNull()
    view.rerender(<OpenAICodexContextIndicator directory={directory('gpt-6.1-sol', 'other-provider')} configScope={scope('maximum')} t={translator(en)} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('follows the selected model, not another model maximum preference', () => {
    const view = render(<OpenAICodexContextIndicator directory={directory()} configScope={scope('maximum')} t={translator(en)} />)
    expect(screen.getByRole('status').textContent).toBe('872K')
    view.rerender(<OpenAICodexContextIndicator directory={directory('gpt-6-astra')} configScope={scope('maximum')} t={translator(en)} />)
    expect(screen.getByRole('status').textContent).toBe('272K')
  })
})
