/** Compact discrete slider shared by staged settings and the immediate-save popover. */
import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { openAICodexContextChoices, openAICodexModelContextWindow } from '../model-contract.ts'
import type { OpenAICodexContextTier } from '../model-contract.ts'

export interface OpenAICodexContextSliderProps {
  model: string
  standard: number
  tier: OpenAICodexContextTier
  label: string
  disabled?: boolean
  onChange: (tier: OpenAICodexContextTier) => void
}
export function OpenAICodexContextSlider({ model, standard, tier, label, disabled = false, onChange }: OpenAICodexContextSliderProps) {
  const choices = openAICodexContextChoices(model, standard)
  const selected = Math.max(0, choices.findIndex(choice => choice.window === openAICodexModelContextWindow(model, standard, tier)))
  const [preview, setPreview] = useState<number | undefined>()
  const drag = useRef<{ pointer: number; index: number } | undefined>(undefined)
  const locked = disabled || choices.length === 1
  const current = preview ?? selected
  const active = choices[Math.max(0, Math.min(choices.length - 1, Math.round(current)))]!
  const color = active.tier === 'maximum' ? '#d97706' : active.tier === 'extended' ? '#3b82f6' : 'var(--dsw-alias-label-secondary)'
  const position = (index: number) => `${(index + .5) * 100 / choices.length}%`
  const rawPosition = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return rect.width > 0 ? Math.max(0, Math.min(choices.length - 1, (event.clientX - rect.left) / rect.width * choices.length - .5)) : selected
  }
  const cancel = () => { drag.current = undefined; setPreview(undefined) }
  const choose = (index: number) => {
    const choice = choices[index]
    if (!locked && choice !== undefined && choice.tier !== tier) onChange(choice.tier)
  }
  return <div role="slider" tabIndex={locked ? -1 : 0} aria-label={label} aria-disabled={locked}
    aria-valuemin={0} aria-valuemax={choices.length - 1} aria-valuenow={Math.round(current)} aria-valuetext={`${active.window / 1000}K`}
    data-openai-codex-context-slider={model}
    onKeyDown={event => {
      if (locked) return
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(0, selected - 1)
          : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.min(choices.length - 1, selected + 1) : undefined
      if (index !== undefined) { event.preventDefault(); choose(index) }
      if (event.key === 'Escape') cancel()
    }}
    onPointerDown={event => {
      if (locked || event.button !== 0) return
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
      const index = Math.round(rawPosition(event))
      drag.current = { pointer: event.pointerId, index }; setPreview(index)
    }}
    onPointerMove={event => {
      const state = drag.current
      if (locked || state === undefined || state.pointer !== event.pointerId) return
      const raw = rawPosition(event)
      // Hysteresis resists hovering at a boundary; a small elastic offset makes detents tactile.
      if (raw > state.index + .62 || raw < state.index - .62) state.index = Math.round(raw)
      setPreview(state.index + Math.tanh((raw - state.index) * 3) * .09)
    }}
    onPointerUp={event => {
      const state = drag.current
      if (state === undefined || state.pointer !== event.pointerId) return
      const index = state.index; cancel()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      choose(index)
    }} onPointerCancel={cancel} onLostPointerCapture={cancel}
    style={{ position: 'relative', width: 140, maxWidth: '100%', height: 30, flexShrink: 0, touchAction: 'pan-y', userSelect: 'none', cursor: locked ? 'default' : 'ew-resize', opacity: disabled ? .5 : 1 }}>
    <span aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: `repeat(${choices.length}, 1fr)`, fontSize: 10, lineHeight: '16px', textAlign: 'center' }}>
      {choices.map((choice, index) => <span key={choice.tier} style={{ color: index === Math.round(current) ? color : 'var(--dsw-alias-label-secondary)' }}>{choice.window / 1000}K</span>)}
    </span>
    <span aria-hidden="true" style={{ position: 'absolute', left: position(0), right: position(0), bottom: 5, height: 2, borderRadius: 999, background: 'var(--dsw-alias-border-l2)' }} />
    {choices.map((choice, index) => <span key={choice.tier} aria-hidden="true" style={{ position: 'absolute', left: position(index), transform: 'translateX(-50%)', bottom: 3, width: 6, height: 6, borderRadius: '50%', background: 'var(--dsw-alias-border-l2)' }} />)}
    <span aria-hidden="true" data-openai-codex-context-thumb style={{ position: 'absolute', left: position(current), transform: 'translateX(-50%)', bottom: 0, width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--dsw-alias-bg-layer-1)', boxSizing: 'border-box', background: color, transition: `left ${drag.current === undefined ? 240 : 65}ms cubic-bezier(.22,1.16,.36,1)` }} />
  </div>
}
