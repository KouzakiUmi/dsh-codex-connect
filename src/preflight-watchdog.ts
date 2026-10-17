/** Finite preflight and ordinary idle timing owned by the opt-in Codex adapter wrapper. */
import { idleWatchdog, MAX_TIMER_DELAY_MS, timeoutOf, TimeoutReason } from '@deepseek-ai/dsh-timeout'
import type { IdleWatchdog } from '@deepseek-ai/dsh-timeout'

export const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 300_000
export const OPENAI_CODEX_MAX_PREFLIGHT_MS = MAX_TIMER_DELAY_MS - OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS
export const PREFLIGHT_IDLE_TIMEOUT = 'CODEX_PREFLIGHT_IDLE_TIMEOUT'
export const PREFLIGHT_TOTAL_TIMEOUT = 'CODEX_PREFLIGHT_TOTAL_TIMEOUT'

export interface PreflightWatchdog extends IdleWatchdog {
  preflight: { begin(maxDurationMs: number): boolean; pulse(): void; end(): void }
}

/** Renew outstanding reads without allowing non-semantic activity to reset the total preflight deadline. */
export function createPreflightWatchdog(upstream: AbortSignal): PreflightWatchdog {
  const budget = new AbortController()
  const watchdog = idleWatchdog(AbortSignal.any([upstream, budget.signal]), OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS, PREFLIGHT_IDLE_TIMEOUT)
  let state: 'ready' | 'active' | 'closed' = 'ready'
  let timer: ReturnType<typeof setTimeout> | undefined
  const preflight = {
    begin(maxDurationMs: number) {
      if (state !== 'ready' || watchdog.signal.aborted) return false
      state = 'active'
      timer = setTimeout(() => { budget.abort(new TimeoutReason(PREFLIGHT_TOTAL_TIMEOUT, maxDurationMs)) }, maxDurationMs)
      return true
    },
    pulse() { if (state === 'active' && !watchdog.signal.aborted) watchdog.pulse() },
    end() { state = 'closed'; clearTimeout(timer); timer = undefined },
  }
  const ownTimeout = (): TimeoutReason | undefined => timeoutOf(watchdog.signal, PREFLIGHT_IDLE_TIMEOUT)
    ?? timeoutOf(watchdog.signal, PREFLIGHT_TOTAL_TIMEOUT)
  return {
    signal: watchdog.signal,
    preflight,
    async next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>> {
      const expired = ownTimeout()
      if (expired !== undefined) throw expired
      const aborted = Promise.withResolvers<never>()
      let cancellation: ReturnType<typeof setImmediate> | undefined
      const onAbort = (): void => {
        if (ownTimeout() !== undefined) aborted.reject(watchdog.signal.reason)
        else {
          // Preserve already-produced Host cancellation chunks; a stuck read gets one event-loop turn to settle.
          cancellation = setImmediate(() => { aborted.reject(watchdog.signal.reason) })
        }
      }
      watchdog.signal.addEventListener('abort', onAbort, { once: true })
      if (watchdog.signal.aborted) onAbort()
      try {
        const next = watchdog.signal.aborted ? iterator.next() : watchdog.next(iterator)
        const result = await Promise.race([next, aborted.promise])
        const expired = ownTimeout()
        if (expired !== undefined) throw expired
        preflight.end()
        return result
      } finally {
        clearImmediate(cancellation)
        watchdog.signal.removeEventListener('abort', onAbort)
        if (watchdog.signal.aborted) { preflight.end(); watchdog[Symbol.dispose]() }
      }
    },
    pulse: () => { preflight.pulse() },
    [Symbol.dispose]() { preflight.end(); watchdog[Symbol.dispose]() },
  }
}
