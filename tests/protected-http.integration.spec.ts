/** Real Host WebServer/Connection admission; accounts, proxies and images remain synthetic. */
import { Context } from '@deepseek-ai/cordis'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { request } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { registerOpenAICodexAuthRoutes } from '../src/auth-routes.ts'
import * as AuthPaths from '../src/auth-paths.ts'
import { registerOpenAICodexProxyRoutes } from '../src/proxy-routes.ts'
import { OPENAI_CODEX_PROXY_DETECT_PATH, OPENAI_CODEX_PROXY_TEST_PATH } from '../src/proxy-paths.ts'
import { registerOpenAICodexOriginalImageRoute } from '../src/image-asset-routes.ts'
import { OPENAI_CODEX_ORIGINAL_IMAGE_PATH } from '../src/image-assets-contract.ts'
import { OPENAI_CODEX_FAST_MODE_PATH } from '../src/fast-mode-paths.ts'
import { registerOpenAICodexModelCatalogRoute } from '../src/model-routes.ts'
import { OPENAI_CODEX_MODEL_CATALOG_PATH } from '../src/model-contract.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'
import type { OpenAICodexProxyManager } from '../src/provider-proxy.ts'
import type { OpenAICodexImageAssetStore } from '../src/image-assets.ts'
import type { OpenAICodexTrustedOriginsStore } from '../src/trusted-origins.ts'

const auth = vi.hoisted(() => ({ status: vi.fn(), login: vi.fn(), logout: vi.fn() }))
vi.mock('../src/auth.ts', () => ({
  openAICodexAuthStatus: auth.status, loginOpenAICodex: auth.login, logoutOpenAICodex: auth.logout,
}))

const PRIVATE_ROUTES = [
  ['GET', AuthPaths.OPENAI_CODEX_AUTH_STATUS_PATH],
  ['POST', AuthPaths.OPENAI_CODEX_AUTH_LOGIN_PATH],
  ['POST', AuthPaths.OPENAI_CODEX_AUTH_CALLBACK_PATH],
  ['POST', AuthPaths.OPENAI_CODEX_AUTH_CANCEL_PATH],
  ['POST', AuthPaths.OPENAI_CODEX_AUTH_LOGOUT_PATH],
  ['GET', AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH],
  ['POST', AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH],
  ['DELETE', AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH],
  ['GET', OPENAI_CODEX_FAST_MODE_PATH],
  ['POST', OPENAI_CODEX_FAST_MODE_PATH],
  ['POST', OPENAI_CODEX_PROXY_DETECT_PATH],
  ['POST', OPENAI_CODEX_PROXY_TEST_PATH],
  ['GET', OPENAI_CODEX_ORIGINAL_IMAGE_PATH],
] as const
const ORIGINAL_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

function http(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer; text: string }>((resolve, reject) => {
    const headers = { ...options.headers, ...(options.body === undefined ? {} : { 'content-length': String(Buffer.byteLength(options.body)) }) }
    const req = request(url, { method: options.method ?? 'GET', headers, timeout: 5000, agent: false }, res => {
      const chunks: Buffer[] = []
      let bytes = 0
      res.on('data', (part: Buffer) => {
        bytes += part.length
        if (bytes > 100_000) req.destroy(new Error('Synthetic response exceeded bound'))
        else chunks.push(part)
      })
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        resolve({ status: res.statusCode!, headers: res.headers, body, text: body.toString('utf8') })
      })
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Synthetic HTTP request timed out')))
    req.on('error', reject)
    req.end(options.body)
  })
}
let host: Context | undefined
let directory: string | undefined
async function fixture() {
  directory = await mkdtemp(join(tmpdir(), 'codex-protected-http-'))
  vi.stubEnv('DSH_HOME', directory)
  vi.stubEnv('OTEL_SDK_DISABLED', 'true')
  auth.status.mockResolvedValue({ authenticated: false })
  auth.logout.mockResolvedValue(undefined)
  const network = vi.fn(() => { throw new Error('Synthetic fixture forbids provider requests') })
  vi.stubGlobal('fetch', network)
  const ctx = new Context()
  host = ctx
  const records = new Map<string, unknown>()
  ctx.provide('credentials', { async modifyRecord(key: string, mutate: (previous: unknown) => Promise<unknown>) {
    const next = await mutate(records.get(key))
    if (next !== undefined) records.set(key, next)
    return records.get(key)
  } } as never)
  const webServer = await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const connectionConfig = { trustedHosts: ['trusted-remote.example'] }
  let connection = await ctx.plugin(Connection, connectionConfig)
  const capture = vi.fn(async () => ({ accounts: async () => [] }))
  const accounts = vi.fn(async () => [])
  const activate = vi.fn()
  const removeAccount = vi.fn()
  const store = { filename: join(directory, 'synthetic-auth.json'), captureActiveAccount: capture,
    accounts, activate, removeAccount } as unknown as OpenAICodexCredentialStore
  const probe = vi.fn(async (proxyUrl: string) => ({ proxyUrl, reachable: false }))
  const manager = { probe } as unknown as OpenAICodexProxyManager
  const readImage = vi.fn(async () => ({ data: ORIGINAL_BYTES,
    ref: { mediaType: 'image/png', bytes: ORIGINAL_BYTES.length, name: 'fixture.png' } }))
  const assets = { read: readImage } as unknown as OpenAICodexImageAssetStore
  const trustedOrigins = { has: vi.fn(async () => false) }
  const origins = trustedOrigins as unknown as OpenAICodexTrustedOriginsStore
  const group = await ctx.plugin(owner => {
    owner.inject(['webServer'], child => registerOpenAICodexModelCatalogRoute(child, () => [], origins))
    owner.inject(['webServer', 'connection'], child => {
      registerOpenAICodexAuthRoutes(child, store, origins)
      registerOpenAICodexProxyRoutes(child, origins, manager)
      registerOpenAICodexOriginalImageRoute(child, origins, assets)
    })
  })
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/', handler(req, res) {
    if (ctx.connection.authorizeIndex(req, res)) { res.writeHead(200); res.end('Synthetic authenticated index') }
  } }))
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  const cookie = async (authority?: string) => {
    const index = await http(ctx.connection.authenticatedUrl(origin), authority === undefined ? {} : { headers: { host: authority } })
    expect(index.status).toBe(303)
    return index.headers['set-cookie']![0]!.split(';')[0]!
  }
  const call = (path: string, headers: Record<string, string> = {}, method = 'GET', body?: string) =>
    http(origin + path, { headers, method, ...(body === undefined ? {} : { body }) })
  await vi.waitFor(async () => { expect((await call(AuthPaths.OPENAI_CODEX_AUTH_STATUS_PATH)).status).toBe(401) })
  return { ctx, webServer, webServerState: webServer.state, origin, cookie, call, group, capture, accounts, activate, removeAccount, probe, readImage, trustedOrigins, network,
    async removeConnection() { await connection.dispose() },
    async restoreConnection() { connection = await ctx.plugin(Connection, connectionConfig) },
  }
}
afterEach(async () => {
  try { await host?.fiber.dispose() } finally {
    host = undefined
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
    directory = undefined
  }
})

it('rejects every protected loopback route without a cookie before private work or network', async () => {
  const f = await fixture()
  for (const [method, path] of PRIVATE_ROUTES) {
    const result = await f.call(path, {}, method, method === 'GET' ? undefined : '{}')
    expect(result.status, `${method} ${path}`).toBe(401)
    expect(JSON.parse(result.text)).toEqual({ error: 'DSH_BROWSER_AUTH_REQUIRED' })
    expect(result.headers['cache-control']).toBe('no-store')
  }
  for (const operation of [f.capture, f.accounts, f.activate, f.removeAccount, f.probe, f.readImage,
    auth.status, auth.login, auth.logout, f.network]) expect(operation).not.toHaveBeenCalled()
  expect((await f.call(OPENAI_CODEX_MODEL_CATALOG_PATH)).status).toBe(200)
})

it('accepts signed cookies for account mutations, Fast Mode, proxy probes and exact original bytes', async () => {
  const f = await fixture()
  const headers = { cookie: await f.cookie(), origin: f.origin }
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_STATUS_PATH, headers)).status).toBe(200)
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, headers)).status).toBe(200)
  const jsonHeaders = { ...headers, 'content-type': 'application/json' }
  const accountKey = `acct_${'a'.repeat(43)}`
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, jsonHeaders, 'POST', JSON.stringify({ accountKey }))).status).toBe(200)
  expect(f.activate).toHaveBeenCalledWith(accountKey)
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, jsonHeaders, 'DELETE', JSON.stringify({ accountKey }))).status).toBe(200)
  expect(f.removeAccount).toHaveBeenCalledWith(accountKey, undefined)
  const sessionId = 'synthetic-fast-mode-session'
  expect((await f.call(OPENAI_CODEX_FAST_MODE_PATH, jsonHeaders, 'POST', JSON.stringify({ sessionId, enabled: true }))).status).toBe(200)
  const fastMode = await f.call(`${OPENAI_CODEX_FAST_MODE_PATH}?${new URLSearchParams({ sessionId })}`, headers)
  expect(fastMode.status).toBe(200)
  expect(JSON.parse(fastMode.text)).toEqual({ enabled: true })
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_LOGOUT_PATH, headers, 'POST')).status).toBe(200)
  expect(auth.logout).toHaveBeenCalledOnce()
  const proxyUrl = 'http://127.0.0.1:9'
  expect((await f.call(`${OPENAI_CODEX_PROXY_TEST_PATH}?${new URLSearchParams({ proxyUrl })}`, headers, 'POST')).status).toBe(200)
  expect(f.probe).toHaveBeenCalledWith(proxyUrl)
  const result = await f.call(`${OPENAI_CODEX_ORIGINAL_IMAGE_PATH}?sessionId=fixture&assetId=img_${'1'.repeat(32)}`, headers)
  expect(result.status).toBe(200)
  expect(result.body).toEqual(ORIGINAL_BYTES)
  expect(result.headers['content-disposition']).toBe('attachment; filename="fixture.png"')
  expect(f.network).not.toHaveBeenCalled()
})

it('refuses tampered and expired signed cookies before private reads', async () => {
  const f = await fixture()
  const cookie = await f.cookie()
  const paths = [AuthPaths.OPENAI_CODEX_AUTH_STATUS_PATH, AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, OPENAI_CODEX_ORIGINAL_IMAGE_PATH]
  for (const path of paths) expect((await f.call(path, { cookie: cookie + 'tampered' })).status).toBe(401)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 24 * 60 * 60 * 1000)
  try {
    for (const path of paths) expect((await f.call(path, { cookie })).status).toBe(401)
  } finally { clock.mockRestore() }
  for (const read of [f.capture, f.accounts, f.readImage, auth.status, f.network]) expect(read).not.toHaveBeenCalled()
})

it('keeps Host authentication and plugin exact-origin admission independent', async () => {
  const f = await fixture()
  const remote = { host: 'trusted-remote.example', origin: 'http://trusted-remote.example' }
  f.trustedOrigins.has.mockResolvedValue(true)
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, remote)).status).toBe(401)
  expect(f.accounts).not.toHaveBeenCalled()
  const cookie = await f.cookie(remote.host)
  const headers = { ...remote, cookie }
  f.trustedOrigins.has.mockResolvedValue(false)
  const untrusted = await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, headers)
  expect(untrusted.status).toBe(403)
  expect(JSON.parse(untrusted.text)).toEqual({ error: 'remote-web-origin-not-trusted' })
  f.trustedOrigins.has.mockResolvedValue(true)
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, headers)).status).toBe(200)
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, { ...headers, 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, { cookie, origin: f.origin })).status).toBe(401)
})

it('unloads protected routes when Connection disappears while preserving the same server and metadata', async () => {
  const f = await fixture()
  const port = f.ctx.webServer.port
  const headers = { cookie: await f.cookie(), origin: f.origin }
  for (let round = 0; round < 2; round++) {
    expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, headers)).status).toBe(200)
    await f.removeConnection()
    // Service access returns caller-traced proxies; assert the original server owner stayed active.
    expect(f.webServer.state).toBe(f.webServerState)
    expect(f.ctx.webServer.port).toBe(port)
    for (const [method, path] of PRIVATE_ROUTES) expect((await f.call(path, headers, method)).status).toBe(404)
    expect((await f.call(OPENAI_CODEX_MODEL_CATALOG_PATH)).status).toBe(200)
    await f.restoreConnection()
    await vi.waitFor(async () => { expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, headers)).status).toBe(200) })
  }
  await f.group.dispose()
  expect((await f.call(AuthPaths.OPENAI_CODEX_AUTH_ACCOUNTS_PATH, headers)).status).toBe(404)
  expect(f.network).not.toHaveBeenCalled()
})
