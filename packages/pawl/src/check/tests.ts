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
  /**
   * Lines that can hide a flaky test instead of fixing it: a retry, a raised timeout or a fixed
   * sleep. Absent in a baseline an earlier version of pawl wrote: then they have no floor yet.
   */
  masks?: number
}

/** What one test file has now, with the line of each skipped test and of each retry, timeout or sleep. */
export interface TestFile extends TestCounts {
  file: string
  skips: { line: number; text: string }[]
  masks: number
  maskLines: { line: number; text: string; kind: 'retry' | 'timeout' | 'sleep' }[]
}

/** What can hide a flaky test: a retry, a raised timeout or a fixed sleep. */
type Mask = TestFile['maskLines'][number]['kind']

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

/**
 * What makes a flaky test pass now and then instead of fixing it: a retry (Vitest's `retry`,
 * Playwright's `retries`, Jest's `retryTimes`, Mocha's `this.retries`), a raised timeout (a
 * `timeout` option, `jest.setTimeout`, `test.setTimeout`, `test.slow()`, a number after the test's
 * function), or a fixed sleep (`waitForTimeout`, `cy.wait(500)`, `setTimeout(resolve, 500)`,
 * `sleep(500)`). Each line counts once, however many of them it has.
 */
const MASKS: readonly (readonly [Mask, RegExp])[] = [
  ['retry', /\bretryTimes\s*\(/],
  ['timeout', /\b(?:jest|vi|test|this)\.setTimeout\s*\(/],
  ['timeout', /\bthis\.timeout\s*\(\s*\d/],
  ['timeout', /\btest\.slow\s*\(/],
  ['sleep', /\bwaitForTimeout\s*\(/],
  ['sleep', /\bcy\.wait\s*\(\s*\d/],
  ['sleep', /\bsetTimeout\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*\d/],
  ['sleep', /\b(?:sleep|delay|wait)\s*\(\s*\d/]
]

/**
 * A retry or a timeout option. It raises them for a test only on a call of the test runner: on an
 * assertion that retries or a wait for something, it is how to wait well, and on the code the
 * test calls, it is what the test checks.
 */
const OPTION = /\b(?:retry|retries)\s*:\s*[1-9]|\b(?:test)?timeout\s*:\s*\d/gi

/** The test runner's own calls: `test`, `it.concurrent`, `describe`, the hooks, `test.describe.configure`, `vi.setConfig`. */
const RUNNER =
  /^(?:[fx]?(?:test|it|describe|suite|context|specify|bench)|(?:before|after)(?:Each|All)?|vi\.setConfig)\b/

/**
 * Script text with the inside of every string, template and regular expression blanked, and every
 * comment, lines kept, so a retry or a timeout written in one is not taken for code.
 */
const blankScript = (text: string): string => {
  let out = ''
  let index = 0
  // The last character outside what is blanked that is not a space: a slash after one of these starts a regular expression.
  let last = ''
  const blank = (from: number, to: number): string => text.slice(from, to).replace(/[^\n]/g, ' ')

  while (index < text.length) {
    const char = text[index] as string
    const next = text[index + 1]

    if (char === '/' && (next === '/' || next === '*')) {
      // A line comment ends before its newline, a block comment after its */, and either at the end.
      const end = next === '/' ? text.indexOf('\n', index) : text.indexOf('*/', index + 2) + 2
      const stop = end === -1 || end === 1 ? text.length : end

      out += blank(index, stop)
      index = stop
    } else if (`'"\``.includes(char) || (char === '/' && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last)))) {
      let end = index + 1
      let inClass = false

      while (end < text.length) {
        const current = text[end]

        if (current === '\\') end++
        else if (current === '\n' && char !== '`') break
        else if (char === '/' && current === '[') inClass = true
        else if (char === '/' && current === ']') inClass = false
        else if (current === char && !inClass) break

        end++
      }

      const stop = Math.min(end, text.length)
      const closed = text[stop] === char

      out += char + blank(index + 1, stop) + (closed ? char : '')
      index = closed ? stop + 1 : stop
      last = char
    } else {
      if (!/\s/.test(char)) last = char

      out += char
      index++
    }
  }

  return out
}

/** Where the bracket that `close` closes opens, in text whose strings are blanked. */
const openerOf = (script: string, close: number): number => {
  let depth = 0

  for (let index = close; index >= 0; index--) {
    const char = script[index] as string

    if (')]}'.includes(char)) depth++
    else if ('([{'.includes(char) && --depth === 0) return index
  }

  return 0
}

/** What a call hangs from, up to its opening parenthesis: `expect(page.getByText(…)).toBeVisible`, `test.describe.configure`. */
const chainBefore = (script: string, paren: number): string => {
  let index = paren - 1

  while (index >= 0) {
    const char = script[index] as string

    if (/[\w$]/.test(char)) {
      index--
    } else if (char === '.') {
      index--

      while (index >= 0 && /\s/.test(script[index] as string)) index--

      if (script[index] === '?') index--
    } else if (char === ')' || char === ']') {
      index = openerOf(script, index) - 1
    } else {
      break
    }
  }

  return script.slice(index + 1, paren)
}

/** A `{` that opens a block, such as a function's body, and not an object: it follows `=>` or `)`. */
const opensBlock = (script: string, brace: number): boolean => {
  let index = brace - 1

  while (index >= 0 && /\s/.test(script[index] as string)) index--

  return script[index] === ')' || (script[index] === '>' && script[index - 1] === '=')
}

/**
 * The call whose arguments hold the text at `at`, through the objects and lists around it. Empty
 * outside any call, and inside a block: an object in a test's body is test data, not its options.
 */
const callAround = (script: string, at: number): string => {
  let depth = 0

  for (let index = at - 1; index >= 0; index--) {
    const char = script[index] as string

    if (')]}'.includes(char)) depth++
    else if (char === '(' && depth === 0) return chainBefore(script, index)
    else if (char === '{' && depth === 0 && opensBlock(script, index)) return ''
    else if ('([{'.includes(char)) depth = Math.max(0, depth - 1)
  }

  return ''
}

/** A line that ends a function with a number after it: `}, 5000)`. */
const NUMBER_AFTER = /^(\s*)\}\s*,\s*\d{3,}\s*\)/

/**
 * A number after a test's function, as on `}, 5000)`: a raised timeout only when the `}` closes a
 * function's body and the `)` closes a call of the test runner, not an object passed to other code.
 */
const timeoutAfterTest = (script: string, start: number, line: string): boolean => {
  const match = NUMBER_AFTER.exec(line)

  if (!match) return false

  const brace = start + (match[1] ?? '').length
  const paren = start + match[0].length - 1

  return opensBlock(script, openerOf(script, brace)) && RUNNER.test(chainBefore(script, openerOf(script, paren)))
}

/** A retry method with a count: `test.retry(2)`, `this.retries(2)`, `it('x', fn).retries(2)`. */
const RETRY_CALL = /\.(?:retry|retries)\s*\(\s*[1-9]/g

/**
 * A retry method called on the test runner or on Mocha's `this`, not one on the code the test
 * calls, such as SuperAgent's `request.get('/api').retry(3)`, which is what the test checks.
 */
const retryOfTest = (script: string, start: number, line: string): boolean =>
  [...line.matchAll(RETRY_CALL)].some(match => {
    const chain = chainBefore(script, start + match.index + match[0].indexOf('('))

    return /^this\./.test(chain) || RUNNER.test(chain)
  })

/** The retry, raised timeout or fixed sleep a line of the script has, if any. `start` is where the line starts in it. */
const maskOf = (script: string, start: number, line: string): Mask | undefined => {
  const kind = MASKS.find(([, mask]) => mask.test(line))?.[0]

  if (kind) return kind

  if (retryOfTest(script, start, line)) return 'retry'

  if (timeoutAfterTest(script, start, line)) return 'timeout'

  const option = [...line.matchAll(OPTION)].find(match => RUNNER.test(callAround(script, start + match.index)))

  if (!option) return undefined

  return /^(?:retry|retries)\b/i.test(option[0]) ? 'retry' : 'timeout'
}

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

  const script = blankScript(text)
  const lines = text.split('\n')
  let start = 0
  const maskLines = script.split('\n').flatMap((line, index) => {
    const kind = maskOf(script, start, line)

    start += line.length + 1

    return kind ? [{ line: index + 1, text: (lines[index] ?? '').trim().slice(0, 80), kind }] : []
  })

  return {
    file,
    assertions: Math.max(0, count(code, ASSERTION) - count(code, WEAK)),
    skipped: skips.length,
    skips,
    masks: maskLines.length,
    maskLines
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
      .filter(test => test.assertions > 0 || test.skipped > 0 || test.masks > 0)
      .map(test => [test.file, { assertions: test.assertions, skipped: test.skipped, masks: test.masks }])
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

/** How to fix each way a test file got weaker. The message of each finding says it, and it is the finding's fix. */
const ADVICE = {
  assertions: 'Put back the checks the tests made, with the values they pinned.',
  skipped: 'Make the test pass instead of skipping it.',
  gone: 'Bring the tests back, or move them to another file.',
  retry: 'Find why the test fails now and then, and fix that instead of running it again.',
  timeout:
    'Find what the test waits for, and wait for that with an assertion that retries instead of giving it more time.',
  sleep: 'Wait for what the test needs with an assertion that retries, instead of for a fixed time.'
} as const

/** A retry, a raised timeout and a fixed sleep, as a finding names them. */
const MASK_NAMES: Record<Mask, string> = { retry: 'retry', timeout: 'raised timeout', sleep: 'fixed sleep' }

/** How to fix a `pawl/no-weaker-tests` finding: the advice for what the test file lost or gained. */
export const weakerTestsAdvice = (finding: Finding): string | undefined =>
  finding.rule === WEAKER_TESTS ? Object.values(ADVICE).find(advice => finding.message.includes(advice)) : undefined

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

    canTighten ||=
      test.assertions > recorded.assertions ||
      test.skipped < recorded.skipped ||
      (recorded.masks !== undefined && test.masks < recorded.masks)

    if (severity === 'off') continue

    if (test.assertions < recorded.assertions) {
      findings.push(
        finding(
          test.file,
          1,
          `This test file has ${plural(test.assertions, 'assertion')} where the baseline recorded ${recorded.assertions}. ${ADVICE.assertions} ${PERSON}`,
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
            `New skipped test ("${skip.text}"). ${ADVICE.skipped} ${PERSON}`,
            severity,
            recorded.skipped > 0 ? { overBaseline: { allowed: recorded.skipped, found: test.skipped } } : {}
          )
        )
      }
    }
  }

  for (const test of tests) {
    const allowed = Object.hasOwn(baseline, test.file) ? baseline[test.file]?.masks : undefined

    if (allowed === undefined || test.masks <= allowed) continue

    const severity = levelForFile(policy, WEAKER_TESTS, test.file, 'error')

    if (severity === 'off') continue

    for (const mask of test.maskLines) {
      findings.push(
        finding(
          test.file,
          mask.line,
          `A new ${MASK_NAMES[mask.kind]} ("${mask.text}") can make a flaky test pass now and then instead of fixing it. ${ADVICE[mask.kind]} ${PERSON}`,
          severity,
          allowed > 0 ? { overBaseline: { allowed, found: test.masks } } : {}
        )
      )
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
        `A test file with ${plural(counts.assertions, 'assertion')} is gone, and no new test file has them. ${ADVICE.gone} ${PERSON}`,
        severity
      )
    )
  }

  return { findings, canTighten }
}
