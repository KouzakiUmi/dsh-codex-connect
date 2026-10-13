/** Session-local context budgets for Host step pressure and request preparation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { FastModeRegistry } from './fast-mode.ts'
import { OPENAI_CODEX_PROVIDER } from './store.ts'


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

  unbind(signal: AbortSignal): void {
    this.requests.delete(signal)
  }

  forRequest(signal: AbortSignal | undefined, model?: string): boolean {
    const request = signal === undefined ? undefined : this.requests.get(signal)
    return request?.enabled === true && (request.model === undefined || request.model === model)
  }
}

/** The Host reuses one turn signal for pre-step pressure and all requests in that turn. */
export function registerExtendedContextRequests(ctx: Context, registry: ExtendedContextRegistry): void {
  ctx.on('agent/pre-step', ({ agent, signal }, next) => {
    // Match BasicCompactionEngine's durable routedTarget, not the next request's proposal.
    // Refresh on EVERY step: the turn signal may still carry the previous step's choice.
    const config = agent.session.requestHeader()?.config
    if (config?.provider === OPENAI_CODEX_PROVIDER && config.model.length > 0) {
      registry.bind(signal, agent.session.id, config.model)
    } else {
      registry.unbind(signal)
    }
    return next()
  }, { global: true, prepend: true })
  ctx.on('agent/request', async ({ agent, signal }, next) => {
    const config = await next()
    if (config.provider === OPENAI_CODEX_PROVIDER) registry.bind(signal, agent.session.id, config.model)
    else registry.unbind(signal)
    return config
  }, { global: true, prepend: true })
  ctx.effect(() => () => { registry.clear() }, 'dsh-codex-connect: extended context state')
}
