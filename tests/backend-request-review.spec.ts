import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICodexBackendRequests } from '../src/backend-request.ts'
import { assertOpenAICodexBackendUrl } from '../src/backend-request-policy.ts'

const endpoint = 'https://chatgpt.com/backend-api/codex/responses'
const managers: OpenAICodexBackendRequests[] = []
const manager = (slots = 1) => {
  const value = new OpenAICodexBackendRequests(undefined, () => undefined, slots)
  managers.push(value)
  return value
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
afterEach(() => { for (const value of managers.splice(0)) value.dispose(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('PR 227 review regressions', () => {
  it('does not execute a logical callback with an already cancelled signal', async () => {
    const requests = manager()
    const controller = new AbortController()
    controller.abort()
    const operation = vi.fn(async () => 'must not run')
    const result = requests.run({ lane: 'search', signal: controller.signal }, operation).catch(error => error)
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('releases a cancelled unread provider body without requiring another read', async () => {
    const requests = manager()
    const cancel = vi.fn()
    const base = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel })))
    const fetch = requests.wrapFetch({ lane: 'model', fetch: base })
    const controller = new AbortController()
    const first = await fetch(endpoint, { signal: controller.signal })
    const next = fetch(endpoint).catch(error => error)
    controller.abort()
    await flush()
    try {
      expect(cancel).toHaveBeenCalledOnce()
      expect(base).toHaveBeenCalledTimes(2)
      await expect(first.text()).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      await first.body?.cancel().catch(() => undefined)
      requests.dispose()
      const value = await next
      if (value instanceof Response) await value.body?.cancel().catch(() => undefined)
    }
  })

  it.each([false, true])('holds admission until abort cleanup settles, rejection=%s', async rejects => {
    const requests = manager()
    const controller = new AbortController()
    const reason = new DOMException('fixture abort', 'AbortError')
    let settle!: () => void
    const cleanup = new Promise<void>((resolve, reject) => {
      settle = () => rejects ? reject(new Error('fixture cleanup rejection')) : resolve()
    })
    const cancel = vi.fn(() => cleanup)
    const base = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel })))
    const fetch = requests.wrapFetch({ lane: 'model', fetch: base })
    const first = await fetch(endpoint, { signal: controller.signal })
    const reader = first.body!.getReader()
    const read = reader.read()
    await flush()
    const next = fetch(endpoint)
    controller.abort(reason)
    try {
      await expect(read).rejects.toBe(reason)
      controller.abort(reason)
      await expect(reader.cancel(reason)).rejects.toBe(reason)
      await flush()
      expect(cancel).toHaveBeenCalledOnce()
      expect(base).toHaveBeenCalledOnce()
      settle()
      const second = await next
      expect(base).toHaveBeenCalledTimes(2)
      await second.body!.cancel().catch(() => undefined)
    } finally { settle(); reader.releaseLock(); requests.dispose() }
  })

  it.each([false, true])('suppresses synthetic EOF until explicit cancel cleanup settles, rejection=%s', async rejects => {
    const requests = manager()
    let settle!: () => void
    const cleanup = new Promise<void>((resolve, reject) => {
      settle = () => rejects ? reject(new Error('fixture cleanup rejection')) : resolve()
    })
    const cancel = vi.fn(() => cleanup)
    const base = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel })))
    const fetch = requests.wrapFetch({ lane: 'model', fetch: base })
    const first = await fetch(endpoint)
    const reader = first.body!.getReader()
    const read = reader.read()
    await flush()
    const cancellation = reader.cancel('fixture cancellation').catch(error => error)
    await expect(read).resolves.toEqual({ done: true, value: undefined })
    const next = fetch(endpoint)
    try {
      await reader.cancel('repeat cancellation')
      await flush()
      expect(base).toHaveBeenCalledOnce()
      expect(cancel).toHaveBeenCalledOnce()
      settle()
      const result = await cancellation
      if (rejects) expect(result).toEqual(new Error('fixture cleanup rejection'))
      else expect(result).toBeUndefined()
      const second = await next
      await second.body!.cancel().catch(() => undefined)
      expect(base).toHaveBeenCalledTimes(2)
      expect(cancel).toHaveBeenCalledTimes(2)
    } finally { settle(); reader.releaseLock(); requests.dispose() }
  })

  it('holds an unread aborted response until source cleanup ends', async () => {
    const requests = manager()
    const controller = new AbortController()
    let settle!: () => void
    const cleanup = new Promise<void>(resolve => { settle = resolve })
    const cancel = vi.fn(() => cleanup)
    const base = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel })))
    const fetch = requests.wrapFetch({ lane: 'model', fetch: base })
    const first = await fetch(endpoint, { signal: controller.signal })
    const next = fetch(endpoint)
    controller.abort()
    try {
      await expect(first.text()).rejects.toMatchObject({ name: 'AbortError' })
      await flush()
      expect(base).toHaveBeenCalledOnce()
      expect(cancel).toHaveBeenCalledOnce()
      settle()
      const second = await next
      await second.body!.cancel()
      expect(base).toHaveBeenCalledTimes(2)
    } finally { settle(); requests.dispose() }
  })

  it.each([false, true])('shares explicit cancel cleanup with repeated cancel and dispose, rejection=%s', async rejects => {
    const requests = manager()
    const controller = new AbortController()
    let settle!: () => void
    const cleanup = new Promise<void>((resolve, reject) => {
      settle = () => rejects ? reject(new Error('fixture cleanup rejection')) : resolve()
    })
    const cancel = vi.fn(() => cleanup)
    const base = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel })))
    const fetch = requests.wrapFetch({ lane: 'model', fetch: base })
    const first = await fetch(endpoint, { signal: controller.signal })
    const reader = first.body!.getReader()
    const read = reader.read()
    await flush()
    const cancellation = reader.cancel('fixture cancellation').catch(error => error)
    await reader.cancel('repeat cancellation')
    await expect(read).resolves.toEqual({ done: true, value: undefined })
    const next = fetch(endpoint).catch(error => error)
    controller.abort()
    requests.dispose()
    requests.dispose()
    try {
      expect(requests.signal.aborted).toBe(true)
      expect(await next).toMatchObject({ name: 'AbortError' })
      expect(cancel).toHaveBeenCalledOnce()
      expect(base).toHaveBeenCalledOnce()
      settle()
      const result = await cancellation
      if (rejects) expect(result).toEqual(new Error('fixture cleanup rejection'))
      else expect(result).toBeUndefined()
      expect(cancel).toHaveBeenCalledOnce()
    } finally { settle(); reader.releaseLock(); requests.dispose() }
  })

  it('exposes one stable lifecycle signal and immediately aborts consumers on dispose', async () => {
    const requests = manager()
    const signal = requests.signal
    expect(signal).toBe(requests.signal)
    expect(signal.aborted).toBe(false)
    let settle!: () => void
    const cleanup = new Promise<void>(resolve => { settle = resolve })
    const cancel = vi.fn(() => cleanup)
    const base = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel })))
    const fetch = requests.wrapFetch({ lane: 'model', fetch: base })
    const first = await fetch(endpoint)
    const reader = first.body!.getReader()
    const read = reader.read()
    const next = fetch(endpoint).catch(error => error)
    requests.dispose()
    try {
      await expect(read).rejects.toBe(signal.reason)
      expect(await next).toBe(signal.reason)
      await expect(fetch(endpoint)).rejects.toBe(signal.reason)
      requests.dispose()
      expect(cancel).toHaveBeenCalledOnce()
      expect(base).toHaveBeenCalledOnce()
    } finally { settle(); await flush(); reader.releaseLock() }
  })

  it('cancels the response body if a response hook throws', async () => {
    const requests = manager()
    const cancel = vi.fn()
    const raw = new Response(new ReadableStream<Uint8Array>({ cancel }))
    const hookError = new Error('fixture hook error')
    const fetch = requests.wrapFetch({ lane: 'model', fetch: async () => raw, onResponse() { throw hookError } })
    try {
      await expect(fetch(endpoint)).rejects.toBe(hookError)
      expect(cancel).toHaveBeenCalledOnce()
    } finally { await raw.body?.cancel().catch(() => undefined) }
  })

  it.each([false, true])('retains admission for response-hook cleanup and preserves its error, rejection=%s', async rejects => {
    const requests = manager()
    let settle!: () => void
    const cleanup = new Promise<void>((resolve, reject) => {
      settle = () => rejects ? reject(new Error('fixture cleanup rejection')) : resolve()
    })
    const cancel = vi.fn(() => cleanup)
    const error = new Error('fixture hook error')
    const first = requests.wrapFetch({ lane: 'model', fetch: async () => new Response(new ReadableStream({ cancel })),
      onResponse() { throw error } })(endpoint).catch(value => value)
    await flush()
    const base = vi.fn(async () => new Response(null))
    const next = requests.wrapFetch({ lane: 'model', fetch: base })(endpoint)
    try {
      await flush()
      expect(cancel).toHaveBeenCalledOnce()
      expect(base).not.toHaveBeenCalled()
      settle()
      expect(await first).toBe(error)
      expect((await next).status).toBe(200)
      expect(base).toHaveBeenCalledOnce()
    } finally { settle(); requests.dispose() }
  })

  it('releases an errored source once even when a pending pull also rejects', async () => {
    const requests = manager()
    let source!: ReadableStreamDefaultController<Uint8Array>
    const cancel = vi.fn()
    const first = await requests.wrapFetch({ lane: 'model', fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { source = controller }, cancel,
    })) })(endpoint)
    const reader = first.body!.getReader()
    const read = reader.read()
    await flush()
    const base = vi.fn(async () => new Response(new ReadableStream<Uint8Array>()))
    const fetch = requests.wrapFetch({ lane: 'model', fetch: base })
    const next = fetch(endpoint)
    const error = new Error('fixture network failure')
    source.error(error)
    await expect(read).rejects.toBe(error)
    const second = await next
    const third = fetch(endpoint)
    await flush()
    expect(base).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
    await second.body!.cancel()
    await (await third).body!.cancel()
    reader.releaseLock()
  })

  it('preserves the signal embedded in a Request passed to a logical context', async () => {
    const requests = manager()
    const controller = new AbortController()
    controller.abort()
    const base = vi.fn(async () => new Response(null))
    await expect(requests.run({ lane: 'search' }, context => context.fetch(
      new Request(endpoint, { signal: controller.signal }), undefined, { fetch: base },
    ))).rejects.toMatchObject({ name: 'AbortError' })
    expect(base).not.toHaveBeenCalled()
  })

  it('freezes URL objects before queueing and prevents automatic redirect following', async () => {
    const requests = manager()
    const base = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null))
    const source = new URL(endpoint)
    const fetch = requests.wrapFetch({ lane: 'model', fetch: base })
    const pending = fetch(source, { redirect: 'follow' })
    await Promise.resolve()
    source.hostname = 'other.example'
    const response = await pending
    await response.body?.cancel()
    const [sent, init] = base.mock.calls[0]!
    expect(String(sent)).toBe(endpoint)
    expect(init?.redirect).not.toBe('follow')
  })

  it('rejects URL-embedded credentials before calling fetch', () => {
    expect(() => assertOpenAICodexBackendUrl('https://user:password@chatgpt.com/backend-api/test')).toThrow()
  })

  it('rechecks an extended server cooldown before sending waiting requests', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const requests = manager(3)
    let finishSecond!: (response: Response) => void
    const base = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '2' } }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishSecond = resolve }))
      .mockResolvedValue(new Response(null))
    const fetch = requests.wrapFetch({ lane: 'search', fetch: base })
    const first = fetch(endpoint)
    const competing = fetch(endpoint)
    await first; await flush()
    const waiting = fetch(endpoint).catch(error => error)
    try {
      await vi.advanceTimersByTimeAsync(1_000)
      finishSecond(new Response(null, { status: 503, headers: { 'retry-after': '10' } }))
      await competing
      await vi.advanceTimersByTimeAsync(1_000)
      expect(base).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(9_000)
      expect((await waiting).status).toBe(200)
    } finally { requests.dispose(); await waiting }
  })

  it('does not let a newly cooling lane occupy the last slot ahead of another lane', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const requests = manager()
    let respond!: (response: Response) => void
    const searchBase = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { respond = resolve }))
      .mockResolvedValue(new Response(null))
    const imageBase = vi.fn(async () => new Response(null))
    const search = requests.wrapFetch({ lane: 'search', fetch: searchBase })
    const first = search(endpoint); await flush()
    const second = search(endpoint).catch(error => error)
    const other = requests.wrapFetch({ lane: 'image', fetch: imageBase })(endpoint).catch(error => error)
    await flush()
    respond(new Response(null, { status: 429, headers: { 'retry-after': '10' } }))
    await first; await flush()
    try {
      expect(imageBase).toHaveBeenCalledOnce()
      expect(searchBase).toHaveBeenCalledOnce()
    } finally { requests.dispose(); await Promise.all([second, other]) }
  })

  it('does not shorten a server Retry-After longer than fifteen minutes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const requests = manager()
    const base = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '1800' } }))
      .mockResolvedValue(new Response(null))
    const fetch = requests.wrapFetch({ lane: 'model', fetch: base })
    await fetch(endpoint)
    const waiting = fetch(endpoint).catch(error => error)
    try {
      await vi.advanceTimersByTimeAsync(900_000)
      expect(base).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(900_000)
      expect((await waiting).status).toBe(200)
    } finally { requests.dispose(); await waiting }
  })

  it('limits parallel HTTP attempts inside one logical scope rather than counting the scope once', async () => {
    const requests = manager()
    const base = vi.fn(async () => new Response(new ReadableStream<Uint8Array>()))
    await requests.run({ lane: 'search' }, async context => {
      const first = await context.fetch(endpoint, undefined, { fetch: base })
      const second = context.fetch(endpoint, undefined, { fetch: base })
      await flush(); expect(base).toHaveBeenCalledOnce()
      await first.body!.cancel()
      const response = await second
      expect(base).toHaveBeenCalledTimes(2)
      await response.body!.cancel()
    })
  })

  it('discards an unconsumed body when a direct parser exits with an error', async () => {
    const requests = manager()
    const cancel = vi.fn()
    const error = new Error('fixture parser rejected content type')
    await expect(requests.run({ lane: 'image' }, async context => {
      await context.fetch(endpoint, undefined, { fetch: async () => new Response(new ReadableStream({ cancel })) })
      throw error
    })).rejects.toBe(error)
    expect(cancel).toHaveBeenCalledOnce()
    const next = await requests.wrapFetch({ lane: 'model', fetch: async () => new Response(null) })(endpoint)
    expect(next.status).toBe(200)
  })

  it('captures request headers before waiting behind another request', async () => {
    const requests = manager()
    const fetch = requests.wrapFetch({ lane: 'model', fetch: async () => new Response(new ReadableStream()) })
    const active = await fetch(endpoint)
    const headers = new Headers({ authorization: 'Bearer synthetic-first' })
    const base = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null))
    const pending = requests.wrapFetch({ lane: 'search', fetch: base })(endpoint, { headers })
    headers.set('authorization', 'Bearer synthetic-second')
    await active.body!.cancel()
    await pending
    expect(new Headers(base.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer synthetic-first')
  })
})
