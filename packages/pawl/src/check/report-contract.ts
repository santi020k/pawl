/** Versioned JSON check output and validation at a consumer's process boundary. */
import { type Finding, type SetupIssue } from '../types.ts'
import { isRecord } from '../utils/json.ts'
import { type CheckResult, exitCode, isBlocked } from './result.ts'

export const CHECK_REPORT_VERSION = 1

/** The check result stays at the top level so existing consumers can keep reading its fields. */
export interface CheckReport extends CheckResult {
  reportVersion: typeof CHECK_REPORT_VERSION
}

export interface ReadCheckReportOptions {
  /** Match the invocation's --ci flag or CI environment. Drift is fatal in CI. */
  ci?: boolean
}

export type CheckReportRead =
  | { status: 'ok'; report: CheckReport; exitCode: 0 }
  | { status: 'findings'; report: CheckReport; exitCode: 1 }
  | { status: 'setup'; report: CheckReport; exitCode: 2 }
  | { status: 'invalid'; message: string }

const ENGINES: Record<Finding['engine'], true> = {
  biome: true,
  oxlint: true,
  eslint: true,
  prettier: true,
  pawl: true,
  clippy: true,
  rustc: true,
  rustfmt: true,
  swiftlint: true,
  swiftformat: true,
  'swift-format': true,
  ktlint: true
}

const SETUP_CODES: Record<SetupIssue['code'], true> = {
  'biome-config-missing': true,
  'biome-config-stale': true,
  'biome-config-nested': true,
  'biome-overrides-conflict': true,
  'biome-config-foreign': true,
  'biome-missing': true,
  'eslint-missing': true,
  'oxlint-missing': true,
  'tsgolint-missing': true,
  'oxlint-config-missing': true,
  'oxlint-config-stale': true,
  'prettier-missing': true,
  'prettier-config-missing': true,
  'prettier-config-stale': true,
  'pack-missing': true,
  'locked-rule': true,
  'engine-failed': true,
  'language-tool-missing': true,
  'since-unresolved': true,
  'baseline-unreadable': true,
  'pawl-missing': true
}

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')

const finding = (value: unknown): value is Finding => {
  if (!isRecord(value)) return false

  const baseline = value.overBaseline

  return (
    typeof value.file === 'string' &&
    count(value.line) &&
    value.line > 0 &&
    count(value.column) &&
    value.column > 0 &&
    typeof value.engine === 'string' &&
    Object.hasOwn(ENGINES, value.engine) &&
    typeof value.engineRule === 'string' &&
    typeof value.rule === 'string' &&
    (value.severity === 'warn' || value.severity === 'error') &&
    typeof value.message === 'string' &&
    typeof value.fixable === 'boolean' &&
    (baseline === undefined ||
      (isRecord(baseline) && count(baseline.allowed) && count(baseline.found) && baseline.found > baseline.allowed))
  )
}

const setupIssue = (value: unknown): value is SetupIssue =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  Object.hasOwn(SETUP_CODES, value.code) &&
  typeof value.message === 'string' &&
  (value.fix === undefined || typeof value.fix === 'string')

const checkReport = (value: unknown): value is CheckReport => {
  if (!isRecord(value)) return false

  return (
    value.reportVersion === CHECK_REPORT_VERSION &&
    Array.isArray(value.findings) &&
    value.findings.every(finding) &&
    count(value.baselined) &&
    Array.isArray(value.setup) &&
    value.setup.every(setupIssue) &&
    strings(value.engines) &&
    value.engines.every(engine => Object.hasOwn(ENGINES, engine) && engine !== 'prettier' && engine !== 'pawl') &&
    strings(value.commands) &&
    typeof value.hasBaseline === 'boolean' &&
    typeof value.canShrinkBaseline === 'boolean' &&
    typeof value.nothingToCheck === 'boolean' &&
    (value.maxWarnings === undefined || count(value.maxWarnings))
  )
}

/**
 * Read exactly one JSON document plus its actual process exit code. Never infer success from an
 * empty findings array: engine failures, malformed output and interrupted processes are failures.
 * Additive fields are allowed, but an unknown version or setup code needs a newer consumer.
 */
export const readCheckReport = (
  stdout: string,
  processExitCode: number | null,
  { ci = false }: ReadCheckReportOptions = {}
): CheckReportRead => {
  let value: unknown

  try {
    value = JSON.parse(stdout)
  } catch {
    return { status: 'invalid', message: 'Expected one complete JSON check report.' }
  }

  if (!checkReport(value))
    return { status: 'invalid', message: 'Unsupported report version or malformed check report fields.' }

  if (
    (!value.hasBaseline &&
      (value.baselined > 0 ||
        value.canShrinkBaseline ||
        value.findings.some(entry => entry.overBaseline !== undefined))) ||
    (value.nothingToCheck && (value.findings.length > 0 || value.baselined > 0)) ||
    (isBlocked(value.setup) && value.canShrinkBaseline)
  )
    return { status: 'invalid', message: 'The report contains contradictory baseline or completion state.' }

  const expected = exitCode(value, ci)

  if (processExitCode !== expected)
    return { status: 'invalid', message: 'The process exit code does not match the check report and CI mode.' }

  if (processExitCode === 2) return { status: 'setup', report: value, exitCode: 2 }

  if (processExitCode === 1) return { status: 'findings', report: value, exitCode: 1 }

  return { status: 'ok', report: value, exitCode: 0 }
}
