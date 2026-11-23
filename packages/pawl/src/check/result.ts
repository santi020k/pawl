import { type EngineName, type Finding, type LanguageEngine, type SetupIssue } from '../types.ts'

export interface CheckResult {
  /** Findings the baseline does not cover, sorted by file and position. */
  findings: Finding[]
  /** Findings hidden because the baseline allows them. */
  baselined: number
  /** Problems with the setup itself. */
  setup: SetupIssue[]
  /** The engines that ran, and the tools of the other languages the policy names. */
  engines: (EngineName | LanguageEngine)[]
  /** The engine commands that ran, as a person would type them. */
  commands: string[]
  hasBaseline: boolean
  canShrinkBaseline: boolean
  /** The baseline was written before pawl counted tests, so they have no floor yet. */
  testsUncounted?: boolean
  /** True when there were no files to look at, such as `--changed` on a clean tree. */
  nothingToCheck: boolean
  /** More new warnings than this fail the check. Undefined means warnings never fail it. */
  maxWarnings?: number
}

export const EXIT_OK = 0

export const EXIT_FINDINGS = 1

export const EXIT_SETUP = 2

/** Setup problems that mean part of the check did not run at all. */
export const BLOCKING: readonly SetupIssue['code'][] = [
  'engine-failed',
  'biome-missing',
  'eslint-missing',
  'prettier-missing',
  'oxlint-missing',
  'tsgolint-missing',
  'oxlint-config-missing',
  'biome-config-missing',
  'since-unresolved',
  'baseline-unreadable',
  'pawl-missing',
  'language-tool-missing'
]

/** True when the setup problems mean part of the check did not run. */
export const isBlocked = (setup: readonly SetupIssue[]): boolean => setup.some(issue => BLOCKING.includes(issue.code))

/** True when the result has more new warnings than its limit allows. */
export const tooManyWarnings = (result: CheckResult): boolean =>
  result.maxWarnings !== undefined &&
  result.findings.filter(finding => finding.severity === 'warn').length > result.maxWarnings

/** Exit code for a result. Setup problems only fail the run in CI, where drift must not pass. */
export const exitCode = (result: CheckResult, ci = false): number => {
  if (isBlocked(result.setup)) return EXIT_SETUP

  if (ci && result.setup.length > 0) return EXIT_SETUP

  if (tooManyWarnings(result)) return EXIT_FINDINGS

  return result.findings.some(finding => finding.severity === 'error') ? EXIT_FINDINGS : EXIT_OK
}
