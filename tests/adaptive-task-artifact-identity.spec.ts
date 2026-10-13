import { constants } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskDelegationArtifacts } from '../src/adaptive-task-artifacts.ts'
import { taskIdentity } from '../src/adaptive-task-store.ts'

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

for (const platform of ['win32', 'linux'] as const) for (const operation of ['get', 'reuse'] as const) {
  it.each([
    'unchanged', 'partial reads', 'initial symlink', 'initial hardlink', 'replaced before open',
    'large inode mismatch', 'replaced during read', 'linked during read', 'missing during read',
    'replaced during close', 'missing during close', 'hardlinked during read', 'ctime changed during read',
    'wrong digest', 'read failure', 'post-stat failure', 'close failure',
    ...(operation === 'reuse' ? ['replacement after get', 'symlink after get', 'missing after get', 'flush failure'] : []),
  ])(`artifact ${operation}: ${platform}: %s`, async scenario => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const value = { result: 'synthetic' }, text = JSON.stringify(value), digest = taskIdentity(text)
    const target = join('synthetic-artifacts', digest + '.json')
    const snapshot = (ino = 9007199254740992n) => ({
      dev: 1n, ino, nlink: 1n, size: BigInt(Buffer.byteLength(text)), mode: 0o600n, uid: 1000n,
      mtimeNs: 10000000000000000n, ctimeNs: 10000000000000000n,
      isFile: () => true, isSymbolicLink: () => false,
    })
    let current = snapshot(), missing = false, observations = 0, opened = 0
    const enoent = Object.assign(new Error('synthetic missing'), { code: 'ENOENT' })
    if (scenario === 'initial symlink') current = { ...current, isFile: () => false, isSymbolicLink: () => true }
    if (scenario === 'initial hardlink') current.nlink = 2n
    const closes: ReturnType<typeof vi.fn>[] = [], flush = vi.fn(async () => {
      if (scenario === 'flush failure') throw new Error('synthetic flush failure')
    })
    io.mkdir.mockResolvedValue(undefined)
    io.lstat.mockImplementation(async (filename: string) => {
      if (filename !== target) return { isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 }
      observations++
      if (observations === 3) {
        if (scenario === 'replacement after get') current = snapshot(2n)
        if (scenario === 'symlink after get') current = { ...current, isFile: () => false, isSymbolicLink: () => true }
        if (scenario === 'missing after get') missing = true
      }
      if (missing) throw enoent
      return { ...current }
    })
    io.open.mockImplementation(async (filename: string, flags: number) => {
      if (filename !== target) return { sync: vi.fn(async () => {}), close: vi.fn(async () => {}) }
      if (scenario === 'replaced before open' || scenario === 'large inode mismatch') current = snapshot(9007199254740993n)
      const writable = (flags & constants.O_RDWR) === constants.O_RDWR
      opened++
      const held = { ...current }
      const content = Buffer.from(scenario === 'wrong digest' || scenario === 'replacement after get' && writable
        ? text.replace('synthetic', 'different') : text)
      const close = vi.fn(async () => {
        if (!writable && scenario === 'replaced during close') current = snapshot(2n)
        if (!writable && scenario === 'missing during close') missing = true
        if (scenario === 'close failure') throw new Error('synthetic close failure')
      })
      closes.push(close)
      let reads = 0
      return {
        stat: vi.fn(async () => {
          if (reads && scenario === 'post-stat failure') throw new Error('synthetic post-stat failure')
          return { ...held }
        }),
        read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
          reads++
          expect(buffer.length).toBeLessThanOrEqual(2 * 1024 * 1024 + 1)
          if (scenario === 'read failure') throw new Error('synthetic read failure')
          if (scenario === 'replaced during read') current = snapshot(2n)
          if (scenario === 'linked during read') current = { ...current, isFile: () => false, isSymbolicLink: () => true }
          if (scenario === 'missing during read') missing = true
          if (scenario === 'hardlinked during read') held.nlink = 2n
          if (scenario === 'ctime changed during read') held.ctimeNs++
          const count = Math.min(length, scenario === 'partial reads' ? 3 : length, Math.max(0, content.length - position))
          content.copy(buffer, offset, position, position + count)
          return { bytesRead: count }
        }), sync: flush, close,
      }
    })
    const store = new TaskDelegationArtifacts('synthetic-artifacts'), consume = vi.fn()
    const result = operation === 'get' ? store.get(digest) : store.put(value)
    if (scenario === 'unchanged' || scenario === 'partial reads') {
      const accepted = await result.then(answer => { consume(); return answer })
      expect(accepted).toEqual(operation === 'get' ? value : digest)
      expect(flush).toHaveBeenCalledTimes(operation === 'reuse' ? 1 : 0)
    } else {
      await expect(result.then(consume)).rejects.toThrow()
      expect(consume).not.toHaveBeenCalled()
    }
    expect(io.write).not.toHaveBeenCalled() // Observed disappearance is not initial absence.
    expect(closes).toHaveLength(opened)
    for (const close of closes) expect(close).toHaveBeenCalledOnce()
  })
}
