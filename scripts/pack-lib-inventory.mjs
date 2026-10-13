// Publication contract: six stable entries and five chunks from the bundled pi-ai 1.1.0 graph.
// Keep this explicit when tsdown.config.ts or its dependency graph changes: a new
// legitimate chunk requires a reviewed contract/fixture update, not a broad glob.
const stableEntries = [
  'lib/bin.js',
  'lib/client.js',
  'lib/index.js',
  'lib/index.d.ts',
  'lib/invariant.js',
  'lib/invariant.d.ts',
]
const chunkFamilies = [
  { name: 'models', count: 1, pattern: /^lib\/models-[A-Za-z0-9_-]+\.js$/u },
  // Host and standalone CLI are separate builds; each emits its own provider chunk.
  { name: 'openai-codex-responses', count: 2, pattern: /^lib\/openai-codex-responses-[A-Za-z0-9_-]+\.js$/u },
  { name: 'openai-responses-shared', count: 1, pattern: /^lib\/openai-responses-shared-[A-Za-z0-9_-]+\.js$/u },
  { name: 'undici-runtime', count: 1, pattern: /^lib\/undici-runtime-[A-Za-z0-9_-]+\.js$/u },
]

// Pure validation of npm pack's manifest paths; never import or execute artifacts.
// Hashes may change between builds. This checks inventory, not content freshness.
export function validateLibArtifactInventory(names) {
  const libFiles = names.filter(name => name === 'lib' || name.startsWith('lib/'))
  const problems = []
  for (const entry of stableEntries) {
    const count = libFiles.filter(name => name === entry).length
    if (count !== 1) problems.push(`expected exactly 1 ${entry}, found ${count}`)
  }
  if (new Set(libFiles).size !== libFiles.length) problems.push('duplicate lib manifest paths')
  for (const { name, pattern, count } of chunkFamilies) {
    const matches = libFiles.filter(path => pattern.test(path))
    if (matches.length !== count) {
      problems.push(`expected exactly ${count} lib/${name}-<hash>.js, found ${matches.length}${matches.length ? ` (${matches.join(', ')})` : ''}`)
    }
  }
  const unexpected = libFiles.filter(name => !stableEntries.includes(name)
    && !chunkFamilies.some(({ pattern }) => pattern.test(name)))
  if (unexpected.length > 0) problems.push(`unexpected lib artifacts: ${unexpected.join(', ')}`)
  if (problems.length > 0) {
    throw new Error(`packed lib artifact inventory mismatch:\n- ${problems.join('\n- ')}`)
  }
}
