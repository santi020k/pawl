import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASELINE_FILE } from '../src/check/baseline.ts'
import { check } from '../src/check/check.ts'
import { formatPretty } from '../src/check/output.ts'
import { countTests, isTestFile, type TestCounts, type TestFile, testCounts, weakerTests } from '../src/check/tests.ts'
import { defaultPolicy, mergeLayers } from '../src/policy/merge.ts'
import { formatWritten, planInit, recordBaseline } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { link, project, write } from './helpers.ts'

const SUM = `import { describe, expect, it } from 'vitest'
import { sum } from './sum.ts'

describe('sum', () => {
  it('adds', () => {
    expect(sum(1, 2)).toBe(3)
    expect(sum(-1, 1)).toBe(0)
  })

  it('keeps the order of the result', () => {
    expect(sum(0.1, 0.2)).toBeCloseTo(0.3)
  })
})
`

describe('counting a test file', () => {
  it('counts the assertions that pin a value, and not the ones that pass for almost anything', () => {
    const counted = countTests(
      'a.test.ts',
      [
        'expect(a).toEqual({ id: 7 })',
        'expect(b).toBeTruthy()',
        'await expect.soft(page).toHaveURL(/x/)',
        'expect(c).toEqual(expect.any(Number))',
        "assert.equal(d, 'x')",
        'assert(e)',
        '// expect(f).toBe(1) in a comment',
        ' * expect(g).toBe(1) in a doc comment'
      ].join('\n')
    )

    // toEqual({ id: 7 }), toHaveURL and assert.equal. The other three pass for almost any value.
    expect(counted.assertions).toBe(3)
  })

  it('finds skipped, todo and fixme tests, with their lines', () => {
    const counted = countTests(
      'a.spec.ts',
      [
        "it.skip('a', () => {})",
        "describe.concurrent.skip('b', () => {})",
        "test.todo('c')",
        "test.fixme('d', async () => {})",
        "xit('e', () => {})",
        "it.skipIf(process.env.CI)('f', () => {})",
        "describe.runIf(ok)('g', () => {})",
        "it('h', () => {})"
      ].join('\n')
    )

    expect(counted.skips).toEqual([
      { line: 1, text: 'it.skip' },
      { line: 2, text: 'describe.concurrent.skip' },
      { line: 3, text: 'test.todo' },
      { line: 4, text: 'test.fixme' },
      { line: 5, text: 'xit' }
    ])
  })

  it('knows test files by the names the test runners use', () => {
    for (const file of ['src/a.test.ts', 'e2e/login.spec.ts', 'cypress/e2e/a.cy.js', 'src/__tests__/a.tsx']) {
      expect(isTestFile(file), file).toBe(true)
    }
    for (const file of ['src/test.ts', 'src/testing/helpers.ts', 'src/a.test.md']) {
      expect(isTestFile(file), file).toBe(false)
    }
  })

  it('recognizes nested test directories without rescanning repeated path segments', () => {
    for (const file of ['__tests__/a.js', 'src/__tests__/nested/a.cts', 'src/__tests__/__tests__/a.tsx']) {
      expect(isTestFile(file), file).toBe(true)
    }
    for (const file of ['src/not__tests__/a.ts', 'src/__tests__suffix/a.ts', '__tests__/.ts', '__tests__/a.ts.map']) {
      expect(isTestFile(file), file).toBe(false)
    }

    const repeated = '__tests__/'.repeat(20_000)

    expect(isTestFile(`${repeated}a.ts`)).toBe(true)
    expect(isTestFile(`${repeated}a.ts.map`)).toBe(false)
  })
})

describe('the ratchet', () => {
  const policy = defaultPolicy()
  const counts = (file: string, assertions: number, skipped = 0, masks = 0): TestFile => ({
    file,
    assertions,
    skipped,
    skips: Array.from({ length: skipped }, (_, index) => ({ line: index + 10, text: 'it.skip' })),
    masks,
    maskLines: Array.from({ length: masks }, (_, index) => ({ line: index + 20, text: 'await sleep(500)' }))
  })
  const baseline: Record<string, TestCounts> = {
    'src/a.test.ts': { assertions: 3, skipped: 0 },
    'src/b.test.ts': { assertions: 5, skipped: 1 }
  }
  const run = (tests: TestFile[], options: Partial<Parameters<typeof weakerTests>[2]> = {}) =>
    weakerTests(tests, baseline, { policy, whole: false, ignored: () => false, ...options })

  it('fails a file with fewer assertions or more skipped tests than the baseline recorded', () => {
    const { findings } = run([counts('src/a.test.ts', 2), counts('src/b.test.ts', 5, 2)])

    expect(findings.map(finding => `${finding.file}:${finding.line} ${finding.rule}`)).toEqual([
      'src/a.test.ts:1 pawl/no-weaker-tests',
      'src/b.test.ts:10 pawl/no-weaker-tests',
      'src/b.test.ts:11 pawl/no-weaker-tests'
    ])
    expect(findings[0]?.message).toContain('This test file has 2 assertions where the baseline recorded 3.')
    expect(findings[1]?.overBaseline).toEqual({ allowed: 1, found: 2 })
  })

  it('leaves alone a file the baseline did not count, and tests that got stronger, which it can lock in', () => {
    expect(run([counts('src/new.test.ts', 0, 3)])).toEqual({ findings: [], canTighten: false })
    expect(run([counts('src/a.test.ts', 4), counts('src/b.test.ts', 5, 0)])).toEqual({
      findings: [],
      canTighten: true
    })
  })

  it('takes the level from the policy and its overrides', () => {
    const relaxed = mergeLayers([
      {
        source: 'repo',
        input: { overrides: [{ files: ['src/a.test.ts'], rules: { 'pawl/no-weaker-tests': 'warn' } }] }
      }
    ])
    const off = mergeLayers([{ source: 'repo', input: { rules: { 'pawl/no-weaker-tests': 'off' } } }])

    expect(run([counts('src/a.test.ts', 0)], { policy: relaxed }).findings[0]?.severity).toBe('warn')
    expect(run([counts('src/a.test.ts', 0)], { policy: off }).findings).toEqual([])
  })

  it('fails a counted test file that is gone, but not one that was renamed or split', () => {
    const removed = run([counts('src/a.test.ts', 3)], { whole: true })

    expect(removed.findings.map(finding => finding.file)).toEqual(['src/b.test.ts'])
    expect(removed.findings[0]?.message).toContain('A test file with 5 assertions is gone')

    const renamed = run([counts('src/a.test.ts', 3), counts('src/b-renamed.test.ts', 5, 1)], { whole: true })

    expect(renamed).toEqual({ findings: [], canTighten: true })
    // A check of some files cannot tell a file that is gone from one it did not look at.
    expect(run([counts('src/a.test.ts', 3)]).findings).toEqual([])
  })

  it('has no floor without counts in the baseline', () => {
    expect(weakerTests([counts('src/a.test.ts', 0)], undefined, { policy, whole: true, ignored: () => false })).toEqual(
      { findings: [], canTighten: false }
    )
  })
})

describe('retries, raised timeouts and fixed sleeps', () => {
  const policy = defaultPolicy()

  it('counts each line that can hide a flaky test once, and leaves good waits alone', () => {
    const file = countTests(
      'src/a.test.ts',
      [
        "test('a', { retry: 3 }, async () => {",
        '  await new Promise(resolve => setTimeout(resolve, 500))',
        '  await page.waitForTimeout(1000)',
        '  cy.wait(250)',
        "  await expect(page.getByText('done')).toBeVisible({ timeout: 10_000 })",
        '  await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 2000 })',
        '  // await sleep(100)',
        '  vi.advanceTimersByTime(500)',
        '}, 30000)',
        'test.describe.configure({ retries: 2 })',
        'jest.retryTimes(2)',
        'jest.setTimeout(20000)',
        'test.slow()'
      ].join('\n')
    )

    expect(file.maskLines.map(mask => mask.line)).toEqual([1, 2, 3, 4, 9, 10, 11, 12, 13])
    expect(file.masks).toBe(9)
  })

  it('fails a file with more of them than the baseline recorded, and has no floor without a count', () => {
    const tests = [
      {
        ...countTests('src/a.test.ts', "test('a', async () => {\n  await sleep(500)\n  expect(1).toBe(1)\n})"),
        file: 'src/a.test.ts'
      }
    ]
    const counted = weakerTests(
      tests,
      { 'src/a.test.ts': { assertions: 1, skipped: 0, masks: 0 } },
      {
        policy,
        whole: false,
        ignored: () => false
      }
    )
    const uncounted = weakerTests(
      tests,
      { 'src/a.test.ts': { assertions: 1, skipped: 0 } },
      {
        policy,
        whole: false,
        ignored: () => false
      }
    )
    const fewer = weakerTests(
      tests,
      { 'src/a.test.ts': { assertions: 1, skipped: 0, masks: 2 } },
      {
        policy,
        whole: false,
        ignored: () => false
      }
    )

    expect(counted.findings).toMatchObject([{ rule: 'pawl/no-weaker-tests', line: 2, file: 'src/a.test.ts' }])
    expect(counted.findings[0]?.message).toContain('sleep(500)')
    expect(uncounted.findings).toEqual([])
    expect(fewer.findings).toEqual([])
    expect(fewer.canTighten).toBe(true)
  })

  it('are kept in the baseline next to the assertions and the skips', () => {
    const file = countTests('src/a.test.ts', "test('a', () => {\n  expect(1).toBe(1)\n}, 10000)")

    expect(testCounts([file])).toEqual({ 'src/a.test.ts': { assertions: 1, skipped: 0, masks: 1 } })
  })
})

describe('the ratchet in a check, with the real Biome', { timeout: 60_000 }, () => {
  const setUp = async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'src/sum.ts': 'export const sum = (a: number, b: number): number => a + b\n',
      'src/sum.test.ts': SUM
    })

    link(root)

    const plan = await planInit({ root, install: false, editor: false })

    applyPlan(plan)
    await formatWritten(
      root,
      plan.actions.map(action => action.path)
    )
    await recordBaseline(root, plan)

    return root
  }
  const rules = (result: Awaited<ReturnType<typeof check>>) =>
    result.findings.map(finding => `${finding.file}:${finding.line} ${finding.rule}`)

  it('records the tests in the baseline, and fails when an agent weakens one, in a hook too', async () => {
    const root = await setUp()
    const baseline = JSON.parse(readFileSync(join(root, BASELINE_FILE), 'utf8')) as { tests?: unknown }

    expect(baseline.tests).toEqual({ 'src/sum.test.ts': { assertions: 3, skipped: 0, masks: 0 } })
    expect(rules(await check({ root }))).toEqual([])

    // The failing assertion becomes one that passes for any number.
    write(root, { 'src/sum.test.ts': SUM.replace('expect(sum(-1, 1)).toBe(0)', 'expect(sum(-1, 1)).toBeDefined()') })

    expect(rules(await check({ root }))).toEqual(['src/sum.test.ts:1 pawl/no-weaker-tests'])
    expect(rules(await check({ root, files: ['src/sum.test.ts'] }))).toEqual(['src/sum.test.ts:1 pawl/no-weaker-tests'])

    write(root, { 'src/sum.test.ts': SUM.replace("it('keeps the order", "it.skip('keeps the order") })

    expect(rules(await check({ root }))).toEqual(['src/sum.test.ts:10 pawl/no-weaker-tests'])
  })

  it('works with a baseline from before pawl counted tests, and says how to start counting them', async () => {
    const root = await setUp()
    const old = JSON.parse(readFileSync(join(root, BASELINE_FILE), 'utf8')) as Record<string, unknown>

    delete old.tests
    write(root, {
      [BASELINE_FILE]: old,
      'src/sum.test.ts': SUM.replace('    expect(sum(-1, 1)).toBe(0)\n', '')
    })

    const result = await check({ root })

    expect(rules(result)).toEqual([])
    expect(result.testsUncounted).toBe(true)
    expect(formatPretty(result)).toContain(
      'The baseline does not count the tests yet. Run "pawl baseline" so they cannot lose assertions.'
    )
  })
})
