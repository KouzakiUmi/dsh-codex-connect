import { expect, it } from 'vitest'
// @ts-expect-error Plain Node matrix diagnostic is not a shipped TypeScript API.
import { taskMatrixFailureSummary } from '../scripts/task-matrix-failure-summary.mjs'

it('identifies failed JSON cases even when the child stderr is blank', () => {
  const text = taskMatrixFailureSummary({ status: 1, stderr: '', stdout: 'private child stdout' }, {
    numFailedTests: 1, numFailedTestSuites: 1, numTotalTests: 138,
    testResults: [{ assertionResults: [
      { title: 'keyless catalog remains available', status: 'failed', failureMessages: ['private assertion payload'] },
      { title: 'passing case', status: 'passed' },
    ] }],
  })
  expect(text).toContain('exit=1')
  expect(text).toContain('numFailedTests=1')
  expect(text).toContain('numTotalTests=138')
  expect(text).toContain('failed case: keyless catalog remains available')
  expect(text).not.toContain('private')
  expect(text).not.toContain('passing case')
})

it('bounds and sanitizes structured identities and stderr', () => {
  const token = `${'a'.repeat(24)}.${'b'.repeat(24)}.${'c'.repeat(24)}`
  const text = taskMatrixFailureSummary({ status: 1, stderr: `/Users/fixture/private/file.js ${token}` }, {
    testResults: [{ assertionResults: Array.from({ length: 30 }, (_, index) => ({
      title: `case-${index} ${'长'.repeat(200)}`, status: 'failed',
    })) }],
  })
  expect(text).not.toContain('case-8')
  expect(text).not.toContain('/Users/fixture')
  expect(text).not.toContain(token)
  expect(text.length).toBeLessThan(1800)
})

it('reports command and cleanup state when JSON is missing or malformed', () => {
  for (const report of [undefined, {}, { testResults: [null, { assertionResults: null }] }]) {
    const text = taskMatrixFailureSummary({ status: null, stderr: '',
      error: new Error('private exception'), cleanupError: new Error('private cleanup') }, report)
    expect(text).toContain('exit=unknown; command-error; cleanup=failed')
    expect(text).toContain('no structured test failures or stderr retained')
    expect(text).not.toContain('private')
  }
})
