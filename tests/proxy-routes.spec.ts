import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpRouteTestContext, rejectedHttpAdmissions } from './http-route-test-context.ts'
import type { CapturedHttpRoute, TestHttpAdmission } from './http-route-test-context.ts'
import {
  OPENAI_CODEX_PROXY_DETECT_PATH,
  OPENAI_CODEX_PROXY_TEST_PATH,
  registerOpenAICodexProxyRoutes,
} from '../src/proxy-routes.ts'
import type { OpenAICodexProxyManager } from '../src/provider-proxy.ts'
import type { OpenAICodexTrustedOriginsStore } from '../src/trusted-origins.ts'

const trustedOrigins = { has: async () => false } as unknown as OpenAICodexTrustedOriginsStore

function response(): ServerResponse & { status?: number; body?: string } {
  const observed: { status?: number; body?: string } = {}
  return {
    writeHead(status: number) {
      observed.status = status
      return this
    },
    end(body?: string) {
      if (body !== undefined) observed.body = body
    },
    get status() { return observed.status },
    get body() { return observed.body },
  } as unknown as ServerResponse & { status?: number; body?: string }
}

function request(method: string, url = '/', options: { remoteAddress?: string; host?: string; origin?: string } = {}): IncomingMessage {
  return {
    method,
    url,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: options.host ?? '127.0.0.1:3081',
      ...options.origin === undefined ? {} : { origin: options.origin },
    },
  } as unknown as IncomingMessage
}

function capture(
  manager: OpenAICodexProxyManager,
  admission: TestHttpAdmission = 'allow',
  origins: OpenAICodexTrustedOriginsStore = trustedOrigins,
): CapturedHttpRoute[] {
  const { ctx, routes } = httpRouteTestContext({ admission })
  registerOpenAICodexProxyRoutes(ctx, origins, manager)
  return [...routes.values()]
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('OpenAI Codex proxy routes', () => {
  it.each(rejectedHttpAdmissions)('rejects $admission before Origin reads or any proxy probe', async ({ admission, status, error }) => {
    const probe = vi.fn()
    const has = vi.fn(async () => true)
    const manager = { probe } as unknown as OpenAICodexProxyManager
    const routes = capture(manager, admission, { has } as unknown as OpenAICodexTrustedOriginsStore)
    for (const path of [OPENAI_CODEX_PROXY_DETECT_PATH, OPENAI_CODEX_PROXY_TEST_PATH]) {
      for (const location of [
        { remoteAddress: '127.0.0.1', host: '127.0.0.1:3081', origin: 'http://127.0.0.1:3081' },
        { remoteAddress: '192.168.1.8', host: '192.168.1.20:3081', origin: 'http://192.168.1.20:3081' },
      ]) {
        const res = response()
        await routes.find(route => route.path === path)!.handler(request('POST', `${path}?proxyUrl=${encodeURIComponent('http://127.0.0.1:7897')}`, location), res)
        expect(res.status).toBe(status)
        expect(JSON.parse(res.body!)).toEqual({ error })
      }
    }
    expect(has).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })

  it('still requires exact Origin and sidecar trust after Host admission', async () => {
    const probe = vi.fn()
    const routes = capture({ probe } as unknown as OpenAICodexProxyManager)
    for (const route of routes) {
      for (const options of [
        { remoteAddress: '127.0.0.1', host: '127.0.0.1:3081', origin: 'http://127.0.0.1:9999' },
        { remoteAddress: '192.168.1.8', host: '192.168.1.20:3081', origin: 'http://192.168.1.20:3081' },
      ]) {
        const res = response()
        await route.handler(request('POST', `${route.path}?proxyUrl=${encodeURIComponent('http://127.0.0.1:7897')}`, options), res)
        expect(res.status).toBe(403)
      }
    }
    expect(probe).not.toHaveBeenCalled()
  })

  it.each([1, 2])('rolls back failed proxy registration %s while retaining unrelated routes', async nth => {
    const fixture = httpRouteTestContext({ failRegistrationAt: nth + 1 })
    const unrelated: CapturedHttpRoute = { kind: 'exact', path: '/unrelated', handler: () => undefined }
    fixture.webServer.register(unrelated)
    const probe = vi.fn()
    expect(() => registerOpenAICodexProxyRoutes(fixture.ctx, trustedOrigins, { probe } as unknown as OpenAICodexProxyManager))
      .toThrow('synthetic HTTP route registration failure')
    expect([...fixture.routes.values()]).toEqual([unrelated])
    await fixture.ctx.fiber.dispose()
    expect([...fixture.routes.values()]).toEqual([unrelated])
    expect(fixture.disposedPaths).toEqual([OPENAI_CODEX_PROXY_DETECT_PATH, OPENAI_CODEX_PROXY_TEST_PATH].slice(0, nth - 1).reverse())
    expect(probe).not.toHaveBeenCalled()
  })

  it('preserves an unrelated owner of a conflicting proxy route', async () => {
    const fixture = httpRouteTestContext()
    const occupied: CapturedHttpRoute = { kind: 'exact', path: OPENAI_CODEX_PROXY_TEST_PATH, handler: () => undefined }
    fixture.webServer.register(occupied)
    expect(() => registerOpenAICodexProxyRoutes(fixture.ctx, trustedOrigins, { probe: vi.fn() } as unknown as OpenAICodexProxyManager))
      .toThrow(/duplicate HTTP route/u)
    expect([...fixture.routes.values()]).toEqual([occupied])
    await fixture.ctx.fiber.dispose()
    expect([...fixture.routes.values()]).toEqual([occupied])
    expect(fixture.disposedPaths).toEqual([OPENAI_CODEX_PROXY_DETECT_PATH])
  })

  it('releases proxy routes in reverse order on normal disposal', async () => {
    const fixture = httpRouteTestContext()
    const unrelated: CapturedHttpRoute = { kind: 'exact', path: '/unrelated', handler: () => undefined }
    fixture.webServer.register(unrelated)
    registerOpenAICodexProxyRoutes(fixture.ctx, trustedOrigins, { probe: vi.fn() } as unknown as OpenAICodexProxyManager)
    await fixture.ctx.fiber.dispose()
    expect([...fixture.routes.values()]).toEqual([unrelated])
    expect(fixture.disposedPaths).toEqual([OPENAI_CODEX_PROXY_TEST_PATH, OPENAI_CODEX_PROXY_DETECT_PATH])
  })

  it('detects bounded candidates without a settings mutation', async () => {
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) vi.stubEnv(name, '')
    const probe = vi.fn(async (proxyUrl: string) => ({
      proxyUrl,
      reachable: proxyUrl.endsWith(':7890'),
      classification: proxyUrl.endsWith(':7890') ? 'reachable' as const : 'connection-refused' as const,
      ...(proxyUrl.endsWith(':7890') ? { status: 401 } : {}),
    }))
    const manager = { probe } as unknown as OpenAICodexProxyManager
    const route = capture(manager).find(candidate => candidate.path === OPENAI_CODEX_PROXY_DETECT_PATH)
    if (route === undefined) throw new Error('detect route was not registered')
    const res = response()
    await route.handler(request('POST'), res)

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body ?? 'null')).toMatchObject({
      candidates: [{ proxyUrl: 'http://127.0.0.1:7890', status: 401 }],
    })
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('tests only the draft URL and rejects missing input without probing', async () => {
    const probe = vi.fn(async (proxyUrl: string) => ({
      proxyUrl,
      reachable: true,
      classification: 'reachable' as const,
      status: 401,
    }))
    const manager = { probe } as unknown as OpenAICodexProxyManager
    const route = capture(manager).find(candidate => candidate.path === OPENAI_CODEX_PROXY_TEST_PATH)
    if (route === undefined) throw new Error('test route was not registered')
    const invalid = response()
    await route.handler(request('POST'), invalid)
    expect(invalid.status).toBe(400)
    expect(probe).not.toHaveBeenCalled()

    const valid = response()
    await route.handler(request('POST', `${OPENAI_CODEX_PROXY_TEST_PATH}?proxyUrl=${encodeURIComponent('http://127.0.0.1:7897')}`), valid)
    expect(valid.status).toBe(200)
    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:7897')
  })
})
