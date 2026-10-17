import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, open, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DSH_METADATA_PACKAGES, readDshInstallationMetadata, readInstalledPluginVersion, readPluginDependencyVersion } from '../src/installation-metadata.ts'

const guarded = vi.hoisted(() => new Set<string>())
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      if (guarded.has(String(args[0]))) throw new Error('forbidden fixture open')
      return actual.open(...args)
    }),
  }
})

const roots: string[] = []
afterEach(async () => {
  guarded.clear()
  vi.mocked(open).mockClear()
  await Promise.all(roots.splice(0).map(async root => {
    expect(await realpath(root)).toBe(root)
    await rm(root, { recursive: true, force: true })
  }))
})

async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-connect-metadata-leaf-')))
  roots.push(root)
  return root
}
async function manifest(path: string, name: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify({ name, version: '0.2.0-rc.2' }))
}
function expectNotOpened(...paths: string[]): void {
  for (const path of paths) expect(vi.mocked(open).mock.calls.map(call => String(call[0]))).not.toContain(path)
}

describe('public manifest leaf admission', () => {
  it('does not resolve/read a leaf symlink even if its target looks like metadata', async () => {
    const root = await fixture()
    const target = join(root, 'private-fixture.json')
    await manifest(target, 'dsh-codex-connect')
    const leaf = join(root, 'package.json')
    await symlink(target, leaf)
    guarded.add(leaf); guarded.add(target)
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(await readDshInstallationMetadata(leaf)).toBeUndefined()
    expectNotOpened(leaf, target)
  })

  it('rejects a symlinked peer leaf instead of opening it or falling through to another root', async () => {
    const root = await fixture()
    const plugin = join(root, 'node_modules/dsh-codex-connect/package.json')
    await manifest(plugin, 'dsh-codex-connect')
    const target = join(root, 'private-fixture.json')
    await manifest(target, '@deepseek-ai/dsh-llm')
    const leaf = join(dirname(plugin), 'node_modules/@deepseek-ai/dsh-llm/package.json')
    await mkdir(dirname(leaf), { recursive: true }); await symlink(target, leaf)
    await manifest(join(root, 'node_modules/@deepseek-ai/dsh-llm/package.json'), '@deepseek-ai/dsh-llm')
    guarded.add(leaf); guarded.add(target)
    expect(await readPluginDependencyVersion('@deepseek-ai/dsh-llm', plugin)).toBeUndefined()
    expectNotOpened(leaf, target, join(root, 'node_modules/@deepseek-ai/dsh-llm/package.json'))
  })

  it('preserves a logical Host directory symlink and its physical peer layout', async () => {
    const root = await fixture()
    const modules = join(root, '.pnpm/host-peer-set/node_modules')
    const physical = join(modules, '@deepseek-ai/dsh')
    await manifest(join(physical, 'package.json'), '@deepseek-ai/dsh')
    for (const name of DSH_METADATA_PACKAGES) await manifest(join(modules, name, 'package.json'), name)
    const logical = join(root, 'active/node_modules/@deepseek-ai/dsh')
    await mkdir(dirname(logical), { recursive: true })
    await symlink(physical, logical, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await readDshInstallationMetadata(join(logical, 'package.json'))).toMatchObject({ currentDshVersion: '0.2.0-rc.2' })
  })

  it('rejects directory and oversized manifest leaves without reading their data', async () => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    await mkdir(leaf)
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(await realpath(leaf)).toBe(leaf)
    await rm(leaf, { recursive: true })
    await writeFile(leaf, ' '.repeat(256 * 1024 + 1))
    guarded.add(leaf)
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expectNotOpened(leaf)
  })

  it.skipIf(process.platform === 'win32')('rejects a real FIFO root/peer without starting a potentially blocking read', async () => {
    const root = await fixture()
    const leaf = join(root, 'package.json')
    execFileSync('/usr/bin/mkfifo', [leaf])
    guarded.add(leaf)
    expect(await readInstalledPluginVersion(leaf)).toBeUndefined()
    expect(await readDshInstallationMetadata(leaf)).toBeUndefined()
    const anchor = join(root, 'node_modules/@deepseek-ai/dsh/package.json')
    await manifest(anchor, '@deepseek-ai/dsh')
    const peer = join(root, 'node_modules/@deepseek-ai/dsh-llm/package.json')
    await mkdir(dirname(peer), { recursive: true }); execFileSync('/usr/bin/mkfifo', [peer])
    guarded.add(peer)
    expect((await readDshInstallationMetadata(anchor))?.packageVersions['@deepseek-ai/dsh-llm']).toBeUndefined()
    expectNotOpened(leaf, peer)
  })
})
