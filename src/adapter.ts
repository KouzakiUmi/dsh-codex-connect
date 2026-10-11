/** OpenAI Codex adapter assembled from public dsh-llm-pi-ai extension points. */

import { defaultProviderAuthContext, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { Provider, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { OpenAICodexCredentialStore } from './store.ts'
import { readOpenAICodexRequestAuth } from './auth.ts'
import { OPENAI_CODEX_PROVIDER } from './store.ts'
import type { FastModeRegistry } from './fast-mode.ts'
import type { OpenAICodexModelCatalogEntry } from './model-contract.ts'
import { isValidOpenAICodexContextBudget, openAICodexContextLimit } from './model-contract.ts'
import { OPENAI_CODEX_TRANSPORT, withOpenAICodexModels } from './model-catalog.ts'
import type { OpenAICodexProxyManager } from './provider-proxy.ts'
import type { OpenAICodexBackendRequests } from './backend-request.ts'
import type { ReserveRequestPermits } from './reserve-state.ts'
import { OPENAI_CODEX_RESERVE_MODEL, OPENAI_CODEX_RESERVE_NORMAL_MODEL } from './reserve-usage.ts'
import { isRetiredOpenAICodexOverride, officialCodexModel } from './official-models.ts'
import { withServedModelObserver } from './served-model.ts'
import { streamWithNativeCompactionScope, withOpenAICodexNativeCompaction } from './native-compaction.ts'
import { streamWithCodexRequestDiagnostics, withCodexDiagnosticFetch } from './request-diagnostics.ts'
import { imageSelectionHandleText } from './image-input-contract.ts'

export { OPENAI_CODEX_ASTRA_MODEL_ID, OPENAI_CODEX_TRANSPORT, openAICodexModelCatalog, withOpenAICodexAstra, withOpenAICodexModels } from './model-catalog.ts'

/** Omission preserves ordinary dispatch; authority stays with the live task runtime. */
export interface OpenAICodexTaskDispatch {
  /** Explicit legacy-task provider policy; ordinary profiles do not import it. */
  wrapProvider?: (provider: Provider) => Provider
  stream(options: GenerateOptions, delegate: (next: GenerateOptions) => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
}

/** Provider idle ceiling used by the composite route. */
export const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 300_000

/** rc.2 default maximum base64 image payload retained in one request. */
export const OPENAI_CODEX_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
/** rc.2 default total-pixel budget for one deterministic inline image version. */
export const OPENAI_CODEX_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
/** rc.2 default raw encoded-byte cap for one deterministic inline image version. */
export const OPENAI_CODEX_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

/**
 * Give the generic dsh adapter a request-scoped bearer-token entry without
 * changing the provider's user-facing OAuth flow. The resolver accepts only
 * the explicit override supplied by this plugin; it never discovers an API
 * key from the environment or persistent api-key credentials.
 */
function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Add the request-scoped Fast Mode hint without changing auth or other options. */
export function withOpenAICodexFastMode(
  provider: Provider,
  fastMode: FastModeRegistry | undefined,
): Provider {
  const streamSimple = provider.streamSimple
  return {
    ...provider,
    streamSimple(model, context: TranscriptContext, options?: SimpleStreamOptions) {
      const sessionId = options?.sessionId
      const enabled = provider.id === OPENAI_CODEX_PROVIDER
        && model.provider === OPENAI_CODEX_PROVIDER
        && model.id !== OPENAI_CODEX_RESERVE_MODEL
        && fastMode !== undefined
        && fastMode.isEnabled(sessionId)
      if (!enabled) return streamSimple.call(provider, model, context, options)
      const previousOnPayload = options?.onPayload
      const nextOptions: SimpleStreamOptions = {
        ...options,
        async onPayload(payload, payloadModel) {
          const replaced = await previousOnPayload?.(payload, payloadModel)
          const nextPayload = replaced === undefined ? payload : replaced
          return isPayloadRecord(nextPayload)
            ? { ...nextPayload, service_tier: 'priority' }
            : nextPayload
        },
      }
      return streamSimple.call(provider, model, context, nextOptions)
    },
  }
}

/**
 * Profile-scoped output-style preferences applied to ordinary Codex requests.
 * `verbosity: 'default'` resolves to the model's catalog `default_verbosity`
 * and is always sent as `text.verbosity`, as the official client does.
 * `reasoningSummary: 'none'` removes `reasoning.summary` from the payload,
 * matching the official client; other values are sent lowercase. Native
 * compaction keeps its own pinned body and never reads these options.
 */
export interface OpenAICodexOutputStyle {
  verbosity: 'default' | 'low' | 'medium' | 'high'
  reasoningSummary: 'auto' | 'concise' | 'detailed' | 'none'
}

/** Official client defaults used when no profile preference is configured. */
export const OFFICIAL_DEFAULT_OUTPUT_STYLE: OpenAICodexOutputStyle = Object.freeze({
  verbosity: 'default',
  reasoningSummary: 'none',
})

/**
 * pi-ai's generic streamSimple signature omits the Codex-specific Responses
 * fields that its own implementation reads; both fields are part of the
 * official Codex wire contract (text.verbosity / reasoning.summary).
 */
export type CodexSimpleStreamOptions = SimpleStreamOptions & {
  textVerbosity?: 'low' | 'medium' | 'high'
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'off' | 'on' | null
}

/** Add the profile-scoped verbosity and reasoning-summary preferences to requests. */
export function withOpenAICodexOutputStyle(
  provider: Provider,
  resolveStyle: () => OpenAICodexOutputStyle | undefined,
): Provider {
  const streamSimple = provider.streamSimple
  return {
    ...provider,
    streamSimple(model, context: TranscriptContext, options?: SimpleStreamOptions) {
      const style = resolveStyle()
      if (style === undefined) return streamSimple.call(provider, model, context, options)
      // The official client always serializes `text.verbosity`; `default` resolves to the model's
      // catalog default_verbosity rather than omitting the field.
      const verbosity = style.verbosity === 'default'
        ? (officialCodexModel(model.id)?.defaultVerbosity ?? 'low')
        : style.verbosity
      const previousOnPayload = options?.onPayload
      const nextOptions: CodexSimpleStreamOptions = {
        ...options,
        textVerbosity: verbosity,
        // 'none' is the official Codex reasoning-summary value (codex-rs serializes the enum lowercase);
        // pi-ai's declared union omits it, so the assignment is narrowed here and forwarded verbatim.
        reasoningSummary: style.reasoningSummary as Exclude<CodexSimpleStreamOptions['reasoningSummary'], undefined>,
        async onPayload(payload, payloadModel) {
          const replaced = await previousOnPayload?.(payload, payloadModel)
          const nextPayload = replaced === undefined ? payload : replaced
          if (style.reasoningSummary !== 'none' || !isPayloadRecord(nextPayload)) return nextPayload
          // The official client omits `reasoning.summary` entirely when the summary is `none`.
          const reasoning = nextPayload['reasoning']
          if (!isPayloadRecord(reasoning) || !('summary' in reasoning)) return nextPayload
          const { summary: _omitted, ...withoutSummary } = reasoning
          return { ...nextPayload, reasoning: withoutSummary }
        },
      }
      return streamSimple.call(provider, model, context, nextOptions)
    },
  }
}

/**
 * Official effort rule: when a request names no effort (or `off`, which these models do not define),
 * the official client sends the catalog `default_reasoning_level`. Without this, pi-ai sends
 * `effort: 'none'` for models without an `off` mapping and omits reasoning for models with one.
 */
export function withOpenAICodexDefaultEffort(provider: Provider): Provider {
  const streamSimple = provider.streamSimple
  return {
    ...provider,
    streamSimple(model, context, options) {
      const official = officialCodexModel(model.id)
      const requested = options?.reasoning as string | undefined
      if (official === undefined || (requested !== undefined && requested !== 'off' && requested !== 'none')) {
        return streamSimple.call(provider, model, context, options)
      }
      return streamSimple.call(provider, model, context, { ...options, reasoning: official.defaultReasoningLevel })
    },
  }
}

/** Add an internal Luna route whose dispatch requires one fresh agent-request permit. */
export function withOpenAICodexReserve(provider: Provider, permits: ReserveRequestPermits): Provider {
  const models = provider.getModels().filter(model => model.id !== OPENAI_CODEX_RESERVE_MODEL)
  const luna = models.find(model => model.id === OPENAI_CODEX_RESERVE_NORMAL_MODEL)
  if (luna === undefined) throw new Error('Codex Reserve requires the Luna model catalog')
  // The official catalog serves this route as `gpt-reserve` with its own default_reasoning_level,
  // which the default-effort wrapper applies; only the Luna metadata is reused here.
  const reserve = { ...luna, id: OPENAI_CODEX_RESERVE_MODEL, name: 'Luna Reserve' }
  return {
    ...provider,
    getModels: () => [...models, reserve],
    streamSimple(model, context, options) {
      if (model.id === OPENAI_CODEX_RESERVE_MODEL) permits.consume(options?.sessionId, options?.apiKey)
      return provider.streamSimple(model, context, options)
    },
  }
}

function requestProvider(
  provider: Provider,
  fastMode?: FastModeRegistry,
  proxyManager?: OpenAICodexProxyManager,
  resolveProxyUrl?: () => string | undefined,
  backendRequests?: OpenAICodexBackendRequests,
  wrapProvider?: (provider: Provider) => Provider,
  outputStyle?: () => OpenAICodexOutputStyle | undefined,
): Provider {
  const ordinary = withOpenAICodexFastMode(
    withOpenAICodexOutputStyle(withOpenAICodexNativeCompaction(withOpenAICodexDefaultEffort(provider)), outputStyle ?? (() => OFFICIAL_DEFAULT_OUTPUT_STYLE)),
    fastMode,
  )
  const configured = wrapProvider === undefined ? ordinary : wrapProvider(ordinary)
  const streamSimple = configured.streamSimple
  return {
    ...configured,
    streamSimple(model, context: TranscriptContext, options?: SimpleStreamOptions) {
      const proxyUrl = resolveProxyUrl?.()
      const operation = () => streamSimple.call(configured, model, context, withServedModelObserver(withCodexDiagnosticFetch(options, backendRequests), model.id))
      return backendRequests?.runStream(operation) ?? proxyManager?.runStream(proxyUrl, operation) ?? operation()
    },
    auth: {
      ...provider.auth,
      apiKey: {
        name: 'OpenAI Codex OAuth bearer token',
        async resolve({ credential }) {
          const apiKey = credential?.key
          return apiKey === undefined || apiKey.length === 0
            ? undefined
            : { auth: { apiKey }, source: 'OAuth' }
        },
      },
    },
  }
}

/** Build the pi-ai profile with the model-error index required by DSH 0.1.7-rc.1. */
export function createOpenAICodexProfile(
  provider: Provider,
  fastMode?: FastModeRegistry,
  proxyManager?: OpenAICodexProxyManager,
  resolveProxyUrl?: () => string | undefined,
  contextWindowOverrides?: Readonly<Record<string, number>> | undefined,
  backendRequests?: OpenAICodexBackendRequests,
  wrapProvider?: (provider: Provider) => Provider,
  extendedContextWindow?: number | undefined,
  outputStyle?: () => OpenAICodexOutputStyle | undefined,
): ResolvedPiAiProviderProfile & { piProvider: Provider } {
  const effectiveProvider = contextWindowOverrides === undefined && extendedContextWindow === undefined
    ? provider
    : withOpenAICodexContextWindowOverrides(provider, contextWindowOverrides ?? {}, extendedContextWindow)
  const profile = {
    provider: OPENAI_CODEX_PROVIDER,
    displayName: 'OpenAI Codex',
    transport: OPENAI_CODEX_TRANSPORT,
    streamIdleTimeoutMs: OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS,
    maxRequestImageBytes: OPENAI_CODEX_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: OPENAI_CODEX_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: OPENAI_CODEX_REQUEST_IMAGE_MAX_BYTES,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-codex-connect retryPolicy'),
    configuredMaxTokens: new Map(),
    modelErrors: new Map<string, string>(),
    piProvider: requestProvider(effectiveProvider, fastMode, proxyManager, resolveProxyUrl, backendRequests, wrapProvider, outputStyle),
  }
  return profile
}

/**
 * Detach one provider and replace the advertised context window for the
 * configured model ids. Request streaming itself is unaffected: pi-ai streams
 * the caller-supplied model, so only the metadata Harness reads for context
 * budgeting and compaction changes.
 *
 * `extendedContextWindow` is the opt-in test switch: it raises every model
 * whose catalog default is smaller (above that model's Codex catalog ceiling
 * when the profile asks for it) so a deployment can measure the real server
 * limit. An explicit per-model override stays authoritative.
 */
export function withOpenAICodexContextWindowOverrides(
  provider: Provider,
  overrides: Readonly<Record<string, number>>,
  extendedContextWindow?: number | undefined,
): Provider {
  const baselineModels = provider.getModels()
  assertOpenAICodexContextWindowOverrides(overrides, baselineModels)
  const replaced = baselineModels.map(model => {
    const contextWindow = overrides[model.id]
    if (contextWindow !== undefined) return { ...model, contextWindow }
    if (extendedContextWindow === undefined || extendedContextWindow <= model.contextWindow) return model
    return { ...model, contextWindow: extendedContextWindow }
  })
  return { ...provider, getModels: () => replaced }
}

/** Reject unknown ids and out-of-range budgets before accepting settings or requests. */
export function assertOpenAICodexContextWindowOverrides(
  overrides: Readonly<Record<string, number | null>> | undefined,
  catalog: readonly Pick<OpenAICodexModelCatalogEntry, 'id' | 'contextWindow'>[],
): void {
  const models = new Map(catalog.map(model => [model.id, model]))
  for (const [id, budget] of Object.entries(overrides ?? {})) {
    const model = models.get(id)
    if (model === undefined) {
      // A stale `null` entry for an officially retired id is dropped rather than rejected: it
      // carries no budget, and rejecting it kept the whole plugin from loading on a stored
      // configuration the user can no longer edit from the UI. Unknown ids with a budget still fail.
      if (isRetiredOpenAICodexOverride(id, budget)) continue
      throw new TypeError(`OpenAI Codex contextWindowOverrides contains unknown model id "${id}"`)
    }
    const { maxContextWindow } = openAICodexContextLimit(id, model.contextWindow)
    if (budget !== null && !isValidOpenAICodexContextBudget(budget, maxContextWindow)) {
      throw new TypeError(`OpenAI Codex contextWindowOverrides for "${id}" must be an integer from 1 to ${maxContextWindow} tokens; use null to restore the catalog default`)
    }
  }
}

/**
 * Create the Codex subscription adapter without requiring a dsh fork. The
 * public pi-ai adapter owns Harness message conversion, image attachment
 * resolution, streaming, reasoning metadata, and compaction behavior; this
 * plugin supplies its provider-native OAuth token for each request.
 */
/** Add stable selection handles next to request images without mutating durable messages. */
export function withOpenAICodexImageSelectionHandles(options: GenerateOptions): GenerateOptions {
  let changed = false
  const messages = options.messages.map(message => {
    let imageIndex = 0
    let contentChanged = false
    const content: ContentBlock[] = []
    for (const block of message.content) {
      content.push(block)
      if (block.type !== 'image') continue
      imageIndex += 1
      content.push({ type: 'text', text: imageSelectionHandleText(imageIndex, block.attachment) })
      contentChanged = true
    }
    if (!contentChanged) return message
    changed = true
    return { ...message, content }
  })
  return changed ? { ...options, messages } : options
}

export function createOpenAICodexAdapter(
  credentials: OpenAICodexCredentialStore,
  resolveAttachments: () => AttachmentStore | undefined,
  fastMode?: FastModeRegistry,
  visibleModelIds?: () => readonly string[] | undefined,
  proxyManager?: OpenAICodexProxyManager,
  resolveProxyUrl?: () => string | undefined,
  contextWindowOverrides?: () => Readonly<Record<string, number>> | undefined,
  reservePermits?: ReserveRequestPermits,
  nativeCompactionEnabled?: () => boolean,
  backendRequests?: OpenAICodexBackendRequests,
  taskDispatch?: OpenAICodexTaskDispatch,
  imageEditingEnabled?: () => boolean,
  /** Opt-in extended-context test budget read on every profile rebuild. */
  extendedContextWindow?: () => number | undefined,
  /** Profile-scoped output-detail and reasoning-summary preferences read on every request. */
  outputStyle?: () => OpenAICodexOutputStyle | undefined,
): PiAiAdapter {
  const baseline = withOpenAICodexModels(openaiCodexProvider())
  const provider = reservePermits === undefined ? baseline : withOpenAICodexReserve(baseline, reservePermits)
  let profiles: Map<string, ResolvedPiAiProviderProfile> | undefined
  let previousBudget: { overrides: Readonly<Record<string, number>> | undefined; extended: number | undefined } | undefined
  const currentProfiles = (): Map<string, ResolvedPiAiProviderProfile> => {
    const overrides = contextWindowOverrides?.()
    const extended = extendedContextWindow?.()
    if (profiles === undefined || !deepEqualJson(previousBudget, { overrides, extended })) {
      const profile = createOpenAICodexProfile(provider, fastMode, proxyManager, resolveProxyUrl, overrides, backendRequests, taskDispatch?.wrapProvider, extended, outputStyle)
      // PiAiAdapter keys snapshots by map identity; captured calls keep the old map.
      profiles = new Map([[OPENAI_CODEX_PROVIDER, profile]])
      previousBudget = { overrides: overrides === undefined ? undefined : { ...overrides }, extended }
    }
    return profiles
  }
  class OpenAICodexAdapter extends PiAiAdapter {
    private streamPrepared(
      stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
      options: GenerateOptions,
    ): AsyncIterable<StreamChunk> {
      const dispatch = (request: GenerateOptions) => {
        const projected = imageEditingEnabled?.() === true ? withOpenAICodexImageSelectionHandles(request) : request
        const observed = (nextOptions: GenerateOptions) => streamWithCodexRequestDiagnostics(
          next => streamWithNativeCompactionScope(stream, next, nativeCompactionEnabled?.() === true), nextOptions,
        )
        return backendRequests?.metrics?.stream(observed, projected) ?? observed(projected)
      }
      return taskDispatch?.stream(options, dispatch) ?? dispatch(options)
    }

    override async prepareCall(providerId: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
      const prepared = await super.prepareCall(providerId, model, signal)
      return {
        model: prepared.model,
        stream: options => this.streamPrepared(prepared.stream, options),
      }
    }

    override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      return this.streamPrepared(next => super.stream(next), options)
    }

    override async listModels(providerId: string) {
      const catalog = (await super.listModels(providerId)).filter(model => model.id !== OPENAI_CODEX_RESERVE_MODEL)
      const configured = visibleModelIds?.()
      if (configured === undefined) return catalog
      const visible = new Set(configured)
      return catalog.filter(model => visible.has(model.id))
    }
  }
  return new OpenAICodexAdapter({
    profiles: currentProfiles,
    resolveApiKey: async () => {
      const operation = async () => (await readOpenAICodexRequestAuth(credentials)).access
      return proxyManager?.run(resolveProxyUrl?.(), operation) ?? operation()
    },
    // Host-side auth accepts only the explicit bearer token resolved above.
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
    resolveAttachments,
  })
}
