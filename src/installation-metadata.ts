/** Bounded, read-only package metadata; never import peers or search ancestor installations. */
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRuntimeMetadataVersion } from './runtime-identity.ts'

const PLUGIN_PACKAGE = 'dsh-codex-connect'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const MAX_MANIFEST_BYTES = 256 * 1024
const PLUGIN_MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url))
export const DSH_METADATA_PACKAGES = ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-compaction'] as const

type DshMetadataPackage = (typeof DSH_METADATA_PACKAGES)[number]

export interface DshInstallationMetadata {
  version: string
  packageVersions: Partial<Record<DshMetadataPackage, string>>
  /** Present only when all three peers agree with the selected DSH manifest. */
  currentDshVersion?: string
}

interface PackageMetadata {
  version: string
  dependencyRoots: readonly string[]
}

/** The public launch fact is an absolute manifest path, never an inferred cwd or executable. */
export function isInstallationAnchor(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value) && basename(value) === 'package.json'
}

interface ManifestMetadata {
  version: string
  directory: string
}

function isNativeManifestFile(metadata: BigIntStats): boolean {
  // Zero/unknown identities cannot establish that lstat and fstat describe the
  // same native object (virtual filesystem metadata is not sufficient proof).
  return metadata.isFile() && metadata.ino > 0n && metadata.dev >= 0n && metadata.size >= 0n
}

function sameManifestFile(left: BigIntStats, right: BigIntStats): boolean {
  return isNativeManifestFile(left) && isNativeManifestFile(right) && left.dev === right.dev && left.ino === right.ino
}

function isAsarPath(filename: string): boolean {
  // Electron may extract a virtual member on open, before fstat can reject it.
  // Do not open ASAR paths, even in an ASAR-capable runtime. Native directories
  // named *.asar are conservatively unknown too; *.asar.unpacked is unaffected.
  return filename.split(/[\\/]/u).some(component => /\.asar$/iu.test(component))
}

async function manifestMetadata(filename: string, name: string): Promise<ManifestMetadata | null | undefined> {
  let observed = false
  try {
    if (isAsarPath(filename)) return null
    const metadata = await lstat(filename, { bigint: true })
    observed = true
    if (!isNativeManifestFile(metadata) || metadata.size > BigInt(MAX_MANIFEST_BYTES)) return null
    // Resolve directory links, never the manifest leaf. Resolving the leaf after
    // lstat could turn a concurrent symlink replacement into an accepted file.
    const directory = await realpath(dirname(filename))
    if (isAsarPath(directory)) return null
    const manifestPath = join(directory, basename(filename))
    // Windows does not supply POSIX no-follow/nonblocking guarantees. There we
    // still require matching, nonzero native identities before reading content.
    if (process.platform !== 'win32' && (!constants.O_NOFOLLOW || !constants.O_NONBLOCK)) return null
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const handle = await open(manifestPath, flags)
    try {
      const opened = await handle.stat({ bigint: true })
      if (!sameManifestFile(metadata, opened) || opened.size > BigInt(MAX_MANIFEST_BYTES)) return null
      // Recheck both aliases before content: a logical directory link may have
      // changed during canonicalization. Also reject a leaf now replaced by a
      // link, even without O_NOFOLLOW and with the original descriptor identity.
      if (!sameManifestFile(opened, await lstat(filename, { bigint: true }))) return null
      if (manifestPath !== filename && !sameManifestFile(opened, await lstat(manifestPath, { bigint: true }))) return null
      const bytes = Buffer.alloc(MAX_MANIFEST_BYTES + 1)
      let length = 0
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length)
        if (bytesRead === 0) break
        length += bytesRead
      }
      // The byte cap belongs to this descriptor, not a pre-open size snapshot:
      // growth and short reads cannot make us consume more than limit + 1.
      if (length > MAX_MANIFEST_BYTES) return null
      const manifest: unknown = JSON.parse(bytes.toString('utf8', 0, length))
      if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return null
      const fields = manifest as Record<string, unknown>
      return fields.name === name && isRuntimeMetadataVersion(fields.version) ? { version: fields.version, directory } : null
    } finally {
      await handle.close()
    }
  } catch (error: unknown) {
    // Only a candidate absent at the first check permits the other explicit
    // root. Disappearance after that check is a failed observation, not absence.
    return !observed && (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? undefined : null
  }
}

async function packageMetadata(filename: string, name: string): Promise<PackageMetadata | undefined> {
  if (!isInstallationAnchor(filename)) return undefined
  const manifest = await manifestMetadata(filename, name)
  if (manifest === undefined || manifest === null) return undefined
  const { directory, version } = manifest
  const parent = dirname(directory)
  // A pnpm physical package may have peers beside it. Its exact peer symlinks
  // are allowed; there is no subsequent ancestor walk or resolver fallback.
  const installationModules = basename(parent) === 'node_modules' ? parent
    : basename(parent).startsWith('@') && basename(dirname(parent)) === 'node_modules' ? dirname(parent) : undefined
  return {
    version,
    dependencyRoots: [join(directory, 'node_modules'), ...installationModules === undefined ? [] : [installationModules]],
  }
}

async function dependencyVersion(name: string, metadata: PackageMetadata): Promise<string | undefined> {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name)) return undefined
  for (const root of metadata.dependencyRoots) {
    const manifest = await manifestMetadata(join(root, name, 'package.json'), name)
    if (manifest !== undefined) return manifest?.version
  }
  return undefined
}

/** Read only this plugin's known manifest; the path seam is for isolated fixtures. */
export async function readInstalledPluginVersion(pluginManifestPath = PLUGIN_MANIFEST): Promise<string | undefined> {
  return (await packageMetadata(pluginManifestPath, PLUGIN_PACKAGE))?.version
}

/** Read one dependency from this plugin's own two logical lookup roots only. */
export async function readPluginDependencyVersion(name: string, pluginManifestPath = PLUGIN_MANIFEST): Promise<string | undefined> {
  const metadata = await packageMetadata(pluginManifestPath, PLUGIN_PACKAGE)
  return metadata === undefined ? undefined : dependencyVersion(name, metadata)
}

/** An invalid explicit anchor is unknown, never a reason to try local/global packages. */
export async function readDshInstallationMetadata(installAnchor: string): Promise<DshInstallationMetadata | undefined> {
  const metadata = await packageMetadata(installAnchor, DSH_PACKAGE)
  if (metadata === undefined) return undefined
  const entries = await Promise.all(DSH_METADATA_PACKAGES.map(async name => [name, await dependencyVersion(name, metadata)] as const))
  const packageVersions = Object.fromEntries(entries.filter(([, version]) => version !== undefined)) as Partial<Record<DshMetadataPackage, string>>
  return {
    version: metadata.version,
    packageVersions,
    ...DSH_METADATA_PACKAGES.every(name => packageVersions[name] === metadata.version)
      ? { currentDshVersion: metadata.version } : {},
  }
}
