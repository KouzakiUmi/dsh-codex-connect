/** Bounded explicit speed choices; no entitlement cache or credential material. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionStore } from '@deepseek-ai/dsh-session'
import { FastModeRegistry, isFastModeSessionId, OPENAI_CODEX_FAST_MODE_MAX_SESSIONS } from './fast-mode.ts'
import { supportsOpenAICodexUltrafast } from './speed-mode-contract.ts'
import type { OpenAICodexSpeedMode, ConversationSpeedState } from './speed-mode-contract.ts'

export interface ConversationSpeedScope {
  readonly workspace: string
  readonly accountKey: string | undefined
  readonly provider: string
  readonly model: string
}
interface Control {
  readonly generation: string
  revision: number
  mode: OpenAICodexSpeedMode
  expired?: boolean
  readonly scope: ConversationSpeedScope
  readonly selectionAvailable: boolean
}
export interface CapturedConversationSpeed {
  readonly mode: OpenAICodexSpeedMode
  readonly generation?: string
  readonly scope?: ConversationSpeedScope
  expired?: boolean
}
const sameScope = (a: ConversationSpeedScope, b: ConversationSpeedScope): boolean =>
  a.workspace === b.workspace && a.accountKey === b.accountKey && a.provider === b.provider && a.model === b.model

function validScope(scope: ConversationSpeedScope): void {
  if (scope.provider !== 'openai-codex' || typeof scope.workspace !== 'string' || !scope.workspace.trim() || scope.workspace.length > 256
    || typeof scope.model !== 'string' || !scope.model.trim() || scope.model.length > 256
    || (scope.accountKey !== undefined && !/^acct_[A-Za-z0-9_-]{43}$/u.test(scope.accountKey))) throw new TypeError('Invalid speed scope')
}

/** Legacy boolean Fast commands remain explicit Fast/Standard commands. */
export class ConversationSpeedRegistry extends FastModeRegistry {
  /** Separate plugin instances cannot reuse each other's choices or observations. */
  readonly workspace = randomUUID()
  private readonly controls = new Map<string, Control>()
  private readonly controlLimit: number
  private accountEpoch = 0
  constructor(limit = OPENAI_CODEX_FAST_MODE_MAX_SESSIONS, private readonly selectionKey?: (sessionId: string) => string | undefined) {
    super(limit)
    this.controlLimit = limit
  }
  override set(sessionId: unknown, enabled: boolean): void {
    super.set(sessionId, enabled)
    this.controls.delete(sessionId as string)
  }
  override delete(sessionId: unknown): void {
    super.delete(sessionId)
    if (typeof sessionId === 'string') this.controls.delete(sessionId)
  }
  override clear(): void { super.clear(); this.controls.clear() }

  /** Login/logout/account commands invalidate paid choices, including an A/B/A round trip. */
  invalidateAccountSelections(): void { this.accountEpoch++; this.controls.clear() }

  /** A committed Host model choice retires the old control, preserving legacy Fast. */
  invalidateModelSelection(sessionId: unknown): void {
    if (isFastModeSessionId(sessionId)) this.controls.delete(sessionId)
  }

  workspaceFor(sessionId: unknown): string {
    const key = typeof sessionId === 'string' ? this.selectionKey?.(sessionId) : undefined
    const workspace = this.accountEpoch === 0 ? this.workspace : this.workspace + ':account-' + this.accountEpoch
    return this.selectionKey === undefined ? workspace : workspace + ':' + (key ?? 'selection-unavailable')
  }

  readSpeed(sessionId: string, scope: ConversationSpeedScope): ConversationSpeedState {
    if (!isFastModeSessionId(sessionId)) throw new TypeError('Invalid speed session')
    validScope(scope)
    let control = this.controls.get(sessionId)
    if (control === undefined || control.expired || !sameScope(control.scope, scope)) {
      control = { generation: randomUUID(), revision: 0, mode: super.isEnabled(sessionId) ? 'fast' : 'standard', scope: { ...scope },
        selectionAvailable: this.selectionKey === undefined || this.selectionKey(sessionId) !== undefined }
    } else if (control.mode !== 'ultrafast') control.mode = super.isEnabled(sessionId) ? 'fast' : 'standard'
    this.controls.delete(sessionId)
    while (this.controls.size >= this.controlLimit) this.controls.delete(this.controls.keys().next().value!)
    this.controls.set(sessionId, control)
    return this.snapshot(control)
  }

  selectSpeed(sessionId: string, scope: ConversationSpeedScope, generation: string, revision: number, mode: OpenAICodexSpeedMode): ConversationSpeedState {
    validScope(scope)
    const control = this.controls.get(sessionId)
    if (control === undefined || !sameScope(control.scope, scope) || control.generation !== generation || control.revision !== revision) {
      throw new TypeError('SPEED_SELECTION_STALE')
    }
    if (mode !== 'standard' && mode !== 'fast' && mode !== 'ultrafast') throw new TypeError('Invalid speed mode')
    if (mode === 'ultrafast') {
      if (!supportsOpenAICodexUltrafast(scope.provider, scope.model)) throw new TypeError('ULTRAFAST_MODEL_UNSUPPORTED')
      if (scope.accountKey === undefined) throw new TypeError('ULTRAFAST_SIGN_IN_REQUIRED')
      if (this.selectionKey !== undefined && this.selectionKey(sessionId) === undefined) throw new TypeError('ULTRAFAST_SELECTION_UNAVAILABLE')
      if (this.selectionKey !== undefined && scope.workspace !== this.workspaceFor(sessionId)) throw new TypeError('SPEED_SELECTION_STALE')
    }
    super.set(sessionId, mode === 'fast')
    control.mode = mode
    control.revision++
    return this.snapshot(control)
  }

  isUltrafastSelected(sessionId: unknown): boolean {
    return typeof sessionId === 'string' && this.controls.get(sessionId)?.mode === 'ultrafast'
  }

  captureSpeed(sessionId: unknown): CapturedConversationSpeed {
    if (!isFastModeSessionId(sessionId)) return { mode: 'standard' }
    if (super.isEnabled(sessionId)) return { mode: 'fast' }
    const control = this.controls.get(sessionId)
    return control?.mode === 'ultrafast'
      ? { mode: 'ultrafast', generation: control.generation, scope: { ...control.scope }, expired: control.expired === true }
      : { mode: 'standard' }
  }

  confirmCapturedSpeed(sessionId: unknown, captured: CapturedConversationSpeed, scope: ConversationSpeedScope): OpenAICodexSpeedMode {
    validScope(scope)
    if (captured.mode !== 'ultrafast') return captured.mode
    if (captured.expired || captured.scope === undefined || !sameScope(captured.scope, scope)
      || !supportsOpenAICodexUltrafast(scope.provider, scope.model)) {
      captured.expired = true
      if (typeof sessionId === 'string') {
        const current = this.controls.get(sessionId)
        if (current !== undefined && current.generation === captured.generation && !current.expired) { current.expired = true; current.revision++ }
      }
      throw new TypeError('ULTRAFAST_SELECTION_EXPIRED')
    }
    return 'ultrafast'
  }

  requestSpeed(sessionId: unknown, scope: ConversationSpeedScope): OpenAICodexSpeedMode {
    if (!isFastModeSessionId(sessionId)) return 'standard'
    validScope(scope)
    if (super.isEnabled(sessionId)) return 'fast'
    const control = this.controls.get(sessionId)
    if (control?.mode !== 'ultrafast') return 'standard'
    if (control.expired || !sameScope(control.scope, scope) || !supportsOpenAICodexUltrafast(scope.provider, scope.model)) {
      // Keep the failure sticky until an explicit control reread/choice. A Host
      // retry must not turn the same expired request into a Standard dispatch.
      if (!control.expired) { control.expired = true; control.revision++ }
      throw new TypeError('ULTRAFAST_SELECTION_EXPIRED')
    }
    return 'ultrafast'
  }

  private snapshot(control: Control): ConversationSpeedState {
    return { generation: control.generation, revision: control.revision, mode: control.mode, model: control.scope.model,
      modelSupported: supportsOpenAICodexUltrafast(control.scope.provider, control.scope.model), eligibility: 'unknown',
      hasAccount: control.scope.accountKey !== undefined, selectionAvailable: control.selectionAvailable }
  }
}

/** Read only the Host's existing selection revision, including an away/back change. */
export function createConversationSpeedRegistry(ctx: Context): ConversationSpeedRegistry {
  const selections = new WeakMap<Session, { generation: string; revision: number }>()
  const liveSession = (sessionId: string): Session | undefined => {
    // Some supported Host declarations expose only the minimal ISessions surface.
    const sessions = ctx.get('sessions') as Partial<SessionStore> | undefined
    return sessions?.get?.(SessionId(sessionId))
  }
  const entry = (session: Session) => {
    let value = selections.get(session)
    if (value === undefined) { value = { generation: randomUUID(), revision: 0 }; selections.set(session, value) }
    return value
  }
  const registry = new ConversationSpeedRegistry(OPENAI_CODEX_FAST_MODE_MAX_SESSIONS, sessionId => {
    // Missing live lookup fails closed rather than enabling a paid choice.
    const session = liveSession(sessionId)
    if (session === undefined) return undefined
    const selection = entry(session)
    return selection.generation + ':' + selection.revision
  })
  // The committed Host lifecycle owns invalidation, never a view unmount.
  // Bump the scope before retiring the control so captured old requests stay guarded.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'model/selection' || liveSession(session.id) !== session) return
    entry(session).revision++
    registry.invalidateModelSelection(session.id)
  }, { global: true })
  return registry
}
