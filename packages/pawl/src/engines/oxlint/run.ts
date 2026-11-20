import { type Finding } from '../../types.ts'
import { toPosix } from '../../utils/fs.ts'
import { isRecord } from '../../utils/json.ts'
import { EngineError, type EngineRun, parseReport, type RunOptions, resolveBin, runNode, targets } from '../engine.ts'
import { OXLINT_RULES } from './rules.ts'

/** Oxlint's own name back to the neutral one, for reading its report. */
const NEUTRAL = new Map(Object.entries(OXLINT_RULES).map(([name, rule]) => [rule, name]))

const BIN = { packageName: 'oxlint', bin: 'oxlint', fallback: 'bin/oxlint', besidePawl: true }

/** Oxlint is installed in the project, or beside pawl itself. */
export const oxlintInstalled = (root: string): boolean => resolveBin(root, BIN) !== undefined

interface OxlintDiagnostic {
  message: string
  code?: string
  severity: string
  filename?: string
  labels?: Array<{ span?: { line?: number; column?: number } }>
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
    rule: NEUTRAL.get(engineRule) ?? `oxlint:${engineRule}`,
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

  const shown = [...(write ? ['--fix'] : []), ...targets(files)]
  const result = await runNode(bin, ['--format', 'json', ...shown], root, 'oxlint', shown)
  const report = parseReport(result, 'Oxlint', '{', isReport)

  return { findings: (report.diagnostics ?? []).map(toFinding), command: result.command }
}
