import { describe, expect, it } from 'vitest'
import { codeFrame, formatAgent, formatEditor, formatPretty, type RichOptions } from '../src/check/output.ts'
import { type CheckResult, exitCode } from '../src/check/result.ts'
import { type Finding } from '../src/types.ts'
import { createStyle, stripAnsi, symbols } from '../src/utils/terminal.ts'

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

describe('the rich view, for a person at a terminal', () => {
  const sources: Record<string, string> = { 'src/a.ts': 'export const a = 1\n\nlet x:any = a\n' }
  const view = (extra: Partial<RichOptions> = {}): RichOptions => ({
    style: createStyle(0),
    sym: symbols(true),
    width: 80,
    source: file => sources[file],
    ...extra
  })

  it('shows each finding with its code and its fix, then the summary', () => {
    const text = formatPretty(result([any, format], { baselined: 4 }), { rich: view({ elapsedMs: 412 }) })

    expect(text).toContain('▲ warn   src/a.ts:3:7  suspicious/noExplicitAny biome')
    expect(text).toContain(['    3 │ let x:any = a', '      │       ^^^'].join('\n'))
    expect(text).toContain('  → Use a specific type, or unknown and narrow it.')
    // A file that is not formatted has no line to show, only the fix.
    expect(text).toContain(
      ['✖ error  src/a.ts:1:1  format biome', '  File is not formatted.', '  → Run "pawl fix".'].join('\n')
    )
    expect(text).toContain('✖ 1 error, 1 warning')
    expect(text).toContain('  → Run pawl fix to fix 1 of them.')
    expect(text).toContain('  4 existing findings allowed by the baseline.')
    expect(text).toContain('  Checked with Biome in 412 ms.')
  })

  it('stands out in color: a badge that says pass or fail', () => {
    const color = view({ style: createStyle(3) })

    expect(formatPretty(result([]), { rich: color })).toContain(' PASS ')
    expect(stripAnsi(formatPretty(result([]), { rich: color }))).toMatch(/^ PASS {2}No new findings\./)
    expect(stripAnsi(formatPretty(result([format]), { rich: color }))).toContain(' FAIL  1 error')
    expect(stripAnsi(formatPretty(result([any]), { rich: color }))).toContain(' WARN  1 warning')
  })

  it('does not claim success when an engine failed, and shows the fix of a setup problem', () => {
    const text = formatPretty(
      result([], { setup: [{ code: 'engine-failed', message: 'biome could not run: boom', fix: 'Install Biome.' }] }),
      { rich: view() }
    )

    expect(text).toContain(['✖ setup  biome could not run: boom', '  → Install Biome.'].join('\n'))
    expect(text).toContain('✖ The check did not complete.')
    expect(text).not.toContain('No new findings.')
  })

  it('fails the badge in CI when the setup drifted, as the exit code does', () => {
    const drift = result([], { setup: [{ code: 'biome-config-stale', message: 'stale' }] })

    expect(stripAnsi(formatPretty(drift, { rich: view({ style: createStyle(1) }) }))).toContain(' PASS ')
    expect(stripAnsi(formatPretty(drift, { rich: view({ style: createStyle(1), ci: true }) }))).toContain(' FAIL ')
  })

  it.each([20, 29, 100])('keeps a visible caret at the end of %s-character lines on narrow terminals', length => {
    const term = view({ width: 40 })
    for (const column of [length, length + 1, length + 50]) {
      const [code = '', mark = ''] = codeFrame('a'.repeat(length), 1, column, term)

      expect(code).toContain('a')
      expect(mark).toContain('^')
      expect(mark.length).toBeLessThanOrEqual(40)
    }
  })

  it('marks the token a finding points at, past tabs and indentation, and cuts a long line around it', () => {
    const plain = view()
    const frame = (source: string, line: number, column: number, width = 80): string[] =>
      codeFrame(source, line, column, { ...plain, width })

    expect(frame("import { x } from 'left-pad'", 1, 19)).toEqual([
      "    1 │ import { x } from 'left-pad'",
      '      │                   ^^^^^^^^^^'
    ])
    expect(frame('\tif (a == b) {}', 1, 8)[1]).toBe('      │         ^^')
    expect(frame('    // a comment on its own line', 1, 1)[1]).toBe(`      │     ${'^'.repeat(28)}`)
    expect(frame('a\n', 3, 1)).toEqual([])
    expect(frame('\n', 1, 1)).toEqual([])

    const long = `${'x'.repeat(200)} debugger ${'y'.repeat(200)}`
    const [code = '', mark = ''] = frame(long, 1, 202, 60)

    expect(code.length).toBeLessThanOrEqual(60)
    expect(code).toContain('debugger')
    expect(mark.indexOf('^')).toBe(code.indexOf('debugger'))
  })

  it('leaves the code out when there are many findings, so the list stays a list', () => {
    const many = Array.from({ length: 31 }, (_, index) => ({ ...any, line: index + 1 }))

    expect(formatPretty(result(many), { rich: view() })).not.toContain('│')
    expect(formatPretty(result(many.slice(0, 1)), { rich: view() })).toContain('│')
  })
})

describe('editor output', () => {
  it('prints the lines compilers print, which problem matchers read', () => {
    expect(formatEditor(result([any, format]))).toBe(
      [
        'src/a.ts:3:7: warning: Unexpected any. [biome:suspicious/noExplicitAny]',
        'src/a.ts:1:1: error: File is not formatted. [biome:format]'
      ].join('\n')
    )
    expect(formatEditor(result([]))).toBe('')
  })

  it('keeps a finding on one line, and puts setup problems and the warning limit under pawl', () => {
    const text = formatEditor(
      result([{ ...any, message: 'First line.\n  Second line.' }, any], {
        setup: [{ code: 'biome-config-missing', message: 'No biome.json found.', fix: 'Run "pawl sync".' }],
        maxWarnings: 1
      })
    )

    expect(text.split('\n')).toEqual([
      'pawl: error: No biome.json found. Run "pawl sync". [pawl/setup:biome-config-missing]',
      'pawl: error: The limit is 1 warning, so the warnings fail the check. [pawl/max-warnings]',
      'src/a.ts:3:7: warning: First line. Second line. [biome:suspicious/noExplicitAny]',
      'src/a.ts:3:7: warning: Unexpected any. [biome:suspicious/noExplicitAny]'
    ])
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
