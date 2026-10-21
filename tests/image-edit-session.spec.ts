/** Full plugin + real host loop/JSONL/attachment store; every provider response is synthetic. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projection from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import LocalAttachments from '@deepseek-ai/dsh-attachment-local'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { selectPersistencePlugin } from '../scripts/persistence-plugin-fixture.mjs'
import { afterEach, expect, it, vi } from 'vitest'
import * as CodexConnect from '../src/index.ts'
import { OpenAICodexCredentialStore } from '../src/store.ts'
import { OpenAICodexImageAssetStore } from '../src/image-assets.ts'
import { decodeImagePresentationMeta } from '../src/image-presentation.ts'
import { decodeImageInputAttachment } from '../src/image-input-contract.ts'

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'))
const PNG_REFERENCE = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
function response(item: Record<string, unknown>): Response {
  return new Response([
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: `r_${randomUUID()}`, status: 'completed', output: [item],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
function tool(args: unknown): Response {
  return response({ type: 'function_call', id: `fc_${randomUUID()}`, call_id: `c_${randomUUID()}`,
    name: 'codex_connect_image_generate', arguments: JSON.stringify(args), status: 'completed' })
}
function answer(): Response {
  return response({ type: 'message', id: `m_${randomUUID()}`, role: 'assistant', phase: 'final_answer', status: 'completed',
    content: [{ type: 'output_text', text: 'Synthetic edit completed.', annotations: [] }] })
}
async function host(root: string, compression: 'none' | 'zstd') {
  const ctx = new Context(); contexts.push(ctx)
  for (const plugin of [Llm, Sessions, Projection, AgentRegistry, Prompt, Tools]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(selectPersistencePlugin(Persistence), { root: join(root, 'sessions'), compression })
  await ctx.plugin(LocalAttachments, { dshHome: root })
  await ctx.plugin(CodexConnect, { enableImageGeneration: true })
  await new Promise(resolve => setImmediate(resolve))
  return ctx
}

it('advertises the image tool and completes generation and continued editing in a synthetic DeepSeek host loop', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-deepseek-image-'))); roots.push(root)
  vi.stubEnv('DSH_HOME', root); vi.stubEnv('OTEL_SDK_DISABLED', 'true')
  const network = vi.fn(async () => { throw new Error('No network is allowed in this synthetic route fixture') })
  vi.stubGlobal('fetch', network)
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('No live model access in this fixture') } })
  const ctx = await host(root, 'none')
  const reply = async () => ({ apiVersion: 1 as const, traceId: 'synthetic', elapsedMs: 1,
    responseBytes: PNG.byteLength, images: [{ b64Json: Buffer.from(PNG).toString('base64') }] })
  const generate = vi.spyOn(ctx.openaiCodexTransport, 'generateImages').mockImplementation(reply)
  const edit = vi.spyOn(ctx.openaiCodexTransport, 'editImages').mockImplementation(reply)
  vi.spyOn(ctx.attachments, 'saveImages').mockRejectedValue(new Error('synthetic preview failure'))
  const requests: GenerateOptions[] = []
  let next: unknown = { operation: 'generate', prompt: 'A blue mug' }
  class DeepSeekFixture extends LlmAdapter {
    providerInfo(provider: string): LlmProviderInfo { return { id: provider, name: 'Synthetic DeepSeek' } }
    async listModels(provider: string): Promise<readonly LlmModelInfo[]> { return [{ provider, id: 'synthetic-flash', name: 'Synthetic Flash' }] }
    async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return { provider, id: model, name: 'Synthetic Flash' } }
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(options)
      expect(options.provider).toBe('deepseek-account')
      expect(options.model).toBe('synthetic-flash')
      expect(options.tools?.find(tool => tool.name === 'codex_connect_image_generate')?.description).toContain('No chat model switch is needed')
      if (next !== undefined) {
        const args = next; next = undefined
        const id = ToolCallId(`synthetic-${requests.length}`)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'codex_connect_image_generate', argumentsDelta: JSON.stringify(args) }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'codex_connect_image_generate', arguments: JSON.stringify(args) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Synthetic result' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic result' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  ctx.llm.registerAdapter(['deepseek-account'], new DeepSeekFixture())
  const handle = await ctx.agents.create({ sessionId: SessionId('deepseek-recovery'), meta: { cwd: root },
    agentOptions: { provider: 'deepseek-account', model: 'synthetic-flash' } })
  handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Generate a blue mug' }] }))
  await handle.agent.whenIdle()
  const first = handle.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
  const firstMeta = first?.type === 'tool/result' ? decodeImagePresentationMeta(first.data.meta) : undefined
  expect(firstMeta).toMatchObject({ schemaVersion: 3 })
  const original = firstMeta?.images[0]?.original
  expect(original).toBeDefined()
  if (original === undefined) throw new Error('expected recovered original')
  expect(JSON.stringify(requests[1]?.messages)).toContain(original.assetId)
  next = { operation: 'edit', prompt: 'Make the mug red', target: { assetId: original.assetId } }
  handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Modify the same mug' }] }))
  await handle.agent.whenIdle()
  const last = handle.agent.session.snapshotEvents().findLast(event => event.type === 'tool/result')
  expect(last?.type === 'tool/result' ? decodeImagePresentationMeta(last.data.meta) : undefined).toMatchObject({
    schemaVersion: 3, operation: 'edit', edit: { target: { assetId: original.assetId } },
  })
  expect(generate).toHaveBeenCalledOnce()
  expect(edit).toHaveBeenCalledWith(expect.objectContaining({ images: [{ data: PNG, mediaType: 'image/png' }] }), expect.anything())
  expect(requests).toHaveLength(4)
  expect(network).not.toHaveBeenCalled()
  await handle.dispose()
})

it.each([
  { compression: 'none' as const, previewUnavailable: false },
  { compression: 'zstd' as const, previewUnavailable: false },
  { compression: 'none' as const, previewUnavailable: true },
  { compression: 'zstd' as const, previewUnavailable: true },
])('edits through the real loop and cold-loads the retained original ($compression, preview unavailable: $previewUnavailable)', async ({ compression, previewUnavailable }) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-edit-session-'))); roots.push(root)
  vi.stubEnv('DSH_HOME', root); vi.stubEnv('OTEL_SDK_DISABLED', 'true')
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('Real WebSocket access is forbidden in this fixture') } })
  const store = new OpenAICodexCredentialStore(join(root, '.openai-codex-auth.json'))
  const claim = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-edit' } })).toString('base64url')
  await store.modify('openai-codex', async () => ({ type: 'oauth', access: `e30.${claim}.fixture`, refresh: 'fixture',
    accountId: 'synthetic-edit', expires: Date.now() + 3_600_000 }))
  let nextCall: unknown
  let modelRequests = 0
  const modelBodies: unknown[] = []
  const imageRequests: Array<{ prompt: string; images: Array<{ image_url: string }> }> = []
  const unexpected: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url === 'https://chatgpt.com/backend-api/codex/responses') {
      const encoded = new Headers(init?.headers).get('content-encoding') === 'zstd'
      const body = encoded ? zstdDecompressSync(init?.body as Uint8Array).toString('utf8') : String(init?.body)
      modelBodies.push(JSON.parse(body))
      modelRequests++
      if (modelRequests > 8) throw new Error('Unexpected synthetic model loop')
      if (nextCall !== undefined) { const call = nextCall; nextCall = undefined; return tool(call) }
      return answer()
    }
    if (url === 'https://chatgpt.com/backend-api/codex/images/edits') {
      expect(new Headers(init?.headers).get('chatgpt-account-id')).toBe('synthetic-edit')
      imageRequests.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }), { headers: { 'content-type': 'application/json' } })
    }
    unexpected.push(url)
    throw new Error('Unexpected network attempt; no real request was sent')
  }))

  const ctx = await host(root, compression)
  const ref = await ctx.attachments.saveImage({ data: PNG, mediaType: 'image/png', name: 'synthetic-upload.png' })
  const reference = await ctx.attachments.saveImage({ data: PNG_REFERENCE, mediaType: 'image/png', name: 'synthetic-reference.png' })
  const expectedInput = await ctx.attachments.readImage(ref)
  if (previewUnavailable) vi.spyOn(ctx.attachments, 'saveImages').mockRejectedValueOnce(new Error('synthetic preview persistence failure'))
  const id = SessionId('edit-durable')
  const options = { provider: 'openai-codex', model: 'gpt-5.6-luna' }
  const handle = await ctx.agents.create({ sessionId: id, meta: { cwd: root }, agentOptions: options })
  nextCall = { operation: 'edit', prompt: 'make background blue', target: { attachmentId: ref.attachmentId } }
  handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [
    { type: 'text', text: 'Edit the first attached image; use the second only as a reference.' },
    { type: 'image', attachment: ref }, { type: 'image', attachment: reference },
  ] }))
  await handle.agent.whenIdle()
  const firstWire = JSON.stringify(modelBodies[0])
  const firstHandle = `Codex Connect image 1 in this message: \\"synthetic-upload.png\\" attachmentId=${String(ref.attachmentId)}`
  const secondHandle = `Codex Connect image 2 in this message: \\"synthetic-reference.png\\" attachmentId=${String(reference.attachmentId)}`
  const firstHandleAt = firstWire.indexOf(firstHandle)
  const secondHandleAt = firstWire.indexOf(secondHandle)
  expect(firstHandleAt).toBeGreaterThanOrEqual(0)
  expect(secondHandleAt).toBeGreaterThan(firstHandleAt)
  expect(firstWire).toContain(JSON.stringify('attachment=' + JSON.stringify(decodeImageInputAttachment(ref))).slice(1, -1))
  expect(firstWire).toContain(JSON.stringify('attachment=' + JSON.stringify(decodeImageInputAttachment(reference))).slice(1, -1))
  const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  const first = results.find(event => event.type === 'tool/result' && decodeImagePresentationMeta(event.data.meta)?.operation === 'edit')
  expect(first, JSON.stringify(results)).toBeDefined()
  if (first?.type !== 'tool/result') throw new Error('expected real tool result')
  const firstMeta = decodeImagePresentationMeta(first.data.meta)!
  const original = firstMeta.images[0]!.original!
  expect(firstMeta.schemaVersion).toBe(previewUnavailable ? 3 : 2)
  expect(firstMeta.images[0]!.previewStatus).toBe(previewUnavailable ? 'unavailable' : undefined)
  expect(JSON.stringify(modelBodies[0])).toContain(String(ref.attachmentId))
  expect(JSON.stringify(modelBodies[1])).toContain(original.assetId)
  expect(imageRequests).toHaveLength(1)
  expect(imageRequests[0]!.images).toEqual([{ image_url: `data:${ref.mediaType};base64,${Buffer.from(expectedInput.data).toString('base64')}` }])
  await handle.dispose()
  const disk = await ctx.sessionPersistence.stat(id)
  expect(disk?.sizeBytes).toBeGreaterThan(0)
  await ctx.fiber.dispose()

  // A new service graph must discover the bytes and sources from disk, not old objects.
  const cold = await host(root, compression)
  expect(cold.sessions.get(id)).toBeUndefined()
  const beforeResume = modelRequests
  const resumed = await cold.agents.resume({ resumeSessionId: id, agentOptions: options })
  expect(modelRequests).toBe(beforeResume)
  const restored = resumed.agent.session.snapshotEvents().find(event => event.type === 'tool/result'
    && decodeImagePresentationMeta(event.data.meta)?.images[0]?.original?.assetId === original.assetId)
  expect(restored?.type === 'tool/result' ? decodeImagePresentationMeta(restored.data.meta) : undefined).toEqual(firstMeta)
  nextCall = { operation: 'edit', prompt: 'change the hat', target: { assetId: original.assetId } }
  resumed.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue editing the saved result.' }] }))
  await resumed.agent.whenIdle()
  const last = resumed.agent.session.snapshotEvents().findLast(event => event.type === 'tool/result')
  const lastMeta = last?.type === 'tool/result' ? decodeImagePresentationMeta(last.data.meta) : undefined
  expect(lastMeta).toMatchObject({ operation: 'edit', edit: { target: { assetId: original.assetId } } })
  expect(lastMeta?.images[0]?.original?.assetId).not.toBe(original.assetId)
  expect(imageRequests).toHaveLength(2)
  expect(JSON.stringify(modelBodies[2])).toContain(original.assetId)
  expect(imageRequests[1]!.images).toEqual([{ image_url: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` }])
  expect((await new OpenAICodexImageAssetStore(root).read(id, original.assetId))?.data).toEqual(PNG)
  expect(unexpected).toEqual([])
  expect(modelRequests).toBe(4)
  await resumed.dispose()
})
