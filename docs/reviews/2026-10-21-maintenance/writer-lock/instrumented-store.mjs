#!/usr/bin/env node
/**
 * One bounded diagnostic of the unmodified 12-writer store.
 * Instrumentation records in memory; it neither changes lock options nor retries a run.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { availableParallelism, cpus, loadavg, release, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const [sourceArgument, holdArgument, label] = process.argv.slice(2)
assert.ok(sourceArgument && label)
const holdMs = Number(holdArgument)
assert.ok(holdMs === 0 || holdMs === 500, 'Only the two declared scenarios are admitted')
assert.ok(!process.env.NODE_OPTIONS, 'Unexpected preload/Node overrides')
const source = await fs.realpath(resolve(sourceArgument))
const requireSource = createRequire(join(source, 'package.json'))
const dependencyPath = requireSource.resolve('@deepseek-ai/dsh-atomic-write')
const sha = value => createHash('sha256').update(value).digest('hex')
const atomicSource = await fs.readFile(dependencyPath, 'utf8')
assert.match(atomicSource, /const DEFAULT_LOCK_WAIT_MS = 2e3;/u)
assert.match(atomicSource, /const LOCK_RETRY_INITIAL_MS = 20;/u)
assert.match(atomicSource, /const LOCK_RETRY_MAX_MS = 200;/u)
const storeSource = await fs.readFile(join(source, 'src/adaptive-task-store.ts'))
assert.equal(sha(storeSource), '3d5c9ec0b3cdb8e09e2cf76ced7cc1f8efd2182b544fa8ff478d896a944246c6')
const original = Object.fromEntries(['writeFile','mkdir','lstat','open','rename','rm'].map(name => [name, fs[name].bind(fs)]))
const nativeTimer = globalThis.setTimeout
const context = new AsyncLocalStorage()
const events = []
const started = performance.now()
const rounded = value => Number(value.toFixed(3))
let root
let heldBy = null
const report = {
  schemaVersion:1, label, scope:'instrumented store diagnostic; not the Vitest/full-suite workload',
  sourceStoreSha256:sha(storeSource), atomicModuleSha256:sha(atomicSource),
  atomicPackageVersion:JSON.parse(await fs.readFile(join(dirname(dependencyPath),'../package.json'),'utf8')).version,
  platform:process.platform, architecture:process.arch, node:process.version, osRelease:release(),
  availableParallelism:availableParallelism(), logicalCpus:cpus().length,
  loadAverageBefore:loadavg(), uvThreadpoolSize:process.env.UV_THREADPOOL_SIZE ?? 'runtime-default',
  execArgv:process.execArgv, startedAt:new Date().toISOString(),
  writerCount:12, productionWaitMs:2000, initialRetryMs:20, maximumRetryMs:200,
  injectedFirstHolderDelayMs:holdMs, instrumentation:'AsyncLocalStorage, fs/FileHandle wrappers and timer event recording; in-memory only until completion',
  instrumentationOverhead:'not independently quantified; same wrapper and fixture on both paired source roots',
  clockMocked:false, lockOptionsOverridden:false, cleanup:{temporaryRootRemoved:false},
}
function kind(path) {
  if (typeof path !== 'string' || !root || !path.startsWith(root + sep)) return 'outside-owned-fixture'
  if (path.endsWith('.lock')) return 'lock'
  if (path.endsWith('.tmp')) return 'atomic-temp'
  if (path.endsWith('.json')) return 'state-file'
  return 'state-directory'
}
function record(event) { events.push({ sequence:events.length, ...event }) }
function point(event, details={}) { record({ id:context.getStore()?.id ?? null, event, atMs:rounded(performance.now()-started), ...details }) }
async function observed(op, resource, action) {
  const ctx = context.getStore()
  if (!ctx || resource === 'outside-owned-fixture') return action()
  const start = performance.now()
  try {
    const value = await action()
    record({id:ctx.id,event:'io',op,resource,startMs:rounded(start-started),endMs:rounded(performance.now()-started),
      durationMs:rounded(performance.now()-start),outcome:'ok'})
    return value
  } catch(error) {
    record({id:ctx.id,event:'io',op,resource,startMs:rounded(start-started),endMs:rounded(performance.now()-started),
      durationMs:rounded(performance.now()-start),outcome:error?.code ?? error?.name ?? 'unknown-error'})
    throw error
  }
}
for (const name of ['writeFile','mkdir','lstat','rename','rm']) {
  fs[name] = (...args) => observed(name,kind(args[0]),()=>original[name](...args))
}
fs.open = async (...args) => {
  const resource=kind(args[0])
  const handle = await observed('open',resource,()=>original.open(...args))
  for (const name of ['read','stat','sync','close']) {
    const call=handle[name].bind(handle)
    handle[name]=(...values)=>observed('handle.'+name,resource,()=>call(...values))
  }
  return handle
}
globalThis.setTimeout = function(callback, delay, ...args) {
  const ctx=context.getStore()
  if (!ctx) return nativeTimer(callback,delay,...args)
  const scheduled=performance.now()
  point('timer-scheduled',{delayMs:delay})
  return nativeTimer(function(...values) {
    point('timer-fired',{delayMs:delay,actualDelayMs:rounded(performance.now()-scheduled)})
    callback(...values)
  },delay,...args)
}
syncBuiltinESMExports()

try {
  const { AdaptiveTaskStore, taskIdentity } = await import(pathToFileURL(join(source,'src/adaptive-task-store.ts')).href)
  const { ADAPTIVE_TASK_START } = await import(pathToFileURL(join(source,'src/adaptive-task-contract.ts')).href)
  root=await fs.mkdtemp(join(tmpdir(),'codex-connect-writer-timing-owned-'))
  const directory=join(root,'state')
  const file=join(directory,taskIdentity('fixture')+'.json')
  const store=new AdaptiveTaskStore(directory)
  const document={version:1,sessionId:'fixture',sessionKey:'a'.repeat(64),owner:'b'.repeat(64),runtime:'c'.repeat(64),
    revision:1,mode:'auto',route:ADAPTIVE_TASK_START,capabilities:[{model:ADAPTIVE_TASK_START.model,efforts:['medium']}],
    maximumRequests:50,reserved:0,selectionSeq:-1,portable:false,handoffSeq:-1,
    receipts:[{id:randomUUID(),digest:'d'.repeat(64)}]}
  await store.update('fixture',()=>document)
  const filesystem=await fs.statfs(root)
  report.filesystemType=filesystem.type
  const launchedAt=performance.now()
  const pending=Array.from({length:12},(_,id)=>context.run({id},async()=>{
    point('update-start')
    try {
      const value=await new AdaptiveTaskStore(directory).update('fixture',async current=>{
        point('mutation-entered')
        if (holdMs && heldBy===null) {
          heldBy=id
          point('injected-hold-start',{holdMs})
          await new Promise(done=>setTimeout(done,holdMs))
          point('injected-hold-end')
        }
        current.reserved++
        return current
      })
      point('update-fulfilled',{reserved:value.reserved})
      return value
    } catch(error) {
      point('update-rejected',{error: String(error?.message??error).replaceAll(root,'<OWNED_FIXTURE>')})
      throw error
    }
  }))
  report.launchSpanMs=rounded(performance.now()-launchedAt)
  // A diagnostic must observe every writer before collecting or deleting any state.
  const settled=await Promise.allSettled(pending)
  report.outcomes=settled.map((value,id)=>value.status==='fulfilled'
    ? {id,status:value.status,reserved:value.value.reserved}
    : {id,status:value.status,error:String(value.reason?.message??value.reason).replaceAll(root,'<OWNED_FIXTURE>')})
  report.fulfilled=settled.filter(value=>value.status==='fulfilled').length
  report.rejected=12-report.fulfilled
  report.lockTimeouts=report.outcomes.filter(value=>value.error?.includes('timed out waiting for the writer lock')).length
  report.persistedReservations=(await store.read('fixture')).reserved
  assert.equal(report.persistedReservations,report.fulfilled,'Every completed reservation must be retained')
  await assert.rejects(fs.lstat(file+'.lock'),{code:'ENOENT'})
  report.lockAbsentAfterDrain=true
  report.heldBy=heldBy
  report.writers=Array.from({length:12},(_,id)=>{
    const own=events.filter(value=>value.id===id)
    const attempts=own.filter(value=>value.op==='writeFile'&&value.resource==='lock')
    const acquired=attempts.find(value=>value.outcome==='ok')
    const released=own.find(value=>value.op==='rm'&&value.resource==='lock'&&value.outcome==='ok')
    const sync=own.filter(value=>value.op==='handle.sync')
    return {id,attempts:attempts.length,attemptStartMs:attempts.map(value=>value.startMs),
      acquiredAtMs:acquired?.endMs??null,releasedAtMs:released?.endMs??null,
      observedHoldMs:acquired&&released?rounded(released.endMs-acquired.endMs):null,
      syncs:sync.map(value=>({resource:value.resource,durationMs:value.durationMs})),
      status:report.outcomes[id].status}
  })
  const successfulLocks=events.filter(value=>value.op==='writeFile'&&value.resource==='lock'&&value.outcome==='ok').sort((a,b)=>a.endMs-b.endMs)
  report.idleGaps=successfulLocks.slice(1).map((lock,index)=>{
    const previous=successfulLocks[index]
    const releaseEvent=events.find(value=>value.id===previous.id&&value.op==='rm'&&value.resource==='lock'&&value.outcome==='ok')
    return {previous:previous.id,next:lock.id,betweenReleaseCompletionAndNextAcquireMs:rounded(lock.endMs-releaseEvent.endMs)}
  })
  report.integrityChecksPassed=true
} catch(error) {
  report.failure={name:error?.name??'Error',message:String(error?.message??error).replaceAll(source,'<SOURCE_ROOT>').replaceAll(root??'<unused>','<OWNED_FIXTURE>')}
  report.integrityChecksPassed=false
} finally {
  for(const name of Object.keys(original)) fs[name]=original[name]
  globalThis.setTimeout=nativeTimer
  syncBuiltinESMExports()
  if(root) {
    await original.rm(root,{recursive:true,force:true})
    try { await original.lstat(root) } catch(error) { if(error?.code==='ENOENT') report.cleanup.temporaryRootRemoved=true; else throw error }
  }
  report.events=events
  report.loadAverageAfter=loadavg()
  report.finishedAt=new Date().toISOString()
  report.elapsedMs=rounded(performance.now()-started)
}
process.stdout.write(JSON.stringify(report,null,2)+'\n')
process.exitCode=report.integrityChecksPassed&&report.cleanup.temporaryRootRemoved?0:1
