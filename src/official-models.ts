/**
 * Official Codex model metadata mirrored from openai/codex `codex-rs/models-manager/models.json`
 * at commit 47bcb3a3f9e0904aed485389aaf410282b6b23fa. Values here decide wire defaults that the
 * official client derives from the catalog: `default_reasoning_level`, `default_verbosity`,
 * and the reasoning-summary default. `ultra` is a client multi-agent mode, not a request effort,
 * so it is intentionally absent from the effort lists.
 */

export const OFFICIAL_CODEX_CATALOG_SOURCE = 'https://github.com/openai/codex/blob/47bcb3a3f9e0904aed485389aaf410282b6b23fa/codex-rs/models-manager/models.json'

/** Request effort levels accepted on the Codex Responses wire (no `ultra`). */
export type OfficialCodexEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** One model whose official default effort and verbosity drive the request body. */
export interface OfficialCodexModel {
  readonly id: string
  readonly defaultReasoningLevel: OfficialCodexEffort
  readonly efforts: readonly OfficialCodexEffort[]
  readonly defaultVerbosity: 'low' | 'medium' | 'high'
  /** Official `default_reasoning_summary`; every listed model defaults to `none`. */
  readonly defaultReasoningSummary: 'none'
}

const FULL: readonly OfficialCodexEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const TO_XHIGH: readonly OfficialCodexEffort[] = ['low', 'medium', 'high', 'xhigh']

/** Visible official models plus the hidden Reserve route served as `gpt-reserve`. */
export const OFFICIAL_CODEX_MODELS: readonly OfficialCodexModel[] = Object.freeze([
  { id: 'gpt-6.1-sol', defaultReasoningLevel: 'low', efforts: FULL, defaultVerbosity: 'low', defaultReasoningSummary: 'none' },
  { id: 'gpt-6-astra', defaultReasoningLevel: 'low', efforts: FULL, defaultVerbosity: 'low', defaultReasoningSummary: 'none' },
  { id: 'gpt-6-sol', defaultReasoningLevel: 'medium', efforts: FULL, defaultVerbosity: 'low', defaultReasoningSummary: 'none' },
  { id: 'gpt-6-luna', defaultReasoningLevel: 'medium', efforts: FULL, defaultVerbosity: 'low', defaultReasoningSummary: 'none' },
  { id: 'gpt-5.6-sol', defaultReasoningLevel: 'low', efforts: FULL, defaultVerbosity: 'low', defaultReasoningSummary: 'none' },
  { id: 'gpt-5.6-terra', defaultReasoningLevel: 'medium', efforts: FULL, defaultVerbosity: 'low', defaultReasoningSummary: 'none' },
  { id: 'gpt-5.6-luna', defaultReasoningLevel: 'medium', efforts: FULL, defaultVerbosity: 'low', defaultReasoningSummary: 'none' },
  { id: 'gpt-5.5', defaultReasoningLevel: 'medium', efforts: TO_XHIGH, defaultVerbosity: 'low', defaultReasoningSummary: 'none' },
  { id: 'gpt-reserve', defaultReasoningLevel: 'medium', efforts: FULL, defaultVerbosity: 'low', defaultReasoningSummary: 'none' },
])

/** Models that earlier releases exposed but the official catalog no longer lists. */
export const OFFICIAL_CODEX_REMOVED_MODEL_IDS: readonly string[] = Object.freeze([
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark',
])

/** Official metadata for one model id, or undefined when the catalog does not list it. */
export function officialCodexModel(id: string): OfficialCodexModel | undefined {
  return OFFICIAL_CODEX_MODELS.find(model => model.id === id)
}
