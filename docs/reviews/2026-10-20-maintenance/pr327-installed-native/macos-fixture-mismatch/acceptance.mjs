#!/usr/bin/env node
/**
 * Bounded installed-CLI/native-store acceptance for PR #327.
 * Requires a separately installed candidate and explicit test-entry authorization.
 * Uses only fake data and newly generated locators; never enumerates OS entries.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createDecipheriv, createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { release } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

assert.equal(process.argv.length, 4, 'Usage: acceptance.mjs --synthetic-owned-entries-only <temporary-install-root>')
assert.equal(process.argv[2], '--synthetic-owned-entries-only', 'Explicit authorization flag required')
assert.ok(['darwin', 'linux'].includes(process.platform), 'This fixture was scoped to macOS and Linux')
assert.ok(!process.env.NODE_OPTIONS && !process.env.DSH_SYNTHETIC_KEYRING
  && !process.env.DSH_SYNTHETIC_KEYRING_DIRECTORY
  && !process.execArgv.some(value => /--(?:import|require|loader)/u.test(value)), 'Native acceptance rejects preload hooks')

const installRoot = await realpath(resolve(process.argv[3]))
const installedRequire = createRequire(join(installRoot, 'package.json'))
const packageRoot = await realpath(dirname(installedRequire.resolve('dsh-codex-connect/package.json')))
assert.ok(packageRoot.startsWith(installRoot + sep + 'node_modules' + sep), 'Candidate must be installed in the owned test prefix')
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
const bin = join(packageRoot, 'lib', 'bin.js')
const keyringFile = installedRequire.resolve('@napi-rs/keyring')
assert.ok((await realpath(keyringFile)).startsWith(installRoot + sep), 'Native binding must come from this installation')
const native = await import(pathToFileURL(keyringFile).href)
assert.notEqual(native.syntheticKeyring, true)
assert.equal(typeof native.AsyncEntry, 'function')

const ownedRoot = await realpath(await mkdtemp(join(installRoot, 'native-owned-home-')))
const service = 'dsh-codex-connect.oauth-encryption-key.v1'
const credential = {
  type: 'oauth', access: 'installed-native-fixture-access-not-a-token',
  refresh: 'installed-native-fixture-refresh-not-a-token',
  accountId: 'installed-native-fixture-account-not-real', expires: 60000,
}
const result = {
  schemaVersion: 1, platform: process.platform, architecture: process.arch,
  osRelease: release(), node: process.version, packageVersion: manifest.version,
  binSha256: createHash('sha256').update(await readFile(bin)).digest('hex'),
  keyringVersion: JSON.parse(await readFile(join(dirname(keyringFile), 'package.json'), 'utf8')).version,
  target: 'installed-standalone-cli', syntheticCredentials: true,
  nativeBindingUsed: true, liveProviderCommands: false,
  commands: [], steps: [], cleanup: { ownedEntries: 0, entriesAbsent: false, temporaryHomeRemoved: false },
}
const owned = []
let phase = 'preflight'
let failed = false

function childEnvironment(dshHome) {
  const env = {}
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR']) {
    if (process.env[name] !== undefined) env[name] = process.env[name]
  }
  // On macOS HOME selects the OS Keychain; isolate the plugin with DSH_HOME.
  return { ...env, HOME: process.platform === 'darwin' ? process.env.HOME : ownedRoot, DSH_HOME: dshHome,
    XDG_CONFIG_HOME: join(ownedRoot, 'config'), XDG_CACHE_HOME: join(ownedRoot, 'cache'),
    DSH_TELEMETRY_MODE: 'DISABLED' }
}
function cli(item, args, expected, extraEnv = {}) {
  const child = spawnSync(process.execPath, [bin, ...args], {
    env: { ...childEnvironment(item.home), ...extraEnv }, cwd: installRoot,
    encoding: 'utf8', timeout: 20000, maxBuffer: 65536,
  })
  const label = args.join(' ')
  result.commands.push({ name: label, expectedExit: expected, actualExit: child.status,
    signal: child.signal, processError: child.error?.code ?? null })
  assert.equal(child.error, undefined, label + ': process failed')
  assert.equal(child.status, expected, label + ': unexpected exit')
  for (const value of [credential.access, credential.refresh, credential.accountId]) {
    assert.equal((child.stdout + child.stderr).includes(value), false, label + ': exposed fixture data')
  }
  return child
}
function normalizedSecret(value) {
  if (value === null || value === undefined) return undefined
  assert.ok(value instanceof Uint8Array || (Array.isArray(value) && Array.from(value).every(
    byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)), 'Unexpected native secret shape')
  return Buffer.from(value)
}
async function readKey(item) { return normalizedSecret(await item.entry.getSecret()) }
async function ownedStore(name) {
  const home = join(ownedRoot, name)
  await mkdir(home, { mode: 0o700 })
  const filename = join(home, '.openai-codex-auth.json')
  const account = createHash('sha256').update(resolve(filename)).digest('hex')
  const entry = new native.AsyncEntry(service, account, { linux: { store: 'secret-service' } })
  const item = { home, filename, backup: filename + '.v1-backup', account, entry }
  assert.equal(await readKey(item), undefined, 'Unexpected pre-existing locator: refuse to use or delete')
  owned.push(item)
  // Persist only owned locators before the first mutation, for interrupted-run cleanup.
  await writeFile(join(ownedRoot, 'owned-entry-cleanup.json'), JSON.stringify({ service, accounts: owned.map(value => value.account) }) + '\n', { mode: 0o600 })
  return item
}
async function assertEnvelope(item, filename, key) {
  const text = await readFile(filename, 'utf8')
  const envelope = JSON.parse(text)
  assert.equal(envelope.version, 3)
  assert.equal(envelope.cipher, 'aes-256-gcm')
  for (const value of [credential.access, credential.refresh, credential.accountId]) assert.equal(text.includes(value), false)
  assert.equal((await stat(filename)).mode & 0o777, 0o600)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(Buffer.from('dsh-codex-connect\0credential-envelope-v3\0' + resolve(filename)))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  assert.deepEqual(JSON.parse(plaintext), { version: 1, credential })
}
async function migrateFakeData(item) {
  const legacy = JSON.stringify({ version: 1, credential }) + '\n'
  for (const filename of [item.filename, item.backup]) await writeFile(filename, legacy, { mode: 0o600 })
  const refusal = cli(item, ['status', '--json'], 1)
  assert.match(refusal.stderr, /explicit migration/u)
  const unconfirmed = cli(item, ['migrate-credentials'], 1)
  assert.match(unconfirmed.stderr, /confirm-stopped/u)
  for (const filename of [item.filename, item.backup]) assert.equal(await readFile(filename, 'utf8'), legacy)
  assert.equal(await readKey(item), undefined, 'Refusal must not create a key')
  cli(item, ['migrate-credentials', '--confirm-stopped'], 0)
  const key = await readKey(item)
  assert.equal(key?.byteLength, 32)
  assert.notDeepEqual(key, Buffer.from(item.account, 'hex'))
  for (const filename of [item.filename, item.backup]) await assertEnvelope(item, filename, key)
  const status = cli(item, ['status', '--json'], 0)
  assert.equal(JSON.parse(status.stdout).status, 'signed-in')
  return key
}
try {
  phase = 'owned-native-locators'
  const first = await ownedStore('first-home')
  const second = await ownedStore('second-home')
  assert.equal(JSON.parse(cli(first, ['status', '--json'], 1).stdout).status, 'signed-out')
  assert.equal(await readKey(first), undefined)
  result.steps.push('empty-installed-status-does-not-create-key')

  phase = 'installed-migration-and-process-readback'
  const key = await migrateFakeData(first)
  const secondKey = await migrateFakeData(second)
  assert.notDeepEqual(key, secondKey)
  result.steps.push('installed-cli-refuses-implicit-or-unconfirmed-migration')
  result.steps.push('installed-cli-migrates-fake-primary-and-backup-to-owner-only-envelopes')
  result.steps.push('native-independent-random-keys-and-fresh-cli-process-readback')

  phase = 'tamper-rejection'
  const original = await readFile(first.filename, 'utf8')
  const tampered = { ...JSON.parse(original), ciphertext: 'eA==' }
  await writeFile(first.filename, JSON.stringify(tampered) + '\n', { mode: 0o600 })
  assert.match(cli(first, ['status', '--json'], 1).stderr, /authenticated/u)
  assert.deepEqual(await readKey(first), key)
  await writeFile(first.filename, original, { mode: 0o600 })
  result.steps.push('installed-cli-rejects-tampered-envelope-without-changing-key')

  phase = 'missing-key-rejection'
  await first.entry.deleteCredential()
  assert.equal(await readKey(first), undefined)
  assert.match(cli(first, ['status', '--json'], 1).stderr, /no OS-store key/u)
  assert.equal(await readKey(first), undefined, 'Missing decryption key must not be recreated')
  assert.equal(await readFile(first.filename, 'utf8'), original)
  await first.entry.setSecret(key)
  assert.deepEqual(await readKey(first), key)
  result.steps.push('installed-cli-missing-key-fails-closed-without-replacement')

  if (process.platform === 'darwin') {
    phase = 'unavailable-keychain-profile'
    const unavailableHome = join(ownedRoot, 'unconfigured-os-home')
    await mkdir(unavailableHome, { mode: 0o700 })
    const unavailable = cli(first, ['status', '--json'], 1, { HOME: unavailableHome })
    assert.match(unavailable.stderr, /unavailable or locked/u)
    assert.equal(await readFile(first.filename, 'utf8'), original)
    assert.deepEqual(await readKey(first), key)
    result.steps.push('installed-cli-unavailable-keychain-profile-fails-closed')
  }

  if (process.platform === 'linux') {
    phase = 'unavailable-secret-service'
    const unavailable = cli(first, ['status', '--json'], 1, {
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(ownedRoot, 'nonexistent-dbus-socket'),
    })
    assert.match(unavailable.stderr, /unavailable or locked/u)
    assert.equal(await readFile(first.filename, 'utf8'), original)
    assert.deepEqual(await readKey(first), key)
    result.steps.push('installed-cli-unavailable-secret-service-fails-closed')
  }

  phase = 'installed-logout'
  assert.equal(JSON.parse(cli(first, ['status', '--json'], 0).stdout).status, 'signed-in')
  for (const item of owned) {
    cli(item, ['logout'], 0)
    assert.equal(await readKey(item), undefined)
    await assert.rejects(stat(item.filename), { code: 'ENOENT' })
    await assert.rejects(stat(item.backup), { code: 'ENOENT' })
    assert.equal(JSON.parse(cli(item, ['status', '--json'], 1).stdout).status, 'signed-out')
  }
  result.steps.push('installed-cli-logout-removes-only-owned-files-and-native-keys')
} catch (error) {
  failed = true
  result.failure = { phase, errorKind: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message.slice(0,300).replaceAll(ownedRoot, '<OWNED_HOME>').replaceAll(installRoot, '<INSTALL_ROOT>') : 'UnknownError' }
} finally {
  result.cleanup.ownedEntries = owned.length
  const incomplete = []
  for (const item of owned) {
    try {
      if (await readKey(item) !== undefined) await item.entry.deleteCredential()
      assert.equal(await readKey(item), undefined)
    } catch { incomplete.push(item.account) }
  }
  result.cleanup.entriesAbsent = incomplete.length === 0
  if (incomplete.length === 0) {
    await rm(ownedRoot, { recursive: true, force: true })
    result.cleanup.temporaryHomeRemoved = true
  } else {
    failed = true
    await writeFile(join(ownedRoot, 'owned-entry-cleanup.json'), JSON.stringify({ service, accounts: incomplete }) + '\n', { mode: 0o600 })
    result.cleanup.recoveryDirectory = ownedRoot
  }
}
result.passed = !failed
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
process.exitCode = failed ? 1 : 0
