// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { formatOpenAICodexResetAt } from '../src/client/OpenAICodexSettings.tsx'
import { OpenAICodexQuotaIndicator } from '../src/client/OpenAICodexQuotaIndicator.tsx'
import type { OpenAICodexConfigForm } from '../src/client/config-form.ts'
import { en } from '../src/client/locales.ts'
import { BROWSER_REQUEST_TIMEOUT_MS } from '../src/client/request-json.ts'
import type { OpenAICodexSettingsKey } from '../src/client/locales.ts'
import { DEFAULT_OPENAI_CODEX_SETTINGS } from '../src/settings-contract.ts'
import type { OpenAICodexSettingsConfig } from '../src/settings-contract.ts'

/** The pill is opt-in, so every render needs a config scope that enables it. */
function pillScope(enabled: boolean): Pick<OpenAICodexConfigForm, 'getSnapshot' | 'subscribe'> {
  const snapshot: ConfigFormSnapshot<OpenAICodexSettingsConfig> = {
    status: 'ready',
    value: { ...DEFAULT_OPENAI_CODEX_SETTINGS, enableComposerQuotaPill: enabled },
    base: undefined,
    user: undefined,
    revision: 7,
    writable: true,
    mode: 'host',
  }
  return { subscribe: () => () => undefined, getSnapshot: () => snapshot }
}

const enabledScope = pillScope(true)

function t(key: OpenAICodexSettingsKey, params: Record<string, unknown> = {}): string {
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
    en[key],
  )
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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

function usage(resetAt?: number, remainingPercent = 72.5): unknown {
  return {
    rateLimits: [{
      id: 'codex',
      name: 'Codex',
      windows: [
        { remainingPercent: 88.5, windowSeconds: 5 * 60 * 60, ...resetAt === undefined ? {} : { resetAt } },
        { remainingPercent, windowSeconds: 7 * 24 * 60 * 60, ...resetAt === undefined ? {} : { resetAt } },
      ],
    }],
  }
}

function directoryStore(state: ModelDirectoryState): SnapshotStore<ModelDirectoryState> {
  const listeners = new Set<() => void>()
  let snapshot = state
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    update: () => undefined,
    set: next => {
      snapshot = next
      listeners.forEach(listener => { listener() })
    },
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OpenAI Codex Composer server-driven quota', () => {
  it.each(['headers', 'body'] as const)('bounds hung %s and releases no-overlap for visibility-aware backoff recovery', async phase => {
    vi.useFakeTimers()
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const signals: AbortSignal[] = []
    const finishes: ((value: unknown) => void)[] = []
    let recover = false
    const fetchMock = vi.fn((_path: string, init: RequestInit) => {
      expect(init.method).toBe('GET')
      expect(init.credentials).toBe('same-origin')
      signals.push(init.signal!)
      if (recover) return Promise.resolve(json({ status: 'signed-in', usage: usage() }))
      const stalled = new Promise<unknown>(done => { finishes.push(done) })
      return phase === 'headers' ? stalled : Promise.resolve({ ok: true, json: () => stalled })
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<OpenAICodexQuotaIndicator directory={directoryStore(directoryState('gpt-5'))} configScope={enabledScope} t={t} />)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS - 1) })
    expect(fetchMock).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(signals[0]?.aborted).toBe(true)
    expect(screen.queryByRole('status')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000 - 1) })
    expect(fetchMock).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(1 + BROWSER_REQUEST_TIMEOUT_MS) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(signals[1]?.aborted).toBe(true)
    hidden = true
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(120_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    recover = true
    hidden = false
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('status').getAttribute('aria-label')).toContain('72.5%')
    await act(async () => { finishes.forEach(done => done(phase === 'headers' ? json({ status: 'signed-out' }) : { status: 'signed-out' })) })
    expect(screen.getByRole('status')).toBeTruthy()
    // Success restores the ordinary one-minute read schedule.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['headers', 'body'] as const)('cancels pending %s on eligibility loss/unmount and ignores late state', async phase => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    let finish!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn((_path: string, init: RequestInit) => {
      signal = init.signal!
      const stalled = new Promise<unknown>(done => { finish = done })
      return phase === 'headers' ? stalled : Promise.resolve({ ok: true, json: () => stalled })
    }))
    const directory = directoryStore(directoryState('gpt-5'))
    const view = render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    await act(async () => {})
    await act(async () => { directory.set(directoryState('o3')) })
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(phase === 'headers' ? json({ status: 'signed-in', usage: usage() }) : { status: 'signed-in', usage: usage() }) })
    expect(screen.queryByRole('status')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { directory.set(directoryState('gpt-5')) })
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(phase === 'headers' ? json({ status: 'signed-in', usage: usage() }) : { status: 'signed-in', usage: usage() }) })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('shows only for a GPT model on the exact OpenAI Codex provider', async () => {
    const resetAt = 1_735_689_600
    const fetchMock = vi.fn(async () => json({ status: 'signed-in', usage: usage(resetAt) }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-5-codex'))

    render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    const indicator = await screen.findByRole('status')
    const localReset = formatOpenAICodexResetAt(resetAt)
    expect(indicator.textContent).toBe('5h7d')
    expect(indicator.querySelector('svg[data-openai-codex-quota-ring="weekly"]')).toBeNull()
    const track = indicator.querySelector<HTMLElement>('[data-openai-codex-quota-track="weekly"]')
    expect(track?.style.width).toBe('48px')
    expect(track?.style.height).toBe('6px')
    const progress = indicator.querySelector<HTMLElement>('[data-openai-codex-quota-progress="weekly"]')
    expect(progress?.style.width).toBe('72.5%')
    expect(progress?.getAttribute('data-openai-codex-quota-color')).toBe('green')
    expect(indicator.textContent).not.toContain(en.composerWeeklyQuota)
    expect(indicator.textContent).not.toContain(localReset)
    expect(indicator.hasAttribute('title')).toBe(false)
    expect(indicator.getAttribute('aria-label')).toContain(en.composerWeeklyQuota)
    expect(indicator.getAttribute('aria-label')).toContain('5-hour quota')
    expect(indicator.querySelector<HTMLElement>('[data-openai-codex-quota-progress="five-hour"]')?.style.width)
      .toBe('88.5%')
    expect(indicator.getAttribute('aria-label')).toContain('72.5%')
    expect(indicator.getAttribute('aria-label')).toContain(localReset)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('shows a visible tooltip on hover and keyboard focus', async () => {
    const resetAt = 1_735_689_600
    const fetchMock = vi.fn(async () => json({ status: 'signed-in', usage: usage(resetAt) }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-5-codex'))

    render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    const indicator = await screen.findByRole('status')
    const localReset = formatOpenAICodexResetAt(resetAt)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.mouseEnter(indicator)
    const hoverTooltip = await screen.findByRole('tooltip')
    expect(hoverTooltip.textContent).toContain('72.5%')
    expect(hoverTooltip.textContent).toContain(localReset)
    fireEvent.mouseLeave(indicator)
    await waitFor(() => { expect(screen.queryByRole('tooltip')).toBeNull() })

    fireEvent.focus(indicator)
    const focusTooltip = await screen.findByRole('tooltip')
    expect(focusTooltip.textContent).toContain('72.5%')
    expect(focusTooltip.textContent).toContain(localReset)
    fireEvent.blur(indicator)
    await waitFor(() => { expect(screen.queryByRole('tooltip')).toBeNull() })
  })

  it('reads the codex quota bucket for every catalog model', async () => {
    const fetchMock = vi.fn(async () => json({ status: 'signed-in', usage: usage() }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-6-astra'))

    render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    let indicator = await screen.findByRole('status')
    expect(indicator.getAttribute('aria-label')).toContain('88.5%')
    expect(indicator.getAttribute('aria-label')).toContain('72.5%')

    directory.set(directoryState('gpt-5.5'))
    await waitFor(() => {
      indicator = screen.getByRole('status')
      expect(indicator.getAttribute('aria-label')).toContain('72.5%')
    })
  })

  it.each([
    [80, 'green'],
    [50, 'yellow'],
    [35, 'orange'],
    [10, 'red'],
  ] as const)('maps %s%% remaining quota to the %s progress color', async (remainingPercent, color) => {
    const fetchMock = vi.fn(async () => json({ status: 'signed-in', usage: usage(undefined, remainingPercent) }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-5'))

    render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    const indicator = await screen.findByRole('status')
    const progress = indicator.querySelector<HTMLElement>('[data-openai-codex-quota-progress="weekly"]')
    expect(progress?.style.width).toBe(`${remainingPercent}%`)
    expect(progress?.getAttribute('data-openai-codex-quota-color')).toBe(color)
  })

  it.each([
    ['non-GPT model', directoryState('o3')],
    ['wrong provider', directoryState('gpt-5', 'openai')],
  ])('hides for a %s', async (_label, state) => {
    const fetchMock = vi.fn(async () => json({ status: 'signed-in', usage: usage() }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(state)

    render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the indicator visible with an explicit unavailable reset time', async () => {
    const fetchMock = vi.fn(async () => json({ status: 'signed-in', usage: usage() }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-5'))

    render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    const indicator = await screen.findByRole('status')
    expect(indicator.textContent).not.toContain(en.resetUnavailable)
    expect(indicator.getAttribute('aria-label')).toContain(en.resetUnavailable)
  })

  it('shows only the windows returned for the selected model bucket', async () => {
    const fetchMock = vi.fn(async () => json({
      status: 'signed-in',
      usage: {
        rateLimits: [{
          id: 'codex',
          name: 'Codex',
          windows: [{ remainingPercent: 41.5, windowSeconds: 5 * 60 * 60 }],
        }],
      },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-5'))

    render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    const indicator = await screen.findByRole('status')
    expect(indicator.textContent).toBe('5h')
    expect(indicator.querySelector<HTMLElement>('[data-openai-codex-quota-progress="five-hour"]')?.style.width)
      .toBe('41.5%')
    expect(indicator.querySelector('[data-openai-codex-quota-progress="weekly"]')).toBeNull()
  })

  it('hides on signed-out or failed quota requests', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('request failed') })
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-5'))

    render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
  })

  it('hides when the signed-in response has no codex weekly window', async () => {
    const fetchMock = vi.fn(async () => json({ status: 'signed-in', usage: { rateLimits: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-5'))

    render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('aborts an in-flight status request when the entry unmounts', async () => {
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal instanceof AbortSignal ? init.signal : undefined
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-5'))

    const rendered = render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledOnce() })
    rendered.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('does not render or request quota when the configuration scope is missing', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const rendered = render(<OpenAICodexQuotaIndicator directory={directoryStore(directoryState('gpt-5'))} t={t} />)
    expect(rendered.container.textContent).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts an in-flight request when the profile switches the pill off', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    }))
    const directory = directoryStore(directoryState('gpt-5'))
    const rendered = render(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    await waitFor(() => { expect(signal).toBeDefined() })
    rendered.rerender(<OpenAICodexQuotaIndicator directory={directory} configScope={pillScope(false)} t={t} />)
    expect(signal?.aborted).toBe(true)
    expect(rendered.container.textContent).toBe('')
  })

  it('stays off without polling until the profile enables the pill', async () => {
    const fetchMock = vi.fn(async () => json({ status: 'signed-in', usage: usage(1_735_689_600) }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = directoryStore(directoryState('gpt-5-codex'))

    const rendered = render(<OpenAICodexQuotaIndicator directory={directory} configScope={pillScope(false)} t={t} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rendered.container.textContent).toBe('')

    rendered.rerender(<OpenAICodexQuotaIndicator directory={directory} configScope={enabledScope} t={t} />)
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeNull() })
  })
})
