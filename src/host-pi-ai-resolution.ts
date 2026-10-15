/** Resolve pi-ai relative to the actual adapter, never a profile/plugin-owned copy. */
import { findPackageJSON } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const HOST_PI_AI_PACKAGE = '@earendil-works/pi-ai'

export interface HostPiAiPackage {
  manifestUrl: string
  version: string
  exports: Record<string, unknown>
}

/** Node's default package resolver follows the adapter's physical dependency graph. */
export function resolveHostPiAiPackage(adapterEntry: string): HostPiAiPackage {
  const manifestPath = findPackageJSON(HOST_PI_AI_PACKAGE, adapterEntry)
  if (manifestPath === undefined) throw new Error('Host pi-ai package metadata is unavailable')
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!isRecord(manifest) || manifest['name'] !== HOST_PI_AI_PACKAGE
    || typeof manifest['version'] !== 'string' || !isRecord(manifest['exports'])) {
    throw new Error('Host pi-ai package metadata is invalid')
  }
  return { manifestUrl: pathToFileURL(realpathSync(manifestPath)).href,
    version: manifest['version'], exports: manifest['exports'] }
}

/** Fail only on a concrete missing API, not an untested host version number. */
export function assertHostPiAiFunctions(module: unknown, names: readonly string[]): void {
  for (const name of names) {
    if (!isRecord(module) || typeof module[name] !== 'function') {
      throw new Error(`Host pi-ai is missing required function ${name}`)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolve only the public ESM exports used by this plugin; do not guess private paths. */
export function resolveHostPiAiExport(pkg: HostPiAiPackage, subpath: string): string {
  let entry = pkg.exports[subpath]
  if (entry === undefined) {
    const pattern = Object.keys(pkg.exports).find(key => key.endsWith('/*') && subpath.startsWith(key.slice(0, -1)))
    if (pattern !== undefined) {
      const value = pkg.exports[pattern]
      const target = isRecord(value) ? value['import'] : value
      if (typeof target === 'string') entry = target.replaceAll('*', subpath.slice(pattern.length - 1))
    }
  }
  const target = isRecord(entry) ? entry['import'] : entry
  if (typeof target !== 'string' || !target.startsWith('./')) {
    throw new Error(`Host pi-ai does not expose the required ESM export ${subpath}`)
  }
  const root = new URL('./', pkg.manifestUrl)
  const url = new URL(target, root)
  if (!url.href.startsWith(root.href) || url.search || url.hash) throw new Error('Host pi-ai export escapes its package')
  return url.href
}
