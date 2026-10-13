import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AtomicTaskDocumentStore, taskIdentity } from '../src/adaptive-task-store.ts'
import { AdaptiveTaskControlRuntime } from '../src/adaptive-task-control-runtime.ts'
import { ADAPTIVE_TASK_START } from '../src/adaptive-task-contract.ts'

const fs = vi.hoisted(() => ({ lstat: vi.fn(), open: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), ...fs,
}))
beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { vi.restoreAllMocks() })
const info = (size: number, ino = 1n) => ({
  dev: 1n, ino, nlink: 1n, size: BigInt(size), mode: 0o600n, uid: 1000n, mtimeNs: 1n, ctimeNs: 1n,
  isFile: () => true, isSymbolicLink: () => false,
})

for (const platform of ['win32', 'linux'] as const) {
  it.each(['unchanged', 'hardlink during read', 'mode during read', 'missing during close', 'link during close', 'ctime during read'])(
    `manual control dispatch: ${platform}: %s`, async scenario => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
      const ctx = new Context(), id = SessionId('fixture')
      const header = { id, createdAt: 1, isSeeded: false }
      const session = { header, snapshotEvents: () => [] }
      const agent = { id, session }
      ctx.provide('agents', { get: () => agent, roots: () => [agent], currentInitiator: () => agent } as never)
      ctx.provide('sessions', { get: () => session } as never)
      const document = { version: 1, sessionId: id, sessionKey: taskIdentity(JSON.stringify([id, 1, '', false, ''])),
        owner: 'b'.repeat(64), runtime: 'c'.repeat(64), revision: 1, mode: 'manual', route: ADAPTIVE_TASK_START,
        capabilities: [{ model: ADAPTIVE_TASK_START.model, efforts: ['medium'] }], maximumRequests: 50, reserved: 0,
        selectionSeq: -1, portable: false, handoffSeq: -1, receipts: [{ id: 'synthetic-receipt-0001', digest: 'd'.repeat(64) }] }
      const bytes = Buffer.from(JSON.stringify(document))
      let opened = 0, missing = false, linked = false, current = info(bytes.length)
      fs.lstat.mockImplementation(async (_filename: string, options?: { bigint: boolean }) => {
        if (!options?.bigint) return { isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 }
        if (missing) throw Object.assign(new Error('synthetic missing'), { code: 'ENOENT' })
        return linked ? { ...current, isFile: () => false, isSymbolicLink: () => true } : { ...current }
      })
      const closes: ReturnType<typeof vi.fn>[] = []
      fs.open.mockImplementation(async () => {
        const index = ++opened, held = info(bytes.length)
        current = held
        const close = vi.fn(async () => {
          if (index === 3 && scenario === 'missing during close') missing = true
          if (index === 3 && scenario === 'link during close') linked = true
        })
        closes.push(close)
        return {
          stat: async (options?: { bigint: boolean }) => options?.bigint ? { ...held }
            : { isFile: () => true, nlink: Number(held.nlink), size: bytes.length, mode: Number(held.mode) },
          read: async (buffer: Buffer) => {
            bytes.copy(buffer)
            if (index === 3 && scenario === 'hardlink during read') { held.nlink = 2n; held.ctimeNs++ }
            if (index === 3 && scenario === 'mode during read') { held.mode = 0o644n; held.ctimeNs++ }
            if (index === 3 && scenario === 'ctime during read') held.ctimeNs++
            return { bytesRead: bytes.length }
          }, close,
        }
      })
      const runtime = new AdaptiveTaskControlRuntime(ctx, { directory: 'synthetic-state', models: async () => [],
        artifacts: () => { throw new Error('Unexpected artifact access') } })
      const dispatch = vi.fn(async function* () { yield { type: 'finish' as const, reason: { kind: 'stop' as const } } })
      const options = { sessionId: id } as Parameters<AdaptiveTaskControlRuntime['stream']>[0]
      try {
        const result = runtime.stream(options, dispatch)[Symbol.asyncIterator]().next()
        if (scenario === 'unchanged') { await result; expect(dispatch).toHaveBeenCalledOnce() }
        else { await expect(result).rejects.toThrow('TASK_STATE_UNAVAILABLE'); expect(dispatch).not.toHaveBeenCalled() }
        expect(opened).toBe(3) // managed read, ownsRoot read, final manual load: none is stubbed.
        for (const close of closes) expect(close).toHaveBeenCalledOnce()
      } finally { await ctx.fiber.dispose() }
    })
}

it.each(['one replacement', 'replacement during close', 'repeated replacement', 'missing on retry'])(
  'bounded read-only retry for a normal private atomic replacement: %s', async scenario => {
    const original = Buffer.from('{"state":"synthetic"}'), next = Buffer.from('{"state":"different"}')
    let opened = 0, observations = 0, current = info(original.length)
    const parse = vi.fn((value: unknown) => value), closes: ReturnType<typeof vi.fn>[] = []
    fs.lstat.mockImplementation(async (_filename: string, options?: { bigint: boolean }) => {
      if (!options?.bigint) return { isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 }
      if (++observations === 4 && scenario === 'missing on retry') throw Object.assign(new Error('synthetic missing'), { code: 'ENOENT' })
      return { ...current }
    })
    fs.open.mockImplementation(async () => {
      const index = ++opened, held = { ...current }, bytes = index === 1 ? original : next
      const close = vi.fn(async () => {
        if (index === 1 && scenario === 'replacement during close') current = info(next.length, held.ino + 1n)
      }); closes.push(close)
      return {
        stat: async (options?: { bigint: boolean }) => options?.bigint ? { ...held }
          : { isFile: () => true, nlink: Number(held.nlink), size: bytes.length, mode: 0o600 },
        read: async (buffer: Buffer) => {
          bytes.copy(buffer)
          if (index === 1 && scenario !== 'replacement during close' || scenario === 'repeated replacement') {
            held.nlink = 0n; held.ctimeNs++
            current = info(next.length, held.ino + 1n)
          }
          return { bytesRead: bytes.length }
        }, close,
      }
    })
    const read = new AtomicTaskDocumentStore('synthetic-state', parse).read('fixture')
    if (scenario === 'one replacement' || scenario === 'replacement during close') { expect(await read).toEqual({ state: 'different' }); expect(parse).toHaveBeenCalledOnce() }
    else { await expect(read).rejects.toThrow('TASK_STATE_UNAVAILABLE'); expect(parse).not.toHaveBeenCalled() }
    expect(opened).toBe(scenario === 'missing on retry' ? 1 : 2)
    for (const close of closes) expect(close).toHaveBeenCalledOnce()
  })
