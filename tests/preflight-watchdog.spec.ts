import { afterEach, expect, it, vi } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createPreflightWatchdog } from '../src/preflight-watchdog.ts'

afterEach(() => { vi.useRealTimers() })

it('delivers queued Host usage and aborted finish even when the caller is already cancelled', async () => {
  vi.useFakeTimers()
  const caller = new AbortController()
  using watchdog = createPreflightWatchdog(caller.signal)
  const chunks: StreamChunk[] = [
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
    { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'caller cancellation' } } },
  ]
  caller.abort(new Error('earlier caller cancellation'))
  const iterator = (async function* () { yield* chunks })()
  expect(await watchdog.next(iterator)).toMatchObject({ done: false, value: chunks[0] })
  await vi.advanceTimersByTimeAsync(600_000)
  expect(await watchdog.next(iterator)).toMatchObject({ done: false, value: chunks[1] })
  expect(await watchdog.next(iterator)).toMatchObject({ done: true })
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves an already-resolved Host result when caller abort occurs in the same turn', async () => {
  const caller = new AbortController()
  using watchdog = createPreflightWatchdog(caller.signal)
  const result: IteratorResult<number> = { done: false, value: 42 }
  const next = watchdog.next({ next: () => Promise.resolve(result) })
  caller.abort(new Error('same-turn caller'))
  expect(await next).toBe(result)
})

it('settles a noncooperative caller-cancelled read after one event-loop turn', async () => {
  vi.useFakeTimers()
  const caller = new AbortController()
  using watchdog = createPreflightWatchdog(caller.signal)
  const never = new Promise<IteratorResult<never>>(() => {})
  const reason = new Error('caller cancellation')
  const result = watchdog.next({ next: () => never }).catch(error => error)
  caller.abort(reason)
  await vi.advanceTimersByTimeAsync(0)
  expect(await result).toBe(reason)
  expect(vi.getTimerCount()).toBe(0)
})

it('never replaces an owned timeout with later caller cancellation or a queued result', async () => {
  vi.useFakeTimers()
  const caller = new AbortController()
  using watchdog = createPreflightWatchdog(caller.signal)
  watchdog.preflight.begin(450_000)
  const demand = Promise.withResolvers<IteratorResult<number>>()
  const result = watchdog.next({ next: () => demand.promise }).catch(error => error)
  for (let index = 0; index < 29; index++) {
    await vi.advanceTimersByTimeAsync(15_000)
    watchdog.preflight.pulse()
  }
  await vi.advanceTimersByTimeAsync(15_000)
  caller.abort(new Error('later caller'))
  demand.resolve({ done: false, value: 42 })
  expect(await result).toMatchObject({ code: 'CODEX_PREFLIGHT_TOTAL_TIMEOUT', timeoutMs: 450_000 })
})
