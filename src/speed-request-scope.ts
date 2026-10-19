/** Request-local account attribution; never retains a bearer token. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { openAICodexAccountKey } from './store.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { CapturedConversationSpeed } from './conversation-speed.ts'

interface SpeedRequestScope { accountKey?: string; selection?: CapturedConversationSpeed }
const requestScope = new AsyncLocalStorage<SpeedRequestScope>()

/** Called only after the normal auth resolver captured/refreshed this request's account. */
export function recordSpeedRequestAccount(accountId: string): void {
  const scope = requestScope.getStore()
  if (scope !== undefined) scope.accountKey = openAICodexAccountKey(accountId)
}
export function currentSpeedRequestAccount(): string | undefined { return requestScope.getStore()?.accountKey }
export function currentCapturedSpeed(): CapturedConversationSpeed | undefined { return requestScope.getStore()?.selection }

export function streamWithSpeedRequestScope(
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
  options: GenerateOptions,
  capture: () => CapturedConversationSpeed,
): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      const scope: SpeedRequestScope = { selection: capture() }
      const iterator = requestScope.run(scope, () => stream(options)[Symbol.asyncIterator]())
      try {
        for (;;) {
          const next = await requestScope.run(scope, () => iterator.next())
          if (next.done) return
          yield next.value
        }
      } finally {
        try { await requestScope.run(scope, () => iterator.return?.()) } finally { delete scope.accountKey; delete scope.selection }
      }
    },
  }
}
