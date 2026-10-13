import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { httpRouteTestContext, rejectedHttpAdmissions } from './http-route-test-context.ts'
import type { CapturedHttpRoute, TestHttpAdmission } from './http-route-test-context.ts'
import {
  OPENAI_CODEX_FAST_MODE_PATH,
  registerOpenAICodexAuthRoutes,
} from '../src/auth-routes.ts'
import { FastModeRegistry } from '../src/fast-mode.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'
import type { OpenAICodexTrustedOriginsStore } from '../src/trusted-origins.ts'

const store = {} as OpenAICodexCredentialStore

function routes(registry = new FastModeRegistry(), admission: TestHttpAdmission = 'allow'): CapturedHttpRoute[] {
  const { ctx, routes: captured } = httpRouteTestContext({ admission })
  const trustedOrigins = { has: async () => false } as unknown as OpenAICodexTrustedOriginsStore
  registerOpenAICodexAuthRoutes(ctx, store, trustedOrigins, registry)
  return [...captured.values()]
}

function request(options: {
  method: string
  url?: string
  origin?: string
  remoteAddress?: string
  contentType?: string
  body?: string
}): IncomingMessage {
  return {
    method: options.method,
    url: options.url ?? OPENAI_CODEX_FAST_MODE_PATH,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: '127.0.0.1:3081',
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.contentType === undefined ? {} : { 'content-type': options.contentType }),
    },
    ...(options.body === undefined ? {} : { body: options.body }),
  } as unknown as IncomingMessage
}

function response(): ServerResponse & { status?: number; body?: string } {
  const observed: { status: number | undefined; body: string | undefined } = { status: undefined, body: undefined }
  return {
    writeHead(status: number) {
      observed.status = status
      return this
    },
    end(body?: string) {
      observed.body = body
      return this
    },
    get status() { return observed.status },
    get body() { return observed.body },
  } as unknown as ServerResponse & { status?: number; body?: string }
}

function fastRoute(registry?: FastModeRegistry, admission: TestHttpAdmission = 'allow'): CapturedHttpRoute {
  const route = routes(registry, admission).find(candidate => candidate.path === OPENAI_CODEX_FAST_MODE_PATH)
  if (route === undefined) throw new Error('Fast Mode route was not registered')
  return route
}

function bodyOf(responseValue: { body?: string }): unknown {
  return JSON.parse(responseValue.body ?? 'null') as unknown
}

describe('OpenAI Codex Fast Mode routes', () => {
  it.each(rejectedHttpAdmissions)('rejects $admission before reading or mutating Fast Mode state', async ({ admission, status, error }) => {
    const registry = new FastModeRegistry()
    registry.set('a', true)
    const isEnabled = vi.spyOn(registry, 'isEnabled')
    const set = vi.spyOn(registry, 'set')
    const has = vi.fn(async () => true)
    const fixture = httpRouteTestContext({ admission })
    registerOpenAICodexAuthRoutes(fixture.ctx, store, { has } as unknown as OpenAICodexTrustedOriginsStore, registry)
    const route = fixture.routes.get(`exact:${OPENAI_CODEX_FAST_MODE_PATH}`)!
    for (const method of ['GET', 'POST']) {
      for (const remoteAddress of ['127.0.0.1', '192.168.1.8']) {
        const req = request({ method, url: `${OPENAI_CODEX_FAST_MODE_PATH}?sessionId=a`, contentType: 'application/json', remoteAddress })
        const readBody = vi.fn(async function* () { yield Buffer.from(JSON.stringify({ sessionId: 'a', enabled: false })) })
        Object.defineProperty(req, Symbol.asyncIterator, { value: readBody })
        const res = response()
        await route.handler(req, res)
        expect(res.status).toBe(status)
        expect(bodyOf(res)).toEqual({ error })
        expect(readBody).not.toHaveBeenCalled()
      }
    }
    expect(has).not.toHaveBeenCalled()
    expect(isEnabled).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
    expect(registry.size).toBe(1)
  })

  it('keeps Origin rejection after Host admission without touching Fast Mode state', async () => {
    const registry = new FastModeRegistry()
    const isEnabled = vi.spyOn(registry, 'isEnabled')
    const set = vi.spyOn(registry, 'set')
    const route = fastRoute(registry)
    for (const method of ['GET', 'POST']) {
      const res = response()
      await route.handler(request({ method, origin: 'http://127.0.0.1:9999', contentType: 'application/json', body: JSON.stringify({ sessionId: 'a', enabled: true }) }), res)
      expect(res.status).toBe(403)
      expect(bodyOf(res)).toEqual({ error: 'forbidden' })
    }
    expect(isEnabled).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('defaults off, isolates sessions, and disables by deletion', async () => {
    const registry = new FastModeRegistry()
    const route = fastRoute(registry)
    const initial = response()
    await route.handler(request({ method: 'GET', url: `${OPENAI_CODEX_FAST_MODE_PATH}?sessionId=a` }), initial)
    expect(initial.status).toBe(200)
    expect(bodyOf(initial)).toEqual({ enabled: false })

    const enabled = response()
    await route.handler(request({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: 'a', enabled: true }),
    }), enabled)
    expect(enabled.status).toBe(200)
    expect(bodyOf(enabled)).toEqual({ enabled: true })

    const other = response()
    await route.handler(request({ method: 'GET', url: `${OPENAI_CODEX_FAST_MODE_PATH}?sessionId=b` }), other)
    expect(bodyOf(other)).toEqual({ enabled: false })

    const disabled = response()
    await route.handler(request({
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ sessionId: 'a', enabled: false }),
    }), disabled)
    expect(bodyOf(disabled)).toEqual({ enabled: false })
    expect(registry.size).toBe(0)
  })

  it('fails closed for origin, method, content type, input, and bounded body', async () => {
    const route = fastRoute()
    const remote = response()
    await route.handler(request({
      method: 'GET',
      url: `${OPENAI_CODEX_FAST_MODE_PATH}?sessionId=secret-session`,
      remoteAddress: '192.168.1.8',
      origin: 'http://192.168.1.20:3081',
    }), remote)
    expect(remote.status).toBe(403)
    expect(JSON.stringify(bodyOf(remote))).not.toContain('secret-session')

    const method = response()
    await route.handler(request({ method: 'PUT' }), method)
    expect(method.status).toBe(405)

    const type = response()
    await route.handler(request({ method: 'POST', contentType: 'text/plain', body: '{}' }), type)
    expect(type.status).toBe(415)

    const input = response()
    await route.handler(request({ method: 'POST', contentType: 'application/json', body: JSON.stringify({ sessionId: '', enabled: true }) }), input)
    expect(input.status).toBe(400)

    const oversized = response()
    await route.handler(request({ method: 'POST', contentType: 'application/json', body: 'x'.repeat(4_097) }), oversized)
    expect(oversized.status).toBe(413)
  })
})
