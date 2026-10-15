import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertHostPiAiFunctions, resolveHostPiAiExport, resolveHostPiAiPackage } from '../src/host-pi-ai-resolution.ts'

const exportsMap = { '.': { import: './dist/index.js' }, './providers/*': { import: './dist/providers/*.js' },
  './api/*': { import: './dist/api/*.js' }, './utils/*': { import: './dist/utils/*.js' } }

describe('adapter-owned pi-ai resolution', () => {
  it('checks concrete missing functions instead of imposing a host version gate', () => {
    expect(() => assertHostPiAiFunctions({ createModels: () => undefined }, ['createModels'])).not.toThrow()
    for (const module of [null, {}, { createModels: 'removed' }]) {
      expect(() => assertHostPiAiFunctions(module, ['createModels'])).toThrow('Host pi-ai is missing required function createModels')
    }
  })
  it('selects the adapter nested package, not a same-version hoisted/plugin copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-host-pi-'))
    try {
      const adapter = join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js')
      await mkdir(dirname(adapter), { recursive: true }); await writeFile(adapter, 'export {}')
      const hoisted = join(root, 'node_modules', '@earendil-works', 'pi-ai')
      const nested = join(dirname(dirname(adapter)), 'node_modules', '@earendil-works', 'pi-ai')
      for (const location of [hoisted, nested]) {
        await mkdir(join(location, 'dist'), { recursive: true })
        await writeFile(join(location, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-ai', version: '1.2.0', exports: exportsMap }))
        await writeFile(join(location, 'dist', 'index.js'), 'export {}')
      }
      const pkg = resolveHostPiAiPackage(pathToFileURL(adapter).href)
      expect(pkg.manifestUrl).toBe(pathToFileURL(join(nested, 'package.json')).href)
      expect(resolveHostPiAiExport(pkg, '.')).toBe(pathToFileURL(join(nested, 'dist', 'index.js')).href)
      for (const subpath of ['./providers/openai-codex', './api/openai-responses-shared', './utils/transcript']) {
        expect(resolveHostPiAiExport(pkg, subpath)).toBe(pathToFileURL(join(nested, 'dist', `${subpath.slice(2)}.js`)).href)
      }
      await rm(root, { recursive: true, force: true })
      expect(() => resolveHostPiAiPackage(pathToFileURL(adapter).href)).toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('refuses missing or escaping ESM exports instead of falling back to a plugin copy', () => {
    const pkg = { manifestUrl: 'file:///host/pi-ai/package.json', version: '1.2.0', exports: exportsMap }
    expect(() => resolveHostPiAiExport(pkg, './missing')).toThrow('required ESM export')
    for (const target of ['../other.js', './../../../other.js', './dist/index.js?other', './dist/index.js#other']) {
      expect(() => resolveHostPiAiExport({ ...pkg, exports: { '.': { import: target } } }, '.')).toThrow()
    }
  })
})
