/** Session-local two-state context budgets, bound before Host request preparation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { FastModeRegistry } from './fast-mode.ts'


/** Reuse the bounded, positive-only session toggle registry; no profile values are changed. */
export class ExtendedContextRegistry extends FastModeRegistry {
  private requests = new WeakMap<AbortSignal, { enabled: boolean; model?: string }>()

  override clear(): void {
    super.clear()
    this.requests = new WeakMap()
  }

  bind(signal: AbortSignal, sessionId: string, model?: string): void {
    this.requests.set(signal, { enabled: this.isEnabled(sessionId), ...(model === undefined ? {} : { model }) })
  }

  forRequest(signal: AbortSignal | undefined, model?: string): boolean {
    const request = signal === undefined ? undefined : this.requests.get(signal)
    return request?.enabled === true && (request.model === undefined || request.model === model)
  }
}

/** The Host forwards this exact turn signal to adapter.prepareCall before prompt admission. */
export function registerExtendedContextRequests(ctx: Context, registry: ExtendedContextRegistry): void {
  ctx.on('agent/request', async ({ agent, signal }, next) => {
    const config = await next()
    registry.bind(signal, agent.session.id, config.model)
    return config
  }, { global: true, prepend: true })
  ctx.effect(() => () => { registry.clear() }, 'dsh-codex-connect: extended context state')
}
