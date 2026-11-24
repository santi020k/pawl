import { scopedName } from '../../catalog/rules.ts'
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
import { prepareEslintCache } from './cache.ts'

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

const position = (value: unknown): boolean =>
  value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)

const isMessage = (value: unknown): value is EslintMessage =>
  isRecord(value) &&
  (value.ruleId === null || typeof value.ruleId === 'string') &&
  (value.severity === 1 || value.severity === 2) &&
  typeof value.message === 'string' &&
  position(value.line) &&
  position(value.column) &&
  (value.fix === undefined ||
    (isRecord(value.fix) &&
      typeof value.fix.text === 'string' &&
      Array.isArray(value.fix.range) &&
      value.fix.range.length === 2 &&
      value.fix.range.every(
        (offset: unknown) => typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0
      ) &&
      value.fix.range[0] <= value.fix.range[1]))

const isResult = (value: unknown): value is EslintResult => {
  if (
    !isRecord(value) ||
    typeof value.filePath !== 'string' ||
    value.filePath.length === 0 ||
    !Array.isArray(value.messages) ||
    !value.messages.every(isMessage)
  )
    return false
  return (
    (value.errorCount === undefined ||
      value.errorCount === value.messages.filter(message => message.severity === 2).length) &&
    (value.warningCount === undefined ||
      value.warningCount === value.messages.filter(message => message.severity === 1).length)
  )
}

const isReport = (value: unknown): value is EslintResult[] => Array.isArray(value) && value.every(isResult)

/** Run the project's ESLint and turn its report into findings. */
export const runEslint = async ({
  root,
  files,
  write = false,
  eslintCache = false
}: RunOptions): Promise<EngineRun> => {
  const bin = resolveBin(root, BIN)

  if (!bin) {
    throw new EngineError('ESLint is not installed in this project. Add it with your package manager.', {
      command: 'eslint'
    })
  }

  const shown = write ? ['--fix'] : []
  const quiet = ['--format', 'json', '--no-warn-ignored', '--no-error-on-unmatched-pattern']

  const cache = eslintCache && !write ? prepareEslintCache(root) : undefined

  try {
    const run = await runChunked(
      files,
      ['eslint', ...shown, ...(cache ? ['--cache'] : [])].join(' '),
      async targets => {
        const result = await runNode(bin, [...quiet, ...shown, ...(cache?.flags ?? []), ...targets], root, 'eslint', [
          ...shown,
          ...targets
        ])

        // ESLint exits with 1 when it finds problems and with 2 when it could not lint; then what it said is the reason.
        if (result.code > 1) {
          throw new EngineError(
            result.stderr.trim() || result.stdout.trim() || `ESLint exited with code ${result.code}.`,
            {
              command: result.command
            }
          )
        }

        const results = parseReport(result, 'ESLint', '[', isReport)
        const hasErrors = results.some(entry => entry.messages.some(message => message.severity === 2))
        if ((result.code === 1) !== hasErrors) {
          throw new EngineError(
            'ESLint exit status disagrees with its JSON diagnostics; the check did not complete safely.',
            {
              command: result.command
            }
          )
        }
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
              rule: message.ruleId ?? scopedName('eslint', 'parse'),
              severity: message.severity === 2 ? 'error' : 'warn',
              message: message.message,
              fixable: message.fix !== undefined
            })
          }
        }

        return findings
      }
    )

    cache?.finish()

    return run
  } catch (cause) {
    if (cause instanceof EngineError) throw cause

    throw new EngineError(
      'ESLint could not complete its report or cache safely. Run without --eslint-cache to diagnose the setup.',
      { command: 'eslint', cause }
    )
  } finally {
    cache?.dispose()
  }
}
