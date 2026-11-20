import { type Finding } from '../../types.ts'
import { toPosix } from '../../utils/fs.ts'
import { EngineError, type EngineRun, parseReport, type RunOptions, resolveBin, runNode, targets } from '../engine.ts'

interface EslintMessage {
  ruleId: string | null
  severity: number
  message: string
  line?: number
  column?: number
  fix?: unknown
}

interface EslintResult {
  filePath: string
  messages: EslintMessage[]
}

const BIN = { packageName: 'eslint', bin: 'eslint', fallback: 'bin/eslint.js' }

/** ESLint is installed in the project. Pawl never brings its own. */
export const eslintInstalled = (root: string): boolean => resolveBin(root, BIN) !== undefined

const isReport = (value: unknown): value is EslintResult[] => Array.isArray(value)

/** Run the project's ESLint and turn its report into findings. */
export const runEslint = async ({ root, files, write = false }: RunOptions): Promise<EngineRun> => {
  const bin = resolveBin(root, BIN)

  if (!bin) {
    throw new EngineError('ESLint is not installed in this project. Add it with your package manager.', {
      command: 'eslint'
    })
  }

  const shown = [...(write ? ['--fix'] : []), ...targets(files)]
  const quiet = ['--format', 'json', '--no-warn-ignored', '--no-error-on-unmatched-pattern']
  const result = await runNode(bin, [...quiet, ...shown], root, 'eslint', shown)

  // ESLint exits with 1 when it finds problems and with 2 when it could not lint; then what it said is the reason.
  if (result.code > 1) {
    throw new EngineError(result.stderr.trim() || result.stdout.trim() || `ESLint exited with code ${result.code}.`, {
      command: result.command
    })
  }

  const results = parseReport(result, 'ESLint', '[', isReport)
  const findings: Finding[] = []

  for (const { filePath, messages } of results) {
    const file = toPosix(filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath)

    for (const message of messages) {
      findings.push({
        file,
        line: Math.max(1, message.line ?? 1),
        column: Math.max(1, message.column ?? 1),
        engine: 'eslint',
        engineRule: message.ruleId ?? 'parse',
        rule: message.ruleId ?? 'eslint:parse',
        severity: message.severity === 2 ? 'error' : 'warn',
        message: message.message,
        fixable: message.fix !== undefined
      })
    }
  }

  return { findings, command: result.command }
}
