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
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
function directory(model = 'gpt-6.1-sol', provider = 'openai-codex') {
  let current: ModelDirectoryState = { current: { model, provider }, routable: true, groups: [], failures: [], status: 'ready', error: null }
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
it('keeps a newer choice in view B when older view A with the same generation unmounts', async () => {
  const fetch = await backend(), d = directory()
  const props = { directory: d.store, sessionId: 'session', t }
  const a = render(<OpenAICodexFastModeToggle {...props} />)
  const b = render(<OpenAICodexFastModeToggle {...props} />)
  const aView = within(a.container), bView = within(b.container)
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
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  const chosen = fetch.registry.readSpeed('session', fetch.scope())
  await act(async () => { initial.unmount() })
  render(<OpenAICodexFastModeToggle {...props} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  expect(screen.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true')
  expect(fetch.registry.readSpeed('session', fetch.scope())).toEqual(chosen)
})
it('blocks paid selection during shared account mutations and rereads after account replacement', async () => {
  const fetch = await backend()
  let state: AccountSnapshot = { status: { status: 'signed-in', usage: { rateLimits: [] } }, busy: false,
    accounts: [{ accountKey: 'synthetic-a', active: true, displayName: 'offline', profileSource: 'generated' }], operation: { kind: 'idle' } }
  const listeners = new Set<() => void>()
  const account = { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
  render(<OpenAICodexFastModeToggle directory={directory().store} account={account} sessionId="session" t={t} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  act(() => { fetch.accountChanged(); state = { ...state, busy: true, operation: { kind: 'activating', accountKey: 'synthetic-b' } }; listeners.forEach(listener => { listener() }) })
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', true) })
  act(() => { state = { ...state, busy: false, operation: { kind: 'idle' }, accounts: [{ ...state.accounts[0]!, accountKey: 'synthetic-b' }] }; listeners.forEach(listener => { listener() }) })
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
})
it.each(['gpt-6.1-sol', 'gpt-6-astra'])('starts %s in Standard and selects mutually exclusive Fast/Ultrafast without claiming service confirmation', async model => {
  const fetch = await backend(), d = directory(model)
  render(<OpenAICodexFastModeToggle directory={d.store} sessionId="session" t={t} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  fireEvent.click(screen.getByRole('button', { name: 'Fast' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Fast' }).getAttribute('aria-pressed')).toBe('true') })
  fireEvent.click(screen.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  expect(screen.getByRole('button', { name: 'Fast' }).getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByText(en.ultrafastDisclosure)).toBeTruthy()
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST').map(([, init]) => JSON.parse(String(init.body)).mode)).toEqual(['fast', 'ultrafast'])
})
it('disables unsupported models and hides the control on unrelated providers', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ enabled: false })))
  const view = render(<OpenAICodexFastModeToggle directory={directory('gpt-6-sol').store} sessionId="session" t={t} />)
  expect(screen.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', true)
  view.rerender(<OpenAICodexFastModeToggle directory={directory('gpt-6.1-sol', 'other').store} sessionId="session" t={t} />)
  expect(screen.queryByRole('button', { name: 'Ultrafast' })).toBeNull()
})
it('invalidates and reads a fresh Standard selection after switching away/back without a request', async () => {
  const fetch = await backend(), d = directory()
  render(<OpenAICodexFastModeToggle directory={d.store} sessionId="session" t={t} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  act(() => { fetch.modelChanged('gpt-6-astra'); d.change('gpt-6-astra') })
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  act(() => { fetch.modelChanged('gpt-6.1-sol'); d.change('gpt-6.1-sol') })
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(0)
})
it('recovers an uncertain POST by an explicit GET without replay or entitlement classification', async () => {
  const fetch = await backend(), normal = fetch.getMockImplementation()!
  fetch.mockImplementation((path, init) => init.method === 'POST' ? Promise.resolve(json({ error: 'forbidden' }, 403)) : normal(path, init))
  render(<OpenAICodexFastModeToggle directory={directory().store} sessionId="session" t={t} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: en.speedRecover })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.speedRecover }))
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true') })
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
})

it('keeps the actual legacy Fast route and its control usable after Ultrafast switches to an unsupported model', async () => {
  const fetch = await backend(), d = directory()
  render(<OpenAICodexFastModeToggle directory={d.store} sessionId="session" t={t} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: 'Ultrafast' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Ultrafast' }).getAttribute('aria-pressed')).toBe('true') })
  act(() => { fetch.modelChanged('gpt-6-sol'); d.change('gpt-6-sol') })
  const response = await fetch(OPENAI_CODEX_FAST_MODE_PATH + '?sessionId=session', { method: 'GET' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ enabled: false })
  await waitFor(() => { expect(screen.getByRole('button', { name: en.fastModeDisabledTitle })).toHaveProperty('disabled', false) })
  expect(screen.getByRole('button', { name: 'Ultrafast' })).toHaveProperty('disabled', true)
  expect(fetch.registry.captureSpeed('session').mode).toBe('standard')
  fireEvent.click(screen.getByRole('button', { name: en.fastModeDisabledTitle }))
  await waitFor(() => { expect(screen.getByRole('button', { name: en.fastModeEnabledTitle })).toBeTruthy() })
  expect(fetch.registry.captureSpeed('session').mode).toBe('fast')
})
