import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { scopedName } from '../../catalog/rules.ts'
import { type Finding } from '../../types.ts'
import { ancestors, toPosix } from '../../utils/fs.ts'
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
import { oxlintCatalogName, resolveTsgolint } from './config.ts'

const BIN = { packageName: 'oxlint', bin: 'oxlint', fallback: 'bin/oxlint', besidePawl: true }

/** Oxlint is installed in the project, or beside pawl itself. */
export const oxlintInstalled = (root: string): boolean => resolveBin(root, BIN) !== undefined

interface OxlintDiagnostic {
  message: string
  code?: string
  severity: string
  filename?: string
  help?: string
  labels?: Array<{ span?: { line?: number; column?: number } }>
}

/** The diagnostic Oxlint gives when tsgolint cannot read the project's tsconfig. */
const TSCONFIG_ERROR = 'typescript(tsconfig-error)'

/**
 * Where to tell Oxlint to find tsgolint, or undefined when it finds it itself. Oxlint looks for
 * node_modules/.bin/tsgolint from the project up, and only there, so a copy it cannot see, as in
 * a layout without a .bin folder, has to be named.
 */
const tsgolintEnv = (root: string): Record<string, string> | undefined => {
  const bin = process.env.OXLINT_TSGOLINT_PATH === undefined ? resolveTsgolint(root) : undefined

  if (!bin) return undefined

  if (ancestors(root).some(dir => existsSync(join(dir, 'node_modules/.bin/tsgolint')))) return undefined

  return { OXLINT_TSGOLINT_PATH: bin }
}

/** Oxlint's rule name as it appears in a config: core rules bare, the rest as plugin/rule. */
const oxlintName = (scope: string, rule: string): string =>
  scope === 'eslint' ? rule : `${scope.replaceAll('_', '-')}/${rule}`

const toFinding = (diagnostic: OxlintDiagnostic): Finding => {
  // Oxlint reports a rule as "scope(rule)", such as "eslint(no-var)" or "typescript(no-explicit-any)".
  const match = /^([\w-]+)\((.+)\)$/.exec(diagnostic.code ?? '')
  const engineRule = match ? oxlintName(match[1] as string, match[2] as string) : (diagnostic.code ?? 'parse')
  const span = diagnostic.labels?.[0]?.span

  return {
    file: toPosix(diagnostic.filename ?? ''),
    line: Math.max(1, span?.line ?? 1),
    column: Math.max(1, span?.column ?? 1),
    engine: 'oxlint',
    engineRule,
    rule: oxlintCatalogName(engineRule) ?? scopedName('oxlint', engineRule),
    severity: diagnostic.severity === 'error' ? 'error' : 'warn',
    message: diagnostic.message,
    fixable: false
  }
}

interface OxlintReport {
  diagnostics?: OxlintDiagnostic[]
}

const isReport = (value: unknown): value is OxlintReport => isRecord(value)

/** Run the project's Oxlint and turn its report into findings. */
export const runOxlint = async ({ root, files, write = false }: RunOptions): Promise<EngineRun> => {
  const bin = resolveBin(root, BIN)

  if (!bin) {
    throw new EngineError('Oxlint is not installed in this project. Add oxlint with your package manager.', {
      command: 'oxlint'
    })
  }

  const shown = write ? ['--fix'] : []

  return runChunked(files, ['oxlint', ...shown].join(' '), async targets => {
    const result = await runNode(
      bin,
      ['--format', 'json', ...shown, ...targets],
      root,
      'oxlint',
      [...shown, ...targets],
      tsgolintEnv(root)
    )
    const diagnostics = parseReport(result, 'Oxlint', '{', isReport).diagnostics ?? []
    const tsconfig = diagnostics.find(diagnostic => diagnostic.code === TSCONFIG_ERROR)

    // tsgolint reports a tsconfig it cannot read as one diagnostic and then runs none of the rules
    // that need type information, so the check did not run in full.
    if (tsconfig) {
      throw new EngineError(
        [
          `Oxlint could not read ${tsconfig.filename ?? 'the tsconfig'}, so the rules that need type information did not run.`,
          [tsconfig.message, tsconfig.help].filter(Boolean).join(': ')
        ].join('\n'),
        { command: result.command }
      )
    }

    return diagnostics.map(toFinding)
  })
}
