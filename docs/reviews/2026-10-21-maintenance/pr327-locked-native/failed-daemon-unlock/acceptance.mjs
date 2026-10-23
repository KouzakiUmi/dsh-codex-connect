#!/usr/bin/env node
/**
 * PR #327: actual locked Secret Service, isolated container only.
 * Requires private dbus-run-session and an owned GNOME Keyring home.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { release } from 'node:os'

assert.equal(process.argv.length,4)
assert.equal(process.argv[2],'--synthetic-owned-entries-only')
assert.equal(process.platform,'linux')
assert.equal(process.env.CODEX_CONNECT_OWNED_SECRET_SERVICE,'true')
assert.equal(process.env.HOME,'/work/secret-service-home')
assert.equal(process.env.GNOME_KEYRING_CONTROL,'/work/secret-service-control')
assert.ok(process.env.DBUS_SESSION_BUS_ADDRESS?.startsWith('unix:'))
await stat('/.dockerenv')
assert.ok(!process.env.NODE_OPTIONS && !process.env.DSH_SYNTHETIC_KEYRING && !process.env.DSH_SYNTHETIC_KEYRING_DIRECTORY)
const installRoot=await realpath(resolve(process.argv[3]))
assert.equal(installRoot,'/work/installation')
const installedRequire=createRequire(join(installRoot,'package.json'))
const packageRoot=await realpath(dirname(installedRequire.resolve('dsh-codex-connect/package.json')))
assert.ok(packageRoot.startsWith(installRoot+sep+'node_modules'+sep))
const bin=join(packageRoot,'lib/bin.js')
const keyringFile=installedRequire.resolve('@napi-rs/keyring')
assert.ok((await realpath(keyringFile)).startsWith(installRoot+sep))
const native=await import(pathToFileURL(keyringFile).href)
assert.notEqual(native.syntheticKeyring,true)
const ownedRoot=await realpath(await mkdtemp(join(installRoot,'native-locked-owned-home-')))
const fakePassword='owned-container-keyring-test-password-not-real'
const service='dsh-codex-connect.oauth-encryption-key.v1'
const fakeCredential={type:'oauth',access:'locked-fixture-access-not-a-token',refresh:'locked-fixture-refresh-not-a-token',
  accountId:'locked-fixture-account-not-real',expires:60000}
const legacy=JSON.stringify({version:1,credential:fakeCredential})+'\n'
const result={
  schemaVersion:1, sourceCommit:'a297fa6808982eed57c219a8a3518bd8c37b6761',
  platform:process.platform,architecture:process.arch,node:process.version,osRelease:release(),
  target:'installed-standalone-cli-with-actually-locked-private-secret-service',
  packageVersion:JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8')).version,
  binSha256:createHash('sha256').update(await readFile(bin)).digest('hex'),
  keyringVersion:JSON.parse(await readFile(join(dirname(keyringFile),'package.json'),'utf8')).version,
  syntheticCredentials:true,nativeBindingUsed:true,liveProviderCommands:false,
  commands:[],nativeControl:[],steps:[],cleanup:{ownedEntries:0,entriesAbsent:false,temporaryHomeRemoved:false},
}
let phase='preflight'
let collection
let failed=false
const owned=[]
function dbus(object,method,args=[]) {
  const child=spawnSync('gdbus',['call','--session','--dest','org.freedesktop.secrets','--object-path',object,
    '--method',method,...args],{env:process.env,encoding:'utf8',timeout:10000,maxBuffer:65536})
  assert.equal(child.error,undefined,'Private D-Bus call failed')
  assert.equal(child.status,0,'Private D-Bus call failed: '+method)
  const text=child.stdout.trim()
  result.nativeControl.push({method,response:text})
  return text
}
function locked(expected) {
  const text=dbus(collection,'org.freedesktop.DBus.Properties.Get',['org.freedesktop.Secret.Collection','Locked'])
  const match=text.match(/<(true|false)>/u)
  assert.ok(match,'Unexpected native Locked property')
  assert.equal(match[1]==='true',expected,'Native collection lock state mismatch')
}
function unlockOwned() {
  const child=spawnSync('gnome-keyring-daemon',['--unlock','--components=secrets','--control-directory','/work/secret-service-control'],{
    env:process.env,input:fakePassword,encoding:'utf8',timeout:10000,maxBuffer:65536})
  result.nativeControl.push({method:'owned-daemon-unlock-via-stdin',exitCode:child.status,error:child.error?.code??null})
  assert.equal(child.error,undefined,'Owned keyring unlock failed')
  assert.equal(child.status,0,'Owned keyring unlock failed')
  if(collection) locked(false)
}
function childEnvironment(home) {
  return {PATH:process.env.PATH,LANG:'C.UTF-8',HOME:ownedRoot,DSH_HOME:home,
    DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS,XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR,
    XDG_CONFIG_HOME:join(ownedRoot,'config'),XDG_CACHE_HOME:join(ownedRoot,'cache'),DSH_TELEMETRY_MODE:'DISABLED'}
}
function cli(item,args,expectedExit) {
  const started=performance.now()
  const child=spawnSync(process.execPath,[bin,...args],{cwd:installRoot,env:childEnvironment(item.home),
    encoding:'utf8',timeout:20000,maxBuffer:65536})
  result.commands.push({phase,name:args.join(' '),expectedExit,actualExit:child.status,
    processError:child.error?.code??null,signal:child.signal,elapsedMs:Number((performance.now()-started).toFixed(3))})
  assert.equal(child.error,undefined,'Installed CLI process failed')
  assert.equal(child.status,expectedExit,'Installed CLI returned unexpected exit')
  assert.ok(!Object.values(fakeCredential).filter(value=>typeof value==='string').some(
    value=>value.length>12&&(child.stdout+child.stderr).includes(value)),'CLI exposed synthetic credential content')
  return child
}
async function readKey(item) {
  const value=await item.entry.getSecret()
  if(value===null||value===undefined)return undefined
  assert.ok(value instanceof Uint8Array||(Array.isArray(value)&&Array.from(value).every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255)),
    'Invalid native secret shape')
  return Buffer.from(value)
}
async function makeOwned(name) {
  const home=join(ownedRoot,name)
  await mkdir(home,{mode:0o700})
  const filename=join(home,'.openai-codex-auth.json')
  const account=createHash('sha256').update(resolve(filename)).digest('hex')
  const entry=new native.AsyncEntry(service,account,{linux:{store:'secret-service'}})
  const item={home,filename,backup:filename+'.v1-backup',account,entry}
  assert.equal(await readKey(item),undefined,'Refuse unexpected pre-existing test locator')
  owned.push(item)
  await writeFile(join(ownedRoot,'owned-entry-cleanup.json'),JSON.stringify({service,accounts:owned.map(value=>value.account)})+'\n',{mode:0o600})
  for(const file of [item.filename,item.backup])await writeFile(file,legacy,{mode:0o600})
  return item
}
async function contents(item) {return Promise.all([readFile(item.filename,'utf8'),readFile(item.backup,'utf8')])}
async function unchanged(item,before) {
  const after=await contents(item)
  assert.ok(after.every((value,index)=>value===before[index]),'Locked operation modified a credential file')
  for(const file of [item.filename,item.backup])assert.equal((await stat(file)).mode&0o777,0o600)
}

try {
  const alias=dbus('/org/freedesktop/secrets','org.freedesktop.Secret.Service.ReadAlias',['default'])
  const match=alias.match(/objectpath '([^']+)'/u)
  assert.ok(match&&/^\/org\/freedesktop\/secrets\/collection\/[A-Za-z0-9_]+$/u.test(match[1]),'Owned default collection unavailable')
  collection=match[1]
  locked(false)
  phase='owned-fixture-setup'
  const first=await makeOwned('encrypted-home')
  const second=await makeOwned('legacy-home')
  cli(first,['migrate-credentials','--confirm-stopped'],0)
  const key=await readKey(first)
  assert.equal(key?.byteLength,32)
  assert.equal(JSON.parse(cli(first,['status','--json'],0).stdout).status,'signed-in')
  const encryptedBefore=await contents(first)
  assert.ok(encryptedBefore.every(text=>JSON.parse(text).version===3&&!text.includes(fakeCredential.access)))
  const legacyBefore=await contents(second)
  assert.equal(await readKey(second),undefined)
  result.steps.push('unlocked-native-precondition-and-owned-existing-key')

  phase='native-lock'
  dbus('/org/freedesktop/secrets','org.freedesktop.Secret.Service.Lock',["['"+collection+"']"])
  locked(true)
  result.steps.push('native-collection-locked-property-true')

  phase='locked-read'
  assert.match(cli(first,['status','--json'],1).stderr,/Secure credential storage failed/u)
  locked(true)
  await unchanged(first,encryptedBefore)
  result.steps.push('locked-installed-status-refuses-without-file-change')

  phase='locked-migration'
  assert.match(cli(second,['migrate-credentials','--confirm-stopped'],1).stderr,/Secure credential storage failed/u)
  locked(true)
  await unchanged(second,legacyBefore)
  result.steps.push('locked-installed-migration-refuses-without-file-change')

  phase='owned-unlock-and-identity-check'
  unlockOwned()
  const restoredKey=await readKey(first)
  assert.ok(restoredKey&&timingSafeEqual(restoredKey,key),'Existing native key changed across locked operations')
  assert.equal(await readKey(second),undefined,'Locked migration created a native key')
  await unchanged(first,encryptedBefore)
  await unchanged(second,legacyBefore)
  assert.equal(JSON.parse(cli(first,['status','--json'],0).stdout).status,'signed-in')
  result.steps.push('unlock-recovery-preserves-existing-key-and-creates-no-replacement')

  phase='unlocked-migration-recovery'
  cli(second,['migrate-credentials','--confirm-stopped'],0)
  const secondKey=await readKey(second)
  assert.equal(secondKey?.byteLength,32)
  assert.ok(!timingSafeEqual(secondKey,key),'Owned homes reused one encryption key')
  assert.equal(JSON.parse(cli(second,['status','--json'],0).stdout).status,'signed-in')
  result.steps.push('explicit-migration-succeeds-after-owned-unlock')

  phase='owned-logout'
  for(const item of owned) {
    cli(item,['logout'],0)
    assert.equal(await readKey(item),undefined)
    await assert.rejects(stat(item.filename),{code:'ENOENT'})
    await assert.rejects(stat(item.backup),{code:'ENOENT'})
    assert.equal(JSON.parse(cli(item,['status','--json'],1).stdout).status,'signed-out')
  }
  result.steps.push('owned-unlocked-logout-deletes-files-and-keys')
} catch(error) {
  failed=true
  result.failure={phase,name:error?.name??'Error',message:String(error?.message??error).slice(0,350)
    .replaceAll(ownedRoot,'<OWNED_HOME>').replaceAll(installRoot,'<INSTALL_ROOT>')}
} finally {
  result.cleanup.ownedEntries=owned.length
  let unlockedForCleanup=false
  try {unlockOwned();unlockedForCleanup=true} catch {result.cleanup.unlockFailed=true}
  const incomplete=[]
  if(unlockedForCleanup) {
    for(const item of owned) {
      try {
        if(await readKey(item)!==undefined)await item.entry.deleteCredential()
        assert.equal(await readKey(item),undefined)
      } catch {incomplete.push(item.account)}
    }
  } else incomplete.push(...owned.map(item=>item.account))
  result.cleanup.entriesAbsent=unlockedForCleanup&&incomplete.length===0
  if(result.cleanup.entriesAbsent) {
    await rm(ownedRoot,{recursive:true,force:true})
    result.cleanup.temporaryHomeRemoved=true
  } else {
    failed=true
    await writeFile(join(ownedRoot,'owned-entry-cleanup.json'),JSON.stringify({service,accounts:incomplete})+'\n',{mode:0o600})
  }
}
result.passed=!failed
process.stdout.write(JSON.stringify(result,null,2)+'\n')
process.exitCode=failed?1:0
