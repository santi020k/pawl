import { guardOfMessage } from '../../catalog/guards.ts'
import { getRuleByBiome } from '../../catalog/rules.ts'
import { type Finding } from '../../types.ts'
import { toPosix } from '../../utils/fs.ts'
import { isRecord } from '../../utils/json.ts'
import { EngineError, type EngineRun, parseReport, type RunOptions, resolveBin, runNode, targets } from '../engine.ts'
import { BIOME_PREFIX, BIOME_VERSION } from './config.ts'

const BIN = { packageName: '@biomejs/biome', bin: 'biome', fallback: 'bin/biome', besidePawl: true }

/** Biome is installed in the project, or beside pawl itself. */
export const biomeInstalled = (root: string): boolean => resolveBin(root, BIN) !== undefined

interface BiomeDiagnostic {
  severity: string
  message: string
  category: string
  location?: { path?: string; start?: { line: number; column: number } }
}

interface BiomeReport {
  diagnostics: BiomeDiagnostic[]
}

const toFinding = (diagnostic: BiomeDiagnostic): Finding | undefined => {
  if (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning') return undefined

  const file = toPosix(diagnostic.location?.path ?? '')
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
      rule: getRuleByBiome(engineRule)?.name ?? `${BIOME_PREFIX}${engineRule}`,
      fixable: false
    }
  }

  // One of pawl's own rules, which Biome runs as a plugin and reports under one shared name.
  const guard = category === 'plugin' ? guardOfMessage(base.message) : undefined

  if (guard) return { ...base, engineRule: `pawl/${guard}`, rule: `pawl/${guard}`, fixable: false }

  return { ...base, engineRule: category, rule: `${BIOME_PREFIX}${category}`, fixable: false }
}

const isReport = (value: unknown): value is BiomeReport => isRecord(value) && Array.isArray(value.diagnostics)

/** Run Biome and turn its report into findings. */
export const runBiome = async ({ root, files, write = false }: RunOptions): Promise<EngineRun> => {
  const bin = resolveBin(root, BIN)

  if (!bin) {
    throw new EngineError(
      `Biome is not installed in this project. Add @biomejs/biome@${BIOME_VERSION} with your package manager.`,
      { command: 'biome' }
    )
  }

  const shown = ['check', ...(write ? ['--write'] : []), ...targets(files)]
  const quiet = ['--reporter=json', '--max-diagnostics=none', '--no-errors-on-unmatched', '--colors=off']
  const result = await runNode(bin, ['check', ...quiet, ...shown.slice(1)], root, 'biome', shown)
  const report = parseReport(result, 'Biome', '{', isReport)
  const findings = report.diagnostics.map(toFinding).filter((finding): finding is Finding => finding !== undefined)

  return { findings, command: result.command }
}
