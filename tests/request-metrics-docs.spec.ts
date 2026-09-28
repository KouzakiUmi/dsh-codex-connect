import { readFile, access } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('local metrics public documentation', () => {
  it.each(['request-metrics.md', 'request-metrics.zh.md'])('keeps %s self-contained and operational', async name => {
    const url = new URL('../docs/' + name, import.meta.url)
    const text = await readFile(url, 'utf8')
    for (const required of ['requestMetricsDirectory', 'requestMetricsMaxBytes', '16777216', '4096', '67108864', '--file', '--session', '--json', '0700', '0600']) expect(text).toContain(required)
    expect(text).not.toMatch(/\/Users\/|\/private\/tmp\/|experiments\/autonomy-evaluation/u)
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1]!
      if (!target.includes('://') && !target.startsWith('#')) await expect(access(new URL(target, url))).resolves.toBeUndefined()
    }
  })
  it.each(['reference.md', 'reference.zh.md'])('indexes startup-only metrics options in %s', async name => {
    const text = await readFile(new URL('../docs/' + name, import.meta.url), 'utf8')
    expect(text).toContain('`requestMetricsDirectory`')
    expect(text).toContain('`requestMetricsMaxBytes`')
    expect(text).toContain('request-metrics')
  })
})
