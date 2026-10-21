// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
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
function scope(tier?: 'standard' | 'extended' | 'maximum', writable = true) {
  const listeners = new Set<() => void>()
  let snapshot: ConfigFormSnapshot<OpenAICodexSettingsConfig> = { status: 'ready', value: { ...DEFAULT_OPENAI_CODEX_SETTINGS,
    modelContextTiers: { 'gpt-6-astra': 'standard', ...(tier === undefined ? {} : { 'gpt-6.1-sol': tier }) } },
    base: undefined, user: undefined, revision: 0, writable }
  const save = (next: 'standard' | 'extended' | 'maximum') => {
    snapshot = { ...snapshot, value: { ...snapshot.value!, modelContextTiers: { ...snapshot.value!.modelContextTiers, 'gpt-6.1-sol': next } }, revision: (snapshot.revision ?? 0) + 1 }
    listeners.forEach(listener => { listener() })
  }
  const mutate = vi.fn<ConfigForm<OpenAICodexSettingsConfig>['mutate']>(async (ops, revision) => {
    expect(revision).toBe(snapshot.revision)
    const op = ops[0]
    if (op?.op !== 'set' || (op.value !== 'standard' && op.value !== 'extended' && op.value !== 'maximum')) throw new Error('Invalid synthetic operation')
    save(op.value); return true
  })
  return { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }, mutate, save }
}
const translator = (copy: typeof en) => (key: OpenAICodexSettingsKey, params: Record<string, unknown> = {}) =>
  Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), copy[key])
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('shared context quick editor', () => {
  it.each([['standard', '272K'], ['extended', '500K'], ['maximum', '872K']] as const)('preserves the original icon and short hover tooltip for %s; only clicking opens the editor', (tier, label) => {
    const configScope = scope(tier)
    render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(en)} />)
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('')
    expect(button.querySelector('path')?.getAttribute('d')).toBe('M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5')
    fireEvent.mouseEnter(button)
    expect(screen.getByRole('tooltip').textContent).toContain(label)
    expect(screen.getByRole('tooltip').textContent!.length).toBeLessThan(40)
    expect(screen.queryByRole('slider')).toBeNull()
    fireEvent.click(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe(label)
    expect(configScope.mutate).not.toHaveBeenCalled()
  })
  it('defaults Sol to 500K, saves only its model key, and reflects external settings changes', async () => {
    const configScope = scope()
    render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(zh)} />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-label')).toBe('上下文：扩展 · 500K')
    fireEvent.click(button); fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' })
    await waitFor(() => { expect(button.getAttribute('data-openai-codex-context-window')).toBe('872000') })
    expect(configScope.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['modelContextTiers', 'gpt-6.1-sol'], value: 'maximum' }], 0)
    expect(configScope.getSnapshot().value?.modelContextTiers?.['gpt-6-astra']).toBe('standard')
    await act(async () => { configScope.save('standard') })
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('272K')
  })
  it('attracts the dragged thumb to detents and submits only once on release', async () => {
    class TestPointer extends MouseEvent {
      pointerId: number
      constructor(type: string, init: MouseEventInit & { pointerId?: number }) { super(type, init); this.pointerId = init.pointerId ?? 1 }
    }
    vi.stubGlobal('PointerEvent', TestPointer)
    const configScope = scope('extended')
    render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(en)} />)
    fireEvent.click(screen.getByRole('button'))
    const slider = screen.getByRole('slider')
    Object.defineProperties(slider, {
      setPointerCapture: { value: vi.fn() }, hasPointerCapture: { value: () => true }, releasePointerCapture: { value: vi.fn() },
      getBoundingClientRect: { value: () => new DOMRect(0, 0, 140, 30) },
    })
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 70 })
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 91 })
    expect(slider.getAttribute('aria-valuetext')).toBe('500K')
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 106 })
    expect(slider.getAttribute('aria-valuetext')).toBe('872K')
    expect(screen.getByRole('button').getAttribute('data-openai-codex-context-window')).toBe('500000')
    expect(configScope.mutate).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 106 })
    await waitFor(() => { expect(screen.getByRole('button').getAttribute('data-openai-codex-context-window')).toBe('872000') })
    expect(configScope.mutate).toHaveBeenCalledOnce()
  })
  it.each(['false', 'error'])('reports a %s write failure without optimistic capacity or automatic replay', async failure => {
    const configScope = scope('extended')
    configScope.mutate.mockImplementation(async () => { if (failure === 'error') throw new Error('Synthetic failure'); return false })
    render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(en)} />)
    fireEvent.click(screen.getByRole('button')); fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' })
    await screen.findByRole('alert')
    expect(screen.getByRole('button').getAttribute('data-openai-codex-context-window')).toBe('500000')
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('500K')
    expect(configScope.mutate).toHaveBeenCalledOnce()
  })
  it('keeps the same editor mounted while the selected model catalog refreshes', () => {
    const source = directory()
    let state = source.getSnapshot()
    const listeners = new Set<() => void>()
    const store = { ...source, getSnapshot: () => state, subscribe: (listener: () => void) => {
      listeners.add(listener); return () => { listeners.delete(listener) }
    } }
    render(<OpenAICodexContextIndicator directory={store} configScope={scope()} t={translator(en)} />)
    fireEvent.click(screen.getByRole('button'))
    const slider = screen.getByRole('slider')
    act(() => { state = { ...state, status: 'loading' }; listeners.forEach(listener => { listener() }) })
    expect(screen.getByRole('slider')).toBe(slider)
    act(() => { state = { ...state, status: 'ready' }; listeners.forEach(listener => { listener() }) })
    expect(screen.getByRole('slider')).toBe(slider)
  })
  it('keeps the editor and optimistic detent stable during a delayed save', async () => {
    const configScope = scope('extended')
    let finish: (() => void) | undefined
    configScope.mutate.mockImplementation(() => new Promise<boolean>(resolve => {
      finish = () => { configScope.save('maximum'); resolve(true) }
    }))
    render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(en)} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'End' })
    expect(slider.getAttribute('aria-valuetext')).toBe('872K')
    expect(slider.getAttribute('aria-disabled')).toBe('false')
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => { finish?.() })
    expect(screen.getByRole('slider')).toBe(slider)
    expect(slider.getAttribute('aria-valuetext')).toBe('872K')
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it.each([true, false])('clears busy on a model change with overlapping saves (old finishes first: %s)', async oldFirst => {
    const configScope = scope('extended')
    const finishes: Array<(value: boolean) => void> = []
    configScope.mutate.mockImplementation(() => new Promise<boolean>(resolve => { finishes.push(resolve) }))
    const view = render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(en)} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' })
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true')
    view.rerender(<OpenAICodexContextIndicator directory={directory('gpt-6-astra')} configScope={configScope} t={translator(en)} />)
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('false')
    fireEvent.click(screen.getByRole('button'))
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' })
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true')
    await act(async () => { finishes[oldFirst ? 0 : 1]?.(true) })
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe(oldFirst ? 'true' : 'false')
    await act(async () => { finishes[oldFirst ? 1 : 0]?.(true) })
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('false')
    // An old-generation write may already advance the queued Host revision.
    // Do not fence the new-generation write with its earlier snapshot.
    expect(configScope.mutate.mock.calls[1]?.[1]).toBeUndefined()
  })
  it('disables writes to read-only settings and does not invent unknown-model capacity', () => {
    const configScope = scope('extended', false)
    const view = render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(en)} />)
    fireEvent.click(screen.getByRole('button')); fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' })
    expect(screen.getByRole('slider').getAttribute('aria-disabled')).toBe('true'); expect(configScope.mutate).not.toHaveBeenCalled()
    view.rerender(<OpenAICodexContextIndicator directory={directory()} t={translator(en)} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').getAttribute('data-openai-codex-context-window')).toBe('unconfirmed')
    expect(screen.queryByRole('dialog')).toBeNull()
    view.rerender(<OpenAICodexContextIndicator directory={directory('unknown-model')} configScope={configScope} t={translator(en)} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('closes on Escape/outside click and model changes', () => {
    const configScope = scope('maximum')
    const view = render(<OpenAICodexContextIndicator directory={directory()} configScope={configScope} t={translator(en)} />)
    fireEvent.click(screen.getByRole('button')); fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button')); fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    view.rerender(<OpenAICodexContextIndicator directory={directory('gpt-6-astra')} configScope={configScope} t={translator(en)} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Context: Standard · 272K')
  })
})
