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

function t(key: OpenAICodexSettingsKey, params: Record<string, unknown> = {}): string {
  return Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), en[key])
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
    set: next => { state = next; listeners.forEach(listener => { listener() }) },
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
  it('preserves the button and confirmed state without rereading during catalog refresh', async () => {
    const directory = directoryStore(directoryState('gpt-6.1-sol'))
    const fetchMock = vi.fn(async () => json({ enabled: true }))
    vi.stubGlobal('fetch', fetchMock)
    render(<OpenAICodexFastModeToggle directory={directory} sessionId="session-a" t={t} />)
    const button = await screen.findByRole('button', { name: en.fastModeEnabledTitle })
    for (const status of ['loading', 'selecting', 'ready'] as const) {
      act(() => { directory.set({ ...directory.getSnapshot(), status }) })
      expect(screen.getByRole('button')).toBe(button)
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(button.getAttribute('aria-busy')).toBe('false')
    }
    expect(fetchMock).toHaveBeenCalledOnce()
    act(() => { directory.set({ ...directory.getSnapshot(), status: 'loading', current: null }) })
    expect(screen.queryByRole('button')).toBeNull()
  })
  it.each(['GET', 'POST'] as const)('does not cancel an in-flight %s on catalog refresh', async method => {
    const directory = directoryStore(directoryState('gpt-6.1-sol'))
    let signal!: AbortSignal
    let finish!: (value: Response) => void
    const fetchMock = vi.fn((_path: string, init: RequestInit) => {
      if (method === 'POST' && init.method === 'GET') return Promise.resolve(json({ enabled: false }))
      signal = init.signal!
      return new Promise<Response>(resolve => { finish = resolve })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OpenAICodexFastModeToggle directory={directory} sessionId="session-a" t={t} />)
    if (method === 'POST') {
      await screen.findByRole('button', { name: en.fastModeDisabledTitle })
      fireEvent.click(screen.getByRole('button'))
    }
    const button = screen.getByRole('button')
    act(() => { directory.set({ ...directory.getSnapshot(), status: 'loading' }) })
    expect(screen.getByRole('button')).toBe(button)
    expect(signal.aborted).toBe(false)
    act(() => { directory.set({ ...directory.getSnapshot(), status: 'ready' }) })
    await act(async () => { finish(json({ enabled: true })) })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(fetchMock).toHaveBeenCalledTimes(method === 'POST' ? 2 : 1)
  })
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
  describe.each([
    ['Fast Mode', OpenAICodexFastModeToggle, OPENAI_CODEX_FAST_MODE_PATH],
  ] as const)('%s readback recovery', (_label, Toggle, path) => {
    it.each(['http', 'invalid-json', 'invalid-state', 'offline'])('recovers a failed GET (%s) only on user action, including after an eligible model change', async failure => {
      const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        expect(init?.method).toBe('GET')
        if (fetchMock.mock.calls.length > 1) return json({ enabled: true })
        if (failure === 'offline') throw new Error('offline')
        if (failure === 'invalid-json') return new Response('{')
        return failure === 'http' ? json({}, 500) : json({ enabled: 'true' })
      })
      vi.stubGlobal('fetch', fetchMock)
      const view = render(<Toggle directory={directoryStore(directoryState('gpt-6.1-sol'))} sessionId="session-a" t={t} />)
      const button = screen.getByRole<HTMLButtonElement>('button')
      await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
      expect(button.disabled).toBe(false)
      expect(button.getAttribute('aria-pressed')).toBe('false')
      view.rerender(<Toggle directory={directoryStore(directoryState('gpt-6-astra'))} sessionId="session-a" t={t} />)
      expect(fetchMock).toHaveBeenCalledOnce()
      fireEvent.click(button)
      await waitFor(() => { expect(button.getAttribute('aria-pressed')).toBe('true') })
      expect(fetchMock.mock.calls.map(([input, init]) => [input, init?.method])).toEqual([
        [`${path}?sessionId=session-a`, 'GET'], [`${path}?sessionId=session-a`, 'GET'],
      ])
    })

    it.each(['http', 'invalid-json', 'offline'])('reads back a possibly committed POST (%s) without replaying it', async failure => {
      let saved = false
      const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (init?.method !== 'POST') return json({ enabled: saved })
        saved = true
        if (failure === 'offline') throw new Error('response lost')
        return failure === 'http' ? json({}, 500) : new Response('{')
      })
      vi.stubGlobal('fetch', fetchMock)
      render(<Toggle directory={directoryStore(directoryState('gpt-6.1-sol'))} sessionId="session-a" t={t} />)
      const button = screen.getByRole<HTMLButtonElement>('button')
      await waitFor(() => { expect(button.disabled).toBe(false) })
      fireEvent.click(button)
      await waitFor(() => { expect(button.disabled).toBe(false) })
      expect(button.getAttribute('aria-pressed')).toBe('false')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      fireEvent.click(button)
      await waitFor(() => { expect(button.getAttribute('aria-pressed')).toBe('true') })
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST', 'GET'])
    })

    it('recovers after an initial GET body exceeds the deadline without automatic retry', async () => {
      vi.useFakeTimers()
      let finishBody: ((value: unknown) => void) | undefined
      const fetchMock = vi.fn(async (): Promise<Response> => {
        if (fetchMock.mock.calls.length > 1) return json({ enabled: true })
        const response = json({ enabled: false })
        vi.spyOn(response, 'json').mockImplementation(() => new Promise(resolve => { finishBody = resolve }))
        return response
      })
      vi.stubGlobal('fetch', fetchMock)
      await act(async () => { render(<Toggle directory={directoryStore(directoryState('gpt-6.1-sol'))} sessionId="session-a" t={t} />) })
      const button = screen.getByRole<HTMLButtonElement>('button')
      await act(async () => { await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS) })
      expect(button.disabled).toBe(false)
      expect(fetchMock).toHaveBeenCalledOnce()
      await act(async () => { fireEvent.click(button) })
      expect(button.getAttribute('aria-pressed')).toBe('true')
      await act(async () => { finishBody?.({ enabled: false }) })
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it.each(['headers', 'body'])('bounds POST %s, ignores its late response, and permits GET recovery', async stall => {
      vi.useFakeTimers()
      let finish: ((response: Response) => void) | undefined
      let finishBody: ((value: unknown) => void) | undefined
      let postSignal: AbortSignal | null | undefined
      const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (init?.method !== 'POST') return json({ enabled: fetchMock.mock.calls.length > 1 })
        postSignal = init.signal
        if (stall === 'headers') return new Promise(resolve => { finish = resolve })
        const response = json({ enabled: false })
        vi.spyOn(response, 'json').mockImplementation(() => new Promise(resolve => { finishBody = resolve }))
        return response
      })
      vi.stubGlobal('fetch', fetchMock)
      await act(async () => { render(<Toggle directory={directoryStore(directoryState('gpt-6.1-sol'))} sessionId="session-a" t={t} />) })
      const button = screen.getByRole<HTMLButtonElement>('button')
      await act(async () => { fireEvent.click(button) })
      await act(async () => { await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS - 1) })
      expect(button.disabled).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(postSignal?.aborted).toBe(true)
      expect(button.disabled).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await act(async () => { fireEvent.click(button) })
      expect(button.getAttribute('aria-pressed')).toBe('true')
      await act(async () => { finish?.(json({ enabled: false })); finishBody?.({ enabled: false }) })
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST', 'GET'])
    })

    it('does not let an old session POST overwrite a newer session read', async () => {
      let finish: ((response: Response) => void) | undefined
      let postSignal: AbortSignal | null | undefined
      const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (init?.method === 'POST') {
          postSignal = init.signal
          return new Promise(resolve => { finish = resolve })
        }
        return Promise.resolve(json({ enabled: false }))
      })
      vi.stubGlobal('fetch', fetchMock)
      const directory = directoryStore(directoryState('gpt-6.1-sol'))
      const view = render(<Toggle directory={directory} sessionId="session-a" t={t} />)
      const button = screen.getByRole<HTMLButtonElement>('button')
      await waitFor(() => { expect(button.disabled).toBe(false) })
      fireEvent.click(button)
      view.rerender(<Toggle directory={directory} sessionId="session-b" t={t} />)
      await waitFor(() => { expect(button.disabled).toBe(false) })
      expect(postSignal?.aborted).toBe(true)
      await act(async () => { finish?.(json({ enabled: true })) })
      expect(button.getAttribute('aria-pressed')).toBe('false')
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST', 'GET'])
    })
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
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
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
    await waitFor(() => { expect(button.getAttribute('aria-pressed')).toBe('true') })
    fireEvent.click(button)
    await waitFor(() => { expect(post).toBe(true) })
    await waitFor(() => { expect(button.getAttribute('aria-label')).toBe(en.fastModeUnconfirmedTitle) })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    await waitFor(() => { expect(button.getAttribute('aria-label')).toBe(en.fastModeEnabledTitle) })
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST', 'GET'])
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
