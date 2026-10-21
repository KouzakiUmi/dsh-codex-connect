import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { httpRouteTestContext, rejectedHttpAdmissions } from './http-route-test-context.ts'
import type { TestHttpAdmission } from './http-route-test-context.ts'
import { registerOpenAICodexAuthRoutes } from '../src/auth-routes.ts'
import { ConversationSpeedRegistry } from '../src/conversation-speed.ts'
import { OPENAI_CODEX_SPEED_MODE_PATH as PATH } from '../src/speed-mode-contract.ts'
import { OPENAI_CODEX_FAST_MODE_PATH } from '../src/fast-mode-paths.ts'
import type { OpenAICodexCredentialStore } from '../src/store.ts'
import type { OpenAICodexTrustedOriginsStore } from '../src/trusted-origins.ts'

function fixture(admission: TestHttpAdmission = 'allow') {
  const f = httpRouteTestContext({ admission }), registry = new ConversationSpeedRegistry()
  let account: string | undefined = 'acct_' + 'a'.repeat(43)
  const accounts = vi.fn(async () => account === undefined ? [] : [{ accountKey: account, active: true }])
  registerOpenAICodexAuthRoutes(f.ctx, { accounts } as unknown as OpenAICodexCredentialStore,
    { has: async () => false } as unknown as OpenAICodexTrustedOriginsStore, registry)
  async function call(method = 'GET', body?: unknown, path = `${PATH}?sessionId=session&model=gpt-6.1-sol`, origin?: string) {
    const req = { method, url: path, socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3081', 'content-type': 'application/json', ...(origin === undefined ? {} : { origin }) },
      body: body === undefined ? '' : JSON.stringify(body) } as unknown as IncomingMessage
    let status = 0, result: unknown
    const res = { writeHead(code: number) { status = code; return this }, end(value: string) { result = JSON.parse(value) } } as unknown as ServerResponse
    const route = f.routes.get(`exact:${path.split('?')[0]}`)!
    await route.handler(req, res)
    return { status, result: result as Record<string, unknown> }
  }
  return { ...f, registry, accounts, call, setAccount: (value: string | undefined) => { account = value } }
}
it.each(rejectedHttpAdmissions)('rejects $admission before account/state/body access', async ({ admission, status }) => {
  const f = fixture(admission)
  for (const method of ['GET', 'POST']) expect((await f.call(method, {})).status).toBe(status)
  expect(f.accounts).not.toHaveBeenCalled()
})
it('rejects an untrusted origin before reading account state', async () => {
  const f = fixture()
  expect((await f.call('POST', {}, PATH, 'https://untrusted.invalid')).status).toBe(403)
  expect(f.accounts).not.toHaveBeenCalled()
})
it('keeps all modes exclusive, rejects stale POST replay, and preserves the legacy boolean command', async () => {
  const f = fixture(), read = await f.call()
  expect(read.result).toMatchObject({ mode: 'standard', eligibility: 'unknown', hasAccount: true, modelSupported: true })
  const body = { sessionId: 'session', model: 'gpt-6.1-sol', generation: read.result['generation'], revision: read.result['revision'], mode: 'ultrafast' }
  expect((await f.call('POST', body)).result).toMatchObject({ mode: 'ultrafast', eligibility: 'unknown' })
  expect((await f.call('POST', body)).status).toBe(409)
  expect((await f.call('GET', undefined, `${OPENAI_CODEX_FAST_MODE_PATH}?sessionId=session`)).status).toBe(409)
  expect((await f.call('POST', { sessionId: 'session', enabled: true }, OPENAI_CODEX_FAST_MODE_PATH)).status).toBe(200)
  expect((await f.call()).result['mode']).toBe('fast')
})
it('does not reuse an account scope or let an old POST clear a newer account choice', async () => {
  const f = fixture(), old = (await f.call()).result
  f.setAccount('acct_' + 'b'.repeat(43))
  const next = (await f.call()).result
  const chosen = await f.call('POST', { sessionId: 'session', model: 'gpt-6.1-sol', generation: next['generation'], revision: next['revision'], mode: 'ultrafast' })
  expect(chosen.status).toBe(200)
  expect((await f.call('POST', { sessionId: 'session', model: 'gpt-6.1-sol', generation: old['generation'], revision: old['revision'], mode: 'standard' })).status).toBe(409)
  expect((await f.call('DELETE', { sessionId: 'session', generation: old['generation'] })).status).toBe(405)
  expect((await f.call()).result['mode']).toBe('ultrafast')
})
it('requires an account and exact supported model without classifying eligibility', async () => {
  const f = fixture(); f.setAccount(undefined)
  const read = (await f.call()).result
  expect(read).toMatchObject({ hasAccount: false, eligibility: 'unknown' })
  expect((await f.call('POST', { sessionId: 'session', model: 'gpt-6.1-sol', generation: read['generation'], revision: 0, mode: 'ultrafast' })).status).toBe(409)
  const other = (await f.call('GET', undefined, `${PATH}?sessionId=session&model=gpt-6-sol`)).result
  expect(other['modelSupported']).toBe(false)
  expect((await f.call('POST', { sessionId: 'session', model: 'gpt-6-sol', generation: other['generation'], revision: 0, mode: 'ultrafast' })).status).toBe(400)
})
it.each([
  { sessionId: 'session', generation: 'g', revision: -1, mode: 'ultrafast', model: 'gpt-6.1-sol' },
  { sessionId: 'session', generation: 'g', revision: 0, mode: 'ultrafast', model: 'gpt-6.1-sol', accountKey: 'spoof' },
  { sessionId: 'session', generation: 'g', revision: 0, mode: 'auto', model: 'gpt-6.1-sol' },
])('rejects malformed/extra control input %j', async body => {
  const f = fixture(); expect((await f.call('POST', body)).status).toBe(400)
  expect(f.accounts).not.toHaveBeenCalled()
})
