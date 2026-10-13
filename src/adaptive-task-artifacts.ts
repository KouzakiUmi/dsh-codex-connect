/** Private immutable artifacts contain evidence/results, never grant authority. */
import { constants, type BigIntStats } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ledgerHash } from './adaptive-task-delegation-contract.ts'
import { taskSafeDirectories } from './adaptive-task-evidence.ts'
import { syncTaskFile, taskFailure, taskIdentity } from './adaptive-task-store.ts'

const MAX_BYTES = 2 * 1024 * 1024 // Includes JSON escaping of a bounded 256 KiB snapshot.
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
      try { await this.get(digest) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await writeFileAtomic(filename, text, { mode: 0o600, dirMode: 0o700 })
      }
      // Reuse also completes durability and final identity/content checks; never rewrite a rejected target.
      await syncTaskFile(filename, text, 'TASK_ARTIFACT_UNSAFE')
    })
    return digest
  }
  async get(digest: string): Promise<unknown> {
    if (!ledgerHash(digest)) taskFailure('TASK_ARTIFACT_INVALID')
    await this.safe(false)
    const filename = join(this.directory, digest + '.json')
    // O_NOFOLLOW is a no-op on Windows; reject links and verify the opened identity.
    const before = await lstat(filename, { bigint: true })
    const safe = (stat: BigIntStats): boolean => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n
      && stat.size <= BigInt(MAX_BYTES) && (process.platform === 'win32' || (stat.mode & 0o077n) === 0n)
    const matches = (stat: BigIntStats, expected: BigIntStats): boolean => safe(stat)
      && stat.dev === expected.dev && stat.ino === expected.ino && stat.size === expected.size
      && stat.mtimeNs === expected.mtimeNs && stat.ctimeNs === expected.ctimeNs
      && stat.mode === expected.mode && stat.uid === expected.uid
    if (!safe(before)) taskFailure('TASK_ARTIFACT_UNSAFE')
    try {
      const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      let identity: BigIntStats, value: unknown
      try {
        identity = await file.stat({ bigint: true })
        if (!matches(identity, before)) taskFailure('TASK_ARTIFACT_UNSAFE')
        const bytes = Buffer.alloc(MAX_BYTES + 1)
        let count = 0
        while (count < bytes.length) {
          const { bytesRead } = await file.read(bytes, count, bytes.length - count, count)
          if (bytesRead === 0) break
          count += bytesRead
        }
        if (BigInt(count) !== identity.size || !matches(await file.stat({ bigint: true }), identity)
          || taskIdentity(bytes.subarray(0, count).toString('utf8')) !== digest) taskFailure('TASK_ARTIFACT_CORRUPT')
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count))) as unknown
      } finally { await file.close() }
      if (!matches(await lstat(filename, { bigint: true }), identity)) taskFailure('TASK_ARTIFACT_UNSAFE')
      return value
    } catch (error) {
      // Only the first lstat may signal absence to put(); never overwrite a target lost after observation.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') taskFailure('TASK_ARTIFACT_UNSAFE')
      throw error
    }
  }
}
