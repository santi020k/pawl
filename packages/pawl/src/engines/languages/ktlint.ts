import { join } from 'node:path'
import { type Finding } from '../../types.ts'
import { chunkFiles, EngineError, findOnPath, readReport } from '../engine.ts'
import {
  asArgument,
  commandIn,
  fromEngine,
  isRecordList,
  type LanguageResult,
  type LanguageRun,
  onlyFiles,
  position,
  runTool,
  ToolMissingError
} from './tool.ts'

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/**
 * Turn ktlint's JSON report into findings. ktlint's rules are about style, so each one is an error.
 * ktlint prints its own log lines before the report. Throws when the output has no report to read.
 */
export const parseKtlint = (root: string, cwd: string, stdout: string): Finding[] => {
  if (!stdout.includes('[')) return []

  const files = readReport<unknown>(stdout, '[')

  if (!isRecordList(files)) throw new Error("Could not read ktlint's report.")

  return files.flatMap(({ file: path, errors }) => {
    const file = typeof path === 'string' ? fromEngine(root, cwd, path) : undefined

    if (!file || !isRecordList(errors)) return []

    return errors.map(error => {
      const message = text(error.message)
      // A file ktlint cannot parse comes back with no rule.
      const engineRule = text(error.rule) ?? (message?.startsWith('Not a valid Kotlin file') ? 'parse' : 'ktlint')

      return {
        file,
        line: position(error.line),
        column: position(error.column),
        engine: 'ktlint',
        engineRule,
        rule: `ktlint:${engineRule}`,
        severity: 'error',
        message: message ?? engineRule,
        fixable: false
      } satisfies Finding
    })
  })
}

/**
 * Lint, and with `write` format first, a Kotlin project with ktlint, in the project's .editorconfig.
 * ktlint is both the linter and the formatter. The report of a format run words and counts what
 * is left differently, so the findings always come from a lint run.
 */
export const runKtlint = async ({ root, dir, files = [], write = false }: LanguageRun): Promise<LanguageResult> => {
  const program = findOnPath('ktlint')

  if (!program) throw new ToolMissingError('Kotlin is in the policy, but ktlint is not installed.')

  const cwd = join(root, dir)
  const findings: Finding[] = []
  const commands: string[] = []

  for (const batch of chunkFiles(files.map(asArgument))) {
    if (write) {
      const formatted = await runTool(program, ['--format', ...batch], cwd, commandIn(dir, 'ktlint --format'))

      if (!commands.includes(formatted.command)) commands.push(formatted.command)

      // ktlint exits with 1 both when something is left that it cannot fix, which the lint below
      // reports, and when it failed, as on a file it cannot write. Only a failure prints an error.
      if (formatted.code !== 0 && formatted.stderr.trim()) {
        throw new EngineError(formatted.stderr.trim() || `ktlint exited with code ${formatted.code}.`, {
          command: formatted.command
        })
      }
    }

    const result = await runTool(program, ['--reporter=json', '--relative', ...batch], cwd, commandIn(dir, 'ktlint'))

    if (!commands.includes(result.command)) commands.push(result.command)

    // ktlint exits with 1 when it finds something, with a report. Anything else is a failure.
    try {
      if (result.code > 1 || (result.code === 1 && !result.stdout.includes('['))) throw new Error('no report')

      const found = parseKtlint(root, cwd, result.stdout)

      // It said it found something, and the report names nothing in this repo: do not pass that.
      if (result.code !== 0 && found.length === 0) throw new Error('empty report')

      findings.push(...found)
    } catch (cause) {
      const said = result.stderr.trim() || result.stdout.trim().split('\n').slice(-5).join('\n')

      throw new EngineError(said || `ktlint exited with code ${result.code}.`, {
        command: result.command,
        cause
      })
    }
  }

  return { findings: onlyFiles(findings, dir, files), commands }
}
