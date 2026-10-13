import { Buffer } from 'node:buffer'
import { beforeEach, expect, it, vi } from 'vitest'
import { AtomicTaskDocumentStore } from '../src/adaptive-task-store.ts'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AdaptiveTaskControlRuntime } from '../src/adaptive-task-control-runtime.ts'

const fs = vi.hoisted(() => ({ lstat: vi.fn(), open: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  lstat: fs.lstat, open: fs.open,
}))
const info = (ino = 1n, dev = 1n, symbolicLink = false, regular = true) => ({
  ino, dev, isFile: () => regular, isSymbolicLink: () => symbolicLink,
})
beforeEach(() => { vi.resetAllMocks() })

it.each([
  ['unchanged', info(), info(), info(), undefined],
  ['initial symlink', info(1n, 1n, true, false), info(), info(), 'TASK_STATE_UNAVAILABLE'],
  ['initial non-file', info(1n, 1n, false, false), info(), info(), 'TASK_STATE_UNSAFE'],
  ['replaced before open', info(), info(2n), info(2n), 'TASK_STATE_UNSAFE'],
  ['different device', info(), info(1n, 2n), info(1n, 2n), 'TASK_STATE_UNSAFE'],
  ['replaced after open', info(), info(), info(2n), 'TASK_STATE_UNSAFE'],
  ['linked after open', info(), info(), info(1n, 1n, true, false), 'TASK_STATE_UNAVAILABLE'],
  ['non-file after open', info(), info(), info(1n, 1n, false, false), 'TASK_STATE_UNSAFE'],
  ['large inode mismatch', info(9007199254740992n), info(9007199254740993n), info(9007199254740993n), 'TASK_STATE_UNSAFE'],
] as const)('checks opened state identity: %s', async (_name, before, opened, after, error) => {
  const bytes = Buffer.from('{"state":"synthetic"}')
  const read = vi.fn(async (buffer: Buffer) => { bytes.copy(buffer); return { bytesRead: bytes.length } })
  const close = vi.fn(async () => {})
  const parse = vi.fn((value: unknown) => value)
  fs.lstat.mockResolvedValueOnce({ isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 })
    .mockResolvedValueOnce(before).mockResolvedValueOnce(after)
  fs.open.mockResolvedValue({
    stat: vi.fn().mockResolvedValueOnce(opened).mockResolvedValueOnce({
      isFile: () => true, nlink: 1, size: bytes.length, mode: 0o600,
    }), read, close,
  })
  const store = new AtomicTaskDocumentStore('synthetic-state', parse)
  if (error) await expect(store.read('fixture')).rejects.toThrow(error)
  else expect(await store.read('fixture')).toEqual({ state: 'synthetic' })
  expect(read).toHaveBeenCalledTimes(error ? 0 : 1)
  expect(parse).toHaveBeenCalledTimes(error ? 0 : 1)
  const openedFile = before.isFile() && !before.isSymbolicLink()
  expect(fs.open).toHaveBeenCalledTimes(openedFile ? 1 : 0)
  expect(close).toHaveBeenCalledTimes(openedFile ? 1 : 0)
  expect(fs.lstat.mock.calls[1]?.[1]).toEqual({ bigint: true })
})

it.each(['directory', 'target'] as const)('returns absent state only for an initially missing %s', async missing => {
  const parse = vi.fn((value: unknown) => value)
  if (missing === 'target') fs.lstat.mockResolvedValueOnce({ isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 })
  fs.lstat.mockRejectedValueOnce(Object.assign(new Error('synthetic missing'), { code: 'ENOENT' }))
  expect(await new AtomicTaskDocumentStore('synthetic-state', parse).read('fixture')).toBeUndefined()
  expect(fs.open).not.toHaveBeenCalled()
  expect(parse).not.toHaveBeenCalled()
})

it.each(['open', 'identity', 'stat', 'read', 'parse', 'close'] as const)('fails unavailable for ENOENT at %s after observing a target', async stage => {
  const missing = Object.assign(new Error('synthetic missing'), { code: 'ENOENT' })
  const bytes = Buffer.from('{"state":"synthetic"}')
  const read = vi.fn(async (buffer: Buffer) => { bytes.copy(buffer); return { bytesRead: bytes.length } })
  const close = vi.fn(async () => {})
  const stat = vi.fn().mockResolvedValueOnce(info()).mockResolvedValueOnce({
    isFile: () => true, nlink: 1, size: bytes.length, mode: 0o600,
  })
  const parse = vi.fn((value: unknown) => value)
  fs.lstat.mockResolvedValueOnce({ isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 })
    .mockResolvedValueOnce(info()).mockResolvedValueOnce(info())
  fs.open.mockResolvedValue({ stat, read, close })
  if (stage === 'open') fs.open.mockRejectedValueOnce(missing)
  if (stage === 'identity') stat.mockReset().mockRejectedValueOnce(missing)
  if (stage === 'stat') stat.mockReset().mockResolvedValueOnce(info()).mockRejectedValueOnce(missing)
  if (stage === 'read') read.mockRejectedValueOnce(missing)
  if (stage === 'close') close.mockRejectedValueOnce(missing)
  if (stage === 'parse') parse.mockImplementationOnce(() => { throw missing })
  await expect(new AtomicTaskDocumentStore('synthetic-state', parse).read('fixture')).rejects.toThrow('TASK_STATE_UNAVAILABLE')
  expect(close).toHaveBeenCalledTimes(stage === 'open' ? 0 : 1)
  expect(read).toHaveBeenCalledTimes(stage === 'read' || stage === 'parse' || stage === 'close' ? 1 : 0)
  expect(parse).toHaveBeenCalledTimes(stage === 'parse' || stage === 'close' ? 1 : 0)
})

it.each(['stream', 'auxiliary'] as const)('does not select legacy dispatch when observed state vanishes during %s admission', async path => {
  const ctx = new Context()
  const agent = { id: SessionId('fixture') }
  // Only registry identity is consumed before the real store rejects admission.
  ctx.provide('agents', { get: () => agent, roots: () => [agent], currentInitiator: () => agent } as never)
  ctx.provide('sessions', {} as never)
  const runtime = new AdaptiveTaskControlRuntime(ctx, { directory: 'synthetic-state', models: async () => [],
    artifacts: () => { throw new Error('Unexpected artifact access') } })
  const delegate = vi.fn(async function* () { yield { type: 'finish' as const, reason: { kind: 'stop' as const } } })
  fs.lstat.mockResolvedValueOnce({ isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 })
    .mockResolvedValueOnce(info())
  fs.open.mockRejectedValueOnce(Object.assign(new Error('synthetic missing'), { code: 'ENOENT' }))
  try {
    if (path === 'stream') {
      const options = { sessionId: agent.id } as Parameters<AdaptiveTaskControlRuntime['stream']>[0]
      await expect(runtime.stream(options, delegate)[Symbol.asyncIterator]().next()).rejects.toThrow('TASK_STATE_UNAVAILABLE')
    } else await expect(runtime.reserveAuxiliary()).rejects.toThrow('TASK_STATE_UNAVAILABLE')
    expect(delegate).not.toHaveBeenCalled()
    expect(fs.open).toHaveBeenCalledTimes(1)
    expect(fs.lstat).toHaveBeenCalledTimes(2)
  } finally { await ctx.fiber.dispose() }
})

it('fails closed if the state path disappears after open, closing without reading or parsing', async () => {
  const close = vi.fn(async () => {})
  const read = vi.fn()
  const parse = vi.fn((value: unknown) => value)
  fs.lstat.mockResolvedValueOnce({ isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 })
    .mockResolvedValueOnce(info()).mockRejectedValueOnce(Object.assign(new Error('synthetic missing'), { code: 'ENOENT' }))
  fs.open.mockResolvedValue({ stat: vi.fn().mockResolvedValue(info()), read, close })
  await expect(new AtomicTaskDocumentStore('synthetic-state', parse).read('fixture')).rejects.toThrow('TASK_STATE_UNAVAILABLE')
  expect(read).not.toHaveBeenCalled()
  expect(parse).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})
