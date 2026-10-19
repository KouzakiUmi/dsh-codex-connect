import { constants } from 'node:fs'
import { chmod, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AtomicTaskDocumentStore, taskIdentity } from '../src/adaptive-task-store.ts'
import { TaskDelegationArtifacts } from '../src/adaptive-task-artifacts.ts'

// No fs/process mocks: this suite is also explicitly run by the native Windows CI job.
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'task-flush-native-'))); roots.push(root)
  return root
}
it.runIf(process.platform === 'win32')('reproduces native Windows read-only sync failure while writable sync succeeds', async () => {
  const filename = join(await fixture(), 'primitive.json')
  await writeFile(filename, '{}', { mode: 0o600 })
  const readonly = await open(filename, constants.O_RDONLY)
  try { await expect(readonly.sync()).rejects.toHaveProperty('code') }
  finally { await readonly.close() }
  const writable = await open(filename, constants.O_RDWR)
  try { await expect(writable.sync()).resolves.toBeUndefined() }
  finally { await writable.close() }
  expect(await readFile(filename, 'utf8')).toBe('{}')
})
it('commits and rereads two state updates on the native filesystem', async () => {
  const root = await fixture(), store = new AtomicTaskDocumentStore<{ count: number }>(root, value => value as { count: number })
  await expect(store.update('fixture', () => ({ count: 1 }))).resolves.toEqual({ count: 1 })
  await expect(store.update('fixture', current => ({ count: current!.count + 1 }))).resolves.toEqual({ count: 2 })
  await expect(new AtomicTaskDocumentStore(root, value => value).read('fixture')).resolves.toEqual({ count: 2 })
})
it('creates, rereads and reuses a new artifact on the native filesystem', async () => {
  const store = new TaskDelegationArtifacts(join(await fixture(), 'artifacts'))
  const digest = await store.put({ result: 'native flush 中文' })
  await expect(store.get(digest)).resolves.toEqual({ result: 'native flush 中文' })
  await expect(store.put({ result: 'native flush 中文' })).resolves.toBe(digest)
})
it.runIf(process.platform !== 'win32')('preserves read-only private POSIX state reads and artifact reuse', async () => {
  const root = await fixture(), store = new AtomicTaskDocumentStore(root, value => value)
  await store.update('fixture', () => ({ count: 1 }))
  await chmod(join(root, taskIdentity('fixture') + '.json'), 0o400)
  await expect(store.read('fixture')).resolves.toEqual({ count: 1 })
  const artifacts = new TaskDelegationArtifacts(join(root, 'artifacts')), value = { result: 'readonly' }
  const digest = await artifacts.put(value)
  await chmod(join(root, 'artifacts', digest + '.json'), 0o400)
  await expect(artifacts.get(digest)).resolves.toEqual(value)
  await expect(artifacts.put(value)).resolves.toBe(digest)
})
