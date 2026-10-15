import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-codex-connect'
const PACKAGE_VERSION = (JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }).version
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-remotes/client',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-api-session-controller/client',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-layout/client',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-settings/client',
] as const

export default [
  {
    entry: {
      index: 'src/index.ts',
      invariant: 'src/invariant.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    // Keep dispatcher preservation ahead of external providers' initialization.
    outputOptions: {
      codeSplitting: {
        groups: [{ name: 'undici-runtime', test: /[\\/]src[\\/]undici-runtime\.ts$/u }],
      },
    },
    define: {
      __CODEX_CONNECT_VERSION__: JSON.stringify(PACKAGE_VERSION),
    },
    deps: {
      // pi-ai is host-provided: the plugin declares it as a peer and the DSH host resolves the
      // import to its own pi-ai (currently 1.2.0), so the plugin and the host adapter share one
      // pi-ai instance. Bundling a second copy reintroduces the cross-version object mismatch
      // that broke transcript handling; never bundle it here.
      neverBundle: [
        /^@earendil-works\/pi-ai(\/|$)/u,
        '@deepseek-ai/schemastery',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-agent',
        '@deepseek-ai/dsh-attachment',
        '@deepseek-ai/dsh-fs',
        '@deepseek-ai/dsh-host-webserver',
        '@deepseek-ai/dsh-invariants',
        '@deepseek-ai/dsh-llm',
        '@deepseek-ai/dsh-llm-pi-ai',
        '@deepseek-ai/dsh-session',
        '@deepseek-ai/dsh-settings',
        '@deepseek-ai/dsh-tools',
        '@deepseek-ai/dsh-web',
      ],
    },
  },
  {
    entry: { bin: 'src/bin.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // pnpm's platform-specific store paths must not leak into generated source labels.
    inputOptions: { experimental: { attachDebugInfo: 'none' } },
    // The standalone CLI keeps bundling everything (pi-ai 1.2.0 comes from devDependencies at
    // build time): it runs outside any DSH host, so it cannot resolve the host-provided peer.
    deps: { alwaysBundle: [/.*/u] },
    define: {
      __CODEX_CONNECT_VERSION__: JSON.stringify(PACKAGE_VERSION),
    },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: { neverBundle: [...CLIENT_EXTERNALS] },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      __CODEX_CONNECT_VERSION__: JSON.stringify(PACKAGE_VERSION),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
