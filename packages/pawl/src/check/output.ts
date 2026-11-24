import { type Finding, type SetupIssue } from '../types.ts'
import { type Style, type Symbols, truncate } from '../utils/terminal.ts'
import { andList, plural } from '../utils/text.ts'
import { type CiOutputOptions, formatGithub, formatSarif } from './ci-output.ts'
import { adviceFor, engineLabel, oneLine, scopedLabel } from './finding-text.ts'
import { CHECK_REPORT_VERSION } from './report-contract.ts'
import { BLOCKING, type CheckResult, exitCode, isBlocked, tooManyWarnings } from './result.ts'

/**
 * Who the output is for: `pretty` for people, `agent` for coding agents, `editor` for the
 * problem matchers of code editors, `github` for GitHub Actions annotations, `sarif` for code
 * scanning, and `json` for other tools.
 */
export type OutputFormat = 'pretty' | 'agent' | 'editor' | 'github' | 'sarif' | 'json'

export const OUTPUT_FORMATS: readonly OutputFormat[] = ['pretty', 'agent', 'editor', 'github', 'sarif', 'json']

/** The full view for a person at a terminal: symbols, code frames and a summary that stands out. */
export interface RichOptions {
  style: Style
  sym: Symbols
  /** The columns to lay the output out in. */
  width: number
  /** A file's text, for the line each finding points at. Undefined leaves the code out. */
  source?: (file: string) => string | undefined
  /** How long the check took, for the summary. */
  elapsedMs?: number
  /** A CI run, where setup drift fails the check too. */
  ci?: boolean
}

export interface FormatOptions extends CiOutputOptions {
  color?: boolean
  /** Show the engine commands that ran. */
  verbose?: boolean
  /** The command that fixes what can be fixed, for the hint at the end. */
  fixCommand?: string
  /** Lay the output out for a person at a terminal. Without it the output is plain, line for line. */
  rich?: RichOptions
}

const paint = (enabled: boolean) => {
  const wrap = (code: number) => (text: string) => (enabled ? `\u001B[${code}m${text}\u001B[0m` : text)

  return { red: wrap(31), yellow: wrap(33), dim: wrap(2), bold: wrap(1), green: wrap(32) }
}

const ENGINE_TITLES: Readonly<Record<string, string>> = {
  biome: 'Biome',
  oxlint: 'Oxlint',
  eslint: 'ESLint',
  prettier: 'Prettier',
  clippy: 'Clippy',
  swiftlint: 'SwiftLint',
  swiftformat: 'SwiftFormat'
}

/** An engine's name as people write it, such as ESLint and SwiftLint. */
export const engineTitle = (name: string): string => ENGINE_TITLES[name] ?? name

/** Above this many findings the code is left out of the rich view, so the list stays a list. */
const FRAME_LIMIT = 30

/** The token at the start of the text: a comment, a name or number, a quoted string, or an operator. */
const TOKEN = /^(?:\/\/.*|\/\*.*?\*\/|#.*|[\w$#@]+|'[^']*'|"[^"]*"|`[^`]*`|[-+*/%=!<>&|^?:]+)/

/**
 * The line a finding points at, with a mark under what it points at:
 *
 *     3 │   debugger
 *       │   ^^^^^^^^
 *
 * Empty when the line is not in the file or is blank. Tabs count as two columns, and a line wider
 * than the room is cut around the column.
 */
export const codeFrame = (
  source: string,
  line: number,
  column: number,
  { style, sym, width }: Pick<RichOptions, 'style' | 'sym' | 'width'>,
  paint: (text: string) => string = style.red
): string[] => {
  const raw = line >= 1 ? source.split(/\r?\n/)[line - 1] : undefined

  if (raw === undefined || raw.trim().length === 0) return []

  const text = raw.trimEnd().replaceAll('\t', '  ')
  const given = Math.min(raw.slice(0, Math.max(0, column - 1)).replaceAll('\t', '  ').length, text.length)
  // A finding at the start of an indented line is about what the line holds, not its indent.
  const indent = text.length - text.trimStart().length
  const at = given < indent && text.slice(0, given).trim().length === 0 ? indent : given
  const span = Math.max(1, TOKEN.exec(text.slice(at))?.[0].length ?? 1)
  const number = String(line)
  const room = Math.max(20, width - number.length - 10)
  const start = text.length > room ? Math.max(0, Math.min(at - Math.floor(room / 3), text.length - room)) : 0
  const lead = start > 0 ? sym.ellipsis : ''
  const shown = `${lead}${truncate(text.slice(start), room - lead.length, sym.ellipsis)}`
  const offset = at - start + lead.length
  const bar = style.gray(sym.bar)

  return [
    `    ${style.dim(number)} ${bar} ${shown}`,
    `    ${' '.repeat(number.length)} ${bar} ${' '.repeat(offset)}${paint('^'.repeat(Math.min(span, room - offset)))}`
  ]
}

/** A badge in color, or the symbol it stands for without color. */
const badge = (style: Style, paint: (text: string) => string, label: string, symbol: string): string =>
  style.level > 0 ? paint(` ${label} `) : symbol

/** The line for a setup problem: a cross when part of the check did not run, a warning otherwise. */
const setupLines = (issue: SetupIssue, { style, sym }: RichOptions): string[] => {
  const blocking = BLOCKING.includes(issue.code)
  const mark = blocking ? style.red(sym.cross) : style.yellow(sym.warning)
  const label = blocking ? style.red('setup') : style.yellow('setup')

  return [`${mark} ${label}  ${issue.message}`, ...(issue.fix ? [`  ${style.accent(sym.arrow)} ${issue.fix}`] : []), '']
}

/** One finding: where, which rule, what is wrong, the code, and how to fix it. */
const findingLines = (finding: Finding, rich: RichOptions, frames: boolean, fixCommand: string): string[] => {
  const { style, sym } = rich
  const error = finding.severity === 'error'
  const paint = error ? style.red : style.yellow
  const mark = error ? style.red(sym.cross) : style.yellow(sym.warning)
  const position = `${finding.file}:${finding.line}:${finding.column}`
  const lines = [
    `${mark} ${paint(error ? 'error' : 'warn ')}  ${style.bold(position)}  ${style.cyan(engineLabel(finding))} ${style.dim(finding.engine)}`,
    ...finding.message
      .trim()
      .split(/\r?\n/)
      .map(text => `  ${text}`)
  ]

  if (finding.overBaseline) {
    lines.push(
      style.dim(
        `  The baseline allows ${finding.overBaseline.allowed} of these in this file; there are now ${finding.overBaseline.found}.`
      )
    )
  }

  const source = frames && finding.rule !== 'pawl/format' ? rich.source?.(finding.file) : undefined

  if (source !== undefined) lines.push(...codeFrame(source, finding.line, finding.column, rich, paint))

  const advice = adviceFor(finding, fixCommand)

  if (advice) lines.push(`  ${style.accent(sym.arrow)} ${advice}`)

  lines.push('')

  return lines
}

/** "it", "all 3" or "2 of them": how many of the findings a fix would take care of. */
const howMany = (fixable: number, total: number): string => {
  if (fixable < total) return `${fixable} of them`

  return fixable === 1 ? 'it' : `all ${fixable}`
}

/** How long a run took, as people say it. */
const duration = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

/** The rich view of a check: each problem with its code and its fix, then a summary that stands out. */
const formatRich = (
  result: CheckResult,
  rich: RichOptions,
  { verbose, fixCommand }: { verbose: boolean; fixCommand: string }
): string => {
  const { style, sym } = rich
  const frames = result.findings.length <= FRAME_LIMIT
  const lines = [
    ...result.setup.flatMap(issue => setupLines(issue, rich)),
    ...result.findings.flatMap(finding => findingLines(finding, rich, frames, fixCommand))
  ]
  const errors = result.findings.filter(finding => finding.severity === 'error').length
  const warnings = result.findings.length - errors
  const fixable = result.findings.filter(finding => finding.fixable).length
  const failed = exitCode(result, rich.ci) !== 0
  const pass = badge(style, style.accentBadge, 'PASS', style.accent(sym.tick))
  const fail = badge(style, style.errorBadge, 'FAIL', style.red(sym.cross))
  const details: string[] = []

  if (isBlocked(result.setup)) {
    lines.push(`${fail} ${style.red('The check did not complete. Fix the setup problem above and run it again.')}`)
  } else if (result.nothingToCheck) {
    lines.push(`${style.dim(sym.info)} ${style.dim('No files to check.')}`)
  } else if (result.findings.length === 0) {
    lines.push(`${failed ? fail : pass} ${style.bold('No new findings.')}`)
  } else {
    const counts = [
      errors > 0 ? style.red(plural(errors, 'error')) : '',
      warnings > 0 ? style.yellow(plural(warnings, 'warning')) : ''
    ]
      .filter(Boolean)
      .join(style.dim(', '))
    const warn = badge(style, style.warnBadge, 'WARN', style.yellow(sym.warning))

    lines.push(`${failed ? fail : warn} ${style.bold(counts)}`)

    if (fixable > 0)
      details.push(
        `${style.accent(sym.arrow)} Run ${style.bold(fixCommand)} to fix ${howMany(fixable, result.findings.length)}.`
      )

    if (tooManyWarnings(result))
      details.push(
        style.red(`The limit is ${plural(result.maxWarnings ?? 0, 'warning')}, so the warnings fail the check.`)
      )
  }

  if (result.baselined > 0)
    details.push(style.dim(`${plural(result.baselined, 'existing finding')} allowed by the baseline.`))

  if (result.canShrinkBaseline) {
    details.push(
      `${style.accent(sym.arrow)} The code has fewer findings, or stronger tests, than the baseline records. Run ${style.bold('pawl baseline')} to lock that in.`
    )
  }

  if (!result.hasBaseline && result.findings.length > 0) {
    details.push(
      style.dim('No baseline yet. Run "pawl baseline" to accept existing findings and fail only on new ones.')
    )
  }

  const ran = andList([...new Set(result.engines.map(engineTitle))])
  const meta = [ran ? `Checked with ${ran}` : '', rich.elapsedMs === undefined ? '' : `in ${duration(rich.elapsedMs)}`]
    .filter(Boolean)
    .join(' ')

  if (meta && !result.nothingToCheck) details.push(style.dim(`${meta}.`))

  lines.push(...details.map(line => `  ${line}`))

  if (verbose && result.commands.length > 0) {
    lines.push('', style.dim('Ran:'), ...result.commands.map(command => style.dim(`  ${command}`)))
  }

  return lines.join('\n')
}

/** Output for people: one block per finding, then a summary. */
export const formatPretty = (
  result: CheckResult,
  { color = false, verbose = false, fixCommand = 'pawl fix', rich }: FormatOptions = {}
): string => {
  if (rich) return formatRich(result, rich, { verbose, fixCommand })

  const c = paint(color)
  const lines: string[] = []

  for (const issue of result.setup) {
    lines.push(`${c.yellow('setup')}  ${issue.message}`)

    if (issue.fix) lines.push(`       ${c.dim(issue.fix)}`)
  }

  if (result.setup.length > 0) lines.push('')

  const width = Math.max(
    0,
    ...result.findings.map(finding => `${finding.file}:${finding.line}:${finding.column}`.length)
  )

  for (const finding of result.findings) {
    const position = `${finding.file}:${finding.line}:${finding.column}`.padEnd(width)
    const mark = finding.severity === 'error' ? c.red('error') : c.yellow('warn ')

    lines.push(`${position}  ${mark}  ${c.dim(finding.engine.padEnd(6))}  ${c.bold(engineLabel(finding))}`)
    lines.push(`  ${finding.message}`)

    if (finding.overBaseline) {
      lines.push(
        c.dim(
          `  The baseline allows ${finding.overBaseline.allowed} of these in this file; there are now ${finding.overBaseline.found}.`
        )
      )
    }

    lines.push('')
  }

  const errors = result.findings.filter(finding => finding.severity === 'error').length
  const warnings = result.findings.length - errors
  const fixable = result.findings.filter(finding => finding.fixable).length

  if (isBlocked(result.setup)) {
    lines.push(c.red('The check did not complete. Fix the setup problem above and run it again.'))
  } else if (result.nothingToCheck) {
    lines.push(c.dim('No files to check.'))
  } else if (result.findings.length === 0) {
    lines.push(c.green('No new findings.'))
  } else {
    const summary = [errors > 0 ? plural(errors, 'error') : '', warnings > 0 ? plural(warnings, 'warning') : '']
      .filter(Boolean)
      .join(', ')

    lines.push(`${summary}.${fixable > 0 ? ` Run "${fixCommand}" to fix ${fixable} of them.` : ''}`)

    if (tooManyWarnings(result)) {
      lines.push(c.red(`The limit is ${plural(result.maxWarnings ?? 0, 'warning')}, so the warnings fail the check.`))
    }
  }

  if (result.baselined > 0)
    lines.push(c.dim(`${plural(result.baselined, 'existing finding')} allowed by the baseline.`))

  if (result.canShrinkBaseline)
    lines.push(
      c.dim(
        'The code has fewer findings, or stronger tests, than the baseline records. Run "pawl baseline" to lock that in.'
      )
    )

  if (result.testsUncounted && result.findings.length === 0) {
    lines.push(c.dim('The baseline does not count the tests yet. Run "pawl baseline" so they cannot lose assertions.'))
  }

  if (!result.hasBaseline && result.findings.length > 0) {
    lines.push(c.dim('No baseline yet. Run "pawl baseline" to accept existing findings and fail only on new ones.'))
  }

  if (verbose && result.commands.length > 0) {
    lines.push('', c.dim('Ran:'), ...result.commands.map(command => c.dim(`  ${command}`)))
  }

  return lines.join('\n')
}

interface AgentLine {
  file: string
  line: number
  rule: string
  message: string
  fix?: string
}

/**
 * Output for coding agents: one compact JSON object per line, errors first, nothing else.
 * No output means nothing to do.
 */
export const formatAgent = (result: CheckResult): string => {
  const lines: AgentLine[] = result.setup.map(issue => ({
    file: '',
    line: 0,
    rule: `pawl/setup:${issue.code}`,
    message: issue.message,
    ...(issue.fix ? { fix: issue.fix } : {})
  }))

  if (tooManyWarnings(result)) {
    lines.push({
      file: '',
      line: 0,
      rule: 'pawl/max-warnings',
      message: `The limit is ${plural(result.maxWarnings ?? 0, 'warning')}, so the warnings fail the check.`,
      fix: 'Fix the warnings below.'
    })
  }

  const ordered = [...result.findings].sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'))

  for (const finding of ordered) {
    const advice = adviceFor(finding)

    lines.push({
      file: finding.file,
      line: finding.line,
      rule: scopedLabel(finding),
      message: finding.message,
      ...(advice ? { fix: advice } : {})
    })
  }

  return lines.map(line => JSON.stringify(line)).join('\n')
}

/**
 * Output for code editors: one line per finding in the shape compilers print, which problem
 * matchers, Vim's errorformat and Emacs's compilation mode read, and terminals turn into links:
 *
 *     src/a.ts:3:7: error: Unexpected debugger. [biome:suspicious/noDebugger]
 *
 * Setup problems have no file, so they start with "pawl:" instead.
 */
export const formatEditor = (result: CheckResult): string => {
  const lines = result.setup.map(
    issue =>
      `pawl: ${BLOCKING.includes(issue.code) ? 'error' : 'warning'}: ${oneLine(issue.message)}${issue.fix ? ` ${oneLine(issue.fix)}` : ''} [pawl/setup:${issue.code}]`
  )

  if (tooManyWarnings(result)) {
    lines.push(
      `pawl: error: The limit is ${plural(result.maxWarnings ?? 0, 'warning')}, so the warnings fail the check. [pawl/max-warnings]`
    )
  }

  for (const finding of result.findings) {
    lines.push(
      `${finding.file}:${Math.max(1, finding.line)}:${Math.max(1, finding.column)}: ${finding.severity === 'error' ? 'error' : 'warning'}: ${oneLine(finding.message)} [${scopedLabel(finding)}]`
    )
  }

  return lines.join('\n')
}

/** The whole result as one JSON document, for CI and other tools. */
export const formatJson = (result: CheckResult): string =>
  JSON.stringify({ ...result, reportVersion: CHECK_REPORT_VERSION }, null, 2)

export const format = (result: CheckResult, kind: OutputFormat, options: FormatOptions = {}): string => {
  if (kind === 'agent') return formatAgent(result)

  if (kind === 'editor') return formatEditor(result)

  if (kind === 'json') return formatJson(result)

  if (kind === 'sarif') return formatSarif(result, options)

  if (kind === 'github') {
    // The annotations go in a group the log folds away, and the plain report follows for the log.
    const annotations = formatGithub(result, options)
    const { rich: _rich, ...plain } = options
    const report = formatPretty(result, plain)

    return annotations ? `::group::Annotations\n${annotations}\n::endgroup::\n${report}` : report
  }

  return formatPretty(result, options)
}
