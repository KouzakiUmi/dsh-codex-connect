/** Opt-in local request evidence. No prompts, responses, headers or credentials are persisted. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, constants, lstatSync, mkdirSync, openSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { OpenAICodexBackendLane } from './backend-request.ts'
import { CODEX_CONNECT_VERSION } from './version.ts'

export interface RequestMetricUsage {
  /** Responses input_tokens includes cached input; fields remain null when absent or invalid. */
  input: number | null
  cachedInput: number | null
  cacheWrite: number | null
  output: number | null
  /** Subset of output, never added to output again. */
  reasoningOutput: number | null
}
export type RequestMetricOutcome = 'completed' | 'incomplete' | 'provider-error' | 'http-error' | 'network-error' | 'cancelled' | 'unobserved'
export interface RequestMetricStart {
  schemaVersion: 1
  event: 'start'
  id: string
  at: number
  lane: OpenAICodexBackendLane
  callId: string | null
  session: string | null
  model: string | null
  effort: string | null
  purpose: 'conversation' | 'compaction' | 'session-title' | null
  version: string
}
export interface RequestMetricFinish {
  schemaVersion: 1
  event: 'finish'
  id: string
  at: number
  elapsedMs: number
  status: number | null
  outcome: RequestMetricOutcome
  usage: RequestMetricUsage
  observation: 'observed' | 'missing' | 'oversized' | 'malformed'
}
export interface RequestMetricCollection {
  schemaVersion: 1
  event: 'collection'
  id: string
  at: number
  state: 'started' | 'closed' | 'stopped'
}
export type RequestMetricEvent = RequestMetricStart | RequestMetricFinish | RequestMetricCollection
export const emptyMetricUsage = (): RequestMetricUsage => ({ input: null, cachedInput: null, cacheWrite: null, output: null, reasoningOutput: null })
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const count = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null
const label = (v: string | undefined): string | null => v !== undefined && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(v) ? v : null
/** Stable opaque session grouping; not an authentication or anonymization mechanism. */
export const metricSessionKey = (id: string): string => createHash('sha256').update(id).digest('hex')

/** Normalize only wire-reported Responses usage, without provider-library zero defaults. */
export function parseMetricUsage(value: unknown): RequestMetricUsage {
  if (!record(value)) return emptyMetricUsage()
  const input = count(value['input_tokens']), output = count(value['output_tokens'])
  const inputDetails = record(value['input_tokens_details']) ? value['input_tokens_details'] : {}
  const outputDetails = record(value['output_tokens_details']) ? value['output_tokens_details'] : {}
  let cachedInput = count(inputDetails['cached_tokens'])
  let cacheWrite = count(value['cache_write_tokens'])
  let reasoningOutput = count(outputDetails['reasoning_tokens'])
  if (input !== null && cachedInput !== null && cachedInput > input) cachedInput = null
  if (input !== null && cacheWrite !== null && (cacheWrite > input || cachedInput !== null && cacheWrite + cachedInput > input)) cacheWrite = null
  if (output !== null && reasoningOutput !== null && reasoningOutput > output) reasoningOutput = null
  return { input, cachedInput, cacheWrite, output, reasoningOutput }
}

/** Bounded incremental SSE/JSON observer; bytes always continue unchanged to their existing consumer. */
export class MetricResponseObserver {
  usage = emptyMetricUsage()
  outcome: RequestMetricOutcome = 'unobserved'
  observation: RequestMetricFinish['observation'] = 'missing'
  private readonly decoder = new TextDecoder()
  private line = ''
  private data = ''
  private size = 0
  private skip = false
  private previousCR = false
  private terminal = false
  constructor(private readonly sse: boolean, private readonly limit = 1024 * 1024) {}
  feed(bytes: Uint8Array): void {
    for (let offset = 0; offset < bytes.length && !this.terminal; offset += 4096) {
      const text = this.decoder.decode(bytes.subarray(offset, offset + 4096), { stream: true })
      if (!this.sse) {
        this.size += text.length
        if (this.size > this.limit) { this.skip = true; this.data = ''; this.observation = 'oversized' }
        if (!this.skip) this.data += text
      } else for (const c of text) {
        if (this.terminal) break
        if (c === '\n' && this.previousCR) { this.previousCR = false; continue }
        this.previousCR = c === '\r'
        if (c === '\r' || c === '\n') {
          if (this.line === '') {
            if (!this.skip && this.data) this.parse(this.data)
            this.data = ''; this.size = 0; this.skip = false
          } else if (!this.skip && this.line.startsWith('data:')) this.data += this.line.slice(5).replace(/^ /u, '') + '\n'
          this.line = ''
        } else {
          this.size += 1
          if (this.size > this.limit) { this.skip = true; this.data = ''; this.observation = 'oversized' }
          // Preserve whether the skipped line is nonempty without retaining its content.
          if (!this.skip) this.line += c
          else this.line = 'x'
        }
      }
    }
  }
  finish(): void {
    if (!this.sse && !this.skip && !this.terminal && this.data) this.parse(this.data + this.decoder.decode())
    this.line = ''; this.data = ''
  }
  private parse(text: string): void {
    if (text.trim() === '[DONE]') { this.terminal = true; return }
    let value: unknown
    try { value = JSON.parse(text) } catch { this.observation = 'malformed'; return }
    if (!record(value)) { this.observation = 'malformed'; return }
    const type = value['type']
    // Wire data is untrusted; object-to-string conversion may itself throw.
    if (this.sse) {
      if (typeof type !== 'string') { this.observation = 'malformed'; return }
      if (!['response.completed', 'response.done', 'response.incomplete', 'response.failed', 'error'].includes(type)) return
    }
    this.terminal = true
    const response = record(value['response']) ? value['response'] : value
    this.usage = parseMetricUsage(response['usage'])
    if (record(response['usage'])) this.observation = 'observed'
    const status = response['status']
    this.outcome = type === 'error' || type === 'response.failed' || status === 'failed' ? 'provider-error'
      : type === 'response.incomplete' || status === 'incomplete' ? 'incomplete'
      : type === 'response.completed' || type === 'response.done' || status === 'completed' ? 'completed' : 'unobserved'
  }
}

interface MetricScope { callId: string; session: string | null; model: string | null; effort: string | null; purpose: RequestMetricStart['purpose'] }

/** One process-local writer; exclusive owner-only file, bounded size, no shared journal mutation. */
export class RequestMetrics {
  private readonly scope = new AsyncLocalStorage<MetricScope>()
  private fd: number | undefined
  private bytes = 0
  private disabled = false
  private readonly journalId = randomUUID()
  readonly filename: string
  constructor(directory: string, private readonly maxBytes = 16 * 1024 * 1024,
    private readonly warn: () => void = () => { console.error('Codex Connect request metrics stopped: local evidence could not be written; reports may be incomplete.') }) {
    if (!isAbsolute(directory)) throw new TypeError('requestMetricsDirectory must be absolute')
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 64 * 1024 * 1024) throw new TypeError('requestMetricsMaxBytes must be between 4096 and 67108864')
    this.filename = join(directory, 'requests-' + randomUUID() + '.jsonl')
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const stat = lstatSync(directory)
      if (!stat.isDirectory() || process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('private metrics directory required')
      this.fd = openSync(this.filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      this.write({ schemaVersion: 1, event: 'collection', id: this.journalId, at: Date.now(), state: 'started' })
    } catch { this.stop() }
  }
  private stop(): void {
    if (this.disabled) return
    this.disabled = true
    if (this.fd !== undefined) {
      try { appendFileSync(this.fd, JSON.stringify({ schemaVersion: 1, event: 'collection', id: this.journalId, at: Date.now(), state: 'stopped' }) + '\n') }
      catch { /* The warning also discloses a missing final journal marker after a write failure. */ }
    }
    this.close()
    this.warn()
  }
  private write(event: RequestMetricEvent): void {
    if (this.disabled || this.fd === undefined) return
    const line = JSON.stringify(event) + '\n'
    const length = Buffer.byteLength(line)
    try {
      // Reserve room for a stop marker so quota exhaustion is visible in offline reports.
      if (this.bytes + length > this.maxBytes - 256) { this.stop(); return }
      appendFileSync(this.fd, line)
      this.bytes += length
    } catch { this.stop() }
  }
  /** Release the local journal descriptor; in-flight writes after close are not claimed as recorded. */
  close(): void {
    if (!this.disabled && this.fd !== undefined) this.write({ schemaVersion: 1, event: 'collection', id: this.journalId, at: Date.now(), state: 'closed' })
    if (this.fd !== undefined) {
      const fd = this.fd; this.fd = undefined
      try { closeSync(fd) } catch { /* No telemetry cleanup error may replace a model result. */ }
    }
  }
  /** Scope each actual adapter call, including compaction/title calls, without rewriting options. */
  stream(stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const scope: MetricScope = { callId: randomUUID(), session: options.sessionId === undefined ? null : metricSessionKey(options.sessionId),
      model: label(options.model), effort: label(options.reasoningEffort), purpose: options.purpose ?? 'conversation' }
    const storage = this.scope
    return { async *[Symbol.asyncIterator]() {
      const iterator = storage.run(scope, () => stream(options)[Symbol.asyncIterator]())
      try {
        while (true) {
          const next = await storage.run(scope, () => iterator.next())
          if (next.done) return
          yield next.value
        }
      } finally { await storage.run(scope, () => iterator.return?.()) }
    } }
  }
  /** Called after admission/reservation, immediately before a real fetch attempt. */
  begin(lane: OpenAICodexBackendLane, id: string): MetricAttempt {
    const now = Date.now(), scope = this.scope.getStore()
    this.write({ schemaVersion: 1, event: 'start', id, at: now, lane, version: CODEX_CONNECT_VERSION,
      callId: scope?.callId ?? null, session: scope?.session ?? null, model: scope?.model ?? null,
      effort: scope?.effort ?? null, purpose: scope?.purpose ?? null })
    return new MetricAttempt(id, event => this.write(event))
  }
}

/** Records the whole response lifetime, including unread-body cancellation, exactly once. */
export class MetricAttempt {
  private readonly start = performance.now()
  private ended = false
  private status: number | null = null
  private observer: MetricResponseObserver | undefined
  constructor(private readonly id: string, private readonly write: (event: RequestMetricFinish) => void) {}
  headers(response: Response, expected?: 'sse'): void {
    this.status = response.status
    const type = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (type.includes('text/event-stream') || type.includes('application/json')) this.observer = new MetricResponseObserver(type.includes('text/event-stream'))
    else if (type === '' && response.ok && expected === 'sse') this.observer = new MetricResponseObserver(true)
  }
  feed(value: Uint8Array): void { this.observer?.feed(value) }
  finish(transport: 'eof' | 'cancelled' | 'network-error'): void {
    if (this.ended) return
    this.ended = true
    if (transport === 'eof') this.observer?.finish()
    // Providers cancel their readers after a terminal event without waiting for socket EOF.
    const observed = this.observer?.outcome ?? 'unobserved'
    const outcome = this.status !== null && this.status >= 400 ? 'http-error'
      : observed !== 'unobserved' ? observed : transport !== 'eof' ? transport : observed
    this.write({ schemaVersion: 1, event: 'finish', id: this.id, at: Date.now(), elapsedMs: Math.max(0, performance.now() - this.start),
      status: this.status, outcome, usage: this.observer?.usage ?? emptyMetricUsage(), observation: this.observer?.observation ?? 'missing' })
  }
}
