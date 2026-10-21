import { sanitizeSummary } from './check-dsh-next.mjs'

/** Report failed case identities, never assertion payloads or arbitrary child stdout. */
export function taskMatrixFailureSummary(result, report) {
  const status = Number.isSafeInteger(result.status) ? result.status : 'unknown'
  const counts = ['numFailedTests', 'numFailedTestSuites', 'numTotalTests']
    .filter(key => Number.isSafeInteger(report?.[key]) && report[key] >= 0)
    .map(key => `${key}=${report[key]}`)
  const failed = Array.isArray(report?.testResults) ? report.testResults.flatMap(suite =>
    Array.isArray(suite?.assertionResults) ? suite.assertionResults
      .filter(test => test?.status === 'failed' && typeof test.title === 'string')
      .map(test => `failed case: ${test.title}`) : []) : []
  const stderr = sanitizeSummary(typeof result.stderr === 'string' ? result.stderr : '')
  const detail = sanitizeSummary([...counts, ...failed.slice(0, 8), stderr].filter(Boolean).join('\n'))
  return `exit=${status}${result.error === undefined ? '' : '; command-error'}${result.cleanupError === undefined ? '' : '; cleanup=failed'}`
    + (detail === '' ? '; no structured test failures or stderr retained' : `:\n${detail}`)
}
