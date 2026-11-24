// cspell:ignore Asuspicious Aformat Aengine Aout Abiome
import { describe, expect, it } from 'vitest'
import { formatGithub, formatSarif } from '../src/check/ci-output.ts'
import {
  codeFrame,
  formatAgent,
  format as formatAs,
  formatEditor,
  formatPretty,
  type RichOptions
} from '../src/check/output.ts'
import { type CheckResult, exitCode } from '../src/check/result.ts'
import { workspaceBase } from '../src/cli/commands/check.ts'
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

  it('handles long whitespace runs while preserving spacing within a message line', () => {
    const spaces = ' '.repeat(50_000)
    const inline = `First${spaces}line.`
    const multiline = `First${spaces}\r\n\t${spaces}second.`

    expect(formatEditor(result([{ ...any, message: inline }]))).toContain(inline)
    expect(formatEditor(result([{ ...any, message: multiline }]))).toContain('First second.')
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

describe('GitHub annotations', () => {
  it('puts each finding on its line, with its rule as the title and its fix under the message', () => {
    expect(formatGithub(result([any, format])).split('\n')).toEqual([
      '::warning file=src/a.ts,line=3,col=7,title=biome%3Asuspicious/noExplicitAny::Unexpected any.%0AUse a specific type, or unknown and narrow it.',
      '::error file=src/a.ts,line=1,col=1,title=biome%3Aformat::File is not formatted.%0ARun "pawl fix".'
    ])
    expect(formatGithub(result([]))).toBe('')
  })

  it('escapes what would end a value or the message, and names files from the root of the repository', () => {
    const odd: Finding = { ...any, file: 'a,b%.ts', line: 0, column: 0, message: '100% sure:\n  not any' }

    expect(formatGithub(result([odd]), { base: 'packages/web/' })).toBe(
      '::warning file=packages/web/a%2Cb%25.ts,line=1,col=1,title=biome%3Asuspicious/noExplicitAny::100%25 sure: not any%0AUse a specific type, or unknown and narrow it.'
    )
    expect(
      formatGithub(result([], { setup: [{ code: 'engine-failed', message: 'Biome failed:\r\nout of memory' }] }))
    ).toBe('::error title=pawl/setup%3Aengine-failed::Biome failed:%0D%0Aout of memory')
  })

  it('shows setup problems and the warning limit on the run, as errors when CI fails on them', () => {
    const drifted = result([any, any], {
      setup: [{ code: 'biome-config-stale', message: 'biome.json is out of date.', fix: 'Run "pawl sync".' }],
      maxWarnings: 1
    })
    const lines = formatGithub(drifted).split('\n')

    expect(lines.slice(0, 2)).toEqual([
      '::warning title=pawl/setup%3Abiome-config-stale::biome.json is out of date.%0ARun "pawl sync".',
      '::error title=pawl/max-warnings::The limit is 1 warning, so the warnings fail the check.'
    ])
    expect(formatGithub(drifted, { ci: true }).split('\n')[0]).toMatch(
      /^::error title=pawl\/setup%3Abiome-config-stale::/
    )
  })

  it('folds the annotations into a group and follows them with the plain report for the log', () => {
    const text = formatAs(result([format]), 'github')

    expect(text.startsWith('::group::Annotations\n::error file=src/a.ts,')).toBe(true)
    expect(text).toContain('\n::endgroup::\n')
    expect(text).toContain(formatPretty(result([format])))
    expect(formatAs(result([]), 'github')).toBe(formatPretty(result([])))
  })

  it('neutralizes workflow commands in appended human output while preserving intended annotations', () => {
    const crafted = [
      { ...any, file: 'src/a.ts', message: '::error::injected' },
      { ...any, file: 'src/b.ts', message: 'note ##[error]injected' },
      { ...any, file: 'src/c.ts', message: 'ok\n::endgroup::\n::error::injected' },
      { ...any, file: 'src/d.ts', message: 'ok\r::warning::injected' },
      { ...any, file: 'src/e.ts', message: '::::error::quad' },
      { ...any, file: 'src/f.ts', message: '###[warning]triple' },
      { ...any, file: 'src/g.ts', message: '\u0085::error::injected' },
      { ...any, file: '::error::file.ts', message: 'bad name' }
    ]
    const output = formatAs(result(crafted, { commands: ['echo ##[error]cmd'] }), 'github', {
      color: true,
      verbose: true
    })
    const marker = '::endgroup::\n'
    const endgroup = output.indexOf(marker)

    expect(endgroup).toBeGreaterThan(0)

    const header = output.slice(0, endgroup + marker.length)
    const appended = output.slice(endgroup + marker.length)

    expect(header.startsWith('::group::Annotations\n')).toBe(true)
    expect(header).toContain('::warning file=src/a.ts,')
    expect(header).toContain(
      '::warning file=src/c.ts,line=3,col=7,title=biome%3Asuspicious/noExplicitAny::ok ::endgroup:: ::error::injected%0AUse a specific type, or unknown and narrow it.'
    )
    expect(appended).not.toContain('::')
    expect(appended).not.toContain('##[')
    expect(stripAnsi(appended)).not.toContain('::')
    expect(stripAnsi(appended)).not.toContain('##[')

    const cleanOnly = formatAs(result([], { commands: ['echo ::error::cmd && echo ##[warning]cmd'] }), 'github', {
      verbose: true
    })

    expect(cleanOnly).not.toContain('::')
    expect(cleanOnly).not.toContain('##[')
  })

  it('preserves dot directories and parent prefixes while stripping redundant leading ./ and / separators', () => {
    expect(formatGithub(result([any]), { base: '.config' })).toContain('file=.config/src/a.ts,')
    expect(formatGithub(result([any]), { base: './.config/' })).toContain('file=.config/src/a.ts,')
    expect(formatGithub(result([any]), { base: '.github/scripts' })).toContain('file=.github/scripts/src/a.ts,')
    expect(formatGithub(result([any]), { base: '.' })).toContain('file=src/a.ts,')
    expect(formatGithub(result([any]), { base: './' })).toContain('file=src/a.ts,')
    expect(formatGithub(result([any]), { base: './/' })).toContain('file=src/a.ts,')
    expect(formatGithub(result([any]), { base: '..' })).toContain('file=../src/a.ts,')
    expect(formatGithub(result([{ ...any, file: './/src/a.ts' }]), { base: './/packages/app' })).toContain(
      'file=packages/app/src/a.ts,'
    )
    expect(formatGithub(result([{ ...any, file: './//evil.com/a.ts' }]))).toContain('file=evil.com/a.ts,')
    expect(formatGithub(result([{ ...any, file: './/.' }]))).toBe(
      '::warning line=3,col=7,title=biome%3Asuspicious/noExplicitAny::Unexpected any.%0AUse a specific type, or unknown and narrow it.'
    )
    expect(formatGithub(result([{ ...any, file: '' }]))).toBe(
      '::warning line=3,col=7,title=biome%3Asuspicious/noExplicitAny::Unexpected any.%0AUse a specific type, or unknown and narrow it.'
    )
  })
})

describe('SARIF', () => {
  const parse = (text: string) => JSON.parse(text)

  it('reports each new finding as a result of the rule that found it, from the root of the repository', () => {
    const sarif = parse(formatSarif(result([any, format, { ...any, line: 9 }]), { base: 'apps/web' }))
    const [run] = sarif.runs

    expect(sarif).toMatchObject({ version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json' })
    expect(run.tool.driver).toMatchObject({ name: 'pawl', informationUri: 'https://pawl.santi020k.com' })
    expect(run.tool.driver.rules).toEqual([
      {
        id: 'biome:suspicious/noExplicitAny',
        shortDescription: { text: 'No explicit any.' },
        help: { text: 'Use a specific type, or unknown and narrow it.' },
        helpUri: 'https://pawl.santi020k.com/reference/rules/',
        properties: { tags: ['typescript', 'guardrail'] }
      },
      {
        id: 'biome:format',
        shortDescription: { text: 'The file is not formatted to the standard.' },
        help: { text: 'Run "pawl fix".' },
        helpUri: 'https://pawl.santi020k.com/reference/rules/',
        properties: { tags: ['pawl'] }
      }
    ])
    expect(run.results.map((each: { ruleIndex: number }) => each.ruleIndex)).toEqual([0, 1, 0])
    expect(run.results[0]).toEqual({
      ruleId: 'biome:suspicious/noExplicitAny',
      ruleIndex: 0,
      level: 'warning',
      message: { text: 'Unexpected any. Use a specific type, or unknown and narrow it.' },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'apps/web/src/a.ts', uriBaseId: '%SRCROOT%' },
            region: { startLine: 3, startColumn: 7 }
          }
        }
      ]
    })
    expect(run.results[1].level).toBe('error')
    expect(run.invocations).toEqual([{ executionSuccessful: true }])
  })

  it('names an engine rule outside the catalog by itself, and keeps what the baseline allowed', () => {
    const own: Finding = {
      ...any,
      rule: 'eslint:no-restricted-syntax',
      engine: 'eslint',
      engineRule: 'no-restricted-syntax',
      overBaseline: { allowed: 1, found: 2 }
    }
    const [run] = parse(formatSarif(result([own]))).runs

    expect(run.tool.driver.rules).toEqual([
      { id: 'eslint:no-restricted-syntax', shortDescription: { text: 'eslint:no-restricted-syntax' } }
    ])
    expect(run.results[0].properties).toEqual({ overBaseline: { allowed: 1, found: 2 } })
    expect(run.results[0].message.text).toBe('Unexpected any.')
  })

  it('reports setup problems and the warning limit as notifications, and a check that did not complete', () => {
    const blocked = result([any, any], {
      setup: [{ code: 'biome-missing', message: 'Biome is not installed.', fix: 'Install @biomejs/biome.' }],
      maxWarnings: 0
    })
    const [run] = parse(formatSarif(blocked)).runs

    expect(run.invocations).toEqual([
      {
        executionSuccessful: false,
        toolExecutionNotifications: [
          {
            level: 'error',
            message: { text: 'Biome is not installed. Install @biomejs/biome.' },
            descriptor: { id: 'pawl/setup:biome-missing' }
          },
          {
            level: 'error',
            message: { text: 'The limit is 0 warnings, so the warnings fail the check.' },
            descriptor: { id: 'pawl/max-warnings' }
          }
        ]
      }
    ])
    expect(parse(formatSarif(result([]))).runs[0].results).toEqual([])
    expect(formatAs(result([]), 'sarif')).toBe(formatSarif(result([])))
  })

  it('encodes SARIF artifactLocation URI segments while preserving separators, backslashes, and dot directories', () => {
    const special = [
      { ...any, file: 'src/a#b?.ts' },
      { ...any, file: 'app/[...slug]/100% ok/café/日本語.ts' },
      { ...any, file: 'src/a\\b.ts' },
      { ...any, file: 'src/bad\uD800file.ts' },
      { ...any, file: 'foo:1.ts' },
      { ...any, file: './//evil.com/a.ts' },
      { ...any, file: './/.' }
    ]
    const [run] = parse(formatSarif(result(special), { base: '.config' })).runs
    const uris = [
      run.results[0].locations[0].physicalLocation.artifactLocation.uri,
      run.results[1].locations[0].physicalLocation.artifactLocation.uri,
      run.results[2].locations[0].physicalLocation.artifactLocation.uri,
      run.results[3].locations[0].physicalLocation.artifactLocation.uri,
      run.results[4].locations[0].physicalLocation.artifactLocation.uri,
      run.results[5].locations[0].physicalLocation.artifactLocation.uri
    ]

    expect(uris).toEqual([
      '.config/src/a%23b%3F.ts',
      '.config/app/%5B...slug%5D/100%25%20ok/caf%C3%A9/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts',
      '.config/src/a%5Cb.ts',
      '.config/src/bad%EF%BF%BDfile.ts',
      '.config/foo%3A1.ts',
      '.config/evil.com/a.ts'
    ])

    const resolved0 = new URL(uris[0] as string, 'file:///repo/')
    const resolved1 = new URL(uris[1] as string, 'file:///repo/')
    const resolved2 = new URL(uris[2] as string, 'file:///repo/')

    expect(resolved0.hash).toBe('')
    expect(resolved0.search).toBe('')
    expect(decodeURIComponent(resolved0.pathname)).toBe('/repo/.config/src/a#b?.ts')
    expect(decodeURIComponent(resolved1.pathname)).toBe('/repo/.config/app/[...slug]/100% ok/café/日本語.ts')
    expect(decodeURIComponent(resolved2.pathname)).toBe('/repo/.config/src/a\\b.ts')
    expect(run.results[6].locations).toBeUndefined()

    const [rootSlashRun] = parse(
      formatSarif(
        result([
          { ...any, file: '/src/a.ts' },
          { ...any, file: './//evil.com/a.ts' }
        ])
      )
    ).runs

    expect(rootSlashRun.results[0].locations[0].physicalLocation.artifactLocation.uri).toBe('src/a.ts')
    expect(rootSlashRun.results[1].locations[0].physicalLocation.artifactLocation.uri).toBe('evil.com/a.ts')
  })
})

describe('the folder pawl runs in, under GitHub Actions', () => {
  it('is the path from the checked-out repository, and empty at its root or outside it', () => {
    const actions = { GITHUB_WORKSPACE: '/work/repo' }

    expect(workspaceBase('/work/repo/packages/web', actions)).toBe('packages/web')
    expect(workspaceBase('/work/repo', actions)).toBe('')
    expect(workspaceBase('/elsewhere', actions)).toBe('')
    expect(workspaceBase('/work/repo', {})).toBe('')
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
