import { describe, expect, it } from 'vitest'
import { type CheckResult, exitCode } from '../src/check.ts'
import { formatAgent, formatPretty } from '../src/output.ts'
import { type Finding } from '../src/types.ts'

const result = (findings: Finding[], extra: Partial<CheckResult> = {}): CheckResult => ({
  findings,
  baselined: 0,
  setup: [],
  engines: ['biome'],
  commands: ['biome check .'],
  hasBaseline: true,
  canShrinkBaseline: false,
  nothingToCheck: false,
  ...extra
})

const any: Finding = {
  file: 'src/a.ts',
  line: 3,
  column: 7,
  engine: 'biome',
  engineRule: 'suspicious/noExplicitAny',
  rule: '@typescript-eslint/no-explicit-any',
  severity: 'warn',
  message: 'Unexpected any.',
  fixable: false
}

const format: Finding = {
  ...any,
  line: 1,
  column: 1,
  engineRule: 'format',
  rule: 'pawl/format',
  severity: 'error',
  message: 'File is not formatted.',
  fixable: true
}

describe('agent output', () => {
  it('prints nothing when there is nothing to do', () => {
    expect(formatAgent(result([]))).toBe('')
  })

  it('prints one compact JSON object per finding, errors first, with the engine rule and a fix', () => {
    const lines = formatAgent(result([any, format]))
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)

    expect(lines).toEqual([
      { file: 'src/a.ts', line: 1, rule: 'biome:format', message: 'File is not formatted.', fix: 'Run "pawl fix".' },
      {
        file: 'src/a.ts',
        line: 3,
        rule: 'biome:suspicious/noExplicitAny',
        message: 'Unexpected any.',
        fix: 'Use a specific type, or unknown and narrow it.'
      }
    ])
  })
})

describe('pretty output', () => {
  it('names the engine and its rule, then summarises', () => {
    const text = formatPretty(result([any, format], { baselined: 4 }), { verbose: true })

    expect(text).toContain('src/a.ts:3:7  warn   biome   suspicious/noExplicitAny')
    expect(text).toContain('1 error, 1 warning. Run "pawl fix" to fix 1 of them.')
    expect(text).toContain('4 existing findings allowed by the baseline.')
    expect(text).toContain('biome check .')
  })

  it('does not claim success when an engine failed', () => {
    const text = formatPretty(result([], { setup: [{ code: 'engine-failed', message: 'biome could not run: boom' }] }))

    expect(text).toContain('biome could not run: boom')
    expect(text).toContain('The check did not complete.')
    expect(text).not.toContain('No new findings.')
  })
})

describe('exit codes', () => {
  it('is 0 when clean or warnings only, 1 on errors', () => {
    expect(exitCode(result([]))).toBe(0)
    expect(exitCode(result([any]))).toBe(0)
    expect(exitCode(result([format]))).toBe(1)
  })

  it('is 2 when an engine failed, and in CI when the setup drifted', () => {
    const drift = result([], { setup: [{ code: 'biome-config-stale', message: 'stale' }] })

    expect(exitCode(result([], { setup: [{ code: 'engine-failed', message: 'boom' }] }))).toBe(2)
    expect(exitCode(drift)).toBe(0)
    expect(exitCode(drift, true)).toBe(2)
  })

  it('is 1 when there are more new warnings than the limit, and says so', () => {
    const limited = result([any, any], { maxWarnings: 1 })

    expect(exitCode(result([any], { maxWarnings: 1 }))).toBe(0)
    expect(exitCode(limited)).toBe(1)
    expect(exitCode(result([any], { maxWarnings: 0 }))).toBe(1)
    expect(formatPretty(limited)).toContain('The limit is 1 warning, so the warnings fail the check.')
    expect(JSON.parse(formatAgent(limited).split('\n')[0] ?? '')).toMatchObject({ rule: 'pawl/max-warnings' })
  })
})
