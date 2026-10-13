// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { BROWSER_REQUEST_TIMEOUT_MS, BrowserRequestTimeoutError, requestBody, requestJson } from '../src/client/request-json.ts'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['reader', 'fetch'])('aborts early %s failure, preserves its error and detaches lifecycle/deadline', async failure => {
  vi.useFakeTimers()
  const parent = new AbortController()
  const remove = vi.spyOn(parent.signal, 'removeEventListener')
  const error = new Error('refused response')
  let transport!: AbortSignal
  const closed = vi.fn()
  vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
    transport = init.signal!
    transport.addEventListener('abort', closed, { once: true })
    if (failure === 'fetch') throw error
    // Headers arrived, but the refused body remains open until abort.
    return { ok: false, blob: () => new Promise(() => {}) }
  })
  await expect(requestBody('/test', { signal: parent.signal }, async () => { throw error })).rejects.toBe(error)
  expect(transport.aborted).toBe(true)
  expect(transport.reason).toBe(error)
  expect(closed).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(vi.getTimerCount()).toBe(0)
  parent.abort()
  expect(closed).toHaveBeenCalledOnce()
})

it('retains malformed JSON decoding without inventing a mutation retry', async () => {
  const fetchMock = vi.fn(async () => new Response('{malformed'))
  vi.stubGlobal('fetch', fetchMock)
  expect((await requestJson('/test', { method: 'POST' })).value).toBeUndefined()
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('includes a stalled response body in the deadline and clears its timer', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
    signal = init.signal
    return { json: () => new Promise<unknown>(() => {}) }
  })
  const pending = requestJson('/test', {})
  const rejected = expect(pending).rejects.toBeInstanceOf(BrowserRequestTimeoutError)
  await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS)
  await rejected
  expect(signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('does not send an already-cancelled request', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const controller = new AbortController()
  controller.abort(new Error('disposed'))
  await expect(requestJson('/test', { signal: controller.signal })).rejects.toThrow('disposed')
  expect(fetchMock).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('clears the deadline after a complete response', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', async () => Response.json({ ok: true }))
  const { value } = await requestJson('/test', {})
  expect(value).toEqual({ ok: true })
  expect(vi.getTimerCount()).toBe(0)
})


it('settles hung headers and rejects late headers without starting the body', async () => {
  vi.useFakeTimers()
  let resolve!: (response: Response) => void
  let signal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', (_path: string, init: RequestInit) => {
    signal = init.signal
    return new Promise<Response>(done => { resolve = done })
  })
  const read = vi.fn(async () => new Blob())
  const pending = requestBody('/test', {}, read)
  const rejected = expect(pending).rejects.toBeInstanceOf(BrowserRequestTimeoutError)
  await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS)
  await rejected
  expect(signal?.aborted).toBe(true)
  resolve(Response.json({ ok: true }))
  await Promise.resolve()
  expect(read).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('parent cancellation settles an uncooperative body and removes the timer', async () => {
  vi.useFakeTimers()
  let resolve!: (blob: Blob) => void
  vi.stubGlobal('fetch', async () => ({ blob: () => new Promise<Blob>(done => { resolve = done }) }))
  const parent = new AbortController()
  const pending = requestBody('/test', { signal: parent.signal }, response => response.blob())
  await Promise.resolve()
  const rejected = expect(pending).rejects.toThrow('replaced')
  parent.abort(new Error('replaced'))
  await rejected
  resolve(new Blob())
  await Promise.resolve()
  expect(vi.getTimerCount()).toBe(0)
})
