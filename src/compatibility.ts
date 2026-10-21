import { createRequire } from 'node:module'
import { readDshInstallationMetadata, readPluginDependencyVersion } from './installation-metadata.ts'
import { resolveHostPiAiPackage } from './host-pi-ai-resolution.ts'
import { COMPATIBILITY_PACKAGES, evaluateCompatibility, PI_AI_PACKAGE } from './compatibility-policy.ts'
import type { CompatibilityEvaluationInput, CompatibilityPackageName, CompatibilityReport } from './compatibility-policy.ts'

// Preserve the existing public module while keeping browser policy Node-free.
export * from './compatibility-policy.ts'

export interface CompatibilityDetectionOptions extends CompatibilityEvaluationInput {
  /** Test seam for package metadata resolution; no package paths are returned. */
  readPackageVersion?: (name: CompatibilityPackageName) => string | null | undefined | Promise<string | null | undefined>
  /** Explicit package.json selecting DSH installation metadata, not proof of a running Host. */
  installAnchor?: string
  /** Isolated fixture seam; production reads only this plugin's known manifest location. */
  pluginManifestPath?: string
}

/**
 * pi-ai is host-owned: resolve it through the actual `@deepseek-ai/dsh-llm-pi-ai`
 * adapter's dependency graph, never through a profile/plugin-owned copy.
 */
async function readHostPiAiVersion(installAnchor?: string): Promise<string | undefined> {
  try {
    const adapterEntry = installAnchor === undefined
      ? import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai')
      : createRequire(installAnchor).resolve('@deepseek-ai/dsh-llm-pi-ai')
    return resolveHostPiAiPackage(adapterEntry).version
  } catch {
    return undefined
  }
}

/** Read selected installation metadata without loading peers or returning paths. */
export async function readInstalledPackageVersion(name: string, installAnchor?: string): Promise<string | undefined> {
  if (name === PI_AI_PACKAGE) return readHostPiAiVersion(installAnchor)
  if (installAnchor === undefined) return readPluginDependencyVersion(name)
  const metadata = await readDshInstallationMetadata(installAnchor)
  return metadata?.packageVersions[name as Exclude<CompatibilityPackageName, typeof PI_AI_PACKAGE>]
}

/** Read bounded metadata; an invalid explicit anchor never falls back to local peers. */
export async function detectCompatibility(options: CompatibilityDetectionOptions = {}): Promise<CompatibilityReport> {
  const suppliedPackages = options.packageVersions ?? options.packages ?? options.installed?.packages
  let packageVersions = suppliedPackages
  let anchoredRootMismatch = false
  if (packageVersions === undefined) {
    const installation = options.installAnchor === undefined || options.readPackageVersion !== undefined
      ? undefined : await readDshInstallationMetadata(options.installAnchor)
    anchoredRootMismatch = installation !== undefined && installation.currentDshVersion === undefined
    const readVersion = options.readPackageVersion ?? ((name: CompatibilityPackageName) => {
      // pi-ai belongs to the host adapter, never to the independently selected Host.
      if (name === PI_AI_PACKAGE) return readHostPiAiVersion(options.installAnchor)
      if (options.installAnchor === undefined) return readPluginDependencyVersion(name, options.pluginManifestPath)
      return installation?.packageVersions[name]
    })
    packageVersions = Object.fromEntries(await Promise.all(COMPATIBILITY_PACKAGES.map(async name => [name, await readVersion(name)] as const)))
  }
  const report = evaluateCompatibility({
    nodeVersion: options.nodeVersion ?? options.node ?? options.installed?.node ?? process.version,
    packageVersions,
  })
  return anchoredRootMismatch && report.status === 'compatible' ? { ...report, status: 'unverified' } : report
}
