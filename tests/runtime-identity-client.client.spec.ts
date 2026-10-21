import { afterEach, describe, expect, it, vi } from 'vitest'
import { comparePluginVersions, readRuntimeIdentity, runtimeIdentityReceipt } from '../src/client/runtime-identity-client.ts'
import { OPENAI_CODEX_RUNTIME_PATH } from '../src/update-paths.ts'
import { CODEX_CONNECT_VERSION } from '../src/version.ts'
import { inconsistentRuntimeReports, runtimeReport } from './runtime-identity-fixtures.ts'

const clientVersion = '0.2.0-alpha.4'
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('fresh runtime identity evidence', () => {
  it.each(['0.2.1-alpha.5', '0.2.1-rc.1'])('accepts coherent %s Host receipts and rejects mixed metadata', async version => {
    const report = runtimeReport(CODEX_CONNECT_VERSION)
    report.currentDshVersion = version
    for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-compaction'] as const) {
      report.compatibility.packages[name].installed = version
    }
    vi.stubGlobal('fetch', vi.fn(async () => json(report)))
    const snapshot = await readRuntimeIdentity(CODEX_CONNECT_VERSION, new AbortController().signal)
    expect(snapshot).toMatchObject({ status: 'available', pluginVersionState: 'match', report: { currentDshVersion: version, compatibility: { status: 'compatible' } } })
    report.compatibility.packages['@deepseek-ai/dsh-compaction'].installed = '0.2.1-alpha.4'
    expect(await readRuntimeIdentity(CODEX_CONNECT_VERSION, new AbortController().signal)).toEqual({
      status: 'unavailable', clientVersion: CODEX_CONNECT_VERSION, pluginVersionState: 'unknown',
    })
  })

  it.each([
    ['0.2.0-alpha.4', '0.2.0-alpha.4', 'match'],
    ['0.2.0-alpha.3', '0.2.0-alpha.3', 'mismatch'],
    ['0.2.0-alpha.4', '0.2.0-alpha.5', 'mismatch'],
    ['0.2.0-alpha.4', null, 'unknown'],
  ] as const)('compares browser/Host/disk separately for %s / %s', (host, disk, state) => {
    expect(comparePluginVersions(clientVersion, runtimeReport(host, disk))).toBe(state)
  })

  it('uses exactly one uncached same-origin read and does not consult the release cache', async () => {
    const getItem = vi.fn(() => { throw new Error('release cache must not be consulted') })
    vi.stubGlobal('localStorage', { getItem })
    const fetch = vi.fn(async () => json(runtimeReport()))
    vi.stubGlobal('fetch', fetch)
    const snapshot = await readRuntimeIdentity(clientVersion, new AbortController().signal)
    expect(snapshot).toMatchObject({ status: 'available', clientVersion, pluginVersionState: 'match' })
    expect(snapshot.observedAt).toEqual(expect.any(Number))
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]).toEqual([OPENAI_CODEX_RUNTIME_PATH, expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: expect.any(AbortSignal),
    })])
    expect(getItem).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404, 503])('keeps rejected/unavailable status %s unknown', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => json(runtimeReport(), status)))
    const snapshot = await readRuntimeIdentity(clientVersion, new AbortController().signal)
    expect(snapshot).toEqual({ status: 'unavailable', clientVersion, pluginVersionState: 'unknown' })
    expect(runtimeIdentityReceipt(snapshot)).toMatchObject({ observation: 'host-not-observed' })
    expect(runtimeIdentityReceipt(snapshot)).not.toHaveProperty('host')
  })

  it.each([{}, { currentDshVersion: '0.2.0-rc.2' }, null, { schemaVersion: 999, identity: runtimeReport().identity }])('does not promote old or malformed payload %j to a match', async value => {
    vi.stubGlobal('fetch', vi.fn(async () => json(value)))
    const snapshot = await readRuntimeIdentity(clientVersion, new AbortController().signal)
    expect(snapshot.status).toBe('unavailable')
    expect(snapshot.pluginVersionState).toBe('unknown')
    expect(snapshot.report).toBeUndefined()
  })

  it.each(inconsistentRuntimeReports())('keeps $name unavailable/unknown and out of the support receipt', async ({ report }) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(report)))
    const snapshot = await readRuntimeIdentity(clientVersion, new AbortController().signal)
    expect(snapshot).toEqual({ status: 'unavailable', clientVersion, pluginVersionState: 'unknown' })
    expect(runtimeIdentityReceipt(snapshot)).toMatchObject({ observation: 'host-not-observed' })
    expect(runtimeIdentityReceipt(snapshot)).not.toHaveProperty('host')
  })

  it('keeps the browser version immutable when the Host reports another current version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...runtimeReport('0.2.0-alpha.5'), currentVersion: '0.2.0-alpha.5' })))
    const snapshot = await readRuntimeIdentity(clientVersion, new AbortController().signal)
    expect(snapshot.clientVersion).toBe(clientVersion)
    expect(snapshot.pluginVersionState).toBe('mismatch')
    expect(runtimeIdentityReceipt(snapshot)).toMatchObject({ client: { loadedPluginVersion: clientVersion } })
  })

  it('does not export unknown server fields, account data or raw errors', async () => {
    const marker = 'must-not-appear-in-a-support-receipt'
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...runtimeReport(), token: marker, profilePath: marker, credentialFile: { path: marker } })))
    const snapshot = await readRuntimeIdentity(clientVersion, new AbortController().signal)
    expect(JSON.stringify(runtimeIdentityReceipt(snapshot))).not.toContain(marker)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(marker) }))
    const failed = await readRuntimeIdentity(clientVersion, new AbortController().signal)
    expect(failed.status).toBe('unavailable')
    expect(JSON.stringify(runtimeIdentityReceipt(failed))).not.toContain(marker)
  })

  it('settles cancellation even if a mocked transport never responds', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    const controller = new AbortController()
    const pending = readRuntimeIdentity(clientVersion, controller.signal)
    controller.abort()
    expect(await pending).toEqual({ status: 'unavailable', clientVersion, pluginVersionState: 'unknown' })
  })
})
