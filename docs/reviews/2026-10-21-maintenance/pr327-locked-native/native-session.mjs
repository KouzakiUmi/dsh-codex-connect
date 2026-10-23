import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const installRoot = process.argv[2]
const out = process.argv[3]
assert.equal(process.platform, 'linux')
assert.ok(process.env.DBUS_SESSION_BUS_ADDRESS, 'A private dbus-run-session is required')
const home = '/work/secret-service-home'
const runtime = '/work/secret-service-runtime'
const control = '/work/secret-service-control'
for (const path of [home, runtime, control]) await mkdir(path, { mode: 0o700 })
const env = { ...process.env, HOME: home, XDG_DATA_HOME: home + '/.local/share',
  XDG_CONFIG_HOME: home + '/.config', XDG_CACHE_HOME: home + '/.cache', XDG_RUNTIME_DIR: runtime,
  CODEX_CONNECT_OWNED_SECRET_SERVICE: 'true', GNOME_KEYRING_CONTROL: control }
const daemon = spawnSync('gnome-keyring-daemon', [
  '--daemonize', '--unlock', '--components=secrets', '--control-directory', control,
], { env, input: 'owned-container-keyring-test-password-not-real', encoding: 'utf8', timeout: 20000 })
await writeFile(out + '/native-daemon.log', daemon.stdout + daemon.stderr)
assert.equal(daemon.error, undefined, 'Owned Secret Service startup failed')
assert.equal(daemon.status, 0, 'Owned Secret Service startup failed')
const child = spawnSync(process.execPath, ['/input/acceptance.mjs', '--synthetic-owned-entries-only', installRoot], {
  env, encoding: 'utf8', timeout: 240000, maxBuffer: 1024 * 1024,
})
await writeFile(out + '/native-result.json', child.stdout)
await writeFile(out + '/native-stderr.log', child.stderr)
process.stdout.write(JSON.stringify({ nativeExit: child.status, signal: child.signal, error: child.error?.code ?? null }) + '\n')
process.exitCode = child.status === 0 && child.error === undefined ? 0 : 1