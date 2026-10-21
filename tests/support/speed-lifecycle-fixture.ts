/** Real Host session/event feed and real plugin HTTP contracts, all synthetic. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import { httpRouteTestContext } from '../http-route-test-context.ts'
import { createConversationSpeedRegistry } from '../../src/conversation-speed.ts'
import { registerOpenAICodexAuthRoutes } from '../../src/auth-routes.ts'
import { openAICodexAccountKey } from '../../src/store.ts'
import type { OpenAICodexCredentialStore } from '../../src/store.ts'
import type { OpenAICodexTrustedOriginsStore } from '../../src/trusted-origins.ts'

export async function speedLifecycleFixture() {
  const f = httpRouteTestContext()
  await f.ctx.plugin(Sessions)
  const session = (f.ctx.get('sessions') as unknown as Sessions).create(SessionId('session'))
  const registry = createConversationSpeedRegistry(f.ctx)
  let accountId = 'synthetic-speed-a'
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const store = {
    accounts: async () => [{ accountKey: openAICodexAccountKey(accountId), active: true }],
    captureActiveAccount: async () => {
      const account = accountId
      return { read: async () => ({ type: 'oauth', accountId: account, refresh: 'synthetic-only', expires: Date.now() + 3600000,
        access: `${encode({ alg: 'none' })}.${encode({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })}.synthetic` }) }
    },
  } as unknown as OpenAICodexCredentialStore
  registerOpenAICodexAuthRoutes(f.ctx, store, { has: async () => false } as unknown as OpenAICodexTrustedOriginsStore, registry)
  const request = async (path: string, init: RequestInit): Promise<Response> => {
    const url = new URL(path, 'http://127.0.0.1:3081')
    const route = f.routes.get(`exact:${url.pathname}`)
    if (route === undefined) return new Response('{}', { status: 404 })
    const headers: Record<string, string> = { host: url.host }
    new Headers(init.headers).forEach((value, key) => { headers[key] = value })
    const req = { method: init.method ?? 'GET', url: url.pathname + url.search,
      socket: { remoteAddress: '127.0.0.1' }, headers,
      ...(init.body === undefined ? {} : { body: String(init.body) }) } as unknown as IncomingMessage
    let status = 200, body = ''
    const res = { writeHead(code: number) { status = code; return this }, end(value: string) { body = value } } as unknown as ServerResponse
    await route.handler(req, res)
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }
  const scope = (model = 'gpt-6.1-sol') => ({ workspace: registry.workspaceFor('session'), accountKey: openAICodexAccountKey(accountId), provider: 'openai-codex', model })
  return { ...f, session, registry, store, request, scope,
    modelChanged: (model: string, provider = 'openai-codex') => { session.append('model/selection', { provider, model }) },
    accountChanged: () => { registry.invalidateAccountSelections(); accountId = 'synthetic-speed-b' },
  }
}
