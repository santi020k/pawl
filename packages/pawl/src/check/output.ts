import { getRule } from '../catalog/rules.ts'
import { type Finding } from '../types.ts'
import { plural } from '../utils/text.ts'
import { type CheckResult, isBlocked, tooManyWarnings } from './result.ts'

export type OutputFormat = 'pretty' | 'agent' | 'json'

export interface FormatOptions {
  color?: boolean
  /** Show the engine commands that ran. */
  verbose?: boolean
  /** The command that fixes what can be fixed, for the hint at the end. */
  fixCommand?: string
}

const paint = (enabled: boolean) => {
  const wrap = (code: number) => (text: string) => (enabled ? `\u001B[${code}m${text}\u001B[0m` : text)

  return { red: wrap(31), yellow: wrap(33), dim: wrap(2), bold: wrap(1), green: wrap(32) }
}

/** The engine's own name for the rule, so it can be searched in that engine's docs. */
const engineLabel = (finding: Finding): string => (finding.engine === 'pawl' ? finding.rule : finding.engineRule)

/** Output for people: one block per finding, then a summary. */
export const formatPretty = (
  result: CheckResult,
  { color = false, verbose = false, fixCommand = 'pawl fix' }: FormatOptions = {}
): string => {
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
    lines.push(c.dim('The code has fewer findings than the baseline allows. Run "pawl baseline" to lock that in.'))

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
    const advice = finding.fixable ? 'Run "pawl fix".' : getRule(finding.rule)?.advice

    lines.push({
      file: finding.file,
      line: finding.line,
      rule: finding.engine === 'pawl' ? finding.rule : `${finding.engine}:${finding.engineRule}`,
      message: finding.message,
      ...(advice ? { fix: advice } : {})
    })
  }

  return lines.map(line => JSON.stringify(line)).join('\n')
}

/** The whole result as one JSON document, for CI and other tools. */
export const formatJson = (result: CheckResult): string => JSON.stringify(result, null, 2)

export const format = (result: CheckResult, kind: OutputFormat, options: FormatOptions = {}): string => {
  if (kind === 'agent') return formatAgent(result)

  if (kind === 'json') return formatJson(result)

  return formatPretty(result, options)
}
