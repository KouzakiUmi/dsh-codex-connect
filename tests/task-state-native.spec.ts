import { mkdtemp, realpath, rm, mkdir, writeFile, rename, unlink, readFile, link, symlink, chmod, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AtomicTaskDocumentStore, taskIdentity } from '../src/adaptive-task-store.ts'

const hooks = vi.hoisted(() => ({
  beforeOpen: undefined as ((filename: string) => Promise<void>) | undefined,
  afterRead: undefined as ((filename: string) => Promise<void>) | undefined,
  afterClose: undefined as ((filename: string) => Promise<void>) | undefined,
  partial: false,
  handles: new Set<{ close(): Promise<void> }>(),
}))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const before = hooks.beforeOpen; hooks.beforeOpen = undefined
    await before?.(String(args[0]))
    const file = await actual.open(...args); hooks.handles.add(file)
    return new Proxy(file, { get(target, key) {
      if (key === 'read') return async (...readArgs: unknown[]) => {
        if (hooks.partial && typeof readArgs[2] === 'number') readArgs[2] = Math.min(readArgs[2], 2)
        const result: unknown = await Reflect.apply(target.read, target, readArgs)
        const after = hooks.afterRead; hooks.afterRead = undefined
        await after?.(String(args[0]))
        return result
      }
      if (key === 'close') return async () => {
        await target.close(); hooks.handles.delete(target)
        const after = hooks.afterClose; hooks.afterClose = undefined
        await after?.(String(args[0]))
      }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  } }
})
const roots: string[] = []
afterEach(async () => {
  hooks.beforeOpen = hooks.afterRead = hooks.afterClose = undefined; hooks.partial = false
  try { expect(hooks.handles.size).toBe(0) }
  finally {
    for (const handle of hooks.handles) await handle.close()
    hooks.handles.clear()
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'task-state-native-'))); roots.push(root)
  const directory = join(root, 'state'); await mkdir(directory, { mode: 0o700 })
  const filename = join(directory, taskIdentity('fixture') + '.json'), text = JSON.stringify({ count: 1 })
  await writeFile(filename, text, { mode: 0o600 })
  const decode = vi.fn((value: unknown) => value)
  return { root, directory, filename, text, decode, store: new AtomicTaskDocumentStore(directory, decode) }
}
it('reads ordinary pre-existing state on the native filesystem', async () => {
  const f = await fixture()
  await expect(f.store.read('fixture')).resolves.toEqual({ count: 1 })
})
it.each(['beforeOpen', 'afterRead', 'afterClose'] as const)('rejects a same-content regular replacement at %s on the native filesystem', async stage => {
  const f = await fixture()
  hooks[stage] = async filename => { await rename(filename, filename + '.old'); await writeFile(filename, f.text, { mode: 0o600 }) }
  await expect(f.store.read('fixture')).rejects.toThrow('TASK_STATE_UNSAFE')
  expect(f.decode).not.toHaveBeenCalled()
})
it('does not treat an observed state disappearing before open as initial absence', async () => {
  const f = await fixture(); hooks.beforeOpen = filename => unlink(filename)
  await expect(f.store.read('fixture')).rejects.toThrow('TASK_STATE_UNSAFE')
})
it('does not invoke an update callback or replace an observed state after disappearance', async () => {
  const f = await fixture(); hooks.beforeOpen = filename => unlink(filename)
  const change = vi.fn(() => ({ count: 2 }))
  await expect(f.store.update('fixture', change)).rejects.toThrow('TASK_STATE_UNSAFE')
  expect(change).not.toHaveBeenCalled()
  await expect(readFile(f.filename)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('finishes bounded native partial reads including multibyte JSON', async () => {
  const f = await fixture(), value = { count: 1, text: '中文' }
  await writeFile(f.filename, JSON.stringify(value)); hooks.partial = true
  await expect(f.store.read('fixture')).resolves.toEqual(value)
})
it.runIf(process.platform !== 'win32')('preserves private POSIX 0400 state reads', async () => {
  const f = await fixture(); await chmod(f.filename, 0o400)
  await expect(f.store.read('fixture')).resolves.toEqual({ count: 1 })
})
it.each(['symlink', 'hardlink'])('rejects a real %s before decoding or running an update callback', async kind => {
  const f = await fixture(), outside = join(f.root, 'outside.json')
  await writeFile(outside, f.text, { mode: 0o600 })
  if (kind === 'symlink') { await unlink(f.filename); await symlink(outside, f.filename, 'file') }
  else await link(f.filename, join(f.root, 'linked.json'))
  await expect(f.store.read('fixture')).rejects.toThrow('TASK_STATE_UNSAFE')
  const change = vi.fn(() => ({ count: 2 }))
  await expect(f.store.update('fixture', change)).rejects.toThrow('TASK_STATE_UNSAFE')
  expect(change).not.toHaveBeenCalled(); expect(f.decode).not.toHaveBeenCalled()
  expect(await readFile(outside, 'utf8')).toBe(f.text)
})
it('rejects a real directory replaced by a link before decoding', async () => {
  const f = await fixture()
  hooks.beforeOpen = async () => {
    await rename(f.directory, f.directory + '.old')
    await symlink(f.directory + '.old', f.directory, process.platform === 'win32' ? 'junction' : 'dir')
  }
  await expect(f.store.read('fixture')).rejects.toThrow('TASK_STATE_UNSAFE')
  expect(f.decode).not.toHaveBeenCalled()
})
it('rejects a real metadata change after reading and closes the handle', async () => {
  const f = await fixture(); hooks.afterRead = filename => utimes(filename, new Date(0), new Date(0))
  await expect(f.store.read('fixture')).rejects.toThrow('TASK_STATE_UNSAFE')
  expect(f.decode).not.toHaveBeenCalled()
})
it('rejects an added hardlink after reading and closes the handle', async () => {
  const f = await fixture(); hooks.afterRead = filename => link(filename, join(f.root, 'late-link.json'))
  await expect(f.store.read('fixture')).rejects.toThrow('TASK_STATE_UNSAFE')
  expect(f.decode).not.toHaveBeenCalled()
})
it('propagates a close-boundary I/O failure without decoding', async () => {
  const f = await fixture(); hooks.afterClose = async () => { throw Object.assign(new Error('fixture close boundary'), { code: 'EIO' }) }
  await expect(f.store.read('fixture')).rejects.toThrow('TASK_STATE_UNAVAILABLE')
  expect(f.decode).not.toHaveBeenCalled()
})
it.each(['file', 'directory'])('retains initial missing %s as undefined without creating state', async kind => {
  const f = await fixture(); await rm(kind === 'file' ? f.filename : f.directory, { recursive: true })
  await expect(f.store.read('fixture')).resolves.toBeUndefined()
  expect(f.decode).not.toHaveBeenCalled()
  await expect(readFile(f.filename)).rejects.toMatchObject({ code: 'ENOENT' })
})
