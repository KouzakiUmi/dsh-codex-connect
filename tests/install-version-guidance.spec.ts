import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const install = await readFile(new URL('../INSTALL.md', import.meta.url), 'utf8')
const compatibility = JSON.parse(await readFile(new URL('../verified-compatibility.json', import.meta.url), 'utf8'))
const firstInstall = install.indexOf('dsh plugin --profile web add ')
const preflight = install.slice(0, firstInstall)
const shellBlocks = [...install.matchAll(/```sh\s*\n([\s\S]*?)```/gu)]
  .flatMap(match => (match[1] ?? '').split('\n').map(line => line.trim()))

describe('installation version guidance', () => {
  it('keeps the alpha.4 host source candidate separate from published plugin pairings', async () => {
    const [english, chinese] = await Promise.all([
      readFile(new URL('../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../docs/README.zh.md', import.meta.url), 'utf8'),
    ])
    expect(english).toContain('**Unreleased source candidate:**')
    expect(chinese).toContain('**尚未发布的源码候选：**')
    expect(install).toContain('unreleased source candidate for DSH `0.2.1-alpha.4`')
    expect(compatibility.pluginVersions.every((entry: { verifiedDshVersions: string[] }) =>
      !entry.verifiedDshVersions.includes('0.2.1-alpha.4'))).toBe(true)
  })

  it.each([
    ['0.1.0-rc.7', '0.1.0-alpha.4.14'],
    ['0.1.1-rc.2', '0.1.0-alpha.4.21'],
    ['0.1.2-alpha.2', '0.1.0-alpha.4.23'],
    ['0.1.2-alpha.5', '0.1.0-alpha.4.25'],
    ['0.1.2-rc.1', '0.1.0-alpha.4.41'],
    ['0.1.5-alpha.1', '0.1.0-alpha.4.41'],
    ['0.1.5-rc.1', '0.1.0-alpha.4.41'],
    ['0.1.5-rc.2', '0.1.0-alpha.4.41'],
    ['0.1.7-rc.1', '0.2.0-alpha.4'],
    ['0.1.7-rc.2', '0.2.0-alpha.4'],
    ['0.2.0-rc.1', '0.2.0-alpha.4'],
    ['0.2.0-rc.2', '0.2.0-alpha.4'],
    ['0.2.1-alpha.1', '0.2.0-alpha.4'],
    ['0.2.1-alpha.2', '0.2.0-alpha.4'],
    ['0.2.1-alpha.3', '0.2.0-alpha.4'],
  ])('selects the recorded DSH %s / Codex Connect %s pair before installation', (dsh, plugin) => {
    expect(firstInstall).toBeGreaterThan(0)
    expect(compatibility.pluginVersions).toContainEqual(expect.objectContaining({
      version: plugin,
      verifiedDshVersions: expect.arrayContaining([dsh]),
    }))
    const rows = preflight.split('\n').filter(line => line.trim().startsWith('|'))
      .map(line => line.split('|').slice(1, -1).map(cell => cell.replaceAll('`', '').trim()))
    expect(rows).toContainEqual([dsh, plugin])
    expect(shellBlocks).toContain(`dsh plugin --profile web add dsh-codex-connect@${plugin}`)
  })

  it('reports the published pairing and default channel without claiming live acceptance', async () => {
    const [english, chinese] = await Promise.all([
      readFile(new URL('../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../docs/README.zh.md', import.meta.url), 'utf8'),
    ])
    for (const guide of [english, chinese]) {
      expect(guide).toContain('dsh plugin --profile web add dsh-codex-connect@0.2.0-alpha.4')
      expect(guide).toContain('`latest`')
      expect(guide).toContain('`0.1.7-rc.1`')
      expect(guide).toContain('`0.1.7-rc.2`')
      expect(guide).toContain('`0.2.0-rc.1`')
      expect(guide).toContain('`0.2.0-rc.2`')
      expect(guide).toContain('`0.2.1-alpha.1`')
      expect(guide).toContain('`0.2.1-alpha.2`')
      expect(guide).toContain('`0.2.1-alpha.3`')
    }
    expect(english).toContain('**Published experiment:**')
    expect(english).toContain('disabled by default')
    expect(english).toContain('Real-account Reserve entry and recovery remain unverified')
    expect(chinese).toContain('**已发布的实验功能：**')
    expect(chinese).toContain('仍默认关闭')
    expect(chinese).toContain('仍未验证')
    expect(install).toContain('Channel snapshot on 2026-10-14: npm `alpha` points to `0.2.0-alpha.4`; `latest` remains `0.2.0-alpha.1`')
    expect(english).toContain('As of 2026-10-14, npm `alpha` points to `0.2.0-alpha.4`, while `latest` remains `0.2.0-alpha.1`')
    expect(chinese).toContain('截至 2026-10-14，npm `alpha` 指向 `0.2.0-alpha.4`，`latest` 仍为 `0.2.0-alpha.1`')
    expect(install).toContain('Stock rc.1 keeps Task controls paused')
    expect(install).toContain('enableReserveFallback: false')
  })

  it('scopes the version-only Desktop comparison to historical alpha.3, not alpha.4 acceptance', async () => {
    const [english, chinese] = await Promise.all([
      readFile(new URL('../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../docs/README.zh.md', import.meta.url), 'utf8'),
    ])
    expect(english).toContain('Only the historical `0.2.0-alpha.3` client was compared with that local adaptation and found to differ only by the package-version string')
    expect(english).toContain('does not establish `0.2.0-alpha.4` Desktop or live-account acceptance')
    expect(english).not.toContain('The released client differs only by the package-version string')
    expect(chinese).toContain('仅历史 `0.2.0-alpha.3` 客户端与该本地适配包进行了比较，确认只差包版本字符串')
    expect(chinese).toContain('不代表 `0.2.0-alpha.4` 的 Desktop 或真实账户验收')
    expect(chinese).not.toContain('发布客户端与该客户端仅版本字符串不同')
    expect(install).toContain('On 2026-10-10 the maintainer reported successful login and normal use')
    expect(install).toContain('not independent live-account verification of a later npm artifact')
  })

  it('requires version checks and warns against blind alpha installation before any add command', () => {
    expect(preflight).toContain('dsh --version')
    expect(preflight).toContain('verified-compatibility.json')
    expect(preflight).toMatch(/(?:unknown|not listed|unlisted)[^.]*\b(?:verify|check)\b/iu)
    expect(preflight).toMatch(/(?:do not|never)[^\n]*dsh-codex-connect@alpha/iu)
    expect(shellBlocks).not.toContain('dsh plugin --profile web add dsh-codex-connect@alpha')
  })

  it('uses the bundled CLI and separate profile for the published Desktop installation', () => {
    expect(shellBlocks).toContain('"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" --version')
    expect(shellBlocks).toContain('"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add dsh-codex-connect@0.2.0-alpha.4')
    expect(install).toContain('fully quit it before CLI package operations')
    expect(install).toContain('Use the intended `DSH_HOME`')
    expect(install).toContain('Preserve profile patches, default models, optional capabilities and OAuth state')
    expect(install).toContain('Reopen Desktop after installing')
    expect(install).not.toContain('trust-origin dsh-app://app')
  })

  it('retains exact GitHub fallbacks for the latest releases when npm is unavailable', () => {
    expect(install).toMatch(/npm is unavailable[^\n]*github:franksong2702\/dsh-codex-connect#v0\.1\.0-alpha\.4\.21/iu)
    expect(install).toMatch(/npm is unavailable[^\n]*github:franksong2702\/dsh-codex-connect#v0\.1\.0-alpha\.4\.23/iu)
    expect(install).toMatch(/npm is unavailable[^\n]*github:franksong2702\/dsh-codex-connect#v0\.1\.0-alpha\.4\.25/iu)
    expect(install).toMatch(/npm is unavailable[^\n]*github:franksong2702\/dsh-codex-connect#v0\.1\.0-alpha\.4\.41/iu)
    expect(install).toMatch(/npm is unavailable[^\n]*github:franksong2702\/dsh-codex-connect#v0\.1\.0-alpha\.4\.46/iu)
    expect(install).toMatch(/npm is unavailable[^\n]*github:franksong2702\/dsh-codex-connect#v0\.2\.0-alpha\.4/iu)
  })
})
