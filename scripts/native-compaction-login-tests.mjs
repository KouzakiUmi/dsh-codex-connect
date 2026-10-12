/** Synthetic login-reader regression: no credentials, network or temporary files. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const entrypoints = [
  ['native-compaction-durable-smoke.mjs', 'readLogin', 'CREDENTIAL_FILE_UNSAFE'],
  ['native-compaction-luna-smoke.mjs', 'readCodexLogin', 'CODEX_LOGIN_FILE_UNSAFE'],
]
const info = (ino = 1n, dev = 1n, link = false, file = true) => ({
  ino, dev, nlink: 1n, size: 1, mode: 0o600, uid: 1000,
  isFile: () => file, isSymbolicLink: () => link,
})

for (const [filename, name, unsafe] of entrypoints) {
  const source = await readFile(new URL(filename, import.meta.url), 'utf8')
  const start = source.indexOf(`async function ${name}() {`)
  assert.notEqual(start, -1)
  const end = source.indexOf('\n}', start)
  assert.notEqual(end, -1)
  const readerSource = source.slice(start, end + 2)
  for (const platform of ['win32', 'linux']) {
    for (const [scenario, before, opened, after, accepted] of [
      ['regular file', info(), info(), info(), true],
      ['initial hardlink', { ...info(), nlink: 2n }, info(), info(), false],
      ['hardlink on opened handle', info(), { ...info(), nlink: 2n }, info(), false],
      ['hardlink after open', info(), info(), { ...info(), nlink: 2n }, false],
      ['hardlink just before read', info(), info(), info(), false],
      ['unlinked opened handle', info(), { ...info(), nlink: 0n }, info(), false],
      ['initial symlink', info(1n, 1n, true, false), info(), info(), false],
      ['initial non-file', info(1n, 1n, false, false), info(), info(), false],
      ['replaced before open', info(), info(2n), info(2n), false],
      ['changed device', info(), info(1n, 2n), info(1n, 2n), false],
      ['replaced after open', info(), info(), info(2n), false],
      ['linked after open', info(), info(), info(1n, 1n, true, false), false],
      ['large distinct identities', info(9007199254740992n), info(9007199254740993n), info(9007199254740993n), false],
      ['oversized file', info(), { ...info(), size: 512 * 1024 + 1 }, info(), false],
      ['unsafe Unix permissions', info(), { ...info(), mode: 0o644 }, info(), platform === 'win32'],
    ]) {
      test(`${filename}: ${platform}: ${scenario}`, async () => {
        let opens = 0
        let reads = 0
        let closes = 0
        let stats = 0
        const reject = code => { throw new Error(code) }
        const access = `header.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600,
          'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic' } })).toString('base64url')}.synthetic`
        const bytes = Buffer.from(JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: access, account_id: 'synthetic' } }))
        const reader = runInNewContext(`(${readerSource})`, {
          process: { platform, env: {}, getuid: () => 1000 }, Buffer,
          constants: { O_RDONLY: 0, O_NOFOLLOW: 0 },
          authPath: () => 'synthetic-auth', join: () => 'synthetic-auth', homedir: () => 'synthetic-home',
          lstat: async (_path, options) => { assert.equal(options.bigint, true); return stats++ === 0 ? before : after },
          open: async () => { opens++; return {
            stat: async options => options?.bigint ? opened : { ...opened, nlink: scenario === 'hardlink just before read' ? 2 : Number(opened.nlink) },
            readFile: async () => { reads++; return bytes },
            close: async () => { closes++ },
          } },
          fail: reject, stop: reject, digest: () => 'synthetic-fingerprint', codexCredential: value => value,
        })
        if (accepted) await reader()
        else await assert.rejects(reader(), { message: unsafe })
        assert.equal(reads, accepted ? 1 : 0)
        assert.equal(closes, opens)
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) assert.equal(opens, 0)
      })
    }
  }
}
