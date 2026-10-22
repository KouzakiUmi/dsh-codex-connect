/** Lightning per-conversation speed selector for Ultrafast-capable models. */
import { useEffect, useId, useRef, useState } from 'react'
import { OPENAI_CODEX_SPEED_MODE_PATH, readConversationSpeed } from '../speed-mode-contract.ts'
import type { ConversationSpeedState, OpenAICodexSpeedMode } from '../speed-mode-contract.ts'
import type { OpenAICodexSettingsKey } from './locales.ts'
import { requestJson } from './request-json.ts'
import { OpenAICodexSpeedSlider, SPEED_ACTIVE_COLORS } from './OpenAICodexSpeedSlider.tsx'

type Translate = (key: OpenAICodexSettingsKey, params?: Record<string, unknown>) => string

export interface OpenAICodexSpeedToggleProps {
  readonly sessionId: string
  readonly model: string
  readonly t: Translate
  /** Live account gate: paid selection stays unavailable during account mutations. */
  readonly available: boolean
}

/**
 * Same interaction shape as the context indicator: a lightning button whose
 * fill color reflects the selected tier, opening a compact three-way picker.
 * Choices are per-conversation Host state, never persistent settings.
 */
export function OpenAICodexSpeedToggle({ sessionId, model, t, available = true }: OpenAICodexSpeedToggleProps) {
  const [selection, setSelection] = useState<ConversationSpeedState>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfirmed'>('loading')
  const [readAttempt, setReadAttempt] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(false)
  const [left, setLeft] = useState(0)
  const controller = useRef<AbortController | undefined>(undefined)
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const tooltipId = useId(), dialogId = useId()

  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    setStatus('loading')
    void requestJson(`${OPENAI_CODEX_SPEED_MODE_PATH}?sessionId=${encodeURIComponent(sessionId)}&model=${encodeURIComponent(model)}`, {
      method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' }, signal: abort.signal,
    }).then(({ response, value }) => {
      if (abort.signal.aborted) return
      const next = response.ok ? readConversationSpeed(value, model) : undefined
      setSelection(next); setStatus(next === undefined ? 'unconfirmed' : 'ready')
    }).catch(() => { if (!abort.signal.aborted) setStatus('unconfirmed') })
      .finally(() => { if (controller.current === abort) controller.current = undefined })
    return () => { abort.abort(); if (controller.current === abort) controller.current = undefined }
  }, [sessionId, model, readAttempt])

  // A view does not own the session choice. Navigation/unmount cancels only
  // this view's request; Host model/account lifecycle governs invalidation.
  useEffect(() => () => { controller.current?.abort() }, [])

  useEffect(() => {
    if (!open) return
    const outside = (event: globalThis.PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  const locate = (width: number) => {
    const rect = root.current?.getBoundingClientRect()
    if (rect !== undefined) setLeft(Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16)) - rect.left)
  }

  const select = (mode: OpenAICodexSpeedMode): void => {
    if (status !== 'ready' || selection === undefined || controller.current !== undefined) return
    if (mode === 'ultrafast' && !canUltra) return
    const abort = new AbortController(); controller.current = abort; setStatus('loading')
    void requestJson(OPENAI_CODEX_SPEED_MODE_PATH, {
      method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, model, generation: selection.generation, revision: selection.revision, mode }), signal: abort.signal,
    }).then(({ response, value }) => {
      if (abort.signal.aborted) return
      const next = response.ok ? readConversationSpeed(value, model) : undefined
      if (next !== undefined && next.mode === mode) { setSelection(next); setStatus('ready') }
      else setStatus('unconfirmed')
    }).catch(() => { if (!abort.signal.aborted) setStatus('unconfirmed') })
      .finally(() => { if (controller.current === abort) controller.current = undefined })
  }

  const busy = status === 'loading'
  const mode = selection?.mode ?? 'standard'
  const canUltra = available && selection?.modelSupported === true && selection.hasAccount && selection.selectionAvailable
  const title = status === 'unconfirmed'
    ? t('speedRecover')
    : mode === 'ultrafast'
      ? t('speedUltrafastTitle')
      : mode === 'fast'
        ? t('fastModeEnabledTitle')
        : t('fastModeDisabledTitle')
  const color = status === 'ready' ? SPEED_ACTIVE_COLORS[mode] : 'var(--dsw-alias-label-secondary)'
  const floating = { position: 'absolute' as const, bottom: 'calc(100% + 8px)', left, zIndex: 1000,
    boxSizing: 'border-box' as const, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, #fff)',
    color: 'var(--dsw-alias-label-primary)', boxShadow: 'none', fontSize: 12, lineHeight: '18px' }

  return <span ref={root} style={{ display: 'inline-flex', position: 'relative', width: 30, height: 30 }}>
    <button ref={button} type="button" aria-label={title} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}
      aria-describedby={hovered && !open ? tooltipId : undefined} aria-busy={busy}
      data-openai-codex-speed-mode={status === 'ready' ? mode : 'unconfirmed'}
      onMouseEnter={() => { if (!open) { locate(180); setHovered(true) } }} onMouseLeave={() => { setHovered(false) }}
      onFocus={() => { if (!open) { locate(180); setHovered(true) } }} onBlur={() => { setHovered(false) }}
      onClick={() => { if (status === 'unconfirmed') { setReadAttempt(n => n + 1); return } locate(198); setHovered(false); setOpen(previous => !previous) }}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, padding: 0, border: 0, background: 'transparent', borderRadius: 8, color, cursor: 'pointer' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          data-openai-codex-speed-bolt={status === 'ready' && mode !== 'standard' ? 'filled' : 'outline'}
          d="M13.1 2.75 5.35 13.1h5.8l-.95 8.15 8.45-11.2h-5.9l.35-7.3Z"
          fill={status === 'ready' && mode !== 'standard' ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
    {hovered && !open ? <span id={tooltipId} role="tooltip" style={{ ...floating, background: 'var(--dsw-specific-tip, #1f2329)', color: 'var(--dsw-alias-label-primary, #fff)', width: 'min(180px, calc(100vw - 32px))', padding: '4px 8px', pointerEvents: 'none' }}>{title}</span> : null}
    {open ? <span id={dialogId} role="dialog" aria-label={t('speedDialogTitle')} style={{ ...floating, width: 198, maxWidth: 'calc(100vw - 32px)', padding: '6px 8px', border: '1px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {status === 'unconfirmed' ? <button type="button" onClick={() => { setReadAttempt(n => n + 1) }}>{t('speedRecover')}</button>
        : <OpenAICodexSpeedSlider mode={mode} label={t('speedDialogTitle')}
          labels={[t('speedStandard'), t('speedFast'), 'Ultrafast']} disabled={status !== 'ready'}
          canUltra={canUltra} unavailableTitle={t('ultrafastUnavailable')} onChange={select} />}
    </span> : null}
  </span>
}
