/** Read-only saved model window; never changes conversation or profile settings. */
import { useId, useRef, useState, useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { OpenAICodexConfigForm } from './config-form.ts'
import type { OpenAICodexSettingsKey } from './locales.ts'
import { openAICodexContextLimit, openAICodexDefaultContextWindow, openAICodexModelContextWindow } from '../model-contract.ts'

export interface OpenAICodexContextIndicatorInjected {
  directory: SnapshotStore<ModelDirectoryState>
  configScope?: Pick<OpenAICodexConfigForm, 'subscribe' | 'getSnapshot'>
}
export function OpenAICodexContextIndicator({ directory, configScope, t }: OpenAICodexContextIndicatorInjected & {
  t: (key: OpenAICodexSettingsKey, params?: Record<string, unknown>) => string
}) {
  const directoryState = useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot(), () => directory.getSnapshot())
  const snapshot = useSyncExternalStore(listener => configScope?.subscribe(listener) ?? (() => undefined), () => configScope?.getSnapshot(), () => configScope?.getSnapshot())
  const [hovered, setHovered] = useState(false)
  const [tooltipLeft, setTooltipLeft] = useState(0)
  const anchor = useRef<HTMLSpanElement>(null)
  const showTooltip = () => {
    const rect = anchor.current?.getBoundingClientRect()
    if (rect !== undefined) {
      const width = Math.min(300, window.innerWidth - 32)
      const left = Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16))
      setTooltipLeft(left - rect.left)
    }
    setHovered(true)
  }
  const tooltipId = useId()
  const model = directoryState.current?.model ?? ''
  if (directoryState.status !== 'ready' || directoryState.current?.provider !== 'openai-codex'
    || openAICodexContextLimit(model, 0).maxContextWindow === 0) return null
  const ready = snapshot?.status === 'ready' && snapshot.value !== undefined && snapshot.mode !== 'memory'
  const tier = snapshot?.value?.modelContextTiers?.[model] ?? 'standard'
  const capacity = openAICodexModelContextWindow(model, openAICodexDefaultContextWindow(model), tier)
  const label = ready ? `${capacity / 1000}K` : '…'
  const color = !ready || capacity <= 272_000 ? 'var(--dsw-alias-label-secondary)' : capacity <= 500_000 ? '#3b82f6' : '#d97706'
  const title = ready ? t('contextIndicatorTitle', { model, window: label }) : t('contextIndicatorUnavailable')
  return <span ref={anchor} role="status" tabIndex={0} aria-label={title} aria-describedby={hovered ? tooltipId : undefined}
    data-openai-codex-context-window={ready ? capacity : 'unconfirmed'}
    onMouseEnter={showTooltip} onMouseLeave={() => { setHovered(false) }}
    onFocus={showTooltip} onBlur={() => { setHovered(false) }}
    style={{ display: 'inline-flex', position: 'relative', alignItems: 'center', minHeight: 30, padding: '0 5px', borderRadius: 6, color, fontSize: 12, fontWeight: 600, cursor: 'help' }}>
    {label}
    {hovered ? <span id={tooltipId} role="tooltip" style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: tooltipLeft, zIndex: 1000,
      boxSizing: 'border-box', width: 'min(300px, calc(100vw - 32px))', padding: '8px 10px', borderRadius: 6, background: 'var(--dsw-specific-tip, #1f2329)',
      color: 'var(--dsw-alias-label-primary, #fff)', boxShadow: 'var(--dsw-shadow-lv2)', fontSize: 12, lineHeight: '18px', fontWeight: 400, pointerEvents: 'none' }}>
      {title}<br />{t('contextIndicatorHelp')}
      {ready && capacity > 272_000 ? <><br />{t('extendedContextWarning')}</> : null}
    </span> : null}
  </span>
}
