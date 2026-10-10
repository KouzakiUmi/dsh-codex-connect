/**
 * Records the model the Codex backend reports serving for a request. The official client reads the
 * `openai-model` (or `x-openai-model`) response header and reports a change from its last value.
 * DSH's stream protocol has no served-model event, so this module keeps a bounded, payload-free
 * record per session that diagnostics can read.
 */

import type { SimpleStreamOptions } from '@earendil-works/pi-ai'

/** Response headers the official Codex client accepts as the served model. */
const SERVED_MODEL_HEADERS: readonly string[] = Object.freeze(['openai-model', 'x-openai-model'])

const MAX_SESSIONS = 256

/** Requested versus served model for the most recent response of one session. */
export interface ServedModelRecord {
  readonly requested: string
  readonly served: string
}

const records = new Map<string, ServedModelRecord>()

/** Served model named by a response header set, or undefined when the backend omits it. */
export function servedModelFromHeaders(headers: Readonly<Record<string, string>>): string | undefined {
  for (const [name, value] of Object.entries(headers)) {
    if (!SERVED_MODEL_HEADERS.includes(name.toLowerCase())) continue
    const trimmed = value.trim()
    if (trimmed.length > 0 && trimmed.length <= 128) return trimmed
  }
  return undefined
}

/** Keep the newest record for a session and bound the map so it cannot grow without limit. */
function remember(sessionId: string, record: ServedModelRecord): void {
  records.delete(sessionId)
  records.set(sessionId, record)
  if (records.size > MAX_SESSIONS) {
    const oldest = records.keys().next().value
    if (oldest !== undefined) records.delete(oldest)
  }
}

/** Latest requested/served pair for a session, if a response reported one. */
export function lastServedModel(sessionId: string): ServedModelRecord | undefined {
  return records.get(sessionId)
}

/** Wrap `onResponse` so every response with a served-model header updates the session record. */
export function withServedModelObserver(
  options: SimpleStreamOptions | undefined,
  requested: string,
): SimpleStreamOptions | undefined {
  const sessionId = options?.sessionId
  if (sessionId === undefined) return options
  const previous = options?.onResponse
  return {
    ...options,
    async onResponse(response, model) {
      const served = servedModelFromHeaders(response.headers)
      if (served !== undefined) remember(sessionId, { requested, served })
      await previous?.(response, model)
    },
  }
}
