/** Node-free model catalog contract shared by the Host route and browser card. */

/** Same-origin endpoint exposing the complete Codex model catalog. */
export const OPENAI_CODEX_MODEL_CATALOG_PATH = '/plugins/dsh-codex-connect/models'

/** Versioned official-client override policy, pinned to the mirrored catalog revision. */
export const OPENAI_CODEX_CONTEXT_LIMIT_SOURCE = 'https://github.com/openai/codex/blob/d63a9b8344cfe58bc78bbe319b560378fc8756ef/codex-rs/models-manager/models.json'

/** Provenance of a configuration ceiling; every listed model shares the pinned official catalog. */
export function openAICodexContextLimitSource(_id: string): string {
  return OPENAI_CODEX_CONTEXT_LIMIT_SOURCE
}

/** Pinned official standard tier; unlisted provider capacities are retained. */
export function openAICodexStandardContextWindow(id: string, fallback = 272_000): number {
  return Object.hasOwn(CONFIGURATION_LIMITS, id) ? 272_000 : fallback
}

/** Plugin default: Sol 6.1 uses 500K; other known defaults follow the verified official catalog. */
export function openAICodexDefaultContextWindow(id: string, fallback = 272_000): number {
  return id === 'gpt-6.1-sol' ? 500_000 : openAICodexStandardContextWindow(id, fallback)
}

/** Finite expanded and maximum tiers, bounded by the pinned model ceiling. */
export function openAICodexExpandedContextWindow(id: string, standard: number, maximum = false): number {
  const limit = openAICodexContextLimit(id, standard).maxContextWindow
  return maximum ? limit : Math.max(standard, Math.min(500_000, limit))
}

export type OpenAICodexContextTier = 'standard' | 'extended' | 'maximum'
export type OpenAICodexContextTiers = Readonly<Record<string, OpenAICodexContextTier | null>>

/** Plugin preference: Sol 6.1 starts at 500K; explicit standard/null still selects the catalog baseline. */
export function openAICodexDefaultContextTier(id: string): OpenAICodexContextTier {
  return id === 'gpt-6.1-sol' ? 'extended' : 'standard'
}

export function resolveOpenAICodexContextTier(id: string, tier: OpenAICodexContextTier | null | undefined): OpenAICodexContextTier {
  return tier === undefined ? openAICodexDefaultContextTier(id) : tier ?? 'standard'
}

/** Finite, non-duplicated capacities shared by both context selectors. */
export function openAICodexContextChoices(id: string, standard: number): readonly { tier: OpenAICodexContextTier; window: number }[] {
  const baseline = openAICodexStandardContextWindow(id, standard)
  const choices = [
    { tier: 'standard' as const, window: baseline },
    { tier: 'extended' as const, window: openAICodexExpandedContextWindow(id, baseline) },
    { tier: 'maximum' as const, window: openAICodexExpandedContextWindow(id, baseline, true) },
  ]
  return choices.filter((choice, index) => !choices.slice(0, index).some(previous => previous.window === choice.window))
}

/** One saved model budget for metadata, admission, ordinary calls and manual compaction. */
export function openAICodexModelContextWindow(id: string, standard: number, tier: OpenAICodexContextTier | null | undefined): number {
  const selected = resolveOpenAICodexContextTier(id, tier)
  const baseline = openAICodexStandardContextWindow(id, standard)
  return selected === 'extended' || selected === 'maximum'
    ? openAICodexExpandedContextWindow(id, baseline, selected === 'maximum') : baseline
}

const CONFIGURATION_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  'gpt-6.1-sol': 872_000,
  'gpt-6-astra': 872_000,
  'gpt-6-sol': 872_000,
  'gpt-6-luna': 872_000,
  'gpt-5.6-sol': 872_000,
  'gpt-5.6-terra': 872_000,
  'gpt-5.6-luna': 872_000,
  'gpt-reserve': 872_000,
  'gpt-5.5': 272_000,
})

/** Keep unlisted or newer provider defaults usable without inventing a larger limit. */
export function openAICodexContextLimit(id: string, contextWindow: number): {
  maxContextWindow: number
  contextLimitSource: 'codex-catalog' | 'catalog-default'
} {
  const ceiling = Object.hasOwn(CONFIGURATION_LIMITS, id) ? CONFIGURATION_LIMITS[id] : undefined
  return ceiling === undefined || ceiling < contextWindow
    ? { maxContextWindow: contextWindow, contextLimitSource: 'catalog-default' }
    : { maxContextWindow: ceiling, contextLimitSource: 'codex-catalog' }
}

/** Whether a proposed local token budget fits the model's configuration range. */
export function isValidOpenAICodexContextBudget(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum
}

/** One model available from the complete provider catalog. */
export interface OpenAICodexModelCatalogEntry {
  id: string
  name: string
  /** Standard-tier raw capacity, independent of the plugin's default or saved tier. */
  contextWindow: number
  /** Local configuration ceiling; account/route capacity can differ. */
  maxContextWindow: number
  contextLimitSource: 'codex-catalog' | 'catalog-default'
}

/** Validate the model catalog before it enters React state. */
export function decodeOpenAICodexModelCatalog(value: unknown): OpenAICodexModelCatalogEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const catalog: OpenAICodexModelCatalogEntry[] = []
  const ids = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined
    const record = entry as Record<string, unknown>
    const id = record['id']
    const name = record['name']
    const contextWindow = record['contextWindow']
    const maxContextWindow = record['maxContextWindow']
    const contextLimitSource = record['contextLimitSource']
    if (typeof id !== 'string' || id.length === 0 || typeof name !== 'string' || name.length === 0 || ids.has(id)) return undefined
    if (typeof contextWindow !== 'number' || typeof maxContextWindow !== 'number'
      || !isValidOpenAICodexContextBudget(maxContextWindow, Number.MAX_SAFE_INTEGER)
      || !isValidOpenAICodexContextBudget(contextWindow, maxContextWindow)
      || (contextLimitSource !== 'codex-catalog' && contextLimitSource !== 'catalog-default')) return undefined
    ids.add(id)
    catalog.push({ id, name, contextWindow, maxContextWindow, contextLimitSource })
  }
  return catalog
}
