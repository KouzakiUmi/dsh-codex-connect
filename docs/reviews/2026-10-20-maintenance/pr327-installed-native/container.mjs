import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { release } from 'node:os'

const report = {
  schemaVersion: 1, sourceCommit: 'a297fa6808982eed57c219a8a3518bd8c37b6761',
  platform: process.platform, architecture: process.arch, node: process.version, kernel: release(),
  image: 'node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b',
  scope: 'installed standalone CLI, private container Secret Service, no host home/socket/store mount',
  steps: [], passed: false,
}
assert.equal(process.platform, 'linux')
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: '/work/package-home',
  DEBIAN_FRONTEND: 'noninteractive', DSH_TELEMETRY_MODE: 'DISABLED',
  npm_config_userconfig: '/work/npm-userconfig', npm_config_globalconfig: '/work/npm-globalconfig',
  npm_config_cache: '/work/npm-cache', npm_config_registry: 'https://registry.npmjs.org/' }
for (const path of ['/work', '/work/source', '/work/installation', '/work/package-home']) await mkdir(path, { recursive: true, mode: 0o700 })
for (const file of ['/work/npm-userconfig','/work/npm-globalconfig']) await writeFile(file, '')
await writeFile('/work/installation/package.json', JSON.stringify({ name:'owned-native-linux-acceptance', private:true, version:'0.0.0' }) + '\n')
async function run(name, command, args, cwd='/work', timeout=600000, requireSuccess=true) {
  const started = performance.now()
  const result = spawnSync(command, args, { cwd, env, encoding:'utf8', timeout, maxBuffer:32*1024*1024 })
  const log = (result.stdout ?? '') + (result.stderr ? '\n[stderr]\n' + result.stderr : '')
  const normalized = log.split(/\r?\n/u).map(line => line.trimEnd()).join('\n')
  await writeFile('/out/' + name + '.log', normalized)
  report.steps.push({ name, exitCode:result.status, signal:result.signal,
    error:result.error?.code ?? null, elapsedSeconds:Number(((performance.now()-started)/1000).toFixed(3)),
    logSha256:createHash('sha256').update(normalized).digest('hex') })
  process.stdout.write(JSON.stringify({step:name,exit:result.status}) + '\n')
  if (requireSuccess) assert.ok(result.status === 0 && !result.error, name + ' failed')
  return result
}
try {
  await run('extract-source','tar',['-xf','/input/source.tar','-C','/work/source'])
  await run('apt-update','apt-get',['update'])
  await run('apt-install','apt-get',['install','-y','--no-install-recommends','dbus','gnome-keyring','libsecret-1-0'])
  const versions = await run('native-package-versions','dpkg-query',['--show','dbus','gnome-keyring','libsecret-1-0'])
  report.nativePackages = versions.stdout.trim().split('\n')
  const packed = await run('pack','npm',['pack','--json','--ignore-scripts','--pack-destination','/work'],'/work/source')
  const [manifest] = JSON.parse(packed.stdout)
  assert.ok(/^[a-zA-Z0-9_.-]+\.tgz$/u.test(manifest.filename))
  const tarball = '/work/' + manifest.filename
  report.package = { filename:manifest.filename, integrity:manifest.integrity,
    sha256:createHash('sha256').update(await readFile(tarball)).digest('hex') }
  await run('install','npm',['install','--prefix','/work/installation','--legacy-peer-deps','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',tarball],'/work/installation')
  report.sourceBinSha256 = createHash('sha256').update(await readFile('/work/source/lib/bin.js')).digest('hex')
  report.installedBinSha256 = createHash('sha256').update(await readFile('/work/installation/node_modules/dsh-codex-connect/lib/bin.js')).digest('hex')
  assert.equal(report.sourceBinSha256, report.installedBinSha256)
  report.fixtureSha256 = createHash('sha256').update(await readFile('/input/acceptance.mjs')).digest('hex')
  const native = await run('private-secret-service','dbus-run-session',['--',process.execPath,'/input/native-session.mjs','/work/installation','/out'],'/work',300000,false)
  report.native = JSON.parse(await readFile('/out/native-result.json','utf8'))
  assert.ok(native.status === 0 && report.native.passed)
  assert.ok(report.native.cleanup.entriesAbsent && report.native.cleanup.temporaryHomeRemoved)
  report.passed = true
} catch (error) {
  report.failure = { errorKind:error instanceof Error ? error.name : 'UnknownError',
    message:error instanceof Error ? error.message.slice(0,300) : 'UnknownError' }
} finally {
  await writeFile('/out/result.json',JSON.stringify(report,null,2)+'\n')
}
process.stdout.write(JSON.stringify(report)+'\n')
process.exitCode = report.passed ? 0 : 1
