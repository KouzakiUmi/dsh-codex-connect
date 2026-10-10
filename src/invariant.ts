/**
 * Package-owned invariant companion for `dsh-codex-connect`.
 * @module dsh-codex-connect/invariant
 */

import type { Context } from '@deepseek-ai/cordis'

/**
 * Local shape of the legacy invariant installer. DSH 0.2.1-alpha.1 and later no
 * longer publish `@deepseek-ai/dsh-invariants`, so the companion keeps only the
 * structural contract it actually uses.
 */
type InvariantInstaller = () => void

/** Host invariant service surface used by the legacy companion registration. */
interface InvariantService {
  register(name: string, install: InvariantInstaller): () => void
}

const PACKAGE_NAME = 'dsh-codex-connect'

/** Cordis companion plugin name. */
export const name = 'openai-codex-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the LLM and web registries own provider uniqueness and disposal,
// while credentials and model replies cross file/network boundaries whose
// validation runs in their owning operations. There is no separate mutable
// package relationship to scan.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve((ctx as Context & { invariants: InvariantService }).invariants.register(PACKAGE_NAME, install))
