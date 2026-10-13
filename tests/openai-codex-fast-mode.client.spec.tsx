// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OpenAICodexFastModeToggle } from '../src/client/OpenAICodexFastModeToggle.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { OpenAICodexSettingsKey } from '../src/client/locales.ts'
import { OPENAI_CODEX_FAST_MODE_PATH } from '../src/fast-mode-paths.ts'
import { BROWSER_REQUEST_TIMEOUT_MS } from '../src/client/request-json.ts'

function t(key: OpenAICodexSettingsKey): string {
  return en[key]
}

function directoryState(model: string, provider = 'openai-codex'): ModelDirectoryState & { pending: null } {
  return {
    pending: null,
    current: { provider, model },
    routable: true,
    groups: [],
    failures: [],
    status: 'ready',
    error: null,
  }
}

function directoryStore(state: ModelDirectoryState): SnapshotStore<ModelDirectoryState> {
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    update: () => undefined,
    set: () => undefined,
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OpenAI Codex Fast Mode Composer toggle', () => {
  it.each(['GET headers', 'GET body', 'POST headers', 'POST body'] as const)('bounds %s and recovers only via explicit GET, ignoring late completion', async phase => {
    vi.useFakeTimers()
    const directory = directoryStore(directoryState('gpt-5'))
    let recover = false
    let signal!: AbortSignal
    let finish!: (value: unknown) => void
    const stalled = new Promise<unknown>(done => { finish = done })
    const fetchMock = vi.fn((_path: string, init: RequestInit) => {
      if (recover || (phase.startsWith('POST') && init.method === 'GET')) return Promise.resolve(json({ enabled: recover }))
      signal = init.signal!
      return phase.endsWith('headers') ? stalled : Promise.resolve({ ok: true, json: () => stalled })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OpenAICodexFastModeToggle directory={directory} sessionId="session-a" t={t} />)
    await act(async () => {})
    if (phase.startsWith('POST')) fireEvent.click(screen.getByRole('button'))
    await act(async () => { await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS) })
    expect(signal.aborted).toBe(true)
    const button = screen.getByRole('button', { name: phase.startsWith('POST') ? en.fastModeUnconfirmedTitle : en.fastModeUnavailableTitle })
    expect(button).toHaveProperty('disabled', false)
    expect(vi.getTimerCount()).toBe(0)
    recover = true
    fireEvent.click(button)
    await act(async () => {})
    expect(button.getAttribute('aria-label')).toBe(en.fastModeEnabledTitle)
    await act(async () => { finish(phase.endsWith('headers') ? json({ enabled: false }) : { enabled: false }) })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(phase.startsWith('POST') ? 1 : 0)
  })

  it.each(['GET', 'POST'] as const)('cancels late %s body on session replacement and unmount', async method => {
    let signal!: AbortSignal
    let finish!: (value: unknown) => void
    const directory = directoryStore(directoryState('gpt-5'))
    vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => {
      if (path.includes('session-b') || (method === 'POST' && init.method === 'GET')) return Promise.resolve(json({ enabled: false }))
      signal = init.signal!
      return Promise.resolve({ ok: true, json: () => new Promise(done => { finish = done }) })
    }))
    const view = render(<OpenAICodexFastModeToggle directory={directory} sessionId="session-a" t={t} />)
    await act(async () => {})
    if (method === 'POST') { fireEvent.click(screen.getByRole('button')); await act(async () => {}) }
    view.rerender(<OpenAICodexFastModeToggle directory={directory} sessionId="session-b" t={t} />)
    expect(signal.aborted).toBe(true)
    await act(async () => { finish({ enabled: true }) })
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
    view.rerender(<OpenAICodexFastModeToggle directory={directory} sessionId="session-a" t={t} />)
    await act(async () => {})
    if (method === 'POST') { fireEvent.click(screen.getByRole('button')); await act(async () => {}) }
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { finish({ enabled: true }) })
  })
  it('keeps the bilingual hover copy concise and state-specific', () => {
    expect(en.fastModeDisabledTitle).toBe('Current: Standard speed. Click to enable 1.5× speed.')
    expect(en.fastModeEnabledTitle).toBe('Current: 1.5× speed, with faster quota consumption. Click to switch to Standard speed.')
    expect(zh.fastModeDisabledTitle).toBe('当前：标准速度。点击开启 1.5 倍速度')
    expect(zh.fastModeEnabledTitle).toBe('当前：1.5 倍速度，额度消耗更快。点击切换到标准速度')
  })

  it('loads the current session state, toggles only that session, and exposes aria/title semantics', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        expect(input).toBe(OPENAI_CODEX_FAST_MODE_PATH)
        expect(JSON.parse(String(init.body))).toEqual({ sessionId: 'session-a', enabled: true })
        return json({ enabled: true })
      }
      expect(String(input)).toContain(`${OPENAI_CODEX_FAST_MODE_PATH}?sessionId=session-a`)
      return json({ enabled: false })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OpenAICodexFastModeToggle directory={directoryStore(directoryState('gpt-5'))} sessionId="session-a" t={t} />)

    const button = await screen.findByRole('button')
    const bolt = button.querySelector('[data-openai-codex-fast-mode-bolt]')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.hasAttribute('title')).toBe(false)
    expect(button.getAttribute('aria-label')).toBe('Current: Standard speed. Click to enable 1.5× speed.')
    expect(button.getAttribute('style')).toContain('var(--dsw-alias-label-secondary)')
    expect(bolt?.getAttribute('data-openai-codex-fast-mode-bolt')).toBe('outline')
    expect(bolt?.getAttribute('fill')).toBe('none')
    fireEvent.mouseEnter(button)
    expect(screen.getByRole('tooltip').textContent).toBe('Current: Standard speed. Click to enable 1.5× speed.')
    fireEvent.mouseLeave(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(button)
    await waitFor(() => { expect(button.getAttribute('aria-pressed')).toBe('true') })
    expect(button.getAttribute('aria-label')).toBe('Current: 1.5× speed, with faster quota consumption. Click to switch to Standard speed.')
    expect(button.getAttribute('style')).toContain('rgb(249, 115, 22)')
    expect(bolt?.getAttribute('data-openai-codex-fast-mode-bolt')).toBe('filled')
    expect(bolt?.getAttribute('fill')).toBe('currentColor')
    fireEvent.focus(button)
    expect(screen.getByRole('tooltip').textContent).toBe('Current: 1.5× speed, with faster quota consumption. Click to switch to Standard speed.')
    fireEvent.blur(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['non-GPT model', directoryState('o3')],
    ['wrong provider', directoryState('gpt-5', 'openai')],
  ])('hides for %s', (_label, state) => {
    const fetchMock = vi.fn(async () => json({ enabled: false }))
    vi.stubGlobal('fetch', fetchMock)
    render(<OpenAICodexFastModeToggle directory={directoryStore(state)} sessionId="session-a" t={t} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed after an invalid response and aborts in-flight GET on unmount', async () => {
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal instanceof AbortSignal ? init.signal : undefined
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)
    const rendered = render(<OpenAICodexFastModeToggle directory={directoryStore(directoryState('gpt-5'))} sessionId="session-a" t={t} />)
    const button = await screen.findByRole('button')
    expect((button as HTMLButtonElement).disabled).toBe(true)
    rendered.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('keeps the prior aria state when a POST fails', async () => {
    let post = false
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        post = true
        return json({ error: 'nope' }, 500)
      }
      return json({ enabled: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OpenAICodexFastModeToggle directory={directoryStore(directoryState('gpt-5'))} sessionId="session-a" t={t} />)
    const button = await screen.findByRole('button')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    await waitFor(() => { expect(post).toBe(true) })
    await waitFor(() => { expect(button.getAttribute('aria-label')).toBe(en.fastModeUnconfirmedTitle) })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    await waitFor(() => { expect(button.getAttribute('aria-label')).toBe(en.fastModeEnabledTitle) })
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('aborts an in-flight POST when the Composer control unmounts', async () => {
    let postSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postSignal = init.signal instanceof AbortSignal ? init.signal : undefined
        return new Promise<Response>(() => {})
      }
      return Promise.resolve(json({ enabled: false }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const rendered = render(<OpenAICodexFastModeToggle directory={directoryStore(directoryState('gpt-5'))} sessionId="session-a" t={t} />)
    const button = await screen.findByRole('button')
    await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(button)
    await waitFor(() => { expect(postSignal).toBeDefined() })
    rendered.unmount()
    expect(postSignal?.aborted).toBe(true)
  })
})
