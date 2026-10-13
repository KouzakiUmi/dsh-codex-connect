/** Host-owned authentication for plugin HTTP routes; origin trust is an additional restriction. */
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'

export interface HarnessHttpRejection {
  status: 401 | 403 | 503
  error: 'DSH_BROWSER_AUTH_REQUIRED' | 'forbidden' | 'DSH_CONNECTION_UNAVAILABLE'
}

/** Resolve the current Connection on each request; never retain a stale authentication service. */
export function harnessHttpRejection(ctx: Context, request: IncomingMessage): HarnessHttpRejection | undefined {
  try {
    const connection = ctx.get('connection')
    if (connection !== undefined) {
      const rejected = connection.requestRejection(request)
      if (rejected === undefined) return undefined
      if (rejected === 401 || rejected === 403) {
        return { status: rejected, error: rejected === 401 ? 'DSH_BROWSER_AUTH_REQUIRED' : 'forbidden' }
      }
    }
  } catch {
    // Inactive dependencies and authentication failures must not become an unauthenticated fallback.
  }
  return { status: 503, error: 'DSH_CONNECTION_UNAVAILABLE' }
}
