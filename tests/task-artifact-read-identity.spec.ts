import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskDelegationArtifacts } from '../src/adaptive-task-artifacts.ts'
import { taskIdentity } from '../src/adaptive-task-store.ts'

const fixture = vi.hoisted(() => ({ linked: true, text: '{"result":"matching external bytes"}',
  pathIno: 10n, handleIno: 10n, handleLinks: 1n,
  read: vi.fn(), close: vi.fn(), write: vi.fn() }))
vi.mock('../src/adaptive-task-evidence.ts', () => ({ taskSafeDirectories: async () => {} }))
vi.mock('@deepseek-ai/dsh-atomic-write', () => ({
  withFileLock: async (_filename: string, operation: () => Promise<void>) => operation(),
  writeFileAtomic: (...args: unknown[]) => fixture.write(...args),
}))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const stat = (directory = false, link = false, bigint = false, handle = false) => ({
    isDirectory: () => directory, isFile: () => !directory && !link, isSymbolicLink: () => link,
    dev: bigint ? 1n : 1,
    ino: bigint ? (handle ? fixture.handleIno : fixture.pathIno) : Number(handle ? fixture.handleIno : fixture.pathIno),
    nlink: bigint ? (handle ? fixture.handleLinks : 1n) : Number(handle ? fixture.handleLinks : 1n),
    mode: bigint ? (directory ? 0o700n : 0o600n) : (directory ? 0o700 : 0o600),
    uid: bigint ? 1n : 1, gid: bigint ? 1n : 1,
    size: bigint ? BigInt(Buffer.byteLength(fixture.text)) : Buffer.byteLength(fixture.text),
    mtimeMs: 1, ctimeMs: 1, mtimeNs: 1n, ctimeNs: 1n,
  })
  return { ...actual,
    mkdir: async () => undefined,
    lstat: async (filename: string, options?: { bigint?: boolean }) => stat(!filename.endsWith('.json'), filename.endsWith('.json') && fixture.linked, options?.bigint),
    // Model Windows: opening a final-component link follows its target; O_NOFOLLOW cannot protect this call.
    open: async () => ({ stat: async (options?: { bigint?: boolean }) => stat(false, false, options?.bigint, true), read: (...args: unknown[]) => fixture.read(...args),
      sync: async () => {}, close: (...args: unknown[]) => fixture.close(...args) }),
  }
})

beforeEach(() => {
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  fixture.linked = true
  fixture.pathIno = fixture.handleIno = 10n
  fixture.handleLinks = 1n
  fixture.write.mockReset().mockResolvedValue(undefined)
  fixture.close.mockReset().mockResolvedValue(undefined)
  fixture.read.mockReset().mockImplementation(async (buffer: Buffer, offset: number, length: number, position: number) => {
    const bytes = Buffer.from(fixture.text)
    const bytesRead = bytes.copy(buffer, offset, position, Math.min(position + length, bytes.length))
    return { bytesRead, buffer }
  })
})
afterEach(() => { vi.unstubAllGlobals() })

it.each(['read', 'reuse'])('rejects a Windows artifact link before accepting matching outside bytes during %s', async operation => {
  const store = new TaskDelegationArtifacts('/fixture/private/artifacts')
  const value = JSON.parse(fixture.text) as unknown
  const digest = taskIdentity(fixture.text)
  await expect(operation === 'read' ? store.get(digest) : store.put(value)).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
  expect(fixture.read).not.toHaveBeenCalled()
  expect(fixture.write).not.toHaveBeenCalled()
})

it('keeps the exact-content regular-file positive control readable', async () => {
  fixture.linked = false
  const store = new TaskDelegationArtifacts('/fixture/private/artifacts')
  await expect(store.get(taskIdentity(fixture.text))).resolves.toEqual(JSON.parse(fixture.text))
  expect(fixture.close).toHaveBeenCalledOnce()
})

it('rejects adjacent native inode identities that alias after conversion to Number', async () => {
  fixture.linked = false
  fixture.pathIno = 2n ** 53n
  fixture.handleIno = fixture.pathIno + 1n
  expect(Number(fixture.pathIno)).toBe(Number(fixture.handleIno))
  const store = new TaskDelegationArtifacts('/fixture/private/artifacts')
  await expect(store.get(taskIdentity(fixture.text))).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
  expect(fixture.read).not.toHaveBeenCalled()
  expect(fixture.close).toHaveBeenCalledOnce()
})

it.each(['path replacement', 'new hardlink', 'post-close link'])('rejects %s during a Windows reuse without rewriting it', async scenario => {
  fixture.linked = false
  const originalRead = fixture.read.getMockImplementation()!
  if (scenario === 'post-close link') fixture.close.mockImplementation(async () => { fixture.linked = true })
  else fixture.read.mockImplementationOnce(async (...args: unknown[]) => {
    const result: unknown = await originalRead(...args)
    if (scenario === 'path replacement') fixture.pathIno++
    else fixture.handleLinks = 2n
    return result
  })
  const store = new TaskDelegationArtifacts('/fixture/private/artifacts')
  await expect(store.put(JSON.parse(fixture.text) as unknown)).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
  expect(fixture.write).not.toHaveBeenCalled()
  expect(fixture.close).toHaveBeenCalledOnce()
})
