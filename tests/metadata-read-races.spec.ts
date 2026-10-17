import { execFileSync } from 'node:child_process'
import { constants, type BigIntStats } from 'node:fs'
import { appendFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, symlink, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDshInstallationMetadata, readInstalledPluginVersion, readPluginDependencyVersion } from '../src/installation-metadata.ts'

interface OpenedFile {
  filename: string
  native: FileHandle
  stat: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  closed: boolean
  bytesRead: number
}

const io = vi.hoisted(() => ({
  afterLstat: undefined as ((filename: string) => Promise<void>) | undefined,
  afterFstat: undefined as ((filename: string, metadata: BigIntStats) => Promise<BigIntStats>) | undefined,
  beforeRead: undefined as ((filename: string, index: number) => Promise<void>) | undefined,
  files: [] as OpenedFile[],
  failStat: new Set<string>(),
  failRead: new Set<string>(),
  failClose: new Set<string>(),
  failPostCheck: new Set<string>(),
  forbidOpen: new Set<string>(),
  requireNonblock: new Set<string>(),
  chunkSize: undefined as number | undefined,
}))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    realpath: vi.fn(actual.realpath),
    // An unbounded path-read fallback must never be used, including on failure.
    readFile: vi.fn(async () => { throw new Error('unbounded manifest read') }),
    lstat: vi.fn(async (...args: Parameters<typeof actual.lstat>) => {
      const filename = String(args[0])
      if (io.failPostCheck.has(filename) && io.files.some(file => file.filename === filename)) {
        throw Object.assign(new Error('fixture disappeared after open'), { code: 'ENOENT' })
      }
      const metadata = await actual.lstat(...args)
      await io.afterLstat?.(filename)
      return metadata
    }),
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      const filename = String(args[0])
      if (io.forbidOpen.has(filename)) throw new Error('forbidden fixture open')
      // Refuse a regressed blocking open in the fixture itself, rather than
      // hanging a test worker on a real FIFO with no writer.
      if (io.requireNonblock.has(filename) && (Number(args[1]) & constants.O_NONBLOCK) === 0) {
        throw new Error('blocking FIFO open')
      }
      const native = await actual.open(...args)
      let readIndex = 0
      const file: OpenedFile = {
        filename, native, closed: false, bytesRead: 0,
        stat: vi.fn(async (options: { bigint: true }) => {
          if (io.failStat.has(filename)) throw new Error('fixture fstat failure')
          const metadata = await native.stat(options)
          return io.afterFstat === undefined ? metadata : io.afterFstat(filename, metadata)
        }),
        read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
          await io.beforeRead?.(filename, readIndex++)
          if (io.failRead.has(filename)) throw Object.assign(new Error('fixture read failure'), { code: 'ENOENT' })
          const result = await native.read(buffer, offset, Math.min(length, io.chunkSize ?? length), position)
          file.bytesRead += result.bytesRead
          return result
        }),
        close: vi.fn(async () => {
          await native.close()
          file.closed = true
          if (io.failClose.has(filename)) throw new Error('fixture close failure')
        }),
      }
      io.files.push(file)
      return { stat: file.stat, read: file.read, close: file.close } as unknown as FileHandle
    }),
  }
})

const LIMIT = 256 * 1024
const VERSION = '0.2.0-rc.2'
const PLUGIN = 'dsh-codex-connect'
const PEER = '@deepseek-ai/dsh-llm'
const roots: string[] = []

afterEach(async () => {
  try {
    expect(vi.mocked(readFile)).not.toHaveBeenCalled()
    for (const file of io.files) {
      expect(file.close).toHaveBeenCalledTimes(1)
      expect(file.closed).toBe(true)
    }
  } finally {
    // Even a failed regression assertion must not leave our fixture fds open.
    for (const file of io.files) if (!file.closed) await file.native.close()
    io.files.length = 0
    io.afterLstat = undefined; io.afterFstat = undefined; io.beforeRead = undefined
    io.chunkSize = undefined
    for (const set of [io.failStat, io.failRead, io.failClose, io.failPostCheck, io.forbidOpen, io.requireNonblock]) set.clear()
    vi.mocked(open).mockClear(); vi.mocked(lstat).mockClear(); vi.mocked(readFile).mockClear(); vi.mocked(realpath).mockClear()
    for (const root of roots.splice(0)) {
      expect(await realpath(root)).toBe(root)
      await rm(root, { recursive: true, force: true })
    }
  }
})

async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-connect-metadata-race-')))
  roots.push(root)
  return root
}

async function manifest(filename: string, name = PLUGIN, size?: number): Promise<void> {
  await mkdir(dirname(filename), { recursive: true })
  const json = JSON.stringify({ name, version: VERSION })
  await writeFile(filename, json + ' '.repeat(size === undefined ? 0 : size - Buffer.byteLength(json)))
}

async function checkedFixtureEntry(filename: string): Promise<string> {
  const root = roots.find(root => filename.startsWith(`${root}${sep}`))
  if (root === undefined || resolve(filename) !== filename) throw new Error('not an exact owned fixture path')
  const parent = await realpath(dirname(filename))
  if (parent !== root && !parent.startsWith(`${root}${sep}`)) throw new Error('fixture parent escaped')
  return join(parent, basename(filename))
}

async function removeEntry(filename: string): Promise<void> {
  await rm(await checkedFixtureEntry(filename))
}

async function replaceEntry(source: string, target: string): Promise<void> {
  const checkedSource = await checkedFixtureEntry(source)
  const checkedTarget = await checkedFixtureEntry(target)
  await rename(checkedSource, checkedTarget)
}

function afterFirstCheck(filename: string, action: () => Promise<void>): void {
  io.afterLstat = async checked => {
    if (checked !== filename) return
    io.afterLstat = undefined
    await action()
  }
}

function opened(filename: string): OpenedFile {
  const file = io.files.find(file => file.filename === filename)
  expect(file).toBeDefined()
  return file!
}

function expectNotOpened(...filenames: string[]): void {
  for (const filename of filenames) expect(vi.mocked(open).mock.calls.map(call => String(call[0]))).not.toContain(filename)
}

function changedStat(metadata: BigIntStats, fields: Partial<BigIntStats>): BigIntStats {
  return Object.assign(Object.create(Object.getPrototypeOf(metadata)), metadata, fields) as BigIntStats
}

describe('same-object manifest reads', () => {
  it.each([
    { name: PLUGIN, read: readInstalledPluginVersion },
    { name: '@deepseek-ai/dsh', read: readDshInstallationMetadata },
  ])('rejects a $name root leaf changed to a symlink after the original lstat', async ({ name, read }) => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    const target = join(root, 'unrelated.json')
    await manifest(leaf, name); await manifest(target, name)
    io.forbidOpen.add(target)
    afterFirstCheck(leaf, async () => { await removeEntry(leaf); await symlink(target, leaf) })
    expect(await read(leaf)).toBeUndefined()
    expect(io.afterLstat).toBeUndefined()
    expect(io.files.every(file => file.read.mock.calls.length === 0)).toBe(true)
    expect(vi.mocked(realpath).mock.calls.map(call => String(call[0]))).not.toContain(leaf)
    expectNotOpened(target)
  })

  it('rejects a peer replaced by a symlink without trying the other explicit root', async () => {
    const root = await fixture()
    const plugin = join(root, 'node_modules/dsh-codex-connect/package.json')
    const leaf = join(dirname(plugin), 'node_modules', PEER, 'package.json')
    const fallback = join(root, 'node_modules', PEER, 'package.json')
    const target = join(root, 'unrelated.json')
    await manifest(plugin); await manifest(leaf, PEER); await manifest(fallback, PEER); await manifest(target, PEER)
    io.forbidOpen.add(fallback); io.forbidOpen.add(target)
    afterFirstCheck(leaf, async () => { await removeEntry(leaf); await symlink(target, leaf) })
    expect(await readPluginDependencyVersion(PEER, plugin)).toBeUndefined()
    expect(io.files.filter(file => file.filename === leaf).every(file => file.read.mock.calls.length === 0)).toBe(true)
    expectNotOpened(target, fallback)
  })

  it.skipIf(process.platform === 'win32' || !constants.O_NONBLOCK || !constants.O_NOFOLLOW)('opens a raced FIFO nonblocking and rejects/closes it before reading', async () => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    await manifest(leaf)
    io.requireNonblock.add(leaf)
    afterFirstCheck(leaf, async () => { await removeEntry(leaf); execFileSync('/usr/bin/mkfifo', [leaf]) })
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    const flags = Number(vi.mocked(open).mock.calls.find(call => String(call[0]) === leaf)?.[1])
    expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW)
    expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK)
    expect(flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC)).toBe(0)
    expect(opened(leaf).read).not.toHaveBeenCalled()
  })

  it('rejects a directory substituted after the first check without reading it', async () => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    await manifest(leaf)
    afterFirstCheck(leaf, async () => { await removeEntry(leaf); await mkdir(leaf) })
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(io.files.every(file => file.read.mock.calls.length === 0)).toBe(true)
  })

  it('binds the initial leaf identity to the opened object, even for an identical regular replacement', async () => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    const replacement = join(root, 'replacement.json')
    await manifest(leaf); await manifest(replacement)
    afterFirstCheck(leaf, () => replaceEntry(replacement, leaf))
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(opened(leaf).read).not.toHaveBeenCalled()
  })

  it('rejects a directory-link retarget between original lstat and canonical directory resolution', async () => {
    const root = await fixture()
    const first = join(root, 'first/package.json')
    const second = join(root, 'second/package.json')
    const logical = join(root, 'logical')
    await manifest(first); await manifest(second)
    await symlink(dirname(first), logical, process.platform === 'win32' ? 'junction' : 'dir')
    const leaf = join(logical, 'package.json')
    afterFirstCheck(leaf, async () => {
      await removeEntry(logical)
      await symlink(dirname(second), logical, process.platform === 'win32' ? 'junction' : 'dir')
    })
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(opened(second).read).not.toHaveBeenCalled()
  })

  it('rejects a logical directory retarget after canonicalization even if the physical descriptor still matches', async () => {
    const root = await fixture()
    const first = join(root, 'first/package.json')
    const second = join(root, 'second/package.json')
    const logical = join(root, 'logical')
    await manifest(first); await manifest(second)
    await symlink(dirname(first), logical, process.platform === 'win32' ? 'junction' : 'dir')
    io.afterFstat = async (filename, metadata) => {
      if (filename === first) {
        await removeEntry(logical)
        await symlink(dirname(second), logical, process.platform === 'win32' ? 'junction' : 'dir')
      }
      return metadata
    }
    expect(await readInstalledPluginVersion(join(logical, 'package.json'))).toBeUndefined()
    expect(opened(first).read).not.toHaveBeenCalled()
  })

  it.each(['type', 'device', 'inode', 'zero identity'] as const)('rejects descriptor %s mismatch before any content read', async kind => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    await manifest(leaf)
    io.afterFstat = async (_filename, metadata) => changedStat(metadata, kind === 'type' ? { isFile: () => false }
      : kind === 'device' ? { dev: metadata.dev + 1n } : { ino: kind === 'inode' ? metadata.ino + 1n : 0n })
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(opened(leaf).read).not.toHaveBeenCalled()
  })

  it('rechecks the leaf after open, rejecting a symlink even when the descriptor still has the initial identity', async () => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    const original = join(root, 'original.json')
    await manifest(leaf)
    io.afterFstat = async (filename, metadata) => {
      if (filename === leaf) {
        await replaceEntry(leaf, original)
        await symlink(original, leaf)
      }
      return metadata
    }
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(opened(leaf).read).not.toHaveBeenCalled()
  })

  it('reads the already validated object rather than reopening a later replacement', async () => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    const replacement = join(root, 'replacement.json')
    const displaced = join(root, 'opened-original.json')
    await manifest(leaf)
    await writeFile(replacement, JSON.stringify({ name: PLUGIN, version: '0.1.7-rc.1' }))
    // Windows need not allow replacing an open destination in one rename. Move
    // that object aside, then install a distinct file at the original path.
    // The read must still use the original descriptor on every platform.
    let mutation: Promise<void> | undefined
    io.beforeRead = async (filename, index) => {
      if (filename !== leaf || index !== 0) return
      mutation = (async () => {
        await replaceEntry(leaf, displaced)
        await replaceEntry(replacement, leaf)
      })()
      await mutation
    }
    const result = await readInstalledPluginVersion(leaf)
    expect(mutation).toBeDefined()
    // Surface fixture mutation errors outside the production fail-closed catch.
    await mutation
    expect(result).toBe(VERSION)
    expect(vi.mocked(open).mock.calls).toHaveLength(1)
  })

  it.each(['fstat', 'post-open lstat', 'read', 'parse', 'name', 'version', 'close'] as const)('closes the descriptor on %s failure', async failure => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    await manifest(leaf)
    if (failure === 'fstat') io.failStat.add(leaf)
    if (failure === 'post-open lstat') io.failPostCheck.add(leaf)
    if (failure === 'read') io.failRead.add(leaf)
    if (failure === 'parse') await writeFile(leaf, '{')
    if (failure === 'name') await manifest(leaf, 'unrelated')
    if (failure === 'version') await writeFile(leaf, JSON.stringify({ name: PLUGIN, version: 'not-a-version' }))
    if (failure === 'close') io.failClose.add(leaf)
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(opened(leaf).close).toHaveBeenCalledTimes(1)
  })

  it.each(['disappear after check', 'post-open lstat', 'descriptor read'] as const)('does not use another dependency root on %s ENOENT', async failure => {
    const root = await fixture()
    const plugin = join(root, 'node_modules/dsh-codex-connect/package.json')
    const leaf = join(dirname(plugin), 'node_modules', PEER, 'package.json')
    const fallback = join(root, 'node_modules', PEER, 'package.json')
    await manifest(plugin); await manifest(leaf, PEER); await manifest(fallback, PEER)
    io.forbidOpen.add(fallback)
    if (failure === 'disappear after check') afterFirstCheck(leaf, () => removeEntry(leaf))
    if (failure === 'post-open lstat') io.failPostCheck.add(leaf)
    if (failure === 'descriptor read') io.failRead.add(leaf)
    expect(await readPluginDependencyVersion(PEER, plugin)).toBeUndefined()
    expectNotOpened(fallback)
  })
})

describe('descriptor byte limit', () => {
  it('rejects growth after the first check using the opened descriptor size', async () => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    await manifest(leaf)
    afterFirstCheck(leaf, () => appendFile(leaf, ' '.repeat(LIMIT + 1)))
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(opened(leaf).read).not.toHaveBeenCalled()
  })

  it.each(['after fstat', 'during short reads'] as const)('caps growth %s at limit + 1 bytes and rejects overflow', async timing => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    await manifest(leaf)
    io.chunkSize = 17 * 1024
    if (timing === 'after fstat') {
      io.afterFstat = async (filename, metadata) => {
        if (filename === leaf) await appendFile(leaf, ' '.repeat(LIMIT * 2))
        return metadata
      }
    } else {
      io.chunkSize = 4 * 1024
      io.beforeRead = async (filename, index) => { if (filename === leaf && index === 1) await appendFile(leaf, ' '.repeat(LIMIT * 2)) }
    }
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    const file = opened(leaf)
    expect(file.bytesRead).toBe(LIMIT + 1)
    for (const [, offset, length, position] of file.read.mock.calls) {
      expect(offset).toBe(position)
      expect(offset + length).toBeLessThanOrEqual(LIMIT + 1)
    }
  })

  it('accepts exactly the limit with short reads and an EOF probe, then closes', async () => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    await manifest(leaf, PLUGIN, LIMIT)
    io.chunkSize = 31 * 1024
    expect(await readInstalledPluginVersion(leaf)).toBe(VERSION)
    expect(opened(leaf).bytesRead).toBe(LIMIT)
    expect(opened(leaf).read.mock.calls.at(-1)?.slice(1)).toEqual([LIMIT, 1, LIMIT])
  })
})

describe('unprovable ASAR metadata is unknown, not implicitly extracted', () => {
  it('rejects a lexical ASAR path before any open, even if the fixture is a native directory', async () => {
    const root = await fixture()
    const leaf = join(root, 'app.asar/node_modules/@deepseek-ai/dsh/package.json')
    await manifest(leaf, '@deepseek-ai/dsh')
    io.forbidOpen.add(leaf)
    expect(await readDshInstallationMetadata(leaf)).toBeUndefined()
    expectNotOpened(leaf)
  })

  it('rejects a directory link resolving into ASAR before open', async () => {
    const root = await fixture()
    const physical = join(root, 'app.asar/plugin/package.json')
    const logical = join(root, 'logical')
    await manifest(physical)
    await symlink(dirname(physical), logical, process.platform === 'win32' ? 'junction' : 'dir')
    io.forbidOpen.add(physical)
    expect(await readInstalledPluginVersion(join(logical, 'package.json'))).toBeUndefined()
    expectNotOpened(physical, join(logical, 'package.json'))
  })

  it('does not fall through an ASAR-linked peer to another dependency root', async () => {
    const root = await fixture()
    const plugin = join(root, 'node_modules/dsh-codex-connect/package.json')
    const physical = join(root, 'app.asar/peer/package.json')
    const logical = join(dirname(plugin), 'node_modules', PEER)
    const fallback = join(root, 'node_modules', PEER, 'package.json')
    await manifest(plugin); await manifest(physical, PEER); await manifest(fallback, PEER)
    await mkdir(dirname(logical), { recursive: true })
    await symlink(dirname(physical), logical, process.platform === 'win32' ? 'junction' : 'dir')
    io.forbidOpen.add(physical); io.forbidOpen.add(fallback)
    expect(await readPluginDependencyVersion(PEER, plugin)).toBeUndefined()
    expectNotOpened(physical, fallback)
  })

  it('still admits native .asar.unpacked directories', async () => {
    const root = await fixture()
    const leaf = join(root, 'app.asar.unpacked/plugin/package.json')
    await manifest(leaf)
    expect(await readInstalledPluginVersion(leaf)).toBe(VERSION)
  })
})
