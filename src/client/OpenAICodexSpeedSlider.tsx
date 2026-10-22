/** Three-detent speed slider, matching the context picker interaction. */
import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { OpenAICodexSpeedMode } from '../speed-mode-contract.ts'

const modes = ['standard', 'fast', 'ultrafast'] as const
export const SPEED_ACTIVE_COLORS: Readonly<Record<OpenAICodexSpeedMode, string>> = {
  standard: 'var(--dsw-alias-label-secondary)', fast: '#f97316', ultrafast: '#d97706',
}

export function OpenAICodexSpeedSlider({ mode, label, labels, disabled, canUltra, unavailableTitle, onChange }: {
  mode: OpenAICodexSpeedMode
  label: string
  labels: readonly string[]
  disabled: boolean
  canUltra: boolean
  unavailableTitle: string
  onChange: (mode: OpenAICodexSpeedMode) => void
}) {
  const selected = modes.indexOf(mode)
  const [preview, setPreview] = useState<number>()
  const drag = useRef<{ pointer: number; index: number }>()
  const current = preview ?? selected
  const active = modes[Math.round(current)]!
  const position = (index: number) => `${(index + .5) * 100 / modes.length}%`
  const rawPosition = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return rect.width > 0 ? Math.max(0, Math.min(2, (event.clientX - rect.left) / rect.width * 3 - .5)) : selected
  }
  const cancel = () => { drag.current = undefined; setPreview(undefined) }
  const choose = (index: number) => {
    const next = modes[index]
    if (!disabled && next !== undefined && next !== mode && (next !== 'ultrafast' || canUltra)) onChange(next)
  }
  return <div role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled}
    aria-valuemin={0} aria-valuemax={canUltra || mode === 'ultrafast' ? 2 : 1} aria-valuenow={Math.round(current)} aria-valuetext={labels[Math.round(current)]}
    data-openai-codex-speed-slider="" title={!canUltra ? unavailableTitle : undefined}
    onKeyDown={event => {
      if (event.key === 'Escape') { cancel(); return }
      if (disabled) return
      const max = canUltra ? 2 : 1
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? max
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(0, selected - 1)
          : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.min(max, selected + 1) : undefined
      if (index !== undefined) { event.preventDefault(); choose(index) }
    }}
    onPointerDown={event => {
      if (disabled || event.button !== 0) return
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
      const index = Math.round(rawPosition(event))
      drag.current = { pointer: event.pointerId, index }; setPreview(index)
    }}
    onPointerMove={event => {
      const state = drag.current
      if (disabled || state === undefined || state.pointer !== event.pointerId) return
      const raw = rawPosition(event)
      if (raw > state.index + .62 || raw < state.index - .62) state.index = Math.round(raw)
      setPreview(state.index + Math.tanh((raw - state.index) * 3) * .09)
    }}
    onPointerUp={event => {
      const state = drag.current
      if (state === undefined || state.pointer !== event.pointerId) return
      cancel()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      choose(state.index)
    }} onPointerCancel={cancel} onLostPointerCapture={cancel}
    style={{ position: 'relative', width: 140, maxWidth: '100%', height: 30, flexShrink: 0, touchAction: 'pan-y', userSelect: 'none', cursor: disabled ? 'default' : 'ew-resize', opacity: disabled ? .5 : 1 }}>
    <span aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', fontSize: 10, lineHeight: '16px', textAlign: 'center' }}>
      {modes.map((entry, index) => <span key={entry} style={{ color: index === Math.round(current) ? SPEED_ACTIVE_COLORS[active] : 'var(--dsw-alias-label-secondary)', opacity: entry === 'ultrafast' && !canUltra ? .5 : 1 }}>{labels[index]}</span>)}
    </span>
    <span aria-hidden="true" style={{ position: 'absolute', left: position(0), right: position(0), bottom: 5, height: 2, borderRadius: 999, background: 'var(--dsw-alias-border-l2)' }} />
    {modes.map((entry, index) => <span key={entry} aria-hidden="true" style={{ position: 'absolute', left: position(index), transform: 'translateX(-50%)', bottom: 3, width: 6, height: 6, borderRadius: '50%', background: 'var(--dsw-alias-border-l2)' }} />)}
    <span aria-hidden="true" data-openai-codex-speed-thumb="" style={{ position: 'absolute', left: position(current), transform: 'translateX(-50%)', bottom: 0, width: 12, height: 12, borderRadius: '50%', border: 0, boxSizing: 'border-box', background: SPEED_ACTIVE_COLORS[active], transition: drag.current === undefined ? 'left 100ms ease-out' : 'none' }} />
  </div>
}
