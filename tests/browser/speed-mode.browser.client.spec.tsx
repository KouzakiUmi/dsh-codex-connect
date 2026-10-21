import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { OpenAICodexSpeedControl } from '../../src/client/OpenAICodexSpeedControl.tsx'
import { en, zh } from '../../src/client/locales.ts'
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(() => { root?.unmount(); host?.remove(); vi.unstubAllGlobals() })
it.each(['en', 'zh'] as const)('keeps speed choices explicit and mutually exclusive in Chromium (%s)', async language => {
  await page.viewport(390, 844)
  let revision = 0, mode = 'standard'
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init: RequestInit) => {
    if (init.method === 'DELETE') return new Response('{}', { headers: { 'content-type': 'application/json' } })
    if (init.method === 'POST') { mode = JSON.parse(String(init.body)).mode; revision++; calls.push(mode) }
    return new Response(JSON.stringify({ generation: 'browser-speed', revision, mode, model: 'gpt-6.1-sol', modelSupported: true,
      hasAccount: true, selectionAvailable: true, eligibility: 'unknown' }), { headers: { 'content-type': 'application/json' } })
  }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const strings = language === 'en' ? en : zh
  root.render(<OpenAICodexSpeedControl sessionId="browser-session" model="gpt-6.1-sol" t={key => strings[key]} />)
  await expect.element(page.getByRole('button', { name: strings.speedStandard, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Ultrafast', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Ultrafast', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.element(page.getByText(strings.ultrafastDisclosure, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: strings.speedFast, exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Ultrafast', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect.element(page.getByRole('button', { name: strings.speedFast, exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(calls).toEqual(['ultrafast', 'fast'])
})
