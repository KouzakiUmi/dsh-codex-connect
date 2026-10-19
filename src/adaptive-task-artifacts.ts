/** Private immutable artifacts contain evidence/results, never grant authority. */
import { constants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ledgerHash } from './adaptive-task-delegation-contract.ts'
import { taskSafeDirectories } from './adaptive-task-evidence.ts'
import { AdaptiveTaskError, taskFailure, taskIdentity } from './adaptive-task-store.ts'

const MAX_BYTES = 2 * 1024 * 1024 // Includes JSON escaping of a bounded 256 KiB snapshot.

function privateArtifact(stat: BigIntStats): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.size >= 0n && stat.size <= BigInt(MAX_BYTES)
    && (process.platform === 'win32' || (stat.mode & 0o077n) === 0n)
}

/** Number inode/clock projections can alias; keep native bigint identity and metadata through close. */
function sameArtifact(before: BigIntStats, after: BigIntStats): boolean {
  return privateArtifact(after) && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.nlink === after.nlink && before.mode === after.mode
    && before.uid === after.uid && before.gid === after.gid
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs
}
export class TaskDelegationArtifacts {
  /** Parent must already exist, canonical and trusted. This directory is private to the exact root. */
  constructor(private readonly directory: string) {}
  private async safe(create: boolean): Promise<void> {
    await taskSafeDirectories(dirname(this.directory))
    if (create) await mkdir(this.directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    const stat = await lstat(this.directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) taskFailure('TASK_ARTIFACT_UNSAFE')
  }
  async put(value: unknown): Promise<string> {
    const text = JSON.stringify(value)
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) taskFailure('TASK_ARTIFACT_TOO_LARGE')
    const digest = taskIdentity(text)
    await this.safe(true)
    const filename = join(this.directory, digest + '.json')
    await withFileLock(filename, async () => {
      await this.safe(false)
      try { await this.get(digest); return } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await writeFileAtomic(filename, text, { mode: 0o600, dirMode: 0o700 })
      const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
      try { await file.sync() } finally { await file.close() }
      if (process.platform !== 'win32') {
        const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
        try { await directory.sync() } finally { await directory.close() }
      }
    })
    return digest
  }
  async get(digest: string): Promise<unknown> {
    if (!ledgerHash(digest)) taskFailure('TASK_ARTIFACT_INVALID')
    await this.safe(false)
    const filename = join(this.directory, digest + '.json')
    // Only absence before observing this target may let put() create it.
    let before: BigIntStats
    try { before = await lstat(filename, { bigint: true }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
      taskFailure('TASK_ARTIFACT_UNSAFE')
    }
    if (!privateArtifact(before)) taskFailure('TASK_ARTIFACT_UNSAFE')
    let bytes: Buffer
    try {
      const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        if (!sameArtifact(before, await file.stat({ bigint: true }))
          || !sameArtifact(before, await lstat(filename, { bigint: true }))) taskFailure('TASK_ARTIFACT_UNSAFE')
        const buffer = Buffer.alloc(Number(before.size) + 1)
        let consumed = 0
        while (consumed < buffer.length) {
          const { bytesRead } = await file.read(buffer, consumed, buffer.length - consumed, consumed)
          if (bytesRead === 0) break
          consumed += bytesRead
        }
        if (!sameArtifact(before, await file.stat({ bigint: true }))) taskFailure('TASK_ARTIFACT_UNSAFE')
        if (consumed !== Number(before.size)) taskFailure('TASK_ARTIFACT_CORRUPT')
        bytes = buffer.subarray(0, consumed)
      } finally { await file.close() }
      await this.safe(false)
      if (!sameArtifact(before, await lstat(filename, { bigint: true }))) taskFailure('TASK_ARTIFACT_UNSAFE')
    } catch (error) {
      if (error instanceof AdaptiveTaskError) throw error
      taskFailure('TASK_ARTIFACT_UNSAFE')
    }
    if (taskIdentity(bytes.toString('utf8')) !== digest) taskFailure('TASK_ARTIFACT_CORRUPT')
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
    catch { taskFailure('TASK_ARTIFACT_CORRUPT') }
  }
}
