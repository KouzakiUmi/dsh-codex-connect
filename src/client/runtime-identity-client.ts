/** Fresh, memory-only runtime evidence. Registry update caches are not runtime proof. */
import { parseOpenAICodexRuntimeReport } from '../runtime-identity.ts'
import type { OpenAICodexRuntimeReport } from '../runtime-identity.ts'
import { OPENAI_CODEX_RUNTIME_PATH } from '../update-paths.ts'
import { requestJson } from './request-json.ts'

export type PluginVersionComparison = 'match' | 'mismatch' | 'unknown'

export interface RuntimeIdentitySnapshot {
  status: 'checking' | 'available' | 'unavailable'
  /** The browser's own compiled version, never a value from a server or release cache. */
  clientVersion: string
  pluginVersionState: PluginVersionComparison
  report?: OpenAICodexRuntimeReport
  /** Browser observation time, not a server boot time or installation timestamp. */
  observedAt?: number
}

/** Compare version declarations only; equality does not establish artifact byte identity. */
export function comparePluginVersions(clientVersion: string, report: OpenAICodexRuntimeReport): PluginVersionComparison {
  const { identity } = report
  if (clientVersion !== identity.loadedPluginVersion || identity.pluginVersionState === 'mismatch') return 'mismatch'
  if (identity.installedPluginVersion === null || identity.pluginVersionState === 'unknown') return 'unknown'
  return 'match'
}

/** An unavailable/old/malformed endpoint is unknown, never a successful upgrade receipt. */
export async function readRuntimeIdentity(clientVersion: string, signal: AbortSignal): Promise<RuntimeIdentitySnapshot> {
  const unavailable: RuntimeIdentitySnapshot = { status: 'unavailable', clientVersion, pluginVersionState: 'unknown' }
  try {
    const { response, value } = await requestJson(OPENAI_CODEX_RUNTIME_PATH, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    })
    if (!response.ok || signal.aborted) return unavailable
    const report = parseOpenAICodexRuntimeReport(value)
    if (report === undefined) return unavailable
    return {
      status: 'available', clientVersion, report,
      pluginVersionState: comparePluginVersions(clientVersion, report), observedAt: Date.now(),
    }
  } catch {
    return unavailable
  }
}

/** User-viewable JSON contains only the allowlisted DTO plus the browser's own declaration. */
export function runtimeIdentityReceipt(snapshot: RuntimeIdentitySnapshot): object {
  return {
    schemaVersion: 1,
    observation: snapshot.status === 'available' ? 'same-origin-host-response' : 'host-not-observed',
    client: { loadedPluginVersion: snapshot.clientVersion },
    pluginVersionState: snapshot.pluginVersionState,
    ...snapshot.observedAt === undefined ? {} : { browserObservedAt: new Date(snapshot.observedAt).toISOString() },
    ...snapshot.status === 'available' && snapshot.report !== undefined ? { host: snapshot.report } : {},
    limitations: ['version-declarations-not-artifact-hashes', 'not-desktop-shell-or-provider-acceptance'],
  }
}
