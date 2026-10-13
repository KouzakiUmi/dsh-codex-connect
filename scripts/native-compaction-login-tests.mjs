/** Synthetic login-reader regression: no credentials, network or temporary files. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const entrypoints = [
  ['native-compaction-durable-smoke.mjs', 'readLogin', 'CREDENTIAL_FILE_UNSAFE'],
  ['native-compaction-luna-smoke.mjs', 'readCodexLogin', 'CODEX_LOGIN_FILE_UNSAFE'],
]
const expiry = Date.now() / 1000 + 3600
const credentialBytes = account => {
  const access = `header.${Buffer.from(JSON.stringify({ exp: expiry,
    'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.synthetic`
  return Buffer.from(JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: access, account_id: account } }))
}
const bytes = credentialBytes('synthetic')
const info = (ino = 1n, dev = 1n, link = false, file = true) => ({
  ino, dev, nlink: 1n, size: BigInt(bytes.length), mode: 0o600n, uid: 1000n,
  mtimeNs: 10000000000000000n, ctimeNs: 10000000000000000n,
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
      ['oversized file', info(), { ...info(), size: 512n * 1024n + 1n }, info(), false],
      ['unsafe Unix permissions', ...Array.from({ length: 3 }, () => ({ ...info(), mode: 0o644n })), platform === 'win32'],
    ]) {
      test(`${filename}: ${platform}: ${scenario}`, async () => {
        let opens = 0, reads = 0, closes = 0, stats = 0
        const reject = code => { throw new Error(code) }
        const reader = runInNewContext(`(${readerSource})`, {
          process: { platform, env: {}, getuid: () => 1000 }, Buffer,
          constants: { O_RDONLY: 0, O_NOFOLLOW: 0 },
          authPath: () => 'synthetic-auth', join: () => 'synthetic-auth', homedir: () => 'synthetic-home',
          lstat: async (_path, options) => { assert.equal(options.bigint, true); return stats++ === 0 ? before : after },
          open: async () => { opens++; return {
            stat: async options => options?.bigint ? opened : { ...opened, size: Number(opened.size), mode: Number(opened.mode),
              uid: Number(opened.uid), nlink: scenario === 'hardlink just before read' ? 2 : Number(opened.nlink) },
            read: async (buffer, offset, length, position) => {
              const count = Math.min(length, Math.max(0, bytes.length - position))
              if (count) reads++
              bytes.copy(buffer, offset, position, position + count)
              return { bytesRead: count }
            },
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
    for (const scenario of ['partial reads', 'valid account rewrite', 'mtime changed', 'ctime changed', 'hardlink added',
      'hardlink added then removed', 'handle unlinked', 'path replaced', 'path linked', 'permissions changed',
      'grew during read', 'truncated during read', 'read failure', 'post-read stat failure', 'post-read path failure']) {
      test(`${filename}: ${platform}: post-read ${scenario}`, async () => {
        let stats = 0, identities = 0, readBytes = 0, reads = 0, closes = 0, decoded = 0
        const snapshot = info(), rewrite = credentialBytes('alternate')
        assert.equal(rewrite.length, bytes.length)
        const failure = new Error('SYNTHETIC_IO_FAILURE')
        const reject = code => { throw new Error(code) }
        const reader = runInNewContext(`(${readerSource})`, {
          process: { platform, env: {}, getuid: () => 1000 }, Buffer,
          constants: { O_RDONLY: 0, O_NOFOLLOW: 0 },
          authPath: () => 'synthetic-auth', join: () => 'synthetic-auth', homedir: () => 'synthetic-home',
          lstat: async (_path, options) => {
            assert.equal(options.bigint, true)
            if (++stats === 3) {
              if (scenario === 'post-read path failure') throw failure
              if (scenario === 'path replaced') return info(2n)
              if (scenario === 'path linked') return info(1n, 1n, true, false)
            }
            return snapshot
          },
          open: async () => ({
            stat: async options => {
              if (!options?.bigint) return { ...snapshot, size: Number(snapshot.size), mode: Number(snapshot.mode), uid: 1000, nlink: 1 }
              if (++identities === 2) {
                if (scenario === 'post-read stat failure') throw failure
                if (scenario === 'valid account rewrite' || scenario === 'mtime changed') return { ...snapshot, mtimeNs: snapshot.mtimeNs + 1n }
                if (scenario === 'ctime changed' || scenario === 'hardlink added then removed') return { ...snapshot, ctimeNs: snapshot.ctimeNs + 1n }
                if (scenario === 'hardlink added') return { ...snapshot, nlink: 2n }
                if (scenario === 'handle unlinked') return { ...snapshot, nlink: 0n }
                if (scenario === 'permissions changed') return { ...snapshot, mode: 0o644n }
              }
              return snapshot
            },
            read: async (buffer, offset, length, position) => {
              reads++
              assert.equal(buffer.length, 512 * 1024 + 1)
              if (scenario === 'read failure') throw failure
              const content = scenario === 'valid account rewrite' ? rewrite
                : scenario === 'grew during read' ? Buffer.alloc(512 * 1024 + 100)
                  : scenario === 'truncated during read' ? bytes.subarray(0, 10) : bytes
              const count = Math.min(length, scenario === 'partial reads' ? 17 : length, Math.max(0, content.length - position))
              content.copy(buffer, offset, position, position + count); readBytes += count
              return { bytesRead: count }
            },
            close: async () => { closes++ },
          }),
          fail: reject, stop: reject, digest: () => { decoded++; return 'synthetic-fingerprint' },
          codexCredential: value => { decoded++; return value },
        })
        if (scenario === 'partial reads') { await reader(); assert.equal(decoded, 1); assert.ok(reads > 2) }
        else { await assert.rejects(reader(), { message: scenario.endsWith('failure') ? failure.message : unsafe }); assert.equal(decoded, 0) }
        assert.ok(readBytes <= 512 * 1024 + 1)
        assert.equal(closes, 1)
      })
    }
  }
}

const durableSource = await readFile(new URL('native-compaction-durable-smoke.mjs', import.meta.url), 'utf8')
const functionSource = name => {
  const start = durableSource.indexOf(`async function ${name}(`)
  assert.notEqual(start, -1)
  const end = durableSource.indexOf('\n}', start)
  assert.notEqual(end, -1)
  return durableSource.slice(start, end + 2)
}
for (const scenario of ['offline', 'matching', 'changed', 'missing', 'empty', 'malformed', 'uppercase', 'read failure']) {
  test(`durable child fingerprint: ${scenario}`, async () => {
    const expected = 'a'.repeat(64), credential = { accountId: 'synthetic-child' }
    let reads = 0
    const selector = runInNewContext(`(${functionSource('childCredential')})`, {
      LIVE: scenario !== 'offline',
      process: { env: { DSH_NATIVE_COMPACTION_EXPECTED_LOGIN: scenario === 'missing' ? undefined
        : scenario === 'empty' ? '' : scenario === 'malformed' ? 'bad' : scenario === 'uppercase' ? 'A'.repeat(64) : expected } },
      syntheticCredential: () => credential,
      readLogin: async () => {
        reads++
        if (scenario === 'read failure') throw new Error('SYNTHETIC_READER_FAILURE')
        return { fingerprint: scenario === 'changed' ? 'b'.repeat(64) : expected, credential }
      },
      fail: code => { throw new Error(code) },
    })
    if (scenario === 'offline' || scenario === 'matching') assert.equal(await selector(), credential)
    else await assert.rejects(selector(), { message: scenario === 'changed' ? 'CREDENTIAL_CHANGED_STOP'
      : scenario === 'read failure' ? 'SYNTHETIC_READER_FAILURE' : 'INVALID_CHILD_MODE' })
    assert.equal(reads, ['matching', 'changed', 'read failure'].includes(scenario) ? 1 : 0)
    assert.ok(durableSource.includes('const credential = await childCredential()'))
    assert.ok(durableSource.indexOf('const credential = await childCredential()') < durableSource.indexOf("const undici = await import('undici')"))
  })
}

test('durable parent binds both spawns to its original fingerprint, overriding ambient input without persistence/logging', async () => {
  const expected = 'a'.repeat(64), spawns = [], states = [], reports = []
  const parent = runInNewContext(`(${functionSource('main').replaceAll('import.meta.url', JSON.stringify(import.meta.url))})`, {
    CHILD: false, LIVE: true, MODEL: 'synthetic-model', SELF: 'synthetic-script', URL, Buffer,
    process: { argv: ['node', 'synthetic-script', '--live', '--codex-login'], platform: 'win32', version: 'synthetic', execPath: 'synthetic-node',
      env: { DSH_NATIVE_COMPACTION_EXPECTED_LOGIN: 'b'.repeat(64) } },
    parseDurableArgs: () => ({ caseName: 'oversized-user' }), stagesForCase: () => ['baseline', 'native', 'resume'],
    digest: () => 'synthetic-digest', readFile: async () => Buffer.from('synthetic-source'),
    readVerifiedDurableRuntime: async () => ({ '@deepseek-ai/dsh-llm': 'synthetic' }), readLogin: async () => ({ fingerprint: expected }),
    mkdtemp: async () => 'synthetic-root', tmpdir: () => 'synthetic-temp', join: (...parts) => parts.join('/'),
    randomBytes: () => Buffer.from('synthetic'), save: async (_path, state) => { states.push(state) },
    json: async () => ({ metrics: [] }), rm: async () => {},
    spawnSync: (_node, args, options) => { spawns.push({ args, options }); return { status: 0, stdout: JSON.stringify({ ok: true, report: { synthetic: true } }) } },
    safeError: () => 'SYNTHETIC_FAILURE', fail: code => { throw new Error(code) }, console: { log: report => reports.push(report) },
  })
  await parent()
  assert.equal(spawns.length, 2)
  for (const { args, options } of spawns) {
    assert.equal(options.env.DSH_NATIVE_COMPACTION_EXPECTED_LOGIN, expected)
    assert.ok(!args.some(value => value.includes(expected)))
  }
  for (const [index, spawn] of spawns.entries()) {
    const phase = index === 0 ? 'write' : 'resume'
    const state = { live: true, caseName: 'oversized-user', runtime_versions: {} }
    let reads = 0, providerImports = 0
    const runChild = runInNewContext(`${functionSource('childCredential')}\n${functionSource('child').replaceAll('import.meta.url', JSON.stringify(import.meta.url))}\nchild`, {
      LIVE: true, process: { env: { ...spawn.options.env }, argv: ['node', 'synthetic-script', '--child', phase, 'synthetic-root', '--live'] },
      join: (...parts) => parts.join('/'), json: async () => state,
      parseDurableArgs: () => ({ live: true, caseName: 'oversized-user' }), stagesForCase: () => ['baseline', 'native', 'resume'],
      readVerifiedDurableRuntime: async () => ({}),
      readLogin: async () => { reads++; return { fingerprint: 'b'.repeat(64), credential: { accountId: 'synthetic-replacement' } } },
      fail: code => { throw new Error(code) },
    }, { importModuleDynamically: () => { providerImports++; throw new Error('UNEXPECTED_PROVIDER_IMPORT') } })
    // Parent A and pre-spawn A were stable; the separately stable child B must stop before undici/adapter setup.
    await assert.rejects(runChild(phase, 'synthetic-root'), { message: 'CREDENTIAL_CHANGED_STOP' })
    assert.equal(reads, 1)
    assert.equal(providerImports, 0)
  }
  assert.ok(!JSON.stringify(states).includes(expected))
  assert.ok(!JSON.stringify(reports).includes(expected))
  assert.equal(JSON.parse(reports[0]).real_provider_dispatches, 0)
})
