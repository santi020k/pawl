/**
 * The ratchet on tests. An agent can turn a failing test green without fixing anything: strip
 * its assertions, swap one for a check that passes for almost any value, or skip the test. So the
 * baseline also counts, per test file, the assertions and the skipped tests, and a check fails
 * when a file has fewer of the first or more of the second.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from '../project/files.ts'
import { levelForFile } from '../scans/scan.ts'
import { type Finding, type Policy } from '../types.ts'
import { isFile } from '../utils/fs.ts'
import { plural } from '../utils/text.ts'

export const WEAKER_TESTS = 'pawl/no-weaker-tests'

/** What the baseline keeps for one test file. */
export interface TestCounts {
  /** Assertions that pin a value, so not the ones that pass for almost any value. */
  assertions: number
  /** Tests that are skipped, left to do, or marked to fix later. */
  skipped: number
}

/** What one test file has now, with the line of each skipped test. */
export interface TestFile extends TestCounts {
  file: string
  skips: { line: number; text: string }[]
}

/** Vitest, Jest, Playwright and Cypress files, and the files under a __tests__ folder. */
export const isTestFile = (file: string): boolean => {
  if (/\.(?:test|spec|cy|e2e)\.[cm]?[jt]sx?$/.test(file)) return true

  const segments = file.split('/')
  const folder = segments.indexOf('__tests__')

  // Find the directory once, then check its remainder once: repeated directory names must not
  // restart a scan of the entire remaining path when its extension does not match.
  return folder >= 0 && /^.+\.[cm]?[jt]sx?$/.test(segments.slice(folder + 1).join('/'))
}

/** expect, its soft and polling forms, the type-level ones, and node:assert. */
const ASSERTION = /\b(?:expect(?:\.soft|\.poll)?|expectTypeOf|assertType|assert(?:\.[A-Za-z]+)?)\s*\(/g

/**
 * The checks that pass for almost any value. Each one takes the place of an assertion in the
 * count, so turning `toEqual({ id: 7 })` into `toBeTruthy()` lowers it, and adding a new one
 * leaves it as it was.
 */
const WEAK =
  /\.(?:toBeTruthy|toBeFalsy|toBeDefined)\s*\(\s*\)|\.not\.(?:toBeNull|toBeUndefined)\s*\(\s*\)|\bexpect\.(?:anything|any)\s*\(|\bassert(?:\.ok)?\s*\(/g

/** `it.skip`, `describe.todo`, Playwright's `test.fixme`, and the `x` forms of Jest and Jasmine. */
const SKIP =
  /\b(?:(?:describe|it|test|suite|context|bench)(?:\.(?:concurrent|sequential|each|serial|parallel))*\.(?:skip|todo|fixme)\b|x(?:describe|it|test)\s*\()/

/** A line that is only a comment. Assertions shown in a comment are not run. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0

/** Count the assertions and skipped tests in one test file. */
export const countTests = (file: string, text: string): TestFile => {
  const code = text
    .split('\n')
    .map(line => (COMMENT_LINE.test(line) ? '' : line))
    .join('\n')
  const skips = code.split('\n').flatMap((line, index) => {
    const match = SKIP.exec(line)

    return match ? [{ line: index + 1, text: match[0].replace(/\s*\($/, '') }] : []
  })

  return {
    file,
    assertions: Math.max(0, count(code, ASSERTION) - count(code, WEAK)),
    skipped: skips.length,
    skips
  }
}

/** The test files of a project, or of the files given, with their counts. */
export const scanTests = (root: string, ignored: (file: string) => boolean, files?: readonly string[]): TestFile[] =>
  (files ?? listFiles(root))
    .filter(file => isTestFile(file) && !ignored(file) && isFile(join(root, file)))
    .map(file => countTests(file, readFileSync(join(root, file), 'utf8')))

/** The counts the baseline keeps: only files with something to count, so the file stays short. */
export const testCounts = (tests: readonly TestFile[]): Record<string, TestCounts> =>
  Object.fromEntries(
    tests
      .filter(test => test.assertions > 0 || test.skipped > 0)
      .map(test => [test.file, { assertions: test.assertions, skipped: test.skipped }])
  )

export interface TestRatchet {
  findings: Finding[]
  /** The tests are ahead of the baseline: more assertions, fewer skips, or a test file renamed. */
  canTighten: boolean
}

interface RatchetOptions {
  policy: Policy
  /** A check of the whole project, which can tell a test file that is gone from one it did not look at. */
  whole: boolean
  ignored: (file: string) => boolean
}

const finding = (file: string, line: number, message: string, severity: Finding['severity'], extra = {}): Finding => ({
  file,
  line,
  column: 1,
  engine: 'pawl',
  engineRule: 'no-weaker-tests',
  rule: WEAKER_TESTS,
  severity,
  message,
  fixable: false,
  ...extra
})

const PERSON = 'If the tests changed on purpose, a person accepts it by running "pawl baseline".'

/**
 * Compare the tests with the baseline. A file the baseline did not count has no floor yet. On a
 * check of the whole project, a counted test file that is gone fails too, unless test files the
 * baseline does not know have at least as many assertions, as when the file was renamed or split.
 */
export const weakerTests = (
  tests: readonly TestFile[],
  baseline: Record<string, TestCounts> | undefined,
  { policy, whole, ignored }: RatchetOptions
): TestRatchet => {
  if (!baseline) return { findings: [], canTighten: false }

  const findings: Finding[] = []
  let canTighten = false

  for (const test of tests) {
    const recorded = Object.hasOwn(baseline, test.file) ? baseline[test.file] : undefined

    if (!recorded) continue

    const severity = levelForFile(policy, WEAKER_TESTS, test.file, 'error')

    canTighten ||= test.assertions > recorded.assertions || test.skipped < recorded.skipped

    if (severity === 'off') continue

    if (test.assertions < recorded.assertions) {
      findings.push(
        finding(
          test.file,
          1,
          `This test file has ${plural(test.assertions, 'assertion')} where the baseline recorded ${recorded.assertions}. Put back the checks the tests made, with the values they pinned. ${PERSON}`,
          severity
        )
      )
    }

    if (test.skipped > recorded.skipped) {
      for (const skip of test.skips) {
        findings.push(
          finding(
            test.file,
            skip.line,
            `New skipped test ("${skip.text}"). Make the test pass instead of skipping it. ${PERSON}`,
            severity,
            recorded.skipped > 0 ? { overBaseline: { allowed: recorded.skipped, found: test.skipped } } : {}
          )
        )
      }
    }
  }

  if (!whole) return { findings, canTighten }

  const present = new Set(tests.map(test => test.file))
  const gone = Object.entries(baseline).filter(
    ([file, counts]) => !present.has(file) && !ignored(file) && counts.assertions > 0
  )
  const lost = gone.reduce((sum, [, counts]) => sum + counts.assertions, 0)
  const added = tests
    .filter(test => !Object.hasOwn(baseline, test.file))
    .reduce((sum, test) => sum + test.assertions, 0)

  if (gone.length > 0 && added >= lost) return { findings, canTighten: true }

  for (const [file, counts] of gone) {
    const severity = levelForFile(policy, WEAKER_TESTS, file, 'error')

    if (severity === 'off') continue

    findings.push(
      finding(
        file,
        1,
        `A test file with ${plural(counts.assertions, 'assertion')} is gone, and no new test file has them. Bring the tests back, or move them to another file. ${PERSON}`,
        severity
      )
    )
  }

  return { findings, canTighten }
}
