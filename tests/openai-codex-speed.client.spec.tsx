// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OpenAICodexFastModeToggle } from '../src/client/OpenAICodexFastModeToggle.tsx'
import { en } from '../src/client/locales.ts'
import type { OpenAICodexSettingsKey } from '../src/client/locales.ts'
import type { AccountSnapshot } from '../src/client/account-store.ts'
import { speedLifecycleFixture } from './support/speed-lifecycle-fixture.ts'
import { OPENAI_CODEX_FAST_MODE_PATH } from '../src/fast-mode-paths.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const t = (key: OpenAICodexSettingsKey) => en[key]
function directory(model = 'gpt-6.1-sol', provider = 'openai-codex') {
  let current: ModelDirectoryState = { current: { model, provider }, routable: true, pending: null, groups: [], failures: [], status: 'ready', error: null }
  const listeners = new Set<() => void>()
  const store: SnapshotStore<ModelDirectoryState> = { getSnapshot: () => current, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, update: () => undefined, set: () => undefined }
  return { store, change: (next: string) => { current = { ...current, current: { provider, model: next } }; listeners.forEach(listener => { listener() }) } }
}
async function backend() {
  const f = await speedLifecycleFixture()
  const fetch = vi.fn((path: string, init: RequestInit) => f.request(path, init))
  vi.stubGlobal('fetch', fetch)
  return Object.assign(fetch, f)
}
/** The lightning button opens the three-way picker; select inside the dialog. */
async function openPicker(view: { container: HTMLElement }) {
  const bolt = await waitFor(() => {
    const found = view.container.querySelector('button[aria-haspopup="dialog"]')
    expect(found).toBeTruthy()
    return found as HTMLButtonElement
  })
  if (bolt.getAttribute('aria-expanded') !== 'true') fireEvent.click(bolt)
  await waitFor(() => { expect(within(view.container).getByRole('dialog')).toBeTruthy() })
  return within(view.container)
}
it('keeps a newer choice in view B when older view A with the same generation unmounts', async () => {
  const fetch = await backend(), d = directory()
  const props = { directory: d.store, sessionId: 'session', t }
  const a = render(<OpenAICodexFastModeToggle {...props} />)
  const b = render(<OpenAICodexFastModeToggle {...props} />)
  const aView = await openPicker(a), bView = await openPicker(b)
  await waitFor(() => { expect(aView.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  await waitFor(() => { expect(bView.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  const shared = fetch.registry.readSpeed('session', fetch.scope())
  fireEvent.click(bView.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(bView.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  expect(fetch.registry.readSpeed('session', fetch.scope())).toMatchObject({ generation: shared.generation, revision: shared.revision + 1, mode: 'ultrafast' })
  await act(async () => { a.unmount() })
  expect(fetch.registry.requestSpeed('session', fetch.scope())).toBe('ultrafast')
  expect(bView.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true')
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(0)
})
it('retains an explicit choice and its generation across navigation away and back', async () => {
  const fetch = await backend(), d = directory(), props = { directory: d.store, sessionId: 'session', t }
  const initial = render(<OpenAICodexFastModeToggle {...props} />)
  const view = await openPicker(initial)
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(view.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  const chosen = fetch.registry.readSpeed('session', fetch.scope())
  await act(async () => { initial.unmount() })
  const again = render(<OpenAICodexFastModeToggle {...props} />)
  const view2 = await openPicker(again)
  await waitFor(() => { expect(view2.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  expect(view2.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true')
  expect(fetch.registry.readSpeed('session', fetch.scope())).toEqual(chosen)
})
it('blocks paid selection during shared account mutations and rereads after account replacement', async () => {
  const fetch = await backend()
  let state: AccountSnapshot = { status: { status: 'signed-in', usage: { rateLimits: [] } }, busy: false,
    accounts: [{ accountKey: 'synthetic-a', active: true, displayName: 'offline', profileSource: 'generated' }], operation: { kind: 'idle' } }
  const listeners = new Set<() => void>()
  const account = { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const rendered = render(<OpenAICodexFastModeToggle directory={directory().store} account={account} sessionId="session" t={t} />)
  const view = await openPicker(rendered)
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(view.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  act(() => { fetch.accountChanged(); state = { ...state, busy: true, operation: { kind: 'activating', accountKey: 'synthetic-b' } }; listeners.forEach(listener => { listener() }) })
  const gated = await openPicker(rendered)
  await waitFor(() => { expect(gated.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', true) })
  act(() => { state = { ...state, busy: false, operation: { kind: 'idle' }, accounts: [{ ...state.accounts[0]!, accountKey: 'synthetic-b' }] }; listeners.forEach(listener => { listener() }) })
  const fresh = await openPicker(rendered)
  await waitFor(() => { expect(fresh.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
})
it.each(['gpt-6.1-sol', 'gpt-6-astra'])('starts %s in Standard and selects mutually exclusive Fast/Ultrafast without claiming service confirmation', async model => {
  const fetch = await backend(), d = directory(model)
  const rendered = render(<OpenAICodexFastModeToggle directory={d.store} sessionId="session" t={t} />)
  const view = await openPicker(rendered)
  await waitFor(() => { expect(view.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  fireEvent.click(view.getByRole('button', { name: 'Fast' }))
  await waitFor(() => { expect(view.getByRole('button', { name: 'Fast' }).getAttribute('aria-pressed')).toBe('true') })
  fireEvent.click(view.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  expect(view.getByRole('button', { name: 'Fast' }).getAttribute('aria-pressed')).toBe('false')
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST').map(([, init]) => JSON.parse(String(init.body)).mode)).toEqual(['fast', 'ultrafast'])
})
it('marks the bolt with the selected tier color and hides the control on unrelated providers', async () => {
  const fetch = await backend()
  const rendered = render(<OpenAICodexFastModeToggle directory={directory().store} sessionId="session" t={t} />)
  const view = await openPicker(rendered)
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(view.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => {
    const bolt = rendered.container.querySelector('[data-openai-codex-speed-bolt]')
    expect(bolt?.getAttribute('data-openai-codex-speed-bolt')).toBe('filled')
    expect(bolt?.getAttribute('fill')).toBe('currentColor')
  })
  const button = rendered.container.querySelector('button[aria-haspopup="dialog"]')!
  expect(button.getAttribute('style')).toContain('rgb(217, 119, 6)')
  rendered.rerender(<OpenAICodexFastModeToggle directory={directory('gpt-6.1-sol', 'other').store} sessionId="session" t={t} />)
  expect(screen.queryByRole('button', { name: en.fastModeDisabledTitle })).toBeNull()
})
it('invalidates and reads a fresh Standard selection after switching away/back without a request', async () => {
  const fetch = await backend(), d = directory()
  const rendered = render(<OpenAICodexFastModeToggle directory={d.store} sessionId="session" t={t} />)
  const view = await openPicker(rendered)
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(view.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  act(() => { fetch.modelChanged('gpt-6-astra'); d.change('gpt-6-astra') })
  const afterAstra = await openPicker(rendered)
  await waitFor(() => { expect(afterAstra.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  act(() => { fetch.modelChanged('gpt-6.1-sol'); d.change('gpt-6.1-sol') })
  const afterSol = await openPicker(rendered)
  await waitFor(() => { expect(afterSol.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(0)
})
it('recovers an uncertain POST by an explicit GET without replay or entitlement classification', async () => {
  const fetch = await backend(), normal = fetch.getMockImplementation()!
  fetch.mockImplementation((path, init) => init.method === 'POST' ? Promise.resolve(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } })) : normal(path, init))
  const rendered = render(<OpenAICodexFastModeToggle directory={directory().store} sessionId="session" t={t} />)
  const view = await openPicker(rendered)
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(view.getByRole('button', { name: 'Ultrafast' }))
  // Both the bolt and the open dialog may show the recover label; trigger via the bolt (first).
  await waitFor(() => { expect(screen.getAllByRole('button', { name: en.speedRecover }).length).toBeGreaterThan(0) })
  fireEvent.click(screen.getAllByRole('button', { name: en.speedRecover })[0]!)
  const fresh = await openPicker(rendered)
  await waitFor(() => { expect(fresh.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
})

it('keeps the actual legacy Fast route and its control usable after Ultrafast switches to an unsupported model', async () => {
  const fetch = await backend(), d = directory()
  const rendered = render(<OpenAICodexFastModeToggle directory={d.store} sessionId="session" t={t} />)
  const view = await openPicker(rendered)
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(view.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(view.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  act(() => { fetch.modelChanged('gpt-6-sol'); d.change('gpt-6-sol') })
  const response = await fetch(OPENAI_CODEX_FAST_MODE_PATH + '?sessionId=session', { method: 'GET' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ enabled: false })
  // The unsupported model falls back to the legacy lightning click toggle.
  await waitFor(() => { expect(screen.getByRole('button', { name: en.fastModeDisabledTitle })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: en.fastModeDisabledTitle }))
  await waitFor(() => { expect(screen.getByRole('button', { name: en.fastModeEnabledTitle })).toBeTruthy() })
  expect(fetch.registry.captureSpeed('session').mode).toBe('fast')
})
