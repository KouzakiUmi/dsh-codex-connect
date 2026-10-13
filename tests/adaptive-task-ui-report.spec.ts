import { expect, it, vi } from 'vitest'
import { resolve, win32 } from 'node:path'

// Exercise native Windows resolution on any test host without changing the helper API.
vi.mock('node:path', async importOriginal => {
  const actual = await importOriginal<typeof import('node:path')>()
  return { ...actual, resolve: vi.fn(actual.resolve) }
})
// @ts-expect-error Plain Node report helper is outside the source build.
import { assertAdaptiveTaskUiReport, requiredAdaptiveTaskUiCases as untypedRequiredCases } from '../scripts/adaptive-task-ui-report.mjs'
const requiredAdaptiveTaskUiCases = untypedRequiredCases as readonly string[]

const root = process.cwd()
const suite = 'tests/adaptive-task-http.spec.ts'
// Shape emitted by the installed Vitest JSON reporter; success alone permits skips/todos.
function fixture(titles = [...requiredAdaptiveTaskUiCases]) {
  return {
    success: true,
    numTotalTestSuites: 1, numPassedTestSuites: 1, numFailedTestSuites: 0, numPendingTestSuites: 0,
    numTotalTests: titles.length, numPassedTests: titles.length,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [{
      name: resolve(root, suite).replace(/\\/g, '/'), status: 'passed', message: '',
      assertionResults: titles.map(title => ({
        ancestorTitles: [] as string[], fullName: title, title,
        status: 'passed', duration: 1, failureMessages: [] as string[], meta: {}, tags: [],
      })),
    }],
  }
}

it('accepts the required authenticated HTTP and real browser evidence', () => {
  expect(() => assertAdaptiveTaskUiReport(fixture(), root)).not.toThrow()
})
it.each([
  String.raw`C:\work\repo\tests\adaptive-task-http.spec.ts`,
  'C:/work/repo/tests/adaptive-task-http.spec.ts',
])('accepts Windows report separators against native resolution: %s', name => {
  const report = fixture()
  report.testResults[0]!.name = name
  const windowsRoot = String.raw`C:\work\repo`
  vi.mocked(resolve).mockReturnValueOnce(win32.resolve(windowsRoot, suite))
  expect(() => assertAdaptiveTaskUiReport(report, windowsRoot)).not.toThrow()
  expect(resolve).toHaveBeenLastCalledWith(windowsRoot, suite)
})
it.each([
  'C:/work/repo/tests/unrelated.spec.ts',
  'tests/adaptive-task-http.spec.ts',
  String.raw`tests\adaptive-task-http.spec.ts`,
  'C:/work/other/tests/adaptive-task-http.spec.ts',
  'D:/work/repo/tests/adaptive-task-http.spec.ts',
  'c:/work/repo/tests/adaptive-task-http.spec.ts',
  'C:/work/repo/tests/../tests/adaptive-task-http.spec.ts',
])('rejects a nonidentical Windows report path: %s', name => {
  const report = fixture()
  report.testResults[0]!.name = name
  const windowsRoot = String.raw`C:\work\repo`
  vi.mocked(resolve).mockReturnValueOnce(win32.resolve(windowsRoot, suite))
  expect(() => assertAdaptiveTaskUiReport(report, windowsRoot)).toThrow(/Unexpected test file/)
})
it('accepts genuinely extra passing tests rather than enforcing a fixed total', () => {
  expect(() => assertAdaptiveTaskUiReport(fixture([...requiredAdaptiveTaskUiCases, 'additional safety case']), root)).not.toThrow()
})
it('reconciles Vitest describe-block suite counts for additional passing tests', () => {
  const report = fixture([...requiredAdaptiveTaskUiCases, 'additional safety case'])
  const extra = report.testResults[0]!.assertionResults.at(-1)!
  extra.ancestorTitles.push('additional coverage')
  extra.fullName = [...extra.ancestorTitles, extra.title].join(' ')
  report.numTotalTestSuites = report.numPassedTestSuites = 2
  expect(() => assertAdaptiveTaskUiReport(report, root)).not.toThrow()
})
it('rejects a missing Chromium scenario even with honest passing counters', () => {
  const report = fixture(requiredAdaptiveTaskUiCases.slice(0, -1))
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Missing or duplicated required case/)
})
it.each(requiredAdaptiveTaskUiCases.slice(5, 8))('rejects old coverage without required regression: %s', missing => {
  // Includes all six pre-regression cases, and even the other new cases.
  const report = fixture(requiredAdaptiveTaskUiCases.filter(title => title !== missing))
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Missing or duplicated required case/)
})
it('rejects the old six-case report despite its success flag', () => {
  const report = fixture([...requiredAdaptiveTaskUiCases.slice(0, 5), requiredAdaptiveTaskUiCases[8]!])
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Missing or duplicated required case/)
})
it.each(['failed', 'pending', 'todo', 'skipped', 'disabled'])('rejects a %s assertion despite a success flag', status => {
  const report = fixture()
  report.testResults[0]!.assertionResults[0]!.status = status
  report.numPassedTests--
  if (status === 'failed') report.numFailedTests++
  else if (status === 'todo') report.numTodoTests++
  else report.numPendingTests++
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/did not execute successfully/)
})
it.each([
  'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests',
  'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites',
] as const)('rejects dishonest counter %s', counter => {
  const report = fixture()
  report[counter]++
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Inconsistent Vitest counter/)
})
it('rejects duplicated required evidence even with matching counters', () => {
  const report = fixture([...requiredAdaptiveTaskUiCases, requiredAdaptiveTaskUiCases[8]!])
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Duplicated test evidence/)
})
it('rejects unrelated file results even with required assertion names', () => {
  const report = fixture()
  report.testResults[0]!.name = resolve(root, 'tests/unrelated.spec.ts')
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Unexpected test file/)
})
it('rejects required names transplanted from another suite', () => {
  const report = fixture()
  const test = report.testResults[0]!.assertionResults[8]!
  test.ancestorTitles.push('unrelated')
  test.fullName = [...test.ancestorTitles, test.title].join(' ')
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Required case moved/)
})
it('rejects additional unrelated file results', () => {
  const report = fixture()
  report.testResults.push({ ...report.testResults[0]!, name: resolve(root, 'tests/unrelated.spec.ts') })
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Expected only/)
})
it('rejects inconsistent assertion identities', () => {
  const report = fixture()
  report.testResults[0]!.assertionResults[0]!.fullName = 'unrelated case'
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Inconsistent assertion name/)
})
it('rejects file-level errors or unsuccessful reports', () => {
  const report = fixture()
  report.testResults[0]!.message = 'afterAll failed'
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/reported an error/)
  report.testResults[0]!.message = ''
  report.testResults[0]!.status = 'failed'
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Test file did not pass/)
  report.testResults[0]!.status = 'passed'
  report.success = false
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/must report success/)
})
it('rejects failure messages on otherwise passing assertions', () => {
  const report = fixture()
  report.testResults[0]!.assertionResults[0]!.failureMessages.push('hidden failure')
  expect(() => assertAdaptiveTaskUiReport(report, root)).toThrow(/Test reported errors/)
})
