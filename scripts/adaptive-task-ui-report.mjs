import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export const requiredAdaptiveTaskUiCases = Object.freeze([
  'matches the host canonical cookie authority across case, default ports and IPv6',
  'keeps signed public task activation closed while ordinary manual model requests still work',
  'rejects missing cookie, forged cookie and cross-origin mutation before creating a task',
  'prevents another valid browser credential from inspecting or controlling a bound task',
  'rejects oversize, wrong-content-type, extra authority and stale mutation requests',
  'removes and remounts exactly one product Task route when Connection is replaced on the same WebServer',
  'owns Task route cleanup across Task and Product reloads without reopening activation or resetting recovery',
  'returns a structured unavailable response when the live Connection verifier throws',
  'runs the paused public control over authenticated HTTP and reconciles a lost manual-exit reply',
])

/** Accept Vitest JSON evidence, not just its success flag (which permits skipped tests). */
export function assertAdaptiveTaskUiReport(report, root) {
  assert.equal(report.success, true, 'Vitest must report success')
  assert.ok(Array.isArray(report.testResults), 'Missing file results')
  assert.equal(report.testResults.length, 1, 'Expected only the authenticated Task HTTP suite')
  const file = report.testResults[0]
  // Vitest emits slash(path.resolve(...)), preserving drive case and absolute identity.
  const slash = path => path.replace(/\\/g, '/')
  assert.equal(typeof file.name, 'string', 'Unexpected test file')
  assert.equal(slash(file.name), slash(resolve(root, 'tests/adaptive-task-http.spec.ts')), 'Unexpected test file')
  assert.equal(file.status, 'passed', 'Test file did not pass')
  assert.equal(file.message, '', 'Test file reported an error')
  assert.ok(Array.isArray(file.assertionResults), 'Missing assertion results')

  const identities = new Set()
  const suites = new Set([JSON.stringify([])]) // The file itself is one Vitest suite.
  const required = new Map(requiredAdaptiveTaskUiCases.map(title => [title, 0]))
  for (const test of file.assertionResults) {
    assert.equal(test.status, 'passed', `Test did not execute successfully: ${test.title}`)
    assert.deepEqual(test.failureMessages, [], `Test reported errors: ${test.title}`)
    assert.ok(typeof test.title === 'string' && test.title.length > 0, 'Missing test title')
    assert.ok(Array.isArray(test.ancestorTitles)
      && test.ancestorTitles.every(title => typeof title === 'string' && title.length > 0), 'Missing suite identity')
    assert.equal(test.fullName, [...test.ancestorTitles, test.title].join(' '), 'Inconsistent assertion name')
    const identity = JSON.stringify([...test.ancestorTitles, test.title])
    assert.ok(!identities.has(identity), `Duplicated test evidence: ${test.fullName}`)
    identities.add(identity)
    // Vitest counts the file and each describe block as a suite, not just testResults.
    for (let length = 1; length <= test.ancestorTitles.length; length++) {
      suites.add(JSON.stringify(test.ancestorTitles.slice(0, length)))
    }
    if (required.has(test.title)) {
      assert.equal(test.ancestorTitles.length, 0, `Required case moved to an unrelated suite: ${test.title}`)
      required.set(test.title, required.get(test.title) + 1)
    }
  }
  for (const [title, count] of required) assert.equal(count, 1, `Missing or duplicated required case: ${title}`)
  const counters = {
    numTotalTests: identities.size, numPassedTests: identities.size,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numTotalTestSuites: suites.size, numPassedTestSuites: suites.size,
    numFailedTestSuites: 0, numPendingTestSuites: 0,
  }
  for (const [name, expected] of Object.entries(counters)) {
    assert.equal(report[name], expected, `Inconsistent Vitest counter: ${name}`)
  }
}
