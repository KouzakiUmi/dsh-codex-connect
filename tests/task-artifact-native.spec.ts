import { constants } from 'node:fs'
import { link, mkdir, mkdtemp, open, readFile, realpath, rename, rm, symlink, unlink, utimes, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskDelegationArtifacts } from '../src/adaptive-task-artifacts.ts'
import { taskIdentity } from '../src/adaptive-task-store.ts'

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
    const filename = String(args[0])
    const before = hooks.beforeOpen; hooks.beforeOpen = undefined
    await before?.(filename)
    const file = await actual.open(...args)
    hooks.handles.add(file)
    return new Proxy(file, { get(target, key) {
      if (key === 'read') return async (...readArgs: unknown[]) => {
        if (hooks.partial && typeof readArgs[2] === 'number') readArgs[2] = Math.min(readArgs[2], 2)
        const result: unknown = await Reflect.apply(target.read, target, readArgs)
        const after = hooks.afterRead; hooks.afterRead = undefined
        await after?.(filename)
        return result
      }
      if (key === 'close') return async () => {
        await target.close(); hooks.handles.delete(target)
        const after = hooks.afterClose; hooks.afterClose = undefined
        await after?.(filename)
      }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  } }
})

const roots: string[] = []
afterEach(async () => {
  hooks.beforeOpen = hooks.afterRead = hooks.afterClose = undefined
  hooks.partial = false
  try { expect(hooks.handles.size).toBe(0) }
  finally {
    for (const handle of hooks.handles) await handle.close()
    hooks.handles.clear()
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'task-artifact-native-')))
  roots.push(root)
  const directory = join(root, 'artifacts')
  await mkdir(directory, { mode: 0o700 })
  const value = { result: 'native fixture 中文' }, text = JSON.stringify(value), digest = taskIdentity(text)
  const filename = join(directory, digest + '.json'), outside = join(root, 'outside.json')
  await writeFile(filename, text, { mode: 0o600 })
  await writeFile(outside, text, { mode: 0o600 })
  return { root, directory, filename, outside, value, text, digest, store: new TaskDelegationArtifacts(directory) }
}

it('reads and reuses an ordinary artifact on the actual filesystem', async () => {
  const f = await fixture()
  await expect(f.store.get(f.digest)).resolves.toEqual(f.value)
  await expect(f.store.put(f.value)).resolves.toBe(f.digest)
})

it('finishes bounded partial native reads without truncating multibyte content', async () => {
  const f = await fixture(); hooks.partial = true
  await expect(f.store.get(f.digest)).resolves.toEqual(f.value)
})

it.runIf(process.platform !== 'win32')('preserves read-only private POSIX artifact reads', async () => {
  const f = await fixture(); await chmod(f.filename, 0o400)
  await expect(f.store.get(f.digest)).resolves.toEqual(f.value)
})

it.each(['read', 'reuse'])('rejects an actual final-component symlink during %s without changing its target', async operation => {
  const f = await fixture(); await unlink(f.filename); await symlink(f.outside, f.filename, 'file')
  await expect(operation === 'read' ? f.store.get(f.digest) : f.store.put(f.value)).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
  expect(await readFile(f.outside, 'utf8')).toBe(f.text)
})

it.runIf(process.platform === 'win32')('demonstrates that native Windows ordinary open follows the matching fixture link', async () => {
  const f = await fixture(); await unlink(f.filename); await symlink(f.outside, f.filename, 'file')
  // This positive primitive control is not the protected artifact reader.
  const file = await open(f.filename, constants.O_RDONLY)
  try { expect(await file.readFile('utf8')).toBe(f.text) }
  finally { await file.close() }
})

it.each(['read', 'reuse'])('rejects an actual hardlink during %s without changing the bytes', async operation => {
  const f = await fixture(); await link(f.filename, join(f.root, 'hardlink.json'))
  await expect(operation === 'read' ? f.store.get(f.digest) : f.store.put(f.value)).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
  expect(await readFile(f.filename, 'utf8')).toBe(f.text)
})

it.each(['beforeOpen', 'afterRead', 'afterClose'] as const)('rejects an actual regular replacement at %s even with matching bytes', async stage => {
  const f = await fixture()
  hooks[stage] = async filename => {
    await rename(filename, filename + '.old')
    await writeFile(filename, f.text, { mode: 0o600 })
  }
  await expect(f.store.get(f.digest)).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
})

it.each(['read', 'reuse'])('does not reinterpret observed-file disappearance as permission to create during %s', async operation => {
  const f = await fixture(); hooks.beforeOpen = filename => unlink(filename)
  await expect(operation === 'read' ? f.store.get(f.digest) : f.store.put(f.value)).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
  await expect(readFile(f.filename)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects an artifact directory changed to a native link during the read', async () => {
  const f = await fixture()
  hooks.beforeOpen = async () => {
    await rename(f.directory, f.directory + '.old')
    await symlink(f.directory + '.old', f.directory, process.platform === 'win32' ? 'junction' : 'dir')
  }
  await expect(f.store.get(f.digest)).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
})

it('retains initial ENOENT without creating an artifact', async () => {
  const f = await fixture(); await unlink(f.filename)
  await expect(f.store.get(f.digest)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readFile(f.filename)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects an in-place metadata change after a real read', async () => {
  const f = await fixture(); hooks.afterRead = filename => utimes(filename, new Date(0), new Date(0))
  await expect(f.store.get(f.digest)).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
})

it('fails closed after a real close followed by an I/O failure', async () => {
  const f = await fixture()
  hooks.afterClose = async () => { throw Object.assign(new Error('fixture close boundary'), { code: 'EIO' }) }
  await expect(f.store.get(f.digest)).rejects.toThrow('TASK_ARTIFACT_UNSAFE')
})
