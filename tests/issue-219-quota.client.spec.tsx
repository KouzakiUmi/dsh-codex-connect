// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OpenAICodexQuotaIndicator } from '../src/client/OpenAICodexQuotaIndicator.tsx'
import type { OpenAICodexConfigForm } from '../src/client/config-form.ts'
import { en } from '../src/client/locales.ts'
import { DEFAULT_OPENAI_CODEX_SETTINGS } from '../src/settings-contract.ts'
import type { OpenAICodexSettingsConfig } from '../src/settings-contract.ts'
import { BROWSER_REQUEST_TIMEOUT_MS } from '../src/client/request-json.ts'

const configScope = ((): Pick<OpenAICodexConfigForm, 'getSnapshot' | 'subscribe'> => {
  const snapshot: ConfigFormSnapshot<OpenAICodexSettingsConfig> = {
    status: 'ready',
    value: { ...DEFAULT_OPENAI_CODEX_SETTINGS, enableComposerQuotaPill: true },
    base: undefined, user: undefined, revision: 7, writable: true, mode: 'host',
  }
  return { subscribe: () => () => undefined, getSnapshot: () => snapshot }
})()

let hidden = false
const state: ModelDirectoryState & { pending: null } = { pending: null, current: { provider: 'openai-codex', model: 'gpt-5.1-codex' }, routable: true, groups: [], failures: [], status: 'ready', error: null }
const directory: SnapshotStore<ModelDirectoryState> = { getSnapshot: () => state, subscribe: () => () => {}, update: () => {}, set: () => {} }
const success = () => new Response(JSON.stringify({ status: 'signed-in', usage: { rateLimits: [] } }), { headers: { 'content-type': 'application/json' } })
const mount = async () => { await act(async () => { render(<OpenAICodexQuotaIndicator directory={directory} configScope={configScope} t={key => en[key]} />) }) }
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const visibility = (value: boolean) => { hidden = value; fireEvent(document, new Event('visibilitychange')) }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('issue 219 quota browser scheduling', () => {
  it('does not poll an initially hidden document and refreshes when visible', async () => {
    hidden = true
    const fetch = vi.fn(async () => success()); vi.stubGlobal('fetch', fetch)
    await mount(); await tick(3_600_000); expect(fetch).not.toHaveBeenCalled()
    visibility(false); await tick(0); expect(fetch).toHaveBeenCalledTimes(1)
    await tick(60_000); expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('pauses hidden tabs and avoids visibility-toggle bursts', async () => {
    const fetch = vi.fn(async () => success()); vi.stubGlobal('fetch', fetch)
    await mount(); await tick(10_000)
    visibility(true); visibility(false); await tick(0); expect(fetch).toHaveBeenCalledTimes(1)
    visibility(true); await tick(3_600_000); expect(fetch).toHaveBeenCalledTimes(1)
    visibility(false); await tick(0); expect(fetch).toHaveBeenCalledTimes(2)
    visibility(true); visibility(false); await tick(0); expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('backs off repeated failures and does not bypass cooldown on refocus', async () => {
    const fetch = vi.fn(async (): Promise<Response> => { throw new Error('offline') }); vi.stubGlobal('fetch', fetch)
    await mount(); expect(fetch).toHaveBeenCalledTimes(1)
    await tick(60_000); expect(fetch).toHaveBeenCalledTimes(2)
    visibility(true); visibility(false)
    await tick(119_999); expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockImplementation(async () => success())
    await tick(1); expect(fetch).toHaveBeenCalledTimes(3)
    await tick(60_000); expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('backs off server-side quota failures carried by a successful local HTTP response', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'signed-in', usage: { rateLimits: [] }, quotaError: 'temporarily unavailable' })))
    vi.stubGlobal('fetch', fetch)
    await mount(); await tick(60_000); expect(fetch).toHaveBeenCalledTimes(2)
    await tick(119_999); expect(fetch).toHaveBeenCalledTimes(2)
    await tick(1); expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each(['headers', 'body'])('keeps %s single-flight until the deadline, then recovers after cooldown and aborts on unmount', async stall => {
    const signals: (AbortSignal | null | undefined)[] = []
    let finishOld: ((response: Response) => void) | undefined
    let finishBody: ((value: unknown) => void) | undefined
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
      signals.push(init?.signal)
      if (fetch.mock.calls.length > 1 || stall === 'headers') return new Promise(resolve => { if (fetch.mock.calls.length === 1) finishOld = resolve })
      const response = success()
      vi.spyOn(response, 'json').mockImplementation(() => new Promise(resolve => { finishBody = resolve }))
      return response
    })
    vi.stubGlobal('fetch', fetch)
    await mount(); await tick(BROWSER_REQUEST_TIMEOUT_MS - 1)
    visibility(true); visibility(false); await tick(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(signals[0]?.aborted).toBe(false)
    await tick(1); expect(signals[0]?.aborted).toBe(true)
    visibility(true); visibility(false); await tick(59_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await tick(1); expect(fetch).toHaveBeenCalledTimes(2)
    await act(async () => {
      const stale = { status: 'signed-in', usage: { rateLimits: [{ id: 'codex', windows: [{ remainingPercent: 99, windowSeconds: 604_800 }] }] } }
      finishOld?.(Response.json(stale)); finishBody?.(stale)
    })
    expect(document.querySelector('[data-openai-codex-quota]')).toBeNull()
    expect(signals[1]?.aborted).toBe(false)
    cleanup(); expect(signals[1]?.aborted).toBe(true)
    visibility(true); visibility(false); await tick(600_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('resumes successful quota polling after a timed-out transport and clears its failure backoff', async () => {
    const fetch = vi.fn(async (): Promise<Response> => fetch.mock.calls.length === 1 ? new Promise(() => {}) : success())
    vi.stubGlobal('fetch', fetch)
    await mount(); await tick(BROWSER_REQUEST_TIMEOUT_MS)
    expect(fetch).toHaveBeenCalledTimes(1)
    await tick(60_000); expect(fetch).toHaveBeenCalledTimes(2)
    await tick(59_999); expect(fetch).toHaveBeenCalledTimes(2)
    await tick(1); expect(fetch).toHaveBeenCalledTimes(3)
  })
})
