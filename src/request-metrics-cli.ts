/** Boot-free, network-free export of explicitly selected local request journals. */
import { buildMetricReport, readMetricJournal } from './request-metrics-report.ts'
import { metricSessionKey } from './request-metrics.ts'

export async function runRequestMetricsCommand(argv: readonly string[]): Promise<number> {
  const files: string[] = [], sessions: string[] = []
  let json = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json' && !json) { json = true; continue }
    const value = argv[i + 1]
    if ((arg !== '--file' && arg !== '--session') || value === undefined || value.startsWith('--') || value.length === 0 || value.length > 4096) {
      process.stderr.write('Usage: dsh-codex-connect metrics --file <journal.jsonl> [--file <journal.jsonl>] [--session <DSH-session-id>] [--json]\n')
      return 1
    }
    if (arg === '--file') files.push(value)
    else sessions.push(metricSessionKey(value))
    i += 1
  }
  if (files.length === 0 || files.length > 32 || new Set(files).size !== files.length) {
    process.stderr.write('Metrics requires 1..32 distinct explicit journal files.\n')
    return 1
  }
  try {
    const journals = []
    for (const file of files) journals.push(await readMetricJournal(file))
    const report = buildMetricReport(journals, sessions)
    if (json) process.stdout.write(JSON.stringify(report) + '\n')
    else process.stdout.write([
      'Codex Connect — observed request report (not a subscription bill)',
      'HTTP attempts: ' + report.total.attempts,
      'Adapter calls: ' + report.total.observedAdapterCalls,
      'Additional attempts within a call: ' + report.total.additionalAttemptsWithinCall,
      'Outcomes: ' + JSON.stringify(report.total.outcomes),
      'Usage (unknown is not zero): ' + JSON.stringify(report.total.usage),
      'Token-weighted cache hit ratio: ' + (report.total.cacheHitRate.ratio ?? 'unknown'),
      'Cache observations: ' + report.total.cacheHitRate.pairedAttempts + '; unknown: ' + report.total.cacheHitRate.unknownAttempts,
      'Partial journal tails: ' + report.truncatedJournals,
      'Recording state: ' + JSON.stringify(report.recording),
      ...report.limitations,
      'Use --json for session/model/purpose/lane breakdowns.',
      '',
    ].join('\n'))
    return 0
  } catch {
    process.stderr.write('Could not read metrics evidence: check regular JSONL files, schema and duplicate inputs. No network request was made.\n')
    return 1
  }
}
