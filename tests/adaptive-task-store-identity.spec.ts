import { Buffer } from 'node:buffer'
import { beforeEach, expect, it, vi } from 'vitest'
import { AtomicTaskDocumentStore } from '../src/adaptive-task-store.ts'

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
