/** Short hover tooltip plus a compact immediate-save editor over Host-owned settings. */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { OpenAICodexConfigForm } from './config-form.ts'
import type { OpenAICodexSettingsKey } from './locales.ts'
import { openAICodexContextLimit, openAICodexStandardContextWindow, openAICodexModelContextWindow, resolveOpenAICodexContextTier } from '../model-contract.ts'
import type { OpenAICodexContextTier } from '../model-contract.ts'
import { OpenAICodexContextSlider } from './OpenAICodexContextSlider.tsx'

export interface OpenAICodexContextIndicatorInjected {
  directory: SnapshotStore<ModelDirectoryState>
  configScope?: Pick<OpenAICodexConfigForm, 'subscribe' | 'getSnapshot' | 'mutate'>
}
export function OpenAICodexContextIndicator({ directory, configScope, t }: OpenAICodexContextIndicatorInjected & {
  t: (key: OpenAICodexSettingsKey, params?: Record<string, unknown>) => string
}) {
  const directoryState = useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot(), () => directory.getSnapshot())
  const snapshot = useSyncExternalStore(listener => configScope?.subscribe(listener) ?? (() => undefined), () => configScope?.getSnapshot(), () => configScope?.getSnapshot())
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(false)
  const [left, setLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const writing = useRef(false)
  const generation = useRef(0)
  const model = directoryState.current?.model ?? ''
  const provider = directoryState.current?.provider
  const ready = snapshot?.status === 'ready' && snapshot.value !== undefined && snapshot.mode !== 'memory'
  const tooltipId = useId(), dialogId = useId()
  const locate = (width: number) => {
    const rect = root.current?.getBoundingClientRect()
    if (rect !== undefined) setLeft(Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16)) - rect.left)
  }
  useEffect(() => {
    const current = ++generation.current
    setOpen(false); setHovered(false); setError(false)
    return () => { if (generation.current === current) generation.current++ }
  }, [model, provider, configScope, ready])
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role="slider"]')?.focus()
    const outside = (event: globalThis.PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  if (directoryState.status !== 'ready' || provider !== 'openai-codex' || openAICodexContextLimit(model, 0).maxContextWindow === 0) return null
  const writable = ready && snapshot.writable && snapshot.revision !== undefined && configScope !== undefined
  const tier = resolveOpenAICodexContextTier(model, snapshot?.value?.modelContextTiers?.[model])
  const standard = openAICodexStandardContextWindow(model)
  const capacity = openAICodexModelContextWindow(model, standard, tier)
  const tierLabel = t(capacity <= standard ? 'contextTierStandard' : capacity <= 500_000 ? 'contextTierExtended' : 'contextTierMaximum', { window: capacity / 1000 })
  const color = !ready || capacity <= standard ? 'var(--dsw-alias-label-secondary)' : capacity <= 500_000 ? '#3b82f6' : '#d97706'
  const title = ready ? t('contextIndicatorTitle', { tier: tierLabel }) : t('contextIndicatorUnavailable')
  const save = async (next: OpenAICodexContextTier) => {
    if (!writable || writing.current || next === tier || configScope === undefined) return
    const latest = configScope.getSnapshot()
    if (latest.status !== 'ready' || !latest.writable || latest.mode === 'memory' || latest.value === undefined || latest.revision === undefined) return
    const current = generation.current
    writing.current = true; setBusy(true); setError(false)
    try {
      // A model-key operation preserves other model preferences; Host owns queueing, validation and revision checks.
      const saved = await configScope.mutate([{ op: 'set', path: ['modelContextTiers', model], value: next }], latest.revision)
      if (generation.current === current) setError(!saved)
    } catch {
      if (generation.current === current) setError(true)
    } finally {
      writing.current = false; setBusy(false)
    }
  }
  const floating = { position: 'absolute' as const, bottom: 'calc(100% + 8px)', left, zIndex: 1000,
    boxSizing: 'border-box' as const, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, #fff)',
    color: 'var(--dsw-alias-label-primary)', boxShadow: 'var(--dsw-shadow-lv2, 0 3px 12px rgb(0 0 0 / 12%))', fontSize: 12, lineHeight: '18px' }
  return <span ref={root} style={{ display: 'inline-flex', position: 'relative', width: 30, height: 30 }}>
    <button ref={button} type="button" aria-label={title} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}
      aria-describedby={hovered && !open ? tooltipId : undefined} aria-busy={busy} aria-disabled={!ready}
      data-openai-codex-context-window={ready ? capacity : 'unconfirmed'}
      onMouseEnter={() => { if (!open) { locate(180); setHovered(true) } }} onMouseLeave={() => { setHovered(false) }}
      onFocus={() => { if (!open) { locate(180); setHovered(true) } }} onBlur={() => { setHovered(false) }}
      onClick={() => { if (!ready) return; locate(140); setHovered(false); setOpen(previous => !previous) }}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, padding: 0, border: 0, background: 'transparent', borderRadius: 8, color, cursor: 'pointer' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
        <path d="M3 3l5 5M21 3l-5 5M21 21l-5-5M3 21l5-5" />
      </svg>
    </button>
    {hovered && !open ? <span id={tooltipId} role="tooltip" style={{ ...floating, background: 'var(--dsw-specific-tip, #1f2329)', color: 'var(--dsw-alias-label-primary, #fff)', width: 'min(180px, calc(100vw - 32px))', padding: '4px 8px', pointerEvents: 'none' }}>{title}</span> : null}
    {open ? <span id={dialogId} role="dialog" aria-label={t('modelContextTier')} style={{ ...floating, width: 140, maxWidth: 'calc(100vw - 32px)', padding: '6px 8px', border: '1px solid var(--dsw-alias-border-l2)' }}>
      <OpenAICodexContextSlider key={model} model={model} standard={standard} tier={tier} label={`${t('modelContextTier')} (${model})`} disabled={!writable || busy}
        onChange={next => { void save(next) }} />
      {error ? <span role="alert" style={{ fontSize: 10, color: 'var(--dsw-alias-state-error-primary)' }}>{t('contextSaveFailed')}</span> : null}
    </span> : null}
  </span>
}
