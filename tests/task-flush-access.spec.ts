import { constants } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AtomicTaskDocumentStore } from '../src/adaptive-task-store.ts'
import { TaskDelegationArtifacts } from '../src/adaptive-task-artifacts.ts'

// Actual temporary files/handles; only FlushFileBuffers access requirements are simulated.
const flush = vi.hoisted(() => ({ flags: [] as number[], fail: false, closed: 0 }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const file = await actual.open(...args)
    return new Proxy(file, { get(target, key) {
      if (key === 'sync') return async () => {
        const flags = Number(args[1]); flush.flags.push(flags)
        if ((flags & constants.O_RDWR) !== constants.O_RDWR || flush.fail) {
          throw Object.assign(new Error('fixture: Windows flush requires writable access'), { code: 'EBADF' })
        }
        await target.sync()
      }
      if (key === 'close') return async () => { await target.close(); flush.closed++ }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  } }
})
const roots: string[] = []
beforeEach(() => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
  flush.flags = []; flush.fail = false; flush.closed = 0
})
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'task-flush-access-'))); roots.push(root)
  return root
}
it('finishes a state update with a writable Windows flush handle', async () => {
  const store = new AtomicTaskDocumentStore(await fixture(), value => value)
  await expect(store.update('fixture', () => ({ count: 1 }))).resolves.toEqual({ count: 1 })
  expect(flush.flags).toHaveLength(1); expect(flush.closed).toBe(1)
  await expect(store.read('fixture')).resolves.toEqual({ count: 1 })
})
it('finishes a fresh artifact put with a writable Windows flush handle', async () => {
  const store = new TaskDelegationArtifacts(join(await fixture(), 'artifacts'))
  const digest = await store.put({ result: 'fixture' })
  expect(flush.flags).toHaveLength(1); expect(flush.closed).toBe(1)
  await expect(store.get(digest)).resolves.toEqual({ result: 'fixture' })
})
it.each(['state', 'artifact'])('propagates a %s flush failure and closes the real handle', async kind => {
  const root = await fixture(); flush.fail = true
  const result = kind === 'state'
    ? new AtomicTaskDocumentStore(root, value => value).update('fixture', () => ({ count: 1 }))
    : new TaskDelegationArtifacts(join(root, 'artifacts')).put({ result: 'fixture' })
  await expect(result).rejects.toMatchObject({ code: 'EBADF' })
  expect(flush.flags).toHaveLength(1); expect(flush.closed).toBe(1)
})
