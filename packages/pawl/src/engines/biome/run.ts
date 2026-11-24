import { guardOfMessage } from '../../catalog/guards.ts'
import { getRuleByBiome, scopedName } from '../../catalog/rules.ts'
import { projectPath } from '../../project/files.ts'
import { type Finding } from '../../types.ts'
import { toPosix } from '../../utils/fs.ts'
import { isRecord } from '../../utils/json.ts'
import {
  EngineError,
  type EngineRun,
  parseReport,
  type RunOptions,
  resolveBin,
  runChunked,
  runNode
} from '../engine.ts'
import { BIOME_VERSION } from './config.ts'

const BIN = { packageName: '@biomejs/biome', bin: 'biome', fallback: 'bin/biome', besidePawl: true }

/** Biome is installed in the project, or beside pawl itself. */
export const biomeInstalled = (root: string): boolean => resolveBin(root, BIN) !== undefined

interface BiomeDiagnostic {
  severity: string
  message: string
  category: string
  location?: { path?: string | null; start?: { line: number; column: number } | null } | null
}

interface BiomeReport {
  diagnostics: BiomeDiagnostic[]
}

const toFinding = (root: string, diagnostic: BiomeDiagnostic): Finding | undefined => {
  if (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning') return undefined

  const rawPath = diagnostic.location?.path ?? ''
  const file = rawPath ? (projectPath(root, rawPath) ?? toPosix(rawPath)) : ''
  const line = Math.max(1, diagnostic.location?.start?.line ?? 1)
  const column = Math.max(1, diagnostic.location?.start?.column ?? 1)
  const severity = diagnostic.severity === 'error' ? 'error' : 'warn'
  const base = { file, line, column, engine: 'biome' as const, severity, message: diagnostic.message.trim() } as const
  const { category } = diagnostic

  if (category === 'format') {
    return { ...base, engineRule: 'format', rule: 'pawl/format', message: 'File is not formatted.', fixable: true }
  }

  if (category === 'assist/source/useSortedPackageJson') {
    return {
      ...base,
      engineRule: category,
      rule: 'pawl/sort-package-json',
      message: 'The fields of package.json are not in the usual order.',
      fixable: true
    }
  }

  if (category.startsWith('assist/')) {
    return {
      ...base,
      engineRule: category,
      rule: 'pawl/organize-imports',
      message: 'Imports are not sorted.',
      fixable: true
    }
  }

  if (category.startsWith('lint/')) {
    const engineRule = category.slice('lint/'.length)

    return {
      ...base,
      engineRule,
      rule: getRuleByBiome(engineRule)?.name ?? scopedName('biome', engineRule),
      fixable: false
    }
  }

  // One of pawl's own rules, which Biome runs as a plugin and reports under one shared name.
  const guard = category === 'plugin' ? guardOfMessage(base.message) : undefined

  if (guard) return { ...base, engineRule: `pawl/${guard}`, rule: `pawl/${guard}`, fixable: false }

  return { ...base, engineRule: category, rule: scopedName('biome', category), fixable: false }
}

const isPosition = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.line === 'number' &&
  Number.isSafeInteger(value.line) &&
  value.line >= 0 &&
  typeof value.column === 'number' &&
  Number.isSafeInteger(value.column) &&
  value.column >= 0

const isLocation = (value: unknown): boolean =>
  isRecord(value) &&
  (value.path === undefined || value.path === null || typeof value.path === 'string') &&
  (value.start === undefined || value.start === null || isPosition(value.start))

const BIOME_SEVERITIES = new Set(['fatal', 'error', 'warning', 'info', 'information', 'hint'])

const isDiagnostic = (value: unknown): value is BiomeDiagnostic =>
  isRecord(value) &&
  typeof value.severity === 'string' &&
  BIOME_SEVERITIES.has(value.severity) &&
  typeof value.message === 'string' &&
  typeof value.category === 'string' &&
  (value.location === undefined || value.location === null || isLocation(value.location))

const isReport = (value: unknown): value is BiomeReport =>
  isRecord(value) && Array.isArray(value.diagnostics) && value.diagnostics.every(isDiagnostic)

/** Run Biome and turn its report into findings. */
export const runBiome = async ({ root, files, write = false }: RunOptions): Promise<EngineRun> => {
  const bin = resolveBin(root, BIN)

  if (!bin) {
    throw new EngineError(
      `Biome is not installed in this project. Add @biomejs/biome@${BIOME_VERSION} with your package manager.`,
      { command: 'biome' }
    )
  }

  const shown = ['check', ...(write ? ['--write'] : [])]
  const quiet = ['--reporter=json', '--max-diagnostics=none', '--no-errors-on-unmatched', '--colors=off']

  return runChunked(files, ['biome', ...shown].join(' '), async targets => {
    const result = await runNode(bin, ['check', ...quiet, ...shown.slice(1), ...targets], root, 'biome', [
      ...shown,
      ...targets
    ])

    if (result.code > 1) {
      throw new EngineError(result.stderr.trim() || result.stdout.trim() || `Biome exited with code ${result.code}.`, {
        command: result.command
      })
    }

    const report = parseReport(result, 'Biome', '{', isReport)
    const fatal = report.diagnostics.find(diagnostic => diagnostic.severity === 'fatal')

    if (fatal) {
      throw new EngineError(fatal.message.trim() || 'Biome reported a fatal error.', { command: result.command })
    }

    const findings = report.diagnostics
      .map(diagnostic => toFinding(root, diagnostic))
      .filter((finding): finding is Finding => finding !== undefined)
    const hasErrors = findings.some(finding => finding.severity === 'error')

    if ((result.code === 1) !== hasErrors) {
      throw new EngineError(
        'Biome exit status disagrees with its JSON diagnostics; the check did not complete safely.',
        {
          command: result.command
        }
      )
    }

    return findings
  })
}
