import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'
import { setImmediate as turn } from 'node:timers/promises'

const proxyOrigin = 'http://127.0.0.1:7890'
const config = { protocol: 'bili-v1', trustedProxyOrigin: proxyOrigin, maxDurationMs: 450_000 }
const heartbeat = ': bili-preflight\n\n'
const headers = { 'content-type': 'text/event-stream', 'x-bili-preflight': 'compressing' }

function responseSource() {
  const started = Promise.withResolvers()
  const ready = Promise.withResolvers()
  let output
  let signal
  let closed = false
  const stop = error => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', aborted)
    if (error === undefined) output?.close()
    else output?.error(error)
  }
  const aborted = () => stop(signal.reason)
  const emit = value => output.enqueue(new TextEncoder().encode(value))
  return {
    started: started.promise, ready,
    async fetch(url, init) {
      assert.equal(String(url), 'https://chatgpt.com/backend-api/codex/responses')
      signal = init.signal
      const response = new Response(new ReadableStream({
        start(controller) {
          output = controller
          signal.addEventListener('abort', aborted, { once: true })
          if (signal.aborted) aborted()
          started.resolve()
        },
        cancel() { closed = true; signal.removeEventListener('abort', aborted) },
      }, { highWaterMark: 0 }), { headers })
      await ready.promise
      return response
    },
    emit,
    stop,
    complete() {
      const item = { type: 'message', id: 'synthetic-message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'OK', annotations: [] }] }
      const events = [
        { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
        { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'OK' },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'synthetic-preflight', status: 'completed', output: [item],
          usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
      ]
      emit(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''))
      stop()
    },
  }
}

async function collect(stream) {
  const chunks = []
  try { for await (const chunk of stream) chunks.push(chunk); return { chunks } }
  catch (error) { return { chunks, error } }
}

/** Exercise the packed plugin on the stock Host; only HTTP and proxy transport are synthetic. */
export async function checkInstalledPreflight(importHost, CodexConnect) {
  const [{ Context }, { default: Llm }] = await Promise.all([
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-llm',
  ].map(importHost))
  const directory = await mkdtemp(join(tmpdir(), 'codex-installed-preflight-'))
  const previousHome = process.env.DSH_HOME
  const previousFetch = globalThis.fetch
  const proxy = CodexConnect.OpenAICodexProxyManager.prototype
  const previousRun = proxy.run
  const previousRunStream = proxy.runStream
  let source
  process.env.DSH_HOME = directory
  // No sockets, real proxy, or credentials: preserve the acquired route as an explicit fixture input.
  proxy.run = proxy.runStream = (origin, operation) => { assert.equal(origin, proxyOrigin); return operation() }
  globalThis.fetch = (...args) => { assert.ok(source); return source.fetch(...args) }
  const flush = async () => { await turn(); await turn() }
  const advance = async milliseconds => { mock.timers.tick(milliseconds); await flush() }
  const pulse = async () => { await advance(15_000); source.emit(heartbeat); await flush() }
  const request = { provider: 'openai-codex', model: 'gpt-6-astra', messages: [] }
  let cases = 0
  try {
    const access = 'e30.' + Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-preflight' },
    })).toString('base64url') + '.fixture'
    await new CodexConnect.OpenAICodexCredentialStore().modify('openai-codex', async () => ({
      type: 'oauth', accountId: 'synthetic-preflight', access, refresh: 'synthetic-only', expires: Date.now() + 3_600_000,
    }))
    const run = async (enabled, scenario) => {
      const ctx = new Context()
      source = responseSource()
      try {
        await ctx.plugin(Llm)
        await ctx.plugin(CodexConnect, { enableProxy: true, proxyUrl: proxyOrigin,
          ...(enabled ? { preflightActivity: config } : {}) })
        mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() })
        await scenario(ctx)
        cases++
      } finally {
        source.ready.resolve()
        source.stop()
        mock.timers.reset()
        await ctx.fiber.dispose()
      }
    }
    await run(true, async ctx => {
      const pending = collect(ctx.llm.stream(request))
      await source.started
      source.ready.resolve()
      await flush()
      for (let index = 0; index < 26; index++) await pulse()
      source.complete()
      const result = await pending
      assert.equal(result.error, undefined)
      assert.equal(result.chunks.at(-1)?.reason?.kind, 'stop', JSON.stringify(result.chunks.at(-1)?.reason))
      assert.ok(!JSON.stringify(result.chunks).includes('bili-preflight'))
    })
    await run(true, async ctx => {
      const pending = collect(ctx.llm.stream(request))
      await source.started
      await advance(299_000)
      source.ready.resolve()
      source.emit(heartbeat)
      await flush()
      for (let index = 0; index < 29; index++) await pulse()
      await advance(15_000)
      const result = await pending
      assert.equal(result.error, undefined)
      assert.equal(result.chunks.at(-1)?.reason?.kind, 'error')
      assert.equal(result.chunks.at(-1)?.reason?.failure?.code, 'TIMEOUT')
      assert.equal(result.chunks.at(-1)?.reason?.failure?.message, 'Codex preflight timeout after 450000ms')
    })
    await run(true, async ctx => {
      const pending = collect(ctx.llm.stream(request))
      await source.started
      source.ready.resolve()
      await flush()
      await pulse()
      await advance(300_000)
      assert.equal((await pending).chunks.at(-1)?.reason?.failure?.message, 'Codex stream idle timeout after 300000ms')
    })
    await run(false, async ctx => {
      const pending = collect(ctx.llm.stream(request))
      await source.started
      source.ready.resolve()
      await flush()
      for (let index = 0; index < 19; index++) await pulse()
      await advance(15_000)
      assert.equal((await pending).chunks.at(-1)?.reason?.failure?.message, 'pi-ai stream idle timeout after 300000ms')
    })
    const cancellations = []
    for (const enabled of [false, true]) await run(enabled, async ctx => {
      const caller = new AbortController()
      const pending = collect(ctx.llm.stream({ ...request, signal: caller.signal }))
      await source.started
      source.ready.resolve()
      await flush()
      caller.abort(new Error('synthetic caller cancellation'))
      await flush()
      const result = await pending
      cancellations.push({ code: result.error?.code, chunks: result.chunks })
    })
    assert.deepEqual(cancellations[1], cancellations[0])
    assert.equal(cancellations[0].chunks.at(-1)?.reason?.kind, 'aborted')
    return { syntheticOnly: true, cases, publicProviderCallback: true, lateHeadersFullBudget: true,
      finiteTotalDeadline: true, ordinaryIdlePreserved: true, callerCancellationUnchanged: true, realProviderRequests: 0 }
  } finally {
    mock.timers.reset()
    proxy.run = previousRun
    proxy.runStream = previousRunStream
    globalThis.fetch = previousFetch
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(directory, { recursive: true, force: true })
  }
}
