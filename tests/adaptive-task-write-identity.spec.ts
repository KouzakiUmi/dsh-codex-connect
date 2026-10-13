import { constants } from 'node:fs'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { AtomicTaskDocumentStore } from '../src/adaptive-task-store.ts'
import { TaskDelegationArtifacts } from '../src/adaptive-task-artifacts.ts'

const io = vi.hoisted(() => ({ mkdir: vi.fn(), lstat: vi.fn(), open: vi.fn(), write: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), ...io,
}))
vi.mock('@deepseek-ai/dsh-atomic-write', () => ({
  writeFileAtomic: io.write,
  withFileLock: async (_filename: string, operation: () => Promise<unknown>) => operation(),
}))
vi.mock('../src/adaptive-task-evidence.ts', () => ({ taskSafeDirectories: async () => [] }))
beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

for (const platform of ['win32', 'linux'] as const) for (const kind of ['state', 'artifact']) {
  it.each([
    'unchanged', 'partial reads', 'post-write symlink', 'post-write hardlink', 'replaced before open',
    'large inode mismatch', 'replaced after open', 'wrong content before observation', 'changed during read',
    'growth during read', 'replaced during sync', 'hardlinked during sync', 'mtime changed during sync',
    'ctime changed during sync', 'missing after sync', 'sync failure', 'close failure', 'file close replacement',
    ...(platform === 'linux' ? ['directory open replacement', 'directory sync replacement', 'directory close replacement',
      'directory sync failure', 'directory close failure'] : []),
  ])(`${kind}: ${platform}: %s`, async scenario => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const value = { state: 'synthetic' }
    let expected = Buffer.alloc(0), target = '', observations = 0, identities = 0, readCalls = 0, replaced = false
    const snapshot = (ino = 1n) => ({
      dev: 1n, ino, nlink: 1n, size: BigInt(expected.length), mode: 0o600n, uid: 1000n,
      mtimeNs: 10000000000000000n, ctimeNs: 10000000000000000n,
      isFile: () => true, isSymbolicLink: () => false,
    })
    const missing = Object.assign(new Error('synthetic missing'), { code: 'ENOENT' })
    io.mkdir.mockResolvedValue(undefined)
    io.write.mockImplementation(async (filename: string, text: string) => { target = filename; expected = Buffer.from(text) })
    io.lstat.mockImplementation(async (_filename: string, options?: { bigint: boolean }) => {
      if (!options?.bigint) return { isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 }
      const stage = ++observations
      if (scenario === 'missing after sync' && stage === 3) throw missing
      if (replaced) return snapshot(2n)
      const stat = snapshot()
      if (scenario === 'post-write symlink' && stage === 1) return { ...stat, isFile: () => false, isSymbolicLink: () => true }
      if (scenario === 'post-write hardlink' && stage === 1) return { ...stat, nlink: 2n }
      if (scenario === 'replaced after open' && stage === 2 || scenario === 'replaced during sync' && stage === 3) return snapshot(2n)
      if (scenario === 'large inode mismatch') return snapshot(9007199254740992n)
      return stat
    })
    const close = vi.fn(async () => {
      if (scenario === 'file close replacement') replaced = true
      if (scenario === 'close failure') throw new Error('synthetic close failure')
    })
    const sync = vi.fn(async () => { if (scenario === 'sync failure') throw new Error('synthetic sync failure') })
    const file = {
      stat: vi.fn(async () => {
        const stage = ++identities, stat = snapshot()
        if (scenario === 'replaced before open') return snapshot(2n)
        if (scenario === 'large inode mismatch') return snapshot(9007199254740993n)
        if (stage === 2) {
          if (scenario === 'changed during read' || scenario === 'ctime changed during sync') return { ...stat, ctimeNs: stat.ctimeNs + 1n }
          if (scenario === 'mtime changed during sync') return { ...stat, mtimeNs: stat.mtimeNs + 1n }
          if (scenario === 'hardlinked during sync') return { ...stat, nlink: 2n }
        }
        return stat
      }),
      read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
        readCalls++
        expect(buffer.length).toBe(expected.length + 1)
        const content = scenario === 'wrong content before observation' || scenario === 'changed during read'
          ? Buffer.from(expected.toString().replace('synthetic', 'different'))
          : scenario === 'growth during read' ? Buffer.concat([expected, Buffer.from('extra')]) : expected
        const count = Math.min(length, scenario === 'partial reads' ? 3 : length, Math.max(0, content.length - position))
        content.copy(buffer, offset, position, position + count)
        return { bytesRead: count }
      }), sync, close,
    }
    const directorySync = vi.fn(async () => {
      if (scenario === 'directory sync replacement') replaced = true
      if (scenario === 'directory sync failure') throw new Error('synthetic directory sync failure')
    })
    const directoryClose = vi.fn(async () => {
      if (scenario === 'directory close replacement') replaced = true
      if (scenario === 'directory close failure') throw new Error('synthetic directory close failure')
    })
    io.open.mockImplementation(async (filename: string, flags: number) => {
      if (filename !== target) {
        if (scenario === 'directory open replacement') replaced = true
        expect(flags).toBe(constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
        return { sync: directorySync, close: directoryClose }
      }
      expect(flags & constants.O_RDWR).toBe(constants.O_RDWR)
      return file
    })
    const store = new AtomicTaskDocumentStore('synthetic-state', (document: unknown) => document)
    const artifacts = new TaskDelegationArtifacts('synthetic-artifacts')
    vi.spyOn(store, 'read').mockResolvedValue(undefined)
    vi.spyOn(artifacts, 'get').mockRejectedValue(missing)
    const dispatch = vi.fn()
    const operation = kind === 'state' ? store.update('fixture', () => value) : artifacts.put(value)
    const accepted = scenario === 'unchanged' || scenario === 'partial reads'
    if (accepted) {
      await operation.then(dispatch)
      expect(sync).toHaveBeenCalledOnce()
      expect(directorySync).toHaveBeenCalledTimes(platform === 'win32' ? 0 : 1)
      if (scenario === 'partial reads') expect(readCalls).toBeGreaterThan(2)
    } else {
      await expect(operation.then(dispatch)).rejects.toThrow()
      expect(dispatch).not.toHaveBeenCalled()
      const early = ['post-write symlink', 'post-write hardlink', 'replaced before open', 'large inode mismatch',
        'replaced after open', 'wrong content before observation', 'changed during read', 'growth during read'].includes(scenario)
      expect(sync).toHaveBeenCalledTimes(early ? 0 : 1)
      expect(directorySync).toHaveBeenCalledTimes(platform === 'linux' && !early && scenario !== 'sync failure' ? 1 : 0)
    }
    expect(directoryClose).toHaveBeenCalledTimes(directorySync.mock.calls.length)
    const opened = scenario !== 'post-write symlink' && scenario !== 'post-write hardlink'
    expect(close).toHaveBeenCalledTimes(opened ? 1 : 0)
    expect(io.write).toHaveBeenCalledOnce()
  })
}
