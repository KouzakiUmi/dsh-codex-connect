/** Offline aggregation of request journals. Missing observations never become zero-cost work. */
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type { RequestMetricEvent, RequestMetricFinish, RequestMetricStart, RequestMetricUsage } from './request-metrics.ts'

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const token = (v: unknown): boolean => v === null || number(v) && Number.isSafeInteger(v)
const slug = (v: unknown): boolean => v === null || typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(v)
const member = (value: unknown, allowed: readonly string[]): value is string => typeof value === 'string' && allowed.includes(value)
const uuid = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-f-]{36}$/u.test(v)
const keys: readonly (keyof RequestMetricUsage)[] = ['input', 'cachedInput', 'cacheWrite', 'output', 'reasoningOutput']

/** Journals are an external file boundary; never print arbitrary source objects or error text. */
function isEvent(v: unknown): v is RequestMetricEvent {
  if (!record(v) || v['schemaVersion'] !== 1 || !uuid(v['id']) || !number(v['at'])) return false
  if (v['event'] === 'collection') return member(v['state'], ['started', 'closed', 'stopped'])
  if (v['event'] === 'start') return member(v['lane'], ['model', 'search', 'quota', 'image', 'auto-review'])
    && (v['callId'] === null || uuid(v['callId'])) && (v['session'] === null || typeof v['session'] === 'string' && /^[a-f0-9]{64}$/u.test(v['session']))
    && slug(v['model']) && slug(v['effort']) && (v['purpose'] === null || member(v['purpose'], ['conversation', 'compaction', 'session-title']))
    && typeof v['version'] === 'string' && slug(v['version'])
  if (v['event'] !== 'finish' || !number(v['elapsedMs']) || !(v['status'] === null || number(v['status']) && Number.isInteger(v['status']) && v['status'] >= 100 && v['status'] <= 599)) return false
  if (!member(v['outcome'], ['completed', 'incomplete', 'provider-error', 'http-error', 'network-error', 'cancelled', 'unobserved'])
    || !member(v['observation'], ['observed', 'missing', 'oversized', 'malformed']) || !record(v['usage'])) return false
  const usage = v['usage']
  return keys.every(key => token(usage[key]))
    && !(number(usage['input']) && number(usage['cachedInput']) && usage['cachedInput'] > usage['input'])
    && !(number(usage['input']) && number(usage['cacheWrite']) && usage['cacheWrite'] + (number(usage['cachedInput']) ? usage['cachedInput'] : 0) > usage['input'])
    && !(number(usage['output']) && number(usage['reasoningOutput']) && usage['reasoningOutput'] > usage['output'])
}

export interface MetricJournal {
  events: RequestMetricEvent[]
  truncatedTail: boolean
}
/** Bounded regular-file reads; a live/crashed final partial line is disclosed, not silently counted. */
export async function readMetricJournal(filename: string): Promise<MetricJournal> {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('Invalid metrics journal size or file type')
    const buffer = Buffer.alloc(stat.size)
    let read = 0
    while (read < buffer.length) {
      const { bytesRead } = await file.read(buffer, read, buffer.length - read, read)
      if (bytesRead === 0) break
      read += bytesRead
    }
    const contents = buffer.toString('utf8', 0, read)
    const lines = contents.split('\n')
    const truncatedTail = lines.pop() !== ''
    const events: RequestMetricEvent[] = []
    for (const line of lines) {
      let value: unknown
      try { value = JSON.parse(line) } catch { throw new Error('Malformed metrics journal') }
      if (!isEvent(value)) throw new Error('Unsupported metrics journal record')
      events.push(value)
    }
    return { events, truncatedTail }
  } finally { await file.close() }
}

interface MetricRow { start: RequestMetricStart; finish?: RequestMetricFinish }

function sum(values: number[]): number | null {
  const total = values.reduce((a, b) => a + b, 0)
  return Number.isSafeInteger(total) ? total : null
}

function summarize(rows: MetricRow[]) {
  const finished = rows.flatMap(row => row.finish === undefined ? [] : [row.finish])
  const outcomes: Record<string, number> = {}
  for (const row of rows) {
    const outcome = row.finish?.outcome ?? 'pending-or-interrupted'
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
  }
  const usage = Object.fromEntries(keys.map(key => {
    const values = finished.flatMap(row => row.usage[key] === null ? [] : [row.usage[key]])
    return [key, { observedTokens: values.length === 0 ? null : sum(values), observedAttempts: values.length, unknownAttempts: rows.length - values.length }]
  }))
  const paired = finished.filter(row => row.usage.input !== null && row.usage.cachedInput !== null)
  const input = sum(paired.map(row => row.usage.input!)), cached = sum(paired.map(row => row.usage.cachedInput!))
  const calls = new Map<string, number>()
  for (const row of rows) if (row.start.callId !== null) calls.set(row.start.callId, (calls.get(row.start.callId) ?? 0) + 1)
  const durations = finished.map(row => row.elapsedMs).sort((a, b) => a - b)
  return {
    attempts: rows.length,
    observedAdapterCalls: calls.size,
    additionalAttemptsWithinCall: [...calls.values()].reduce((n, attempts) => n + attempts - 1, 0),
    attemptsWithoutCallAttribution: rows.filter(row => row.start.callId === null).length,
    outcomes, usage,
    cacheHitRate: { ratio: input !== null && cached !== null && input > 0 ? cached / input : null,
      pairedAttempts: paired.length, unknownAttempts: rows.length - paired.length, denominator: 'observed input tokens including cache reads' },
    latency: { observedAttempts: durations.length, sumAttemptMs: durations.reduce((a, b) => a + b, 0),
      p50AttemptMs: durations.length === 0 ? null : durations[Math.ceil(durations.length * 0.5) - 1],
      p95AttemptMs: durations.length === 0 ? null : durations[Math.ceil(durations.length * 0.95) - 1] },
  }
}

/** Aggregate explicit evidence only. Session groups are not inferred task/parent relationships. */
export function buildMetricReport(journals: readonly MetricJournal[], sessions: readonly string[] = []) {
  const starts = new Map<string, RequestMetricStart>(), finishes = new Map<string, RequestMetricFinish>()
  const collections = new Map<string, string>()
  const collectionEvents = new Set<string>()
  for (const journal of journals) {
    let collectionId: string | undefined
    let phase: string | undefined
    const fileStarts = new Set<string>()
    for (const event of journal.events) {
      if (!isEvent(event)) throw new Error('Unsupported metrics journal record')
      if (event.event === 'collection') {
        const key = event.id + ':' + event.state
        if (collectionEvents.has(key)) throw new Error('Duplicate metrics collection')
        if (event.state === 'started') {
          if (collectionId !== undefined || collections.has(event.id)) throw new Error('Invalid metrics collection lifecycle')
          collectionId = event.id
        } else if (event.id !== collectionId || phase !== 'started') {
          throw new Error('Invalid metrics collection lifecycle')
        }
        phase = event.state
        collectionEvents.add(key)
        collections.set(event.id, event.state)
        continue
      }
      if (phase !== 'started') throw new Error('Request outside active metrics collection')
      const entries = event.event === 'start' ? starts : finishes
      if (entries.has(event.id)) throw new Error('Duplicate request metrics; do not include the same journal twice')
      if (event.event === 'start') { starts.set(event.id, event); fileStarts.add(event.id) }
      else {
        if (!fileStarts.has(event.id)) throw new Error('Metrics finish has no matching start in this journal')
        finishes.set(event.id, event)
      }
    }
    if (collectionId === undefined) throw new Error('Missing metrics collection header')
  }
  for (const id of finishes.keys()) if (!starts.has(id)) throw new Error('Metrics finish has no matching start')
  const rows: MetricRow[] = [...starts.values()].filter(start => sessions.length === 0 || start.session !== null && sessions.includes(start.session))
    .map(start => ({ start, ...(finishes.has(start.id) ? { finish: finishes.get(start.id)! } : {}) }))
  const group = (key: (start: RequestMetricStart) => string | null) => {
    const groups = new Map<string, MetricRow[]>()
    for (const row of rows) {
      const name = key(row.start) ?? '(unattributed)'
      const values = groups.get(name) ?? []; values.push(row); groups.set(name, values)
    }
    return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [name, summarize(values)]))
  }
  return {
    schemaVersion: 1,
    coverage: 'observed backend attempts only; not a complete task ledger or an acceptance result',
    truncatedJournals: journals.filter(j => j.truncatedTail).length,
    recording: {
      journals: journals.length,
      closed: [...collections.values()].filter(v => v === 'closed').length,
      stoppedEarly: [...collections.values()].filter(v => v === 'stopped').length,
      liveOrInterrupted: [...collections.values()].filter(v => v === 'started').length,
    },
    selectedSessions: sessions,
    versions: [...new Set(rows.map(row => row.start.version))].sort(),
    apiCostEstimate: null,
    subscriptionQuotaCost: null,
    limitations: [
      'No historical backfill, external providers, OAuth, pre-dispatch failures, queue/auth time or user/tool-turn counts.',
      'Auxiliary calls without adapter scope remain unattributed; explicit session selection does not automatically include children.',
      'Additional attempts count retries within an adapter call, not all task-level rework.',
      'Elapsed request time is not task wall-clock time; concurrent attempt durations overlap.',
      'Missing usage is unknown, not zero. Reasoning output is a subset of output.',
      'Recording is opt-in and bounded; absent, stopped or lost journals cannot prove absence of spend.',
      'No price table or subscription conversion is assumed. Completed response does not mean accepted task.',
    ],
    total: summarize(rows),
    bySession: group(start => start.session),
    byModel: group(start => start.model),
    byPurpose: group(start => start.purpose),
    byLane: group(start => start.lane),
  }
}
