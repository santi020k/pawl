/**
 * Output for CI services: GitHub Actions annotations, which put each finding on its line in the
 * pull request, and SARIF, the format GitHub code scanning and other code-scanning tools read.
 */

import { getRule } from '../catalog/rules.ts'
import { findOwnRule } from '../scans/registry.ts'
import { type Finding, type SetupIssue } from '../types.ts'
import { plural } from '../utils/text.ts'
import { VERSION } from '../version.ts'
import { adviceFor, oneLine, scopedLabel } from './finding-text.ts'
import { BLOCKING, type CheckResult, isBlocked, tooManyWarnings } from './result.ts'

export interface CiOutputOptions {
  /** A CI run, where every setup problem fails the check, so it is reported as an error. */
  ci?: boolean
  /**
   * The folder pawl ran in, relative to the root of the repository, with forward slashes. Findings
   * name files from the folder pawl ran in; GitHub reads paths from the root. Empty at the root.
   */
  base?: string
}

const DOCS = 'https://pawl.santi020k.com'

type Level = 'error' | 'warning'

/** The path without its trailing slashes, by a scan from the end: a regular expression is quadratic on many slashes. */
const trimTrailingSlashes = (path: string): string => {
  let end = path.length

  while (end > 0 && path[end - 1] === '/') end -= 1

  return path.slice(0, end)
}

const stripCurrentPrefix = (path: string): string => {
  const clean = trimTrailingSlashes(path.replace(/^(?:\.?\/)+/, ''))

  return clean === '.' ? '' : clean
}

/** A finding's path from the root of the repository. */
const fromRoot = (file: string, base = ''): string => {
  const cleanFile = stripCurrentPrefix(file)

  if (!cleanFile) return ''

  const folder = stripCurrentPrefix(base)

  return folder ? `${folder}/${cleanFile}` : cleanFile
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Encode each path segment as an RFC 3986 relative URI reference while preserving `/` separators. */
const toSarifUri = (path: string): string =>
  path
    .split('/')
    .map(segment => encodeURIComponent(segment.replace(LONE_SURROGATE, '\uFFFD')))
    .join('/')

/**
 * Neutralize GitHub Actions workflow commands in appended human log text without altering
 * intentional annotations. Every `::` and legacy `##[` is broken up regardless of line
 * breaks, Unicode whitespace (including U+0085), or ANSI escape sequences.
 */
export const neutralizeGithubCommands = (text: string): string =>
  text.replace(/:(?=:)/g, ': ').replaceAll('##[', '## [')

const findingLevel = (finding: Finding): Level => (finding.severity === 'error' ? 'error' : 'warning')

const setupLevel = (issue: SetupIssue, ci: boolean): Level =>
  ci || BLOCKING.includes(issue.code) ? 'error' : 'warning'

const warningLimit = (result: CheckResult): string =>
  `The limit is ${plural(result.maxWarnings ?? 0, 'warning')}, so the warnings fail the check.`

/** What a finding says, with how to fix it when pawl knows. */
const explained = (finding: Finding, separator: string): string => {
  const advice = adviceFor(finding)

  return advice ? `${oneLine(finding.message)}${separator}${advice}` : oneLine(finding.message)
}

// Workflow commands escape these, as @actions/core does: a value ends at a comma and a message at a line break.
const escapeData = (text: string): string => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')

const escapeProperty = (text: string): string => escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C')

const workflowCommand = (level: Level, properties: Record<string, string | number>, message: string): string => {
  const list = Object.entries(properties)
    .map(([key, value]) => `${key}=${escapeProperty(String(value))}`)
    .join(',')

  return `::${level} ${list}::${escapeData(message)}`
}

/**
 * GitHub Actions annotations: one `::error` or `::warning` workflow command per finding, with its
 * file, line, column and rule, so the finding shows on that line of the pull request. Setup
 * problems and the warning limit have no file, so they show on the run.
 *
 * GitHub turns at most 10 errors and 10 warnings of a step into annotations; the log keeps them all.
 */
export const formatGithub = (result: CheckResult, options: CiOutputOptions = {}): string => {
  const lines = result.setup.map(issue =>
    workflowCommand(
      setupLevel(issue, options.ci === true),
      { title: `pawl/setup:${issue.code}` },
      issue.fix ? `${issue.message}\n${issue.fix}` : issue.message
    )
  )

  if (tooManyWarnings(result))
    lines.push(workflowCommand('error', { title: 'pawl/max-warnings' }, warningLimit(result)))

  for (const finding of result.findings) {
    const file = fromRoot(finding.file, options.base)

    lines.push(
      workflowCommand(
        findingLevel(finding),
        {
          ...(file ? { file } : {}),
          line: Math.max(1, finding.line),
          col: Math.max(1, finding.column),
          title: scopedLabel(finding)
        },
        explained(finding, '\n')
      )
    )
  }

  return lines.join('\n')
}

interface SarifRule {
  id: string
  shortDescription: { text: string }
  help?: { text: string }
  helpUri?: string
  properties?: { tags: string[] }
}

interface SarifNotification {
  level: Level
  message: { text: string }
  descriptor: { id: string }
}

/**
 * A rule as SARIF describes it: what the catalog says of it, or what one of pawl's own scans says,
 * such as the Docker checks. An engine's own rule has only its name.
 */
const sarifRule = (finding: Finding, id: string): SarifRule => {
  const rule = getRule(finding.rule)

  if (rule) {
    return {
      id,
      shortDescription: { text: rule.summary },
      ...(rule.advice ? { help: { text: rule.advice } } : {}),
      helpUri: `${DOCS}/reference/rules/`,
      properties: { tags: rule.guardrail ? [rule.tag, 'guardrail'] : [rule.tag] }
    }
  }

  const own = finding.engine === 'pawl' ? findOwnRule(finding.rule) : undefined

  if (!own) return { id, shortDescription: { text: id } }

  return {
    id,
    shortDescription: { text: own.rule.summary },
    help: { text: own.rule.advice },
    helpUri: `${DOCS}${own.scan.docs}`,
    properties: { tags: ['pawl'] }
  }
}

/**
 * SARIF 2.1.0, as one document: the rules that found something, one result per new finding with
 * its location from the root of the repository, and the setup problems and the warning limit as
 * notifications of the run. A run that could not complete says so with `executionSuccessful`.
 * Only new findings are results: those the baseline allows stay out of code scanning.
 */
export const formatSarif = (result: CheckResult, options: CiOutputOptions = {}): string => {
  const rules = new Map<string, { index: number; rule: SarifRule }>()
  const results = result.findings.map(finding => {
    const id = scopedLabel(finding)
    const known = rules.get(id) ?? { index: rules.size, rule: sarifRule(finding, id) }
    const file = fromRoot(finding.file, options.base)

    rules.set(id, known)

    return {
      ruleId: id,
      ruleIndex: known.index,
      level: findingLevel(finding),
      message: { text: explained(finding, ' ') },
      ...(file
        ? {
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: toSarifUri(file), uriBaseId: '%SRCROOT%' },
                  region: { startLine: Math.max(1, finding.line), startColumn: Math.max(1, finding.column) }
                }
              }
            ]
          }
        : {}),
      ...(finding.overBaseline ? { properties: { overBaseline: finding.overBaseline } } : {})
    }
  })
  const notifications: SarifNotification[] = result.setup.map(issue => ({
    level: setupLevel(issue, options.ci === true),
    message: { text: issue.fix ? `${oneLine(issue.message)} ${oneLine(issue.fix)}` : oneLine(issue.message) },
    descriptor: { id: `pawl/setup:${issue.code}` }
  }))

  if (tooManyWarnings(result)) {
    notifications.push({
      level: 'error',
      message: { text: warningLimit(result) },
      descriptor: { id: 'pawl/max-warnings' }
    })
  }

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'pawl',
            version: VERSION,
            semanticVersion: VERSION,
            informationUri: DOCS,
            rules: [...rules.values()].map(entry => entry.rule)
          }
        },
        invocations: [
          {
            executionSuccessful: !isBlocked(result.setup),
            ...(notifications.length > 0 ? { toolExecutionNotifications: notifications } : {})
          }
        ],
        results
      }
    ]
  }

  return JSON.stringify(sarif, null, 2)
}
