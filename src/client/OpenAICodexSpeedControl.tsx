/** Explicit, nonpersistent conversation speed; a selected hint is not served-tier proof. */
import { useEffect, useRef, useState } from 'react'
import { OPENAI_CODEX_SPEED_MODE_PATH, readConversationSpeed } from '../speed-mode-contract.ts'
import type { ConversationSpeedState, OpenAICodexSpeedMode } from '../speed-mode-contract.ts'
import type { OpenAICodexSettingsKey } from './locales.ts'
import { requestJson } from './request-json.ts'

type Translate = (key: OpenAICodexSettingsKey) => string
export function OpenAICodexSpeedControl({ sessionId, model, t, available = true }: { sessionId: string; model: string; t: Translate; available?: boolean }) {
  const [selection, setSelection] = useState<ConversationSpeedState>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfirmed'>('loading')
  const [readAttempt, setReadAttempt] = useState(0)
  const controller = useRef<AbortController | undefined>(undefined)

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

  const select = (mode: OpenAICodexSpeedMode): void => {
    if (status !== 'ready' || selection === undefined || controller.current !== undefined) return
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
  const canUltra = available && selection?.modelSupported === true && selection.hasAccount && selection.selectionAvailable
  return <span role="group" aria-label="Codex speed" style={{ display: 'inline-flex', flexWrap: 'wrap', maxWidth: '100%', alignItems: 'center', gap: 4 }}>
    {status === 'unconfirmed' ? <button type="button" onClick={() => { setReadAttempt(n => n + 1) }}>{t('speedRecover')}</button>
      : (['standard', 'fast', 'ultrafast'] as const).map(mode => <button key={mode} type="button"
        aria-pressed={status === 'ready' && selection?.mode === mode}
        aria-busy={status === 'loading'} disabled={status !== 'ready' || (mode === 'ultrafast' && !canUltra)}
        title={mode === 'ultrafast' ? t(canUltra ? 'ultrafastDisclosure' : 'ultrafastUnavailable') : undefined}
        onClick={() => { select(mode) }}
        style={{ borderRadius: 6, padding: '3px 6px', border: selection?.mode === mode ? '1px solid #f97316' : '1px solid var(--dsw-alias-border, #777)',
          background: selection?.mode === mode ? 'var(--dsw-alias-background-secondary, rgba(249,115,22,0.18))' : 'transparent', color: 'inherit', fontSize: 12 }}>
        {mode === 'standard' ? t('speedStandard') : mode === 'fast' ? t('speedFast') : 'Ultrafast'}
      </button>)}
    {status === 'loading' && <span role="status">{t('speedLoading')}</span>}
    {status === 'ready' && selection?.mode === 'ultrafast' && <small style={{ flexBasis: '100%', maxWidth: 260, fontSize: 11 }}>{t('ultrafastDisclosure')}</small>}
  </span>
}
